/**
 * PRTS Electron main: monochrome window + IPC bridge (fs + http streaming).
 * The renderer (web/index.html) is fully self-contained; all persistence and
 * API traffic go through the IPC bridge to avoid CORS and enable real file
 * storage. Single instance, auto-hide menu, quit on last window closed.
 */
const { app, BrowserWindow, ipcMain, session, protocol, dialog, shell, clipboard } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFile } = require('node:child_process')

// The speech engine loads its wasm glue through dynamic import() and falls
// back to XMLHttpRequest for non-http(s) URLs — custom protocols don't work
// for XHR. So the renderer is served over a loopback-only HTTP server that
// also hosts the speech-engine files and the whisper model, all over http(s).
// (Keep the prts-stt scheme registration harmless/removed — no longer used.)
protocol.registerSchemesAsPrivileged([
  { scheme: 'prts-stt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

let win = null
const controllers = new Map()

// One PRTS window at a time: a second launch focuses the existing window
// instead of stacking another dsh-web shell.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// The PRTS backend URL is passed as the first argv (launcher) or via
// DSH_WEB_URL. Default: the isolated PRTS profile's port (3081) — never the
// official `dsh web` port (3080), which stays the original harness UI.
const DSH_WEB_URL = process.argv.find((a) => /^https?:\/\//.test(a)) || process.env.DSH_WEB_URL || 'http://127.0.0.1:3081'
// The splash runs the SAME three.js particle EFFECT as the reference
// (three + the 1:1-ported engine), so the intro looks identical.
let PRTS_PARTICLES_ENGINE = ''
try {
  PRTS_PARTICLES_ENGINE =
    fs.readFileSync(path.join(__dirname, '..', 'vendor', 'three.min.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'effect', 'arknights.js'), 'utf8')
} catch (e) {
  try { fs.writeFileSync(path.join(require('node:os').tmpdir(), 'prts-engine-err.log'), String((e && e.stack) || e)) } catch (e2) { /* noop */ }
}

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
    // Frameless: the PRTS skin draws the window bar (full black, three
    // circles − □ ×, hover-reveal). thickFrame keeps Windows aero-snap and
    // native edge resize; maximize is still available through the circles.
    frame: false,
    thickFrame: true,
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
  // The window opens INSTANTLY on a local splash page: particles play while
  // dsh boots in the background ("后台加载中"), and once dsh web answers the
  // splash redirects into it. No black screen, no retry gap.
  win.loadURL('http://127.0.0.1:' + guiPort + '/splash.html')
}

/* ---------- filesystem bridge ---------- */
ipcMain.handle('prts:readFile', (_e, p) => fs.promises.readFile(p, 'utf8'))
ipcMain.handle('prts:copyText', (_e, t) => { clipboard.writeText(String(t || '')); return true })
ipcMain.handle('prts:writeFile', async (_e, p, d) => {
  await fs.promises.writeFile(p, d, 'utf8')
  // PRTS config holds account tokens (github/deepseek) — keep it owner-only.
  try { await fs.promises.chmod(p, 0o600) } catch (err) { /* noop */ }
  return undefined
})
ipcMain.handle('prts:appendFile', (_e, p, d) => fs.promises.appendFile(p, d, 'utf8'))
ipcMain.handle('prts:deleteFile', (_e, p) => fs.promises.rm(p, { force: true }))
ipcMain.handle('prts:exists', async (_e, p) => {
  try { await fs.promises.access(p); return true } catch { return false }
})
ipcMain.handle('prts:mkdir', (_e, p) => fs.promises.mkdir(p, { recursive: true }))
ipcMain.handle('prts:listDir', (_e, p) => fs.promises.readdir(p))

/* Native directory picker — the OS's own file manager, exactly the dialog
   dsh web's workspace flow opens. Works on Windows/Linux/macOS without any
   extra desktop tooling (zenity/kdialog), so "add workspace" always has a
   browse button. */
ipcMain.handle('prts:pickDirectory', async (_e, title) => {
  try {
    const r = await dialog.showOpenDialog(win, {
      title: typeof title === 'string' && title ? title : 'Choose a workspace directory',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths || !r.filePaths.length) return null
    return r.filePaths[0]
  } catch (err) {
    return { error: String(err && err.message || err) }
  }
})

/* Native download (Session log ZIP): Electron's download manager shows the
   save dialog and writes the file — no binary corruption through the text
   IPC bridge. */
ipcMain.handle('prts:download', (_e, url) => {
  try {
    if (!win || win.isDestroyed()) throw new Error('window unavailable')
    win.webContents.downloadURL(String(url))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
})

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

/* ---------- dsh bridge: RPC + mux relay (no CORS in Node) ---------- */
// Current dsh builds serve `/api/events.mux` as a **WebSocket** (a plain GET
// answers "upgrade required"); older builds served it as an SSE stream.
// This relays either carrier to the renderer over IPC and reconnects on drop.
// IMPORTANT: the WebSocket carrier must never be opened against an unreachable
// host — a failed connect inside the Electron main process wedges its message
// loop (HTTP servers stop answering). A plain-HTTP probe therefore gates
// every connect: PRTS boots dsh in the background, so the relay keeps probing
// until dsh answers and only then opens the carrier.
let dshMuxAbort = null
let dshMuxWs = null
let dshMuxTimer = null
let dshMuxWatchTimer = null
let dshMuxReady = false

function dshMuxPush(data) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send('prts:dshFrame', data)
  } catch (e) { /* window gone */ }
}

/** Plain-HTTP readiness probe — safe against unreachable hosts. */
async function dshProbe() {
  try {
    const res = await fetch(DSH_WEB_URL.replace(/\/+$/, '') + '/api/workspace.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'prts-probe-' + Date.now(), method: 'workspace.list', payload: {} }),
    })
    if (res.status !== 200) return false
    const body = await res.json().catch(() => null)
    return !!(body && body.type === 'server-response' && body.result && body.result.ok === true)
  } catch (e) { return false }
}

/** Probe until dsh answers, then open the mux carrier once. */
function dshMuxWatchdog() {
  clearTimeout(dshMuxWatchTimer)
  if (dshMuxReady) return
  dshProbe().then((up) => {
    if (!up) { dshMuxWatchTimer = setTimeout(dshMuxWatchdog, 1500); return }
    dshMuxReady = true
    dshMuxConnect()
  }).catch(() => { dshMuxWatchTimer = setTimeout(dshMuxWatchdog, 1500) })
}

/** The stream dropped — re-probe before reconnecting so the carrier is never
 *  aimed at a host that may have gone unreachable. */
function dshMuxLost() {
  dshMuxReady = false
  dshMuxWatchdog()
}

function dshMuxParseLines(buf) {
  let idx
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, idx)
    buf = buf.slice(idx + 2)
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ')) dshMuxPush(line.slice(6).trim())
    }
  }
  return buf
}

function dshMuxConnect() {
  try { if (dshMuxAbort) dshMuxAbort.abort() } catch (e) {}
  dshMuxAbort = null
  try { if (dshMuxWs) dshMuxWs.close() } catch (e) {}
  dshMuxWs = null
  clearTimeout(dshMuxTimer)

  const base = DSH_WEB_URL.replace(/\/+$/, '')
  if (typeof WebSocket !== 'undefined') {
    const wsUrl = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/api/events.mux'
    let ws
    try { ws = new WebSocket(wsUrl) } catch (e) { ws = null }
    if (ws) {
      let opened = false
      let settled = false
      dshMuxWs = ws
      ws.onopen = () => { opened = true }
      ws.onmessage = (e) => dshMuxPush(String(e.data))
      const teardown = () => {
        if (settled) return
        settled = true
        if (dshMuxWs === ws) dshMuxWs = null
        if (!opened) { dshMuxLost(); return }   // refused upgrade / failed connect
        dshMuxLost()                            // stream dropped — re-probe first
      }
      ws.onclose = teardown
      ws.onerror = teardown
      return
    }
  }
  dshMuxSse()
}

function dshMuxSse() {
  const ac = new AbortController()
  dshMuxAbort = ac
  fetch(DSH_WEB_URL.replace(/\/+$/, '') + '/api/events.mux', { signal: ac.signal })
    .then((res) => {
      if (!res.ok || !res.body) throw new Error('mux ' + res.status)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) return
        buf += dec.decode(value, { stream: true })
        buf = dshMuxParseLines(buf)
        return pump()
      })
      return pump()
    })
    .catch(() => {})
    .finally(() => {
      if (dshMuxAbort === ac) dshMuxAbort = null
      dshMuxTimer = setTimeout(dshMuxLost, 1000)
    })
}
ipcMain.handle('prts:dshRequest', async (_e, method, payload) => {
  const res = await fetch(DSH_WEB_URL.replace(/\/+$/, '') + '/api/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'prts-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), method, payload: payload || {} }),
  })
  return res.json()
})
ipcMain.handle('prts:dshRespond', async (_e, rpcId, result) => {
  const res = await fetch(DSH_WEB_URL.replace(/\/+$/, '') + '/api/respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId, result }),
  })
  return res.json()
})

