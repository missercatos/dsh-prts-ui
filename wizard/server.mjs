#!/usr/bin/env node
/**
 * PRTS installer wizard — the integration pack bootstrap. The interface is a
 * DESKTOP GUI (Electron window over the official dsh web), which the wizard
 * auto-packages at the end and runs automatically.
 *
 * Pipeline:
 *   1. environment check (node / npm / pnpm)
 *   2. dsh harness — already installed? skip : npm i -g @deepseek-ai/dsh
 *      (npmmirror fallback; live progress while downloading)
 *   3. plugin selection — installed plugins are greyed out in the page;
 *      selected ones land in the official `web` profile (the GUI shows them)
 *   4. auto-package the desktop GUI (scripts/package-gui.mjs): copies the
 *      Electron shell to ~/.local/share/prts/app, writes the `prts` launcher
 *      and the "PRTS" desktop shortcut — then launches the GUI
 */

import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform as osPlatform } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = osPlatform() === 'win32'
const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh')
/** Plugins land in the official web profile — the profile `dsh web` boots. */
const WEB_PROFILE_DIR = join(DSH_HOME, 'profiles', 'web')

/** The integration pack's plugin catalog — plain optional dsh plugins. The
 *  redesigned version has no bundled UI, so no plugin conflicts with anything:
 *  every plugin is a normal plugin for the official `web` profile. Installed
 *  plugins are greyed out in the wizard. */
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
  { id: 'dsh-plugin-wallpaper-engine', label: 'dsh-plugin-wallpaper-engine', desc: '壁纸引擎：dsh web 聊天背景播放本地 Wallpaper Engine 壁纸', def: true },
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

/** Version of `spec` installed in the OFFICIAL web profile, or null. */
function installedVersion(spec) {
  // Normalize a pnpm spec (version suffix / git+ prefix) to the package
  // directory name under the profile's node_modules.
  let name = String(spec)
  if (name.startsWith('git+')) name = name.slice(4).replace(/\.git$/, '').split('/').pop()
  else name = name.replace(/@(\d[\w.+-]*)$/, '')
  const rel = join(WEB_PROFILE_DIR, 'node_modules', ...name.split('/'))
  const m = readJson(join(rel, 'package.json'))
  return m && m.version ? m.version : null
}

function dshVersion() {
  const r = spawnSyncSafe('dsh', ['--version'])
  if (r.status !== 0 || !r.stdout) return null
  const line = String(r.stdout).trim().split('\n')[0]
  return line.length < 60 ? line : 'installed'
}

function dshInstalled() {
  return hasCmd('dsh') && dshVersion() !== null
}

function snapshot() {
  const plugins = PLUGINS.map((p) => ({ id: p.id, label: p.label, desc: p.desc, def: p.def, installed: !!installedVersion(p.id) }))
  // 自动发现本机 ~/.dsh 已安装的插件：已装的自动置灰，不重复安装。
  const discovered = discoverInstalledPlugins()
  const merged = mergedPluginList(discovered, plugins)
  return {
    platform: IS_WIN ? 'windows' : osPlatform() === 'darwin' ? 'macos' : 'linux',
    version: (readJson(join(ROOT, 'package.json')) || {}).version || '0.0.0',
    dsh: { installed: dshInstalled(), version: dshVersion() },
    discovered: discovered.map((p) => p.id),
    plugins: merged,
    step: state.step,
    stage: state.stage,
    progress: state.progress,
    error: state.error,
    log: state.log.slice(-160),
  }
}

/* ---------- 自动发现 ~/.dsh 已装插件 ---------- */

/**
 * 读 ~/.dsh 下 profiles 目录内每个 profile 的 package.json 的
 * dependencies + devDependencies，把每个非 dsh 内核 / 非本插件包名
 * 收集为本机已装插件清单。
 * 返回 [{ id, label, desc, installed:true }]，id 是可直接 `dsh plugin add` 的 spec。
 */
