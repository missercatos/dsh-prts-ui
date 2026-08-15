/**
 * PRTS GUI boot: starts the dsh web backend, waits for its local URL, then
 * opens the PRTS Electron window pointed at that URL. PRTS is only the shell —
 * the agent, sessions, tools, models and plugins all live in dsh, so PRTS
 * keeps working across dsh upgrades as long as `dsh web` still prints its URL.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:os'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { pkgRoot, readPkg } from './root.js'

const pkg = readPkg('package.json')
const VERSION = (pkg.devDependencies && pkg.devDependencies.electron) || '43.4.0'

/* ---------- dsh web backend ---------- */

/** Start `dsh web` and resolve with its local URL once it is printed. */
function bootDshWeb() {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('dsh', ['web'], { stdio: ['ignore', 'pipe', 'pipe'], detached: false })
    } catch (e) {
      reject(new Error('dsh is not installed — run `npm i -g @deepseek-ai/dsh` first'))
      return
    }
    let buf = ''
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('dsh web did not start in time')); try { child.kill(); } catch (e) {} } }, 60000)
    const onData = (d) => {
      if (settled) return
      buf += d.toString()
      const m = buf.match(/https?:\/\/127\.0\.0\.1:\d+/)
      if (m) { settled = true; clearTimeout(timer); resolve({ url: m[0], child }) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e) } })
    child.on('exit', (code) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('dsh web exited: ' + code)) } })
  })
}

/* ---------- Electron ---------- */

function releaseName() {
  const p = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  const a = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  return { p, a, file: 'electron-v' + VERSION + '-' + p + '-' + a + '.zip' }
}

function binaryName(p) {
  if (p === 'win32') return 'electron.exe'
  if (p === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
  return 'electron'
}

function electronCacheDir() {
  return join(process.env.PRTS_ELECTRON_CACHE || join(process.env.HOME || process.env.USERPROFILE || '.', '.cache', 'prts', 'electron'), 'v' + VERSION)
}

export function electronBinary() {
  const fromEnv = process.env.PRTS_ELECTRON
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const { p } = releaseName()
  const bin = join(electronCacheDir(), binaryName(p))
  return existsSync(bin) ? bin : null
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? httpsGet : httpGet
    const req = mod(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume()
        return reject(Object.assign(new Error('redirect ' + res.statusCode), { redirect: res.headers.location }))
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' for ' + url)) }
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve()))
      out.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(180000, () => req.destroy(new Error('download timeout')))
  })
}

function unzip(zipPath, dir) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32'
      ? { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Expand-Archive -Force -Path ' + JSON.stringify(zipPath) + ' -DestinationPath ' + JSON.stringify(dir)] }
      : { file: 'unzip', args: ['-oq', zipPath, '-d', dir] }
    const child = spawn(cmd.file, cmd.args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('unzip failed: ' + code))))
  })
}

export async function ensureElectron() {
  const found = electronBinary()
  if (found) return found
  const { p, a, file } = releaseName()
  const dir = electronCacheDir()
  mkdirSync(dir, { recursive: true })
  const zip = join(dir, file)
  const sources = [
    'https://github.com/electron/electron/releases/download/v' + VERSION + '/' + file,
    'https://npmmirror.com/mirrors/electron/' + VERSION + '/' + file,
  ]
  let lastErr = null
  for (const url of sources) {
    try {
      rmSync(zip, { force: true })
      await download(url, zip)
      await unzip(zip, dir)
      rmSync(zip, { force: true })
      const bin = join(dir, binaryName(p))
      if (!existsSync(bin)) throw new Error('binary missing after unzip')
      return bin
    } catch (e) { lastErr = e }
  }
  throw new Error('failed to fetch electron ' + VERSION + ' (' + p + '/' + a + '): ' + (lastErr && lastErr.message))
}

/** Boot dsh web and open the PRTS window over it. */
export async function launchGui(opts) {
  const { url } = await bootDshWeb()
  const bin = await ensureElectron()
  const main = join(pkgRoot, 'electron', 'main.cjs')
  const child = spawn(bin, ['--no-sandbox', main, url], {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { PRTS_GUI: '1', DSH_WEB_URL: url }),
  })
  child.on('error', () => { /* window already detached */ })
  child.unref()
  return { ok: true, url, pid: child.pid }
}