// Installed plugins = the harness profile's own bundle dependencies. There is
// no plugin *marketplace* RPC in dsh — this lists what is already installed
// (dsh core + dsh-prts-ui + anything added via `dsh plugin add <pkg>`).
function readInstalledPlugins() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(path.join(home, 'profiles')) } catch (e) { return out }
  for (const p of dirs) {
    const pkgPath = path.join(home, 'profiles', p, 'package.json')
    let m
    try { m = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch (e) { continue }
    const deps = Object.assign({}, m.dependencies, m.devDependencies)
    for (const name of Object.keys(deps)) {
      if (name === 'dsh-prts-ui') continue
      if (!out.some((x) => x.name === name)) out.push({ name, version: deps[name], profile: p })
    }
  }
  return out
}
ipcMain.handle('prts:listPlugins', () => readInstalledPlugins())

// Run the packaged updater script (update.sh / update.bat) from the app root.
// Run the stable-channel updater: it checks the website release manifest —
// the same STABLE set the download site serves; the git tree never enters it.
ipcMain.handle('prts:update', () => new Promise((resolve) => {
  const root = path.join(__dirname, '..')
  const child = execFile(process.execPath, [path.join(root, 'scripts', 'update-runner.mjs'), 'update'], { timeout: 600000 }, (err, stdout, stderr) => {
    let out = null
    try { out = JSON.parse(String(stdout || '').trim()) } catch (e) { out = null }
    resolve(out || { ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
  if (!child) resolve({ ok: false, stderr: 'could not spawn the updater' })
}))

// Speech-engine files (transformers.js + ort wasm + whisper-tiny model):
// download from CN-reachable mirrors (npmmirror / hf-mirror with official
// fallbacks), extract and cache, then hand the renderer the content. Keeps
// voice input working without GitHub or huggingface.co access at run time.
const STT_WHITELIST = new Set(['transformers.min.js', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'])
function runSttCache(args) {
  return new Promise((resolve, reject) => {
    const cacheScript = path.join(__dirname, '..', 'scripts', 'stt-cache.mjs')
    const child = execFile('node', [cacheScript, ...args], { timeout: 600000 }, () => {})
    if (!child) return reject(new Error('could not spawn node'))
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', () => {
      const filePath = stdout.trim().split('\n').pop()
      if (!filePath) return reject(new Error('stt cache miss: ' + stderr))
      resolve(filePath)
    })
    child.on('error', (e) => reject(new Error(String(e && e.message || e))))
  })
}
function ensureSttFile(rel) {
  const base = String(rel || '').split('/').filter(Boolean).pop() || ''
  if (!STT_WHITELIST.has(base)) return Promise.reject(new Error('not allowed: ' + rel))
  return runSttCache(['ensure', base])
}
function ensureModelFile(rel) {
  const base = String(rel || '').split('/').filter(Boolean).pop() || ''
  return runSttCache(['model-file', base])
}
ipcMain.handle('prts:sttFile', async (_e, rel) => {
  try {
    const filePath = await ensureSttFile(rel)
    const buf = await fs.promises.readFile(filePath)
    if (String(rel).endsWith('.js') || String(rel).endsWith('.mjs')) return { text: buf.toString('utf8') }
    return { base64: buf.toString('base64') }
  } catch (e) {
    return { error: 'stt read failed: ' + String(e && e.message || e) }
  }
})
function sttContentType(rel) {
  if (rel.endsWith('.wasm')) return 'application/wasm'
  if (rel.endsWith('.onnx')) return 'application/octet-stream'
  if (rel.endsWith('.json')) return 'application/json; charset=utf-8'
  return 'text/javascript; charset=utf-8'
}

/* ---------- PRTS panel bridge: profiles / skills / shell / auth ---------- */

function dshHomeDir() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh') }
function skillsDir() { return path.join(dshHomeDir(), 'skills') }

/** Every dsh profile and its packages, with a CLI flag for one-shot apps
 *  (packages exposing a bin), so the GUI's command directory can offer
 *  givemyflag-style plugins as commands. */
function readProfiles() {
  const home = dshHomeDir()
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(path.join(home, 'profiles')) } catch (e) { return out }
  for (const p of dirs) {
    const pkgPath = path.join(home, 'profiles', p, 'package.json')
    let m
    try { m = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch (e) { continue }
    const deps = Object.assign({}, m.dependencies, m.devDependencies)
    const packages = []
    let cli = false
    let description = ''
    let usage = ''
    for (const name of Object.keys(deps)) {
      packages.push({ name, version: String(deps[name]).replace(/^file:/, '') })
      if (name.startsWith('@deepseek-ai/')) continue
      let pm = null
      try { pm = JSON.parse(fs.readFileSync(path.join(home, 'profiles', p, 'node_modules', name, 'package.json'), 'utf8')) } catch (e) { pm = null }
      if (pm && pm.bin) {
        cli = true
        description = pm.description || description
        if (/URL/i.test(String(pm.description || ''))) usage = '<URL>'
      }
    }
    out.push({ profile: p, packages, cli, description, usage })
  }
  return out
}
ipcMain.handle('prts:listProfiles', () => readProfiles())

/** Run a CLI profile plugin (e.g. dsh --profile givemyflag <url>) in a
 *  terminal window; falls back to a detached headless run. */
ipcMain.handle('prts:runCli', (_e, profile, args) => {
  const quoted = (a) => JSON.stringify(String(a))
  const cmd = 'dsh --profile ' + profile + (Array.isArray(args) && args.length ? ' ' + args.map(quoted).join(' ') : '')
  if (process.platform === 'darwin') {
    try {
      const child = execFile('osascript', ['-e', 'tell app "Terminal" to do script ' + JSON.stringify(cmd)], () => {})
      if (child) return { ok: true, via: 'terminal' }
    } catch (e) { /* fall through */ }
  } else if (process.platform === 'win32') {
    try {
      const child = execFile('cmd', ['/c', 'start', 'cmd', '/k', cmd], () => {})
      if (child) return { ok: true, via: 'terminal' }
    } catch (e) { /* fall through */ }
  } else {
    const keep = '; echo; echo "[PRTS] done — close this window or press Enter"; read _'
    const terminals = [
      ['x-terminal-emulator', ['-e', 'bash', '-lc', cmd + keep]],
      ['gnome-terminal', ['--', 'bash', '-c', cmd + keep]],
      ['konsole', ['-e', 'bash', '-lc', cmd + keep]],
      ['xterm', ['-e', 'bash', '-lc', cmd + keep]],
    ]
    for (const [bin, argv] of terminals) {
      try {
        const child = execFile(bin, argv, { detached: true }, () => {})
        if (child) { child.unref(); return { ok: true, via: bin } }
      } catch (e) { /* next */ }
    }
  }
  try {
    const child = execFile('dsh', ['--profile', profile, ...(Array.isArray(args) ? args : [])], { detached: true, stdio: 'ignore' }, () => {})
    if (child) { child.unref(); return { ok: true, via: 'background' } }
  } catch (e) { /* fall through */ }
  return { ok: false, error: 'no terminal available' }
})

ipcMain.handle('prts:shell', (_e, cmd, args) => new Promise((resolve) => {
  const argv = Array.isArray(args) ? args : []
  const child = execFile(String(cmd), argv, { timeout: 600000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
  if (!child) resolve({ ok: false, stderr: 'could not spawn ' + cmd })
}))

ipcMain.handle('prts:openExternal', (_e, url) => {
  try {
    shell.openExternal(String(url))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
})

/* ---------- skills (the dsh user root) ---------- */

function parseSkillFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ''))
  if (!m) return {}
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

ipcMain.handle('prts:listSkills', () => {
  const dir = skillsDir()
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return [] }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const md = path.join(dir, e.name, 'SKILL.md')
    let text = ''
    try { text = fs.readFileSync(md, 'utf8') } catch (err) { continue }
    const fm = parseSkillFrontmatter(text)
    const name = fm.name || e.name
    out.push({
      name,
      description: fm.description || '',
      path: path.join(dir, e.name),
      persona: /(^|[-_.])persona($|[-_.])/.test(name) || fm.category === 'persona' || fm.persona === 'true',
    })
  }
  return out
})

ipcMain.handle('prts:readSkill', async (_e, name) => {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) throw new Error('bad skill name')
  return fs.promises.readFile(path.join(skillsDir(), safe, 'SKILL.md'), 'utf8')
})

ipcMain.handle('prts:writeSkill', async (_e, name, content) => {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) throw new Error('bad skill name')
  await fs.promises.mkdir(path.join(skillsDir(), safe), { recursive: true })
  await fs.promises.writeFile(path.join(skillsDir(), safe, 'SKILL.md'), String(content || ''), 'utf8')
  return { ok: true }
})

ipcMain.handle('prts:deleteSkill', async (_e, name) => {
  const safe = String(name || '').replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) throw new Error('bad skill name')
  await fs.promises.rm(path.join(skillsDir(), safe), { recursive: true, force: true })
  return { ok: true }
})

