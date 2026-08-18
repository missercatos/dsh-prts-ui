#!/usr/bin/env node
/**
 * PRTS installer wizard — one cross-platform bootstrap for the integrated
 * package (Windows / Linux / macOS). Zero-dependency Node HTTP server on
 * 127.0.0.1: serves the PRTS-styled wizard page and drives the install
 * pipeline, streaming live progress (dsh download included) to the page.
 *
 * Pipeline (the "modpack" flow):
 *   1. environment check (node / npm / pnpm)
 *   2. dsh harness — already installed? skip : npm i -g @deepseek-ai/dsh
 *      (progress shown while downloading)
 *   3. plugin selection — installed plugins are greyed out in the page
 *   4. PRTS UI package into the isolated `prts` profile (bundles pinned)
 *   5. migration: clean pre-0.9.4 installs out of the official web profile
 *   6. config provision + desktop shortcuts
 */

import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform as osPlatform } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = osPlatform() === 'win32'
const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'prts')
const WEB_PROFILE_DIR = join(DSH_HOME, 'profiles', 'web')

/** The integrated pack's plugin manifest — exactly these nine. Installed
 *  plugins are greyed out in the wizard; everything lands in the PRTS
 *  profile (the official `dsh web` profile stays untouched). */
const PLUGINS = [
  { id: 'dsh-better-sidebar', label: 'dsh-better-sidebar', desc: '类 VSCode 侧栏（资源管理器 / 编辑器 / 终端 / Git）', def: true },
  { id: 'dsh-sidebar-files', label: 'dsh-sidebar-files', desc: '侧栏文件管理', def: true },
  { id: 'dshmarket', label: 'dshmarket', desc: 'dsh 插件市场：浏览、搜索、一键装卸插件', def: true },
  { id: 'git+https://github.com/ChenRuoT/dsh-sidebar-qa.git', label: 'dsh-sidebar-qa', desc: '侧栏问答（GitHub 源码安装）', def: true },
  { id: '@liustack/modlens@3.17.2', label: 'ModLens', desc: '视觉增强：给纯文本模型增加图片理解能力', def: true },
  { id: 'dsh-at-file', label: 'dsh-at-file', desc: '@ 引用文件', def: true },
  { id: 'dsh-paste-input', label: 'dsh-paste-input', desc: '粘贴输入增强', def: true },
  { id: 'dsh-office', label: 'dsh-office', desc: 'Office 文档处理', def: true },
  { id: 'sh-browser-panel', label: 'sh-browser-panel', desc: '浏览器面板', def: true },
]

/* ---------- state ---------- */
const state = {
  step: 'idle',        // idle | running | done | error
  stage: '',
  progress: 0,
  log: [],
  error: '',
  started: false,
  finished: false,
}

function pushLog(line) {
  state.log.push(String(line).replace(/\x1b\[[0-9;]*m/g, '').replace(/[^\x20-\x7E\u4e00-\u9fff\n\r\t]/g, ''))
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400)
}

function versionCompare(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1
  }
  return 0
}

/* ---------- environment / installed-state detection ---------- */

function spawnSyncSafe(file, args, opts = {}) {
  const o = Object.assign({ encoding: 'utf8', shell: IS_WIN }, opts)
  try { return spawnSync(file, args, o) } catch (e) { return { status: 1, error: e } }
}

function hasCmd(cmd) {
  const r = spawnSyncSafe(IS_WIN ? 'where' : 'which', [cmd])
  return r.status === 0
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch (e) { return null }
}

function installedVersion(spec) {
  // Normalize a pnpm spec (version suffix / git+ prefix) to the package
  // directory name under the profile's node_modules.
  let name = String(spec)
  if (name.startsWith('git+')) name = name.slice(4).replace(/\.git$/, '').split('/').pop()
  else name = name.replace(/@(\d[\w.+-]*)$/, '')
  const rel = join(PROFILE_DIR, 'node_modules', ...name.split('/'))
  const m = readJson(join(rel, 'package.json'))
  return m && m.version ? m.version : null
}

function dshVersion() {
  const r = spawnSyncSafe('dsh', ['--version'])
  if (r.status !== 0 || !r.stdout) return null
  const line = String(r.stdout).trim().split('\n')[0]
  return line.length < 60 ? line : 'installed'
}

function prtsVersion() {
  return installedVersion('dsh-prts-ui') || null
}

function dshInstalled() {
  return hasCmd('dsh') && dshVersion() !== null
}

