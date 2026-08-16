/**
 * PRTS GUI boot: opens the PRTS Electron window IMMEDIATELY and starts (or
 * reuses) the `dsh web` backend in the background. The particle intro doubles
 * as the loading animation: it keeps looping until the renderer's own ping
 * reaches dsh, a click before that shows the "not loaded" hint, and when the
 * window closes the dsh web backend PRTS spawned is torn down so it never
 * lingers on port 3080. PRTS is only the shell — the agent, sessions, tools,
 * models and plugins all live in dsh, so PRTS keeps working across dsh
 * upgrades as long as `dsh web` still serves /api.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

/** Kill a backend child across platforms (Windows .cmd shims need taskkill). */
function killChild(child) {
  if (!child) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch (e) { /* already gone */ }
    return;
  }
  try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
}

/** Spawn one detached `dsh web`. On Windows `dsh` is a .cmd shim, which plain
 *  spawn() cannot execute — shell mode fixes that (the launcher itself lives
 *  in the same situation). */
function spawnDshWeb() {
  const opts = { stdio: 'ignore', detached: true };
  if (process.platform === 'win32') opts.shell = true;
  let child;
  try {
    child = spawn('dsh', ['web'], opts);
  } catch (e) {
    return null;
  }
  try { child.unref(); } catch (e) { /* noop */ }
  child.on('error', () => { /* handled via exit/retry below */ });
  return child;
}

/**
 * Start the dsh web backend without blocking on readiness: spawn immediately,
 * retry spawns silently while the window lives (dsh may still be installing
 * or the first boot may be slow), and keep the pid written to a pidfile so
 * Electron can tear the backend down on quit even if the runner dies first.
 * Reuses a dsh web that is already answering (child = null — never killed).
 */
async function startBackend(url) {
  const state = {
    child: null,
    spawnTimer: null,
    attempts: 0,
    stopped: false,
    pidFile: join(tmpdir(), 'prts-dsh-' + process.pid + '.pid'),
  };
  const writePid = () => {
    try { if (state.child && state.child.pid) writeFileSync(state.pidFile, String(state.child.pid), 'utf8'); } catch (e) { /* noop */ }
  };
  const clearPid = () => { try { unlinkSync(state.pidFile); } catch (e) { /* noop */ } };
  const stop = () => {
    state.stopped = true;
    clearTimeout(state.spawnTimer);
    killChild(state.child);
    state.child = null;
    clearPid();
  };

  if (await dshUp(url)) {
    // An instance is already serving — reuse it and never touch it.
    clearPid();
    return { child: null, pidFile: state.pidFile, stop };
  }

  const trySpawn = () => {
    if (state.stopped) return;
    state.attempts++;
    // After a while, stop respawning: a backend that keeps dying instantly
    // (port squatted by a non-dsh service, broken install) should not burn
    // CPU forever. The renderer keeps pinging and the intro keeps looping.
    if (state.attempts > 12) return;
    const child = spawnDshWeb();
    if (!child) {
      // dsh is not on PATH yet — retry quietly.
      state.spawnTimer = setTimeout(trySpawn, Math.min(3000, 600 + state.attempts * 400));
      return;
    }
    state.child = child;
    writePid();
    child.on('exit', () => {
      if (state.child === child) state.child = null;
      if (!state.stopped) state.spawnTimer = setTimeout(trySpawn, 2000);
    });
  };
  trySpawn();

  // Readiness probe — informational only; the renderer drives the UX with
  // its own ping loop. Stops probing once the window closes.
  (async () => {
    while (!state.stopped) {
      if (await dshUp(url)) return;
      await new Promise((r) => setTimeout(r, 700));
    }
  })().catch(() => {});

  return { child: state.child, pidFile: state.pidFile, stop };
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

/** Open the PRTS window immediately and boot dsh web in the background.
 *  The window is the priority surface: it appears at once, its particle intro
 *  loops as the loading animation while dsh (and the profile's plugins) come
 *  up, and a click before readiness shows the "not loaded" hint. The returned
 *  handle keeps the runner alive until the window closes, then tears the
 *  backend down — so a PRTS-spawned `dsh web` can never outlive its window
 *  and squat on port 3080 (which would break the official `dsh web`). */
export async function launchGui(opts) {
  const url = process.env.PRTS_DSH_URL || 'http://127.0.0.1:3080'
  // 1. Kick the backend spawn off right away — it boots in parallel with the
  //    Electron download (first run) and the window itself. No readiness wait:
  //    the renderer drives the "loaded" state with its own ping loop.
  const backend = await startBackend(url)
  // 2. Electron binary (downloads to ~/.cache/prts/electron on first run).
  const bin = await ensureElectron()
  const main = join(pkgRoot, 'electron', 'main.cjs')
  const cdpArgs = process.env.PRTS_CDP ? ['--remote-debugging-port=' + process.env.PRTS_CDP] : []
  const child = spawn(bin, ['--no-sandbox'].concat(cdpArgs, [main, url]), {
    stdio: 'ignore',
    env: Object.assign({}, process.env, {
      PRTS_GUI: '1',
      DSH_WEB_URL: url,
      // Fallback PID + the live pidfile: Electron cleans the spawned backend
      // up on quit even if this runner dies abnormally first.
      DSH_WEB_PID: backend.child ? String(backend.child.pid) : '',
      DSH_WEB_PIDFILE: backend.pidFile,
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
      backend.stop()
    },
  }
}