/** Lift one skill directory into the skills root (rename, replacing old). */
function liftSkill(srcDir, destRoot, name) {
  const safe = String(name).replace(/[^A-Za-z0-9._-]/g, '')
  if (!safe) return null
  const dest = path.join(destRoot, safe)
  try { fs.rmSync(dest, { recursive: true, force: true }) } catch (e) { /* noop */ }
  fs.renameSync(srcDir, dest)
  return safe
}

/** Clone a GitHub skill repo and normalize it into ~/.dsh/skills:
 *  - subdir given → lift that one skill (e.g. anthropics/skills skills/canvas-design)
 *  - root SKILL.md → single-skill repo
 *  - monorepo → lift every directory that contains a SKILL.md. */
ipcMain.handle('prts:skillInstall', (_e, repo, subdir) => new Promise((resolve) => {
  const baseName = String(repo || '').replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '')
  if (!/^[A-Za-z0-9._-]+$/.test(baseName) || !baseName) return resolve({ ok: false, error: 'bad repo name' })
  const tmp = path.join(os.tmpdir(), 'prts-skill-' + Date.now().toString(36))
  const root = skillsDir()
  try { fs.mkdirSync(root, { recursive: true }) } catch (e) { /* exists */ }
  const hasSkillMd = (dir) => { try { return fs.existsSync(path.join(dir, 'SKILL.md')) } catch (e) { return false } }
  const child = execFile('git', ['clone', '--depth', '1', String(repo), tmp], { timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* noop */ }
      return resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || '') })
    }
    try {
      const names = []
      if (subdir) {
        const src = path.join(tmp, String(subdir))
        if (!hasSkillMd(src)) throw new Error('no SKILL.md at ' + subdir)
        const n = liftSkill(src, root, path.basename(String(subdir)))
        if (n) names.push(n)
      } else if (hasSkillMd(tmp)) {
        const n = liftSkill(tmp, root, path.basename(tmp))
        if (n) names.push(n)
      } else {
        for (const l1 of fs.readdirSync(tmp, { withFileTypes: true })) {
          if (!l1.isDirectory()) continue
          const d1 = path.join(tmp, l1.name)
          if (hasSkillMd(d1)) { const n = liftSkill(d1, root, l1.name); if (n) names.push(n); continue }
          for (const l2 of fs.readdirSync(d1, { withFileTypes: true })) {
            if (!l2.isDirectory()) continue
            const d2 = path.join(d1, l2.name)
            if (hasSkillMd(d2)) { const n = liftSkill(d2, root, l2.name); if (n) names.push(n) }
          }
        }
        if (!names.length) throw new Error('no SKILL.md found in the repository')
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* noop */ }
      resolve({ ok: true, names })
    } catch (e) {
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e2) { /* noop */ }
      resolve({ ok: false, error: String(e && e.message || e) })
    }
  })
  if (!child) resolve({ ok: false, error: 'git unavailable' })
}))