/** The tarball the installer payload ships (explicit arg or newest found). */
function findTgz(preferred) {
  // ALWAYS resolve to an absolute path: pnpm treats a bare tarball name as
  // an npm registry package (404) unless it is a real filesystem path.
  if (preferred && existsSync(preferred)) return resolve(preferred)
  const files = readdirSync(ROOT).filter((f) => /^dsh-prts-ui-[\d.]+\.tgz$/.test(f)).sort()
  if (!files.length) return null
  return join(ROOT, files[files.length - 1])
}

function snapshot() {
  const plugins = PLUGINS.map((p) => ({ id: p.id, label: p.label, desc: p.desc, def: p.def, installed: !!installedVersion(p.id) }))
  return {
    platform: IS_WIN ? 'windows' : osPlatform() === 'darwin' ? 'macos' : 'linux',
    version: (readJson(join(ROOT, 'package.json')) || {}).version || '0.0.0',
    tgz: findTgz(process.env.PRTS_WIZARD_TGZ || '') ? 'ok' : 'missing',
    dsh: { installed: dshInstalled(), version: dshVersion() },
    prtsInstalled: prtsVersion(),
    plugins,
    step: state.step,
    stage: state.stage,
    progress: state.progress,
    error: state.error,
    log: state.log.slice(-160),
  }
}

/* ---------- pipeline ---------- */

function execLog(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    pushLog('$ ' + [cmd, ...args.map((a) => JSON.stringify(String(a)))].join(' '))
    const child = spawn(cmd, args, Object.assign({ shell: IS_WIN, windowsHide: true }, opts))
    let buf = ''
    const feed = (d) => {
      buf += String(d)
      let i
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) pushLog(line) }
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    child.on('error', (e) => { pushLog('error: ' + (e && e.message)); resolve(1) })
    child.on('close', (code) => {
      if (buf.trim()) pushLog(buf.trim())
      resolve(code === null ? 1 : code)
    })
  })
}

function bump(pct, stage) {
  state.progress = Math.max(state.progress, Math.min(100, Math.round(pct)))
  state.stage = stage
}

function npmInstallGlobal(pkg) {
  // npm i -g <pkg>, npmmirror fallback for CN networks.
  return (async () => {
    pushLog('dsh 正在下载 — 首次安装需要一些时间…')
    const r1 = await execLog(IS_WIN ? 'npm.cmd' : 'npm', ['install', '-g', pkg])
    if (r1 === 0) return true
    pushLog('primary registry failed — retrying with npmmirror…')
    const r2 = await execLog(IS_WIN ? 'npm.cmd' : 'npm', ['install', '-g', pkg, '--registry=https://registry.npmmirror.com'])
    return r2 === 0
  })()
}

