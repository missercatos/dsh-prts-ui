/**
 * GUI boot: locate (or download) the pinned Electron binary and launch the
 * PRTS window detached from the dsh process. The downloader covers all
 * release platforms (linux/darwin/win32 × x64/arm64). GitHub Releases is the
 * primary source, npmmirror is the fallback for slow/CN networks.
 */
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { platform } from 'node:os'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { pkgRoot, readPkg } from './root.js'

const pkg = readPkg('package.json')
const VERSION = pkg.devDependencies && pkg.devDependencies.electron || '43.4.0'

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

/** Absolute path of the electron binary if already present. */
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
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url))
      }
      const out = createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => { out.close(() => resolve()) })
      out.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(180000, () => { req.destroy(new Error('download timeout')); })
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

/** Ensure the electron binary exists; returns its path or throws. */
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
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error('failed to fetch electron ' + VERSION + ' (' + p + '/' + a + '): ' + (lastErr && lastErr.message))
}

/** Spawn the detached PRTS window. Resolves after the binary is ready. */
export async function launchGui() {
  const bin = await ensureElectron()
  const main = join(pkgRoot, 'electron', 'main.cjs')
  const child = spawn(bin, ['--no-sandbox', main], {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { PRTS_GUI: '1' }),
  })
  child.on('error', (e) => { throw new Error('electron spawn failed: ' + e.message) })
  child.unref()
  return { ok: true, pid: child.pid }
}