const EDITOR_CANDIDATES = [
  { id: 'default', name: '系统默认', cmd: null, terminal: false },
  { id: 'code', name: 'VS Code', cmd: 'code', terminal: false },
  { id: 'gedit', name: '文本编辑器 (gedit)', cmd: 'gedit', terminal: false },
  { id: 'kate', name: 'Kate', cmd: 'kate', terminal: false },
  { id: 'vim', name: 'vim (终端)', cmd: 'vim', terminal: true },
  { id: 'nvim', name: 'nvim (终端)', cmd: 'nvim', terminal: true },
  { id: 'nano', name: 'nano (终端)', cmd: 'nano', terminal: true },
  { id: 'notepad', name: '记事本', cmd: 'notepad', terminal: false },
]

/** Open a command in a terminal window (cross-platform best effort). */
function spawnTerminalCmd(cmd, keepOpen) {
  const full = keepOpen ? cmd + '; echo; echo "[PRTS] done — close this window or press Enter"; read _' : cmd
  if (process.platform === 'darwin') {
    try {
      const child = execFile('osascript', ['-e', 'tell app "Terminal" to do script ' + JSON.stringify(full)], () => {})
      if (child) return true
    } catch (e) { /* next */ }
  } else if (process.platform === 'win32') {
    try {
      const child = execFile('cmd', ['/c', 'start', 'cmd', '/k', full], () => {})
      if (child) return true
    } catch (e) { /* next */ }
  } else {
    for (const [bin, argv] of [
      ['x-terminal-emulator', ['-e', 'bash', '-lc', full]],
      ['gnome-terminal', ['--', 'bash', '-c', full]],
      ['konsole', ['-e', 'bash', '-lc', full]],
      ['xterm', ['-e', 'bash', '-lc', full]],
    ]) {
      try {
        const child = execFile(bin, argv, { detached: true }, () => {})
        if (child) { child.unref(); return true }
      } catch (e) { /* next */ }
    }
  }
  return false
}

