/**
 * PRTS stable-channel update core (in-process + CLI share the same logic).
 *
 * The ONLY source of truth is the STABLE release manifest
 * (`releaseBase`/`releases.json` from ~/.dsh/profiles/prts/prts.config.json`)
 * — the website download set and the in-app update channel are the same
 * file, and the git working tree (现行版) never enters it. A manifest that
 * declares a channel other than `stable` is ignored.
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
const IS_WIN = process.platform === 'win32'
const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'prts')

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return null }
}
const installed = readJson(join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'package.json'))
const CURRENT = (installed && installed.version) || '0.0.0'

function config() {
  const cfg = readJson(join(PROFILE_DIR, 'prts.config.json')) || {}
  return {
    releaseBase: String(cfg.releaseBase || 'https://missercatos.github.io/dsh-prts-ui/releases').replace(/\/+$/, ''),
    manifest: String(cfg.releaseManifest || 'releases.json'),
  }
}

export function versionCompare(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  }
  return 0
}

function fetchText(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? httpsGet : httpGet
    const attempt = (u, hops) => {
      const req = mod(u, { timeout: timeoutMs }, (res) => {
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
          res.resume()
          const next = res.headers.location
          if (!next || hops >= 5) return reject(new Error('redirect ' + res.statusCode))
          return attempt(new URL(next, u).toString(), hops + 1)
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
        let b = ''
        res.on('data', (d) => { b += d })
        res.on('end', () => resolve(b))
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('timeout')))
    }
    attempt(url, 0)
  })
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.indexOf('https:') === 0 ? httpsGet : httpGet
    const attempt = (u, hops) => {
      const req = mod(u, (res) => {
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0) {
          res.resume()
          const next = res.headers.location
          if (!next || hops >= 5) return reject(new Error('redirect ' + res.statusCode))
          return attempt(new URL(next, u).toString(), hops + 1)
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
        const out = createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => out.close(() => resolve()))
        out.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(300000, () => req.destroy(new Error('download timeout')))
    }
    attempt(url, 0)
  })
}

/** The stable manifest's tarball entry (and its version). */
async function stableRelease() {
  const { releaseBase, manifest } = config()
  const text = await fetchText(releaseBase + '/' + manifest)
  const m = JSON.parse(text)
  if (m.channel && m.channel !== 'stable') return null // never follow a non-stable channel
  const latest = String(m.version || '0.0.0')
  const file = (m.downloads && m.downloads.tarball) ||
    (Array.isArray(m.files) ? (m.files.find((f) => f.file && /\.tgz$/.test(f.file)) || {}).file : '') || ''
  if (!file) return null
  return { version: latest, file, url: releaseBase + '/' + file, channel: m.channel || 'stable' }
}

export async function check() {
  try {
    const rel = await stableRelease()
    if (!rel) return { current: CURRENT, latest: CURRENT, update: false, channel: 'stable' }
    return {
      current: CURRENT,
      latest: rel.version,
      update: versionCompare(rel.version, CURRENT) > 0,
      url: rel.url,
      channel: rel.channel,
    }
  } catch (e) {
    return { current: CURRENT, latest: CURRENT, update: false, channel: 'stable', error: String((e && e.message) || e) }
  }
}

/** Rewrite the `prts` launcher command: resilient — it probes the prts
 *  profile first, then the legacy web profile, and prints a reinstall hint
 *  when neither exists (the old fixed web-profile path broke after the
 *  profile isolation). */
