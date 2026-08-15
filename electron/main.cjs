/**
 * PRTS Electron main: monochrome window + IPC bridge (fs + http streaming).
 * The renderer (web/index.html) is fully self-contained; all persistence and
 * API traffic go through the IPC bridge to avoid CORS and enable real file
 * storage. Single instance, auto-hide menu, quit on last window closed.
 */
const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')

let win = null
const controllers = new Map()

// The dsh web URL is passed as the first argv (launcher) or via DSH_WEB_URL.
const DSH_WEB_URL = process.argv.find((a) => /^https?:\/\//.test(a)) || process.env.DSH_WEB_URL || 'http://127.0.0.1:3085'

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0A0A0B',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'prts.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: ['--dsh-url=' + DSH_WEB_URL],
    },
  })
  win.once('ready-to-show', () => win.show())
  win.removeMenu()
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'))
}

/* ---------- filesystem bridge ---------- */
ipcMain.handle('prts:readFile', (_e, p) => fs.promises.readFile(p, 'utf8'))
ipcMain.handle('prts:writeFile', (_e, p, d) => fs.promises.writeFile(p, d, 'utf8'))
ipcMain.handle('prts:appendFile', (_e, p, d) => fs.promises.appendFile(p, d, 'utf8'))
ipcMain.handle('prts:deleteFile', (_e, p) => fs.promises.rm(p, { force: true }))
ipcMain.handle('prts:exists', async (_e, p) => {
  try { await fs.promises.access(p); return true } catch { return false }
})
ipcMain.handle('prts:mkdir', (_e, p) => fs.promises.mkdir(p, { recursive: true }))
ipcMain.handle('prts:listDir', (_e, p) => fs.promises.readdir(p))

/* ---------- http bridge (streaming SSE) ---------- */
ipcMain.handle('prts:http', async (e, req) => {
  const ctrl = new AbortController()
  controllers.set(req.token, ctrl)
  try {
    const res = await fetch(req.url, {
      method: req.method || 'GET',
      headers: req.headers || {},
      body: req.body,
      signal: ctrl.signal,
    })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let n = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n++
      const text = dec.decode(value, { stream: true })
      if (process.env.PRTS_DEBUG_HTTP) console.error('prts:chunk', req.token, 'read#' + n, text.length, 'bytes')
      e.sender.send('prts:chunk', req.token, text)
    }
    if (process.env.PRTS_DEBUG_HTTP) console.error('prts:end', req.token, res.status)
    return { status: res.status }
  } catch (err) {
    console.error('prts:http failed', req.url, err && err.message)
    e.sender.send('prts:end', req.token, {
      status: 0,
      aborted: !!(err && err.name === 'AbortError'),
      message: String(err && err.message || err),
    })
    return { status: 0 }
  } finally {
    controllers.delete(req.token)
  }
})
ipcMain.handle('prts:abort', (_e, token) => {
  const c = controllers.get(token)
  if (c) c.abort()
})

/* ---------- dsh bridge: RPC + mux WebSocket relay (no CORS in Node) ---------- */
let dshWs = null
function dshWsConnect() {
  const mux = DSH_WEB_URL.replace(/^http/, 'ws').replace(/\/+$/, '') + '/api/events.mux'
  try {
    dshWs = new WebSocket(mux)
    dshWs.onmessage = (ev) => { if (win && !win.isDestroyed()) win.webContents.send('prts:dshFrame', ev.data) }
    dshWs.onclose = () => { dshWs = null; setTimeout(dshWsConnect, 1000) }
    dshWs.onerror = () => {}
  } catch (e) { setTimeout(dshWsConnect, 1000) }
}
ipcMain.handle('prts:dshRequest', async (_e, method, payload) => {
  const res = await fetch(DSH_WEB_URL.replace(/\/+$/, '') + '/api/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'prts-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), method, payload: payload || {} }),
  })
  return res.json()
})
ipcMain.handle('prts:dshSend', (_e, msg) => {
  if (dshWs && dshWs.readyState === 1) dshWs.send(msg)
})