ipcMain.handle('prts:openPath', (_e, p, editorId) => {
  const ed = EDITOR_CANDIDATES.find((e) => e.id === editorId) || EDITOR_CANDIDATES[0]
  try {
    if (ed.cmd) {
      if (ed.terminal) {
        if (spawnTerminalCmd(ed.cmd + ' ' + JSON.stringify(String(p)), false)) return { ok: true }
      } else {
        const child = execFile(ed.cmd, [String(p)], () => {})
        if (child) return { ok: true }
      }
    }
    shell.openPath(String(p))
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
})

ipcMain.handle('prts:detectEditors', () => new Promise((resolve) => {
  const out = []
  let settled = false
  const done = () => { if (!settled) { settled = true; resolve(out) } }
  const probe = (cmd) => {
    const bin = process.platform === 'win32' ? 'where' : 'which'
    return new Promise((r) => execFile(bin, [cmd], (err) => r(!err)))
  }
  ;(async () => {
    out.push(EDITOR_CANDIDATES[0])   // 系统默认 always present
    for (const e of EDITOR_CANDIDATES.slice(1)) {
      if (await probe(e.cmd)) out.push(e)
    }
    done()
  })()
  setTimeout(done, 4000)
}))

ipcMain.handle('prts:readFileB64', async (_e, p) => {
  const buf = await fs.promises.readFile(String(p))
  return buf.toString('base64')
})

ipcMain.handle('prts:prtsLogo', async () => {
  try {
    const buf = await fs.promises.readFile(path.join(__dirname, '..', 'assets', 'prts.png'))
    return buf.toString('base64')
  } catch (e) { return '' }
})

ipcMain.handle('prts:writeFileB64', async (_e, p, b64) => {
  const buf = Buffer.from(String(b64 || ''), 'base64')
  await fs.promises.writeFile(String(p), buf)
  return { ok: true }
})

/* ---------- site logins (in-app windows, session reuse, key capture) ---------- */

function authPoll(authWin, isLoggedInUrl, redirectTo, tokenRe, tokenField, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    const deadline = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs)
    function finish(v) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      try { authWin.close() } catch (e) { /* already gone */ }
      resolve(v)
    }
    const poll = async () => {
      if (settled) return
      let url = ''
      try { url = authWin.webContents.getURL() } catch (e) { return finish({ ok: false, reason: 'window closed' }) }
      if (isLoggedInUrl(url)) {
        if (redirectTo && url.indexOf(redirectTo) < 0) {
          try { authWin.loadURL(redirectTo).catch(() => {}) } catch (e) { /* keep polling */ }
        }
        const html = await authWin.webContents.executeJavaScript('document.body ? document.body.innerText : ""').catch(() => '')
        const m = tokenRe.exec(html || '')
        if (m) return finish({ ok: true, [tokenField]: m[0] })
      }
      setTimeout(poll, 2500)
    }
    setTimeout(poll, 6000)
  })
}