function refreshLauncher() {
  try {
    if (IS_WIN) {
      const dir = join(HOME, '.local', 'bin')
      mkdirSync(dir, { recursive: true })
      const lines = [
        '@echo off',
        'for %%P in (prts web) do (',
        '  if exist "%USERPROFILE%\\.dsh\\profiles\\%%P\\node_modules\\dsh-prts-ui\\bin\\dsh-prts-ui.js" (',
        '    node "%USERPROFILE%\\.dsh\\profiles\\%%P\\node_modules\\dsh-prts-ui\\bin\\dsh-prts-ui.js" %*',
        '    exit /b 0',
        '  )',
        ')',
        'echo PRTS not installed — run the installer again.',
        'exit /b 1',
      ]
      writeFileSync(join(dir, 'prts.cmd'), lines.join('\r\n') + '\r\n')
    } else {
      const dir = join(HOME, '.local', 'bin')
      mkdirSync(dir, { recursive: true })
      const script = [
        '#!/bin/sh',
        '# PRTS launcher — prts profile first, legacy web profile fallback.',
        'BASE="$HOME/.dsh/profiles"',
        'for P in prts web; do',
        '  BIN="$BASE/$P/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js"',
        '  if [ -f "$BIN" ]; then exec node "$BIN" "$@"; fi',
        'done',
        'echo "PRTS not installed — run the installer again (or: dsh plugin --profile prts add <dsh-prts-ui tgz>)." >&2',
        'exit 1',
      ]
      writeFileSync(join(dir, 'prts'), script.join('\n') + '\n', { mode: 0o755 })
    }
    return true
  } catch (e) { return false }
}

/** Refresh the desktop shortcut (best-effort; the package's own bin). */
function refreshShortcut() {
  try {
    const pkg = readJson(join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'package.json'))
    const bin = join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'bin', 'dsh-prts-ui.js')
    if (pkg && existsSync(bin)) {
      spawnSync(process.execPath, [bin, '--shortcut'], { stdio: 'ignore', shell: IS_WIN, timeout: 120000 })
      return true
    }
    return false
  } catch (e) { return false }
}

function dshPlugin(args) {
  const r = spawnSync('dsh', ['plugin', '--profile', 'prts', ...args], {
    encoding: 'utf8', shell: IS_WIN, timeout: 600000,
  })
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}

function pinBundles() {
  const p = join(PROFILE_DIR, 'package.json')
  const m = readJson(p) || { name: 'dsh-profile-prts', private: true, dependencies: {} }
  m.dsh = m.dsh || {}
  const ex = (m.dsh.profile && m.dsh.profile.bundles) || []
  const wanted = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-prts-ui']
  m.dsh.profile = { bundles: Array.from(new Set([...wanted, ...ex.filter((b) => wanted.indexOf(b) < 0)])) }
  writeFileSync(p, JSON.stringify(m, null, 2))
}

export async function update() {
  const c = await check()
  if (!c.update) return { ok: true, updated: false, version: c.current, ...c }
  mkdirSync(join(DSH_HOME, 'profiles', 'prts'), { recursive: true })
  const tmp = join(DSH_HOME, 'profiles', 'prts', '.prts-update.tgz')
  try {
    await download(c.url, tmp)
  } catch (e) {
    return { ok: false, error: 'download failed: ' + String((e && e.message) || e) }
  }
  // NOTE: keep the downloaded tarball — pnpm records it as a `file:`-spec
  // dependency, so deleting it would break every later profile install.
  // Clear pnpm's file:-tarball cache first: it keys by filename, so a
  // re-downloaded `.prts-update.tgz` would otherwise serve the stale copy.
  try {
    const store = spawnSync('pnpm', ['store', 'path'], { encoding: 'utf8', shell: IS_WIN }).stdout.toString().trim()
    if (store && store.indexOf('pnpm-store') >= 0) {
      const { readdirSync: readdirSync1, rmSync: rmSync1 } = await import('node:fs')
      for (const e of readdirSync1(store)) if (e.startsWith('file+') && e.indexOf('prts-update') >= 0) { try { rmSync1(join(store, e), { recursive: true, force: true }) } catch (err) { /* noop */ } }
    }
  } catch (e) { /* cache cleanup is best-effort */ }
  dshPlugin(['remove', 'dsh-prts-ui'])
  const r = dshPlugin(['add', tmp])
  if (r.code !== 0) return { ok: false, error: (r.err || r.out || 'pnpm failed').slice(0, 400) }
  pinBundles()
  const after = readJson(join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'package.json'))
  // the update ALWAYS repairs the launcher command and the desktop shortcut
  const launcher = refreshLauncher()
  const shortcut = refreshShortcut()
  return { ok: true, updated: true, version: (after && after.version) || c.latest, launcher, shortcut }
}