/* ---------- system info (hardware + agent-side stats are computed in the renderer) ---------- */
function readProcMem() {
  try {
    const txt = fs.readFileSync('/proc/meminfo', 'utf8')
    const kv = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+) kB/)
      if (m) kv[m[1]] = Number(m[2]) * 1024
    }
    return kv
  } catch (e) { return {} }
}

function statfsOf(p) {
  try { return fs.statfsSync(p) } catch (e) { return null }
}

function thermalTemps() {
  const out = []
  try {
    const zones = fs.readdirSync('/sys/class/thermal')
    for (const z of zones) {
      if (!/^thermal_zone\d+$/.test(z)) continue
      let type = '', temp = null
      try { type = fs.readFileSync('/sys/class/thermal/' + z + '/type', 'utf8').trim() } catch (e) { /* noop */ }
      try { temp = Number(fs.readFileSync('/sys/class/thermal/' + z + '/temp', 'utf8').trim()) / 1000 } catch (e) { /* noop */ }
      if (temp !== null && temp > 0 && temp < 200) out.push({ zone: z, type: type || z, temp })
    }
  } catch (e) { /* noop */ }
  return out
}

function raplPower() {
  // Intel RAPL package energy (best-effort, watts over a short window).
  const dir = '/sys/class/powercap'
  try {
    const names = fs.readdirSync(dir).filter((n) => /^intel-rapl:\d+$/.test(n))
    const base = dir + '/' + names[0]
    const read = () => { try { return Number(fs.readFileSync(base + '/energy_uj', 'utf8').trim()) } catch (e) { return null } }
    const a = read()
    return new Promise((resolve) => {
      setTimeout(() => {
        const b = read()
        if (a === null || b === null) return resolve(null)
        const dt = 0.4
        resolve(Math.max(0, ((b - a) / 1e6) / dt))
      }, 400)
    })
  } catch (e) { return Promise.resolve(null) }
}

function gpuInfo() {
  return new Promise((resolve) => {
    if (process.platform !== 'linux') return resolve(null)
    execFile('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 2000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const parts = String(stdout).split('\n').map((l) => l.split(',').map((s) => s.trim())).filter((r) => r.length >= 6)[0]
      if (!parts) return resolve(null)
      resolve({
        name: parts[0], usage: Number(parts[1]) || 0,
        memUsed: Number(parts[2]) || 0, memTotal: Number(parts[3]) || 0,
        powerW: Number(parts[4]) || 0, tempC: Number(parts[5]) || 0,
      })
    })
  })
}

async function collectSystemInfo() {
  const mem = readProcMem()
  const totalmem = os.totalmem()
  const freemem = os.freemem()
  const disk = statfsOf('/')
  const diskUsed = disk && disk.blocks - disk.bfree
  const diskTotal = disk && disk.blocks
  const load = os.loadavg()
  const cpus = os.cpus()
  const cpuModel = cpus.length ? cpus[0].model : null
  const cpuSpeed = cpus.length ? cpus[0].speed : null
  const swap = { total: mem.SwapTotal || null, free: mem.SwapFree || null }
  const temps = thermalTemps()
  const power = await raplPower()
  const gpu = await gpuInfo()
  return {
    os: { type: os.type(), release: os.release(), arch: os.arch(), platform: os.platform() },
    host: os.hostname(),
    uptime: os.uptime(),
    cpu: { model: cpuModel, cores: cpus.length, speed: cpuSpeed, load: load },
    gpu,
    memory: { total: totalmem, used: Math.max(0, totalmem - freemem), pct: totalmem ? Math.round((totalmem - freemem) / totalmem * 100) : 0 },
    swap,
    disk: disk && diskTotal ? { total: diskTotal, used: diskUsed, pct: diskTotal ? Math.round(diskUsed / diskTotal * 100) : 0 } : null,
    cpuPowerW: power,
    temps,
  }
}
ipcMain.handle('prts:systemInfo', () => collectSystemInfo())

app.whenReady().then(() => {
  // Grant microphone access so voice input works in the renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  createWindow()
  dshWsConnect()
})
app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