ipcMain.handle('prts:loginDeepseek', () => {
  const partition = 'persist:prts-auth-ds'
  const authWin = new BrowserWindow({
    width: 1100, height: 760, title: 'DeepSeek 官方平台登录',
    autoHideMenuBar: true,
    webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  authWin.loadURL('https://platform.deepseek.com/sign_in').catch(() => {})
  // The official session cookie lives on this partition; an already-logged-in
  // user lands past /sign_in immediately → returns as 已登录 without a password.
  return authPoll(
    authWin,
    (url) => url.indexOf('platform.deepseek.com') >= 0 && url.indexOf('/sign_in') < 0,
    'https://platform.deepseek.com/api_keys',
    /sk-[A-Za-z0-9]{20,}/, 'apiKey', 240000,
  )
})

// Open any DeepSeek platform page in the SAME persisted partition as the
// login window: once logged in, 充值 / API Keys open straight into the
// account (no second login), and the session survives restarts on disk.
ipcMain.handle('prts:openDeepseek', (_e, page) => {
  const partition = 'persist:prts-auth-ds'
  const url = page === 'top_up' ? 'https://platform.deepseek.com/top_up'
    : page === 'api_keys' ? 'https://platform.deepseek.com/api_keys'
    : 'https://platform.deepseek.com'
  const authWin = new BrowserWindow({
    width: 1100, height: 760, title: 'DeepSeek 官方平台',
    autoHideMenuBar: true,
    webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  authWin.loadURL(url).catch(() => {})
  return Promise.resolve({ ok: true })
})

ipcMain.handle('prts:loginGithub', () => {
  const partition = 'persist:prts-auth-gh'
  const authWin = new BrowserWindow({
    width: 1100, height: 760, title: 'GitHub 登录',
    autoHideMenuBar: true,
    webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  authWin.loadURL('https://github.com/login').catch(() => {})
  return authPoll(
    authWin,
    (url) => url.indexOf('github.com') >= 0 && url.indexOf('/login') < 0,
    'https://github.com/settings/tokens/new?scopes=repo,workflow&description=PRTS+Agent',
    /ghp_[A-Za-z0-9]{20,}/, 'token', 300000,
  )
})

function splashHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>PRTS</title><style>
  html,body{margin:0;height:100%;background:#0A0A0B;overflow:hidden;font-family:sans-serif}
  #cv{position:fixed;inset:0;width:100%;height:100%}
  .stack{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none}
  .status{position:fixed;bottom:22px;left:0;right:0;text-align:center;color:#9C9CA1;font-size:12px;letter-spacing:.18em;min-height:16px;pointer-events:none;z-index:3}
  .status.hint{color:#FAFAFA;pointer-events:auto;cursor:pointer;display:inline-block;border:1px solid rgba(250,250,250,.3);border-radius:8px;padding:6px 14px}
</style></head><body>
<canvas id="cv"></canvas>
  <span class="status" id="st">后台加载中…</span>
<script>
${PRTS_PARTICLES_ENGINE || ''}
;(function(){
  var DSH='__DSH_WEB_URL__';
  var cv=document.getElementById('cv');
  if(!window.PRTS_INTRO){ document.getElementById('st').textContent='特效引擎加载失败'; return; }
  var eng=PRTS_INTRO.create(cv,{particleNum:10000,speedRange:[34,52]});
  var st=document.getElementById('st'),t0=Date.now(),ready=false,redirected=false;
  var act=0,timer=null;
  // v0.0.1(new)：入场动画提速 —— 粒子运动更快（speedRange 上调）、切镜更快
  function nextAct(){
    if(act===0) eng.showText('welcome to PRTS', 88);
    else eng.showMark(1.05);
    act=(act+1)%2;
    timer=setTimeout(nextAct,3800);
  }
  eng.showText('welcome to PRTS', 88); act=1;
  timer=setTimeout(nextAct,3800);
  cv.addEventListener('pointermove',function(e){eng.onPointerMove(e);});
  cv.addEventListener('pointerleave',function(){eng.onPointerLeave();});
  cv.addEventListener('touchmove',function(e){eng.onPointerMove(e);});
  function probe(){
    // 1) the APP's own ready signal: once fully rendered it posts
    //    /prts/api/ready (kept fresh while it runs), so a warm relaunch
    //    hands over with zero boot-screen flash. Relayed over the
    //    main-process http bridge (no CORS), chunk-accumulated.
    // 2) fallback: the dsh backend answering — a cold start's app cannot
    //    post ready before the splash redirects, so backend-up enters too.
    var tryHttp = (window.prts && window.prts.bridge && window.prts.bridge.http)
      ? function(){
          return new Promise(function(resolve){
            var buf='', settled=false;
            var settle=function(v){ if(!settled){ settled=true; resolve(v) } };
            try{
              window.prts.bridge.http({ method:'GET', url: DSH+'/prts/api/ready',
                onChunk: function(t){ buf+=t },
                onEnd: function(){
                  try{ var j=JSON.parse(buf); settle(!!(j && j.ready)) }catch(e){ settle(false) }
                } });
              setTimeout(function(){ settle(false) }, 3000);
            }catch(e){ settle(false) }
          })
        }
      : function(){ return Promise.resolve(false) }
    var tryDsh = (window.prts && window.prts.bridge && window.prts.bridge.dsh)
      ? function(){
          return window.prts.bridge.dsh.request('workspace.list',{})
            .then(function(r){ return !!(r&&r.type==='server-response'&&r.result&&r.result.ok===true) })
            .catch(function(){ return false })
        }
      : function(){
          return fetch(DSH+'/api/workspace.list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'splash-probe-'+Date.now(),method:'workspace.list',payload:{}})})
            .then(function(f){
              if(f.status===200){ return f.json().catch(function(){return null}).then(function(j){ return !!(j&&j.type==='server-response'&&j.result&&j.result.ok===true) }) }
              return false
            })
            .catch(function(){ return false })
        }
    return tryHttp().then(function(ready){ return ready ? true : tryDsh() })
  }
  function enter(){
    if(redirected)return;redirected=true;
    clearTimeout(timer);eng.stop();
    st.textContent='READY · 进入中…';
    setTimeout(function(){location.replace(DSH+'/?prtsAct='+act)},420);
  }
  document.body.addEventListener('click',function(){enter();});
  setInterval(function(){
    if(redirected||ready)return;
    var el=Date.now()-t0;
    if(el>45000){st.textContent='未检测到 PRTS 后端 — 点击重试';st.classList.add('hint')}
    else if(el>15000)st.textContent='后端仍在启动…';
  },500);
  (async function(){
    var delay=600;
    while(true){
      if(await probe()){ready=true;break}
      await new Promise(function(r){setTimeout(r,delay)});
      delay=Math.min(3000,delay+250);
    }
    st.classList.remove('hint');
    st.textContent='READY · 进入中…';
    setTimeout(enter, 900);
  })();
})();
</script></body></html>`.replace('__DSH_WEB_URL__', DSH_WEB_URL)
}

/* Loopback-only HTTP server: serves the single-file GUI plus the speech
 * engine files and the whisper model from the shared cache. Everything stays
 * on http(s) so transformers.js's XHR/module loading works untouched. */

/* PRTS 系统面板 —— 独立小窗内容（只读遥测/关于；经 window.prts.bridge 取 systemInfo） */
function systemPanelHtml() {
  return `<!DOCTYPE html><html lang="zh-CN" data-theme="dark"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PRTS · SYSTEM</title>
<style>
:root{--bg:#0A0A0B;--panel:#101012;--surface:#161618;--ink:#FAFAFA;--dim:#A0A0A5;--hair:rgba(255,255,255,.14);--acc:#7AA2F7}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;background:var(--bg);color:var(--ink);-webkit-user-select:none;user-select:none;display:flex;flex-direction:column;overflow:hidden}
.bar{display:flex;align-items:center;height:42px;padding:0 14px;gap:10px;border-bottom:1px solid var(--hair)}
.bar .rhombus{width:11px;height:11px;transform:rotate(45deg);border:1.4px solid var(--ink)}
.bar .title{font-style:italic;font-weight:700;letter-spacing:.16em;font-size:13px}
.bar .spacer{flex:1}
.winBtn{width:22px;height:22px;border:none;border-radius:6px;background:transparent;color:var(--dim);cursor:pointer;line-height:1;font-size:12px}
.winBtn:hover{background:var(--surface);color:var(--ink)}
.body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
h3{font-size:11px;letter-spacing:.2em;color:var(--dim);margin:2px 0 6px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--hair);border-radius:12px;padding:12px 14px}
.row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:12px}
.row .k{color:var(--dim);white-space:nowrap}.row .v{text-align:right;word-break:break-all}
.brandmark{display:flex;align-items:center;justify-content:center;gap:12px;padding:8px 0}
.brandmark .big{width:22px;height:22px;transform:rotate(45deg);border:2px solid var(--ink)}
.brandmark .w{font-style:italic;font-weight:800;letter-spacing:.2em;font-size:18px}
.dim{color:var(--dim);font-size:11px;text-align:center;line-height:1.7}
</style></head><body>
<div class="bar">
  <span class="rhombus"></span><span class="title">PRTS SYSTEM</span><span class="spacer"></span>
  <button class="winBtn" id="minBtn">–</button><button class="winBtn" id="closeBtn">×</button>
</div>
<div class="body">
  <div class="card brandmark"><span class="big"></span><span class="w">PRTS</span></div>
  <div class="card"><h3>关于</h3>
    <div class="row"><span class="k">版本</span><span class="v" id="ver">…</span></div>
    <div class="row"><span class="k">后端 dsh</span><span class="v" id="dsh">…</span></div>
    <div class="row"><span class="k">平台</span><span class="v" id="plat">…</span></div>
  </div>
  <div class="card"><h3>硬件遥测</h3><div id="hw"></div></div>
  <p class="dim">图形化 AI 入口 · 黑白 · 菱形 · 粒子</p>
</div>
<script>
(function(){
  var bridge = window.prts && window.prts.bridge;
  function set(id,t){ var el=document.getElementById(id); if(el) el.textContent=t }
  set('ver', (window.prts&&window.prts.env&&window.prts.env.prtsVersion)||'0.0.1');
  set('dsh', (window.prts&&window.prts.env&&window.prts.env.dshUrl)||'');
  set('plat', (window.prts&&window.prts.env&&window.prts.env.platform)||'');
  document.getElementById('closeBtn').onclick=function(){ if(bridge&&bridge.manualWindowBar) bridge.manualWindowBar('close'); else window.close() };
  document.getElementById('minBtn').onclick=function(){ if(bridge&&bridge.manualWindowBar) bridge.manualWindowBar('minimize') };
  if(bridge&&bridge.systemInfo){ bridge.systemInfo().then(function(info){
    var rows=(info&&info.rows)||[];
    function addR(k,v){ var d=document.getElementById('hw'); if(!d) return; var row=document.createElement('div'); row.className='row';
      var kk=document.createElement('span'); kk.className='k'; kk.textContent=k;
      var vv=document.createElement('span'); vv.className='v'; vv.textContent=String(v==null?'':v);
      row.appendChild(kk); row.appendChild(vv); d.appendChild(row) }
    if(info.cpu&&info.mem){ addR('CPU',info.cpu); addR('内存',info.mem) }
    else if(info.specs){ for(var i=0;i<info.specs.length;i++){ var s=info.specs[i]; addR(s.label||s[0], s.value!=null?s.value:(s[1])) } }
    else { addR('数据', JSON.stringify(info).slice(0,120)) }
    if(!rows.frame){ var d=document.getElementById('hw'); if(d&&!d.children.length) d.innerHTML='<div class="row"><span class="k">—</span><span class="v">暂无遥测数据</span></div>' }
  }).catch(function(){}) }
})();
</script></body></html>`
}


let guiServer = null
let guiPort = 0
function startGuiServer() {
  const guiHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8')
  guiServer = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0])
    try {
      if (urlPath === '/splash.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(splashHtml())
        return
      }
      if (urlPath === '/system.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(systemPanelHtml())
        return
      }
      if (urlPath === '/' || urlPath === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(guiHtml)
        return
      }
      if (urlPath.startsWith('/assets/')) {
        const rel = urlPath.slice('/assets/'.length).split('/').filter(Boolean).pop() || ''
        const filePath = await ensureSttFile(rel)
        const buf = await fs.promises.readFile(filePath)
        res.writeHead(200, { 'content-type': sttContentType(rel), 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' })
        res.end(buf)
        return
      }
      if (urlPath.startsWith('/whisper-tiny/')) {
        const rel = urlPath.split('/').filter(Boolean).pop() || ''
        const filePath = await ensureModelFile(rel)
        const buf = await fs.promises.readFile(filePath)
        res.writeHead(200, { 'content-type': sttContentType(rel), 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' })
        res.end(buf)
        return
      }
      res.writeHead(404); res.end('404')
    } catch (e) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('prts asset: ' + String(e && e.message || e))
    }
  })
  return new Promise((resolve, reject) => {
    guiServer.on('error', reject)
    guiServer.listen(0, '127.0.0.1', () => {
      guiPort = guiServer.address().port
      console.error('[prts] gui server on http://127.0.0.1:' + guiPort)
      resolve()
    })
  })
}

// Find the harness profile that owns dsh-prts-ui (so `dsh plugin add` targets
// the right profile). Defaults to "prts".
function resolveProfile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  let dirs = []
  try { dirs = fs.readdirSync(path.join(home, 'profiles')) } catch (e) { return 'prts' }
  for (const p of dirs) {
    const pkgPath = path.join(home, 'profiles', p, 'package.json')
    let m
    try { m = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) } catch (e) { continue }
    const deps = Object.assign({}, m.dependencies, m.devDependencies)
    if (deps['dsh-prts-ui']) return p
  }
  return 'prts'
}

// Install/update a plugin by npm package name, the same command dsh uses.
// (`dsh` is a .cmd shim on Windows — execFile needs shell mode there.)
ipcMain.handle('prts:pluginAdd', (_e, pkg) => new Promise((resolve) => {
  const profile = resolveProfile()
  const child = execFile('dsh', ['plugin', '--profile', profile, 'add', String(pkg)], { timeout: 300000, shell: process.platform === 'win32' }, (err, stdout, stderr) => {
    resolve({ ok: !err, profile, stdout: String(stdout || ''), stderr: String(stderr || '') })
  })
  if (!child) resolve({ ok: false, profile, stderr: 'could not spawn dsh' })
}))

// Install a plugin from a GitHub repo: clone it, then `dsh plugin add <dir>`.
ipcMain.handle('prts:pluginClone', (_e, repo) => new Promise((resolve) => {
  const tmp = path.join(os.tmpdir(), 'dsh-prts-plugin-' + Date.now().toString(36))
  execFile('git', ['clone', '--depth', '1', String(repo), tmp], { timeout: 180000 }, (err) => {
    if (err) return resolve({ ok: false, stderr: 'git clone failed: ' + String(err.message || err) })
    const profile = resolveProfile()
    execFile('dsh', ['plugin', '--profile', profile, 'add', tmp], { timeout: 300000, shell: process.platform === 'win32' }, (e2, stdout, stderr) => {
      resolve({ ok: !e2, profile, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}))

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

app.whenReady().then(async () => {
  // Grant microphone access so voice input works in the renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  await startGuiServer()
  // Warm the speech-engine cache in the background (first voice use would
  // otherwise wait for the download).
  for (const rel of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs', 'ort.bundle.min.mjs']) {
    ensureSttFile(rel).catch(() => {})
  }
  ensureModelFile('config.json').catch(() => {})
  createWindow()
  dshMuxWatchdog()
})
/* ---------- custom window-bar controls (the three circles) ---------- */
ipcMain.handle('prts:win-minimize', () => { if (win && !win.isDestroyed()) win.minimize(); return { ok: true } })
ipcMain.handle('prts:win-toggle-maximize', () => {
  if (!win || win.isDestroyed()) return { maximized: false }
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return { maximized: win.isMaximized() }
})
ipcMain.handle('prts:win-close', () => { if (win && !win.isDestroyed()) win.close(); return { ok: true } })
ipcMain.handle('prts:win-is-maximized', () => ({ maximized: !!(win && !win.isDestroyed() && win.isMaximized()) }))

/* ---------- 系统面板：独立小窗（第③④效果） ----------
 * 侧栏新增的 SYSTEM 按钮通过 prts:openSystemPanel 打开一个独立 frameless 小窗，
 * 加载本地 /system.html（一个只读遥测/关于面板），不改变主窗口布局。 */
let sysWin = null
ipcMain.handle('prts:openSystemPanel', () => {
  try {
    if (sysWin && !sysWin.isDestroyed()) { sysWin.focus(); return { ok: true } }
    sysWin = new BrowserWindow({
      width: 420, height: 560, minWidth: 360, minHeight: 460,
      backgroundColor: '#0A0A0B', autoHideMenuBar: true, show: false,
      icon: path.join(__dirname, '..', 'assets', 'prts.png'),
      frame: false, thickFrame: true,
      parent: win,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        additionalArguments: ['--dsh-url=' + DSH_WEB_URL, '--prts-window=system'],
      },
    })
    sysWin.once('ready-to-show', () => sysWin.show())
    sysWin.removeMenu()
    sysWin.loadURL('http://127.0.0.1:' + guiPort + '/system.html')
    sysWin.on('closed', () => { sysWin = null })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  }
})
ipcMain.handle('prts:closeSystemPanel', () => { if (sysWin && !sysWin.isDestroyed()) sysWin.close(); return { ok: true } })
ipcMain.handle('prts:systemWindowBar', (e, action) => {
  const w = (e.sender === sysWin && sysWin && !sysWin.isDestroyed()) ? sysWin : win
  if (!w || w.isDestroyed()) return { ok: false }
  if (action === 'close') w.close()
  else if (action === 'minimize') w.minimize()
  return { ok: true }
})

app.on('window-all-closed', () => app.quit())
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// If PRTS spawned its own `dsh web` backend, tear it down when the window
// closes so it never lingers on port 3080 and blocks the official `dsh web`.
// The runner keeps the pidfile up to date (spawn retries may change the pid);
// DSH_WEB_PID is the fallback for older runners.
function killPid(pid) {
  if (!pid || pid <= 1) return
  if (process.platform === 'win32') {
    try {
      require('node:child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch (e) { /* already gone */ }
    return
  }
  try { process.kill(pid, 'SIGKILL') } catch (e) { /* already gone */ }
}
app.on('before-quit', () => {
  let pid = Number(process.env.DSH_WEB_PID || 0)
  const pidFile = process.env.DSH_WEB_PIDFILE
  if (pidFile) {
    try {
      const txt = fs.readFileSync(pidFile, 'utf8').trim()
      if (/^\d+$/.test(txt)) pid = Number(txt)
      fs.unlinkSync(pidFile)
    } catch (e) { /* pidfile unreadable */ }
  }
  killPid(pid)
})