async function runPipeline(selectedPlugins) {
  state.started = true
  state.step = 'running'
  state.log = []
  state.error = ''
  try {
    // 1. environment
    bump(3, '检测运行环境')
    if (!hasCmd('npm')) { pushLog('npm not found — installing pnpm needs npm; aborting'); throw new Error('未检测到 npm（Node.js 自带）。') }
    if (!hasCmd('pnpm')) {
      bump(5, '安装 pnpm')
      await execLog(IS_WIN ? 'npm.cmd' : 'npm', ['install', '-g', 'pnpm'])
    }

    // 2. dsh harness
    if (!dshInstalled()) {
      bump(8, 'dsh 正在下载')
      const ok = await npmInstallGlobal('@deepseek-ai/dsh')
      if (!ok || !dshInstalled()) throw new Error('dsh 安装失败。')
      pushLog('dsh installed: ' + dshVersion())
    } else {
      pushLog('dsh 已安装: ' + dshVersion())
    }
    bump(55, 'dsh 本体就绪')

    // 3. selected plugins (installed ones skip automatically; git-hosted
    //    packages get their build script approved on the first attempt)
    const plugins = PLUGINS.filter((p) => selectedPlugins.indexOf(p.id) >= 0 && !installedVersion(p.id))
    let i = 0
    for (const p of plugins) {
      bump(55 + Math.round((i / Math.max(1, plugins.length)) * 20), '安装插件 ' + p.label)
      let code = await execLog('dsh', ['plugin', '--profile', 'prts', 'add', p.id])
      if (code !== 0) {
        // pnpm 11 blocks build scripts until approved — approve the hinted
        // package name and retry once before giving up on this plugin.
        const hinted = state.log.slice(-40).join('\n').match(/(?:approve-builds|ignored build scripts?|allowBuilds)[^\n]*?[\s'"]+(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)/i)
        if (hinted && hinted[1]) {
          const ws = join(PROFILE_DIR, 'pnpm-workspace.yaml')
          try {
            const lines = readFileSync(ws, 'utf8').split('\n')
            const already = lines.some((l) => l.indexOf('  ' + hinted[1] + ':') === 0)
            if (!already) {
              const q2 = (k) => (/^@/.test(k) ? "'" + k + "'" : k)
              const idx = lines.findIndex((l) => /^allowBuilds:/.test(l))
              if (idx >= 0) { lines.splice(idx + 1, 0, '  ' + q2(hinted[1]) + ': true'); writeFileSync(ws, lines.join('\n')) }
            }
          } catch (e) { /* noop */ }
          code = await execLog('dsh', ['plugin', '--profile', 'prts', 'add', p.id])
        }
        if (code !== 0) pushLog('（跳过）' + p.id + ' 未能安装 — 不影响安装')
      }
      i++
    }

    // 4. PRTS UI package into the prts profile
    const tgz = findTgz(process.env.PRTS_WIZARD_TGZ || '')
    if (!tgz) throw new Error('安装包缺少 dsh-prts-ui-*.tgz')
    bump(80, '安装 PRTS 界面')
    mkdirSync(PROFILE_DIR, { recursive: true })
    // Keep the tarball INSIDE the profile: the self-extracting installer
    // deletes its payload directory on exit, and a dangling `file:` spec
    // would break every later profile operation.
    const keptTgz = join(PROFILE_DIR, 'dsh-prts-ui-' + snapshot().version + '.tgz')
    try { copyFileSync(tgz, keptTgz) } catch (e) { /* fall through to the payload path */ }
    const installTgz = existsSync(keptTgz) ? keptTgz : tgz
    const bundles = join(PROFILE_DIR, 'package.json')
    let m = readJson(bundles) || { name: 'dsh-profile-prts', private: true, dependencies: {} }
    m.dsh = m.dsh || {}
    const wanted = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
    const cur = (m.dsh.profile && m.dsh.profile.bundles) || []
    m.dsh.profile = { bundles: [...wanted, ...cur.filter((b) => wanted.indexOf(b) < 0)] }
    writeFileSync(bundles, JSON.stringify(m, null, 2) + '\n')
    // allowBuilds (pnpm 11 build-script approvals)
    const ws = join(PROFILE_DIR, 'pnpm-workspace.yaml')
    const base = new Map([
      ['node-pty', 'true'], ['koffi', 'true'], ['protobufjs', 'true'],
      ['@google/genai', 'true'], ['@deepseek-ai/dsh-subprocess-local', 'true'], ['dsh-prts-ui', 'true'],
    ])
    const extra = new Map()
    try {
      for (const line of readFileSync(ws, 'utf8').split('\n')) {
        const mm = line.match(/^  (@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?): (true|false)\s*$/)
        if (mm && !base.has(mm[1])) extra.set(mm[1], mm[2])
      }
    } catch (e) { /* new file */ }
    const q = (k) => (/^@/.test(k) ? "'" + k + "'" : k)
    writeFileSync(ws, 'allowBuilds:\n' + [...base, ...extra].map(([k, v]) => '  ' + q(k) + ': ' + v).join('\n') + '\n')
    let code = await execLog('dsh', ['plugin', '--profile', 'prts', 'add', installTgz])
    if (code !== 0 || !prtsVersion()) throw new Error('PRTS 插件安装失败。')
    // pin the bundle (web bundles first, dsh-prts-ui after, others preserved)
    m = readJson(bundles) || {}
    m.dsh = m.dsh || {}
    const ex = (m.dsh.profile && m.dsh.profile.bundles) || []
    const want2 = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-prts-ui']
    m.dsh.profile = { bundles: Array.from(new Set([...want2, ...ex.filter((b) => want2.indexOf(b) < 0)])) }
    writeFileSync(bundles, JSON.stringify(m, null, 2) + '\n')
    pushLog('PRTS installed: v' + prtsVersion())

    // 5. migration: restore the official web profile (pre-0.9.4 installs)
    bump(92, '恢复原版 dsh web')
    if (existsSync(join(WEB_PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'package.json'))) {
      await execLog('dsh', ['plugin', '--profile', 'web', 'remove', 'dsh-prts-ui'])
    }
    const wm = readJson(join(WEB_PROFILE_DIR, 'package.json'))
    if (wm && wm.dsh && wm.dsh.profile && Array.isArray(wm.dsh.profile.bundles)) {
      const before = wm.dsh.profile.bundles.length
      wm.dsh.profile.bundles = wm.dsh.profile.bundles.filter((b) => b !== 'dsh-prts-ui')
      if (wm.dsh.profile.bundles.length !== before) writeFileSync(join(WEB_PROFILE_DIR, 'package.json'), JSON.stringify(wm, null, 2))
    }

    // 6. config + shortcuts
    bump(95, '写入配置与快捷方式')
    const cfg = join(PROFILE_DIR, 'prts.config.json')
    if (!existsSync(cfg)) {
      const example = join(ROOT, 'prts.config.example.json')
      if (existsSync(example)) writeFileSync(cfg, readFileSync(example, 'utf8'))
    }
    const bin = join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'bin', 'dsh-prts-ui.js')
    if (existsSync(bin)) {
      await execLog(process.execPath, [bin, '--shortcut'])
    } else {
      pushLog('shortcut skipped: PRTS bin not found')
    }
    // the `prts` command: resilient launcher (prts profile → legacy web fallback)
    if (IS_WIN) {
      const dir = join(HOME, '.local', 'bin')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'prts.cmd'), [
        '@echo off',
        'for %%P in (prts web) do (',
        '  if exist "%USERPROFILE%\\.dsh\\profiles\\%%P\\node_modules\\dsh-prts-ui\\bin\\dsh-prts-ui.js" (',
        '    node "%USERPROFILE%\\.dsh\\profiles\\%%P\\node_modules\\dsh-prts-ui\\bin\\dsh-prts-ui.js" %*',
        '    exit /b 0',
        '  )',
        ')',
        'echo PRTS not installed - run the installer again.',
        'exit /b 1',
      ].join('\r\n') + '\r\n')
    } else {
      const dir = join(HOME, '.local', 'bin')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'prts'), [
        '#!/bin/sh',
        'BASE="$HOME/.dsh/profiles"',
        'for P in prts web; do',
        '  BIN="$BASE/$P/node_modules/dsh-prts-ui/bin/dsh-prts-ui.js"',
        '  if [ -f "$BIN" ]; then exec node "$BIN" "$@"; fi',
        'done',
        'echo "PRTS not installed - run the installer again." >&2',
        'exit 1',
      ].join('\n') + '\n', { mode: 0o755 })
    }
    pushLog('prts command -> ' + join(HOME, '.local', 'bin', (IS_WIN ? 'prts.cmd' : 'prts')))

    bump(100, '完成')
    state.step = 'done'
    state.finished = true
  } catch (error) {
    state.step = 'error'
    state.error = String((error && error.message) || error)
    pushLog('ERROR: ' + state.error)
  }
}