function discoverInstalledPlugins() {
  const PROFILES_ROOT = join(DSH_HOME, 'profiles')
  const seen = new Map()
  const SKIP = new Set(['dsh-prts-ui', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-cmdline'])
  let dirs = []
  try { dirs = readdirSync(PROFILES_ROOT) } catch (e) { dirs = [] }
  for (const prof of dirs) {
    const pkgPath = join(PROFILES_ROOT, prof, 'package.json')
    let m = null
    try { m = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch (e) { continue }
    const deps = Object.assign({}, m.dependencies, m.devDependencies)
    for (const name of Object.keys(deps)) {
      if (SKIP.has(name)) continue
      if (seen.has(name)) continue
      const spec = deps[name]
      const id = /^github:|^git\+/.test(String(spec)) && String(spec).includes('.git')
        ? String(spec) // 保留 github: 源，可直接 add
        : /^file:/.test(String(spec))
          ? name       // 本地打包 → 用包名注册
          : String(spec).indexOf('/') >= 0 ? spec : name // 其它规范化到可 add 的形态
      seen.set(name, { id, label: name, desc: '来自 ~/.dsh 已安装插件', installed: true })
    }
  }
  return Array.from(seen.values())
}

/** 把“已安装发现”合并到默认插件表：已装的置前并置灰。 */
function mergedPluginList(discovered, defaults) {
  const byId = new Map(defaults.map((p) => [p.id, p]))
  for (const d of discovered) {
    if (!byId.has(d.id)) byId.set(d.id, { id: d.id, label: d.label, desc: d.desc, def: true, installed: true, discovered: true })
    else { const cur = byId.get(d.id); byId.set(d.id, { ...cur, installed: true, discovered: true }) }
  }
  return Array.from(byId.values())
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

/** pnpm 11 blocks build scripts until approved: approve the package name
 *  pnpm hinted at and return true when something was written. */
function approveBuildsHint() {
  const hinted = state.log.slice(-40).join('\n').match(/(?:approve-builds|ignored build scripts?|allowBuilds)[^\n]*?[\s'"]+(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)/i)
  if (!hinted || !hinted[1]) return false
  const ws = join(WEB_PROFILE_DIR, 'pnpm-workspace.yaml')
  try {
    const q = (k) => (/^@/.test(k) ? "'" + k + "'" : k)
    const lines = readFileSync(ws, 'utf8').split('\n')
    if (lines.some((l) => l.indexOf('  ' + q(hinted[1]) + ':') === 0)) return false
    const idx = lines.findIndex((l) => /^allowBuilds:/.test(l))
    if (idx >= 0) lines.splice(idx + 1, 0, '  ' + q(hinted[1]) + ': true')
    else lines.push('', 'allowBuilds:', '  ' + q(hinted[1]) + ': true')
    writeFileSync(ws, lines.join('\n'))
    return true
  } catch (e) { return false }
}

async function installPlugin(p) {
  let code = await execLog('dsh', ['plugin', '--profile', 'web', 'add', p.id])
  if (code !== 0 && approveBuildsHint()) code = await execLog('dsh', ['plugin', '--profile', 'web', 'add', p.id])
  if (code !== 0) pushLog('（跳过）' + p.id + ' 未能安装 — 不影响安装')
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

    // 旧版残留清理：老整合包把 dsh-prts-ui 皮肤插件装进过 web profile，
    // 新版本不再带任何界面 — 发现就移除（尽力而为，失败不影响安装）。
    const webManifest = readJson(join(WEB_PROFILE_DIR, 'package.json'))
    if (webManifest && webManifest.dependencies && webManifest.dependencies['dsh-prts-ui']) {
      pushLog('清理旧版 PRTS 皮肤插件（web profile）…')
      await execLog('dsh', ['plugin', '--profile', 'web', 'remove', 'dsh-prts-ui'])
    }

    // 3. selected plugins → official web profile (installed ones skip)
    const plugins = PLUGINS.filter((p) => selectedPlugins.indexOf(p.id) >= 0 && !installedVersion(p.id))
    let i = 0
    for (const p of plugins) {
      bump(55 + Math.round((i / Math.max(1, plugins.length)) * 30), '安装插件 ' + p.label)
      await installPlugin(p)
      i++
    }

    // 4. 自动打包为桌面 GUI（Electron 窗口包住官方 dsh web 的 web profile），
    //    生成 `prts` 启动命令与名为 PRTS 的桌面快捷方式
    bump(88, '打包桌面 GUI')
    const guiPkg = join(ROOT, 'scripts', 'package-gui.mjs')
    const guiCode = await execLog(process.execPath, [guiPkg])
    if (guiCode !== 0) throw new Error('桌面 GUI 打包失败。')

    bump(100, '完成')
    state.step = 'done'
    state.finished = true
    // 安装完成自动运行 GUI（尽力而为，不阻塞向导）
    setTimeout(() => { try { spawnLauncher() } catch (e) { /* noop */ } }, 900)
  } catch (error) {
    state.step = 'error'
    state.error = String((error && error.message) || error)
    pushLog('ERROR: ' + state.error)
    // allow a retry from the wizard page (previously `started` stayed true
    // and every re-attempt was rejected with 409 until the wizard restarted)
    state.started = false
  }
}

/* ---------- GUI 启动 ---------- */

function launcherPath() {
  return join(HOME, '.local', 'bin', IS_WIN ? 'prts.cmd' : 'prts')
}

/** 启动打包好的桌面 GUI（detached；launcher 由 scripts/package-gui.mjs 生成）。 */
function spawnLauncher() {
  const launcher = launcherPath()
  if (!existsSync(launcher)) return false
  const child = IS_WIN
    ? spawn('cmd.exe', ['/c', launcher], { detached: true, stdio: 'ignore', windowsHide: true })
    : spawn(launcher, [], { detached: true, stdio: 'ignore' })
  child.unref()
  return true
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
      if (spawnLauncher()) return json(res, 200, { ok: true })
      return json(res, 400, { ok: false, error: 'PRTS 尚未安装' })
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
