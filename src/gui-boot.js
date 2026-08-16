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

/** Reuse a dsh web that is already serving this default port. Only a genuine
 *  server-response (200 + `ok`) counts — a 404 from an unmounted /api route is
 *  a server that is not ready yet, not one to reuse. */
async function dshUp(url) {
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/api/workspace.list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'workspace.list', payload: {} }),
    });
    if (res.status !== 200) return false;
    const body = await res.json().catch(() => null);
    return !!(body && body.type === 'server-response' && body.result && body.result.ok === true);
  } catch (e) { return false; }
}

/** Start (or reuse) `dsh web` and resolve with its local URL once /api answers. */
async function bootDshWeb() {
  const defaultUrl = process.env.PRTS_DSH_URL || 'http://127.0.0.1:3080';
  // 1. An instance may already be running (previous launch, a separate
  //    `dsh web`, etc.) — reuse it instead of failing on the port.
  if (await dshUp(defaultUrl)) return { url: defaultUrl, child: null };
  // 2. Spawn one, detached, and poll /api until it answers. stdout is
  //    ignored — the endpoint is the real readiness signal, not the log text.
  let child;
  try {
    child = spawn('dsh', ['web'], { stdio: 'ignore', detached: true });
  } catch (e) {
    throw new Error('dsh is not installed — run `npm i -g @deepseek-ai/dsh` first');
  }
  child.unref();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await dshUp(defaultUrl)) return { url: defaultUrl, child };
    await new Promise((r) => setTimeout(r, 500));
  }
  // The backend we spawned never came up — kill it so it cannot squat on the
  // port and block the official `dsh web` later.
  try { child.kill('SIGKILL') } catch (e) { /* already gone */ }
  throw new Error('dsh web did not start in time — check that `dsh web` boots (its agent tree may be unhealthy)');
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

/** Boot dsh web and open the PRTS window over it. The returned handle keeps
 *  the runner alive until the window closes, then tears the backend down — so
 *  a PRTS-spawned `dsh web` can never outlive its window and squat on port
 *  3080 (which would break the official `dsh web`). */
export async function launchGui(opts) {
  const { url, child: dshChild } = await bootDshWeb()
  const bin = await ensureElectron()
  const main = join(pkgRoot, 'electron', 'main.cjs')
  const child = spawn(bin, ['--no-sandbox', main, url], {
    stdio: 'ignore',
    env: Object.assign({}, process.env, {
      PRTS_GUI: '1',
      DSH_WEB_URL: url,
      // Pass the spawned backend's PID so Electron can clean it up on quit
      // even if this runner dies abnormally first.
      DSH_WEB_PID: dshChild ? String(dshChild.pid) : '',
    }),
  })
  // Not detached: the Electron child keeps the runner's event loop alive, so
  // the runner stays around to clean up the backend it spawned.
  const electronExited = new Promise((resolve) => {
    child.on('exit', resolve)
    child.on('error', resolve)
  })
  return {
    ok: true, url, pid: child.pid,
    electronExited,
    cleanup() {
      // Kill only the dsh web WE spawned — a reused (already-running) backend
      // is left alone.
      if (dshChild) { try { dshChild.kill('SIGKILL') } catch (e) { /* already gone */ } }
    },
  }
}