/* ---------- HTTP ---------- */

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}
function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}
async function readBody(req) {
  let b = ''
  for await (const c of req) b += c
  return b
}

const WIZARD_HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8')

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  try {
    if (url.pathname === '/' || url.pathname === '/index.html') return html(res, WIZARD_HTML)
    if (url.pathname === '/api/state') return json(res, 200, snapshot())
    if (url.pathname === '/api/install' && req.method === 'POST') {
      if (state.started) return json(res, 409, { ok: false, error: 'already started' })
      const body = JSON.parse(await readBody(req) || '{}')
      const selected = Array.isArray(body.plugins) ? body.plugins.filter((p) => typeof p === 'string') : []
      runPipeline(selected)
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/launch' && req.method === 'POST') {
      const bin = join(PROFILE_DIR, 'node_modules', 'dsh-prts-ui', 'bin', 'dsh-prts-ui.js')
      if (existsSync(bin)) {
        const child = spawn(process.execPath, [bin], { detached: true, stdio: 'ignore', windowsHide: true })
        child.unref()
        return json(res, 200, { ok: true })
      }
      return json(res, 400, { ok: false, error: 'PRTS not installed' })
    }
    json(res, 404, { ok: false })
  } catch (error) {
    json(res, 500, { ok: false, error: String((error && error.message) || error) })
  }
})

function openBrowser(port) {
  const url = 'http://127.0.0.1:' + port + '/'
  const cmd = IS_WIN
    ? ['cmd', ['/c', 'start', '', url]]
    : osPlatform() === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', shell: IS_WIN })
    child.unref()
  } catch (e) { /* browser must be opened manually */ }
}

/** The wizard is a REAL desktop GUI window (Electron, PRTS-dark, frameless)
 *  — not a web page. Falls back to the system browser only when Electron
 *  cannot be obtained. */
async function openWizardWindow(port) {
  const url = 'http://127.0.0.1:' + port + '/'
  try {
    const { ensureElectron } = await import('../src/gui-boot.js')
    const bin = await ensureElectron()
    const child = spawn(bin, ['--no-sandbox', join(dirname(fileURLToPath(import.meta.url)), 'window.cjs'), url], {
      detached: true, stdio: 'ignore', windowsHide: false,
    })
    child.unref()
    return true
  } catch (e) {
    openBrowser(port)
    return false
  }
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port
  console.log('PRTS_WIZARD_URL=http://127.0.0.1:' + port + '/')
  console.log('PRTS installer wizard — opening the GUI window…')
  openWizardWindow(port).then((gui) => {
    if (!gui) console.log('（Electron 不可用，已改用系统浏览器打开）')
  })
})
