#!/usr/bin/env node
/**
 * PRTS GUI packager — the installer's final step: "自动打包为 GUI".
 * Copies this package's desktop-GUI runtime (Electron shell around the
 * official dsh web) into a stable user directory, writes the `prts` launcher
 * and the "PRTS" desktop shortcut, and reports what was created.
 *
 *   node scripts/package-gui.mjs
 *
 * Layout (all under the user home, surviving the self-extracting installer):
 *   ~/.local/share/prts/app/                    GUI runtime (copied from here)
 *   ~/.local/bin/prts (or prts.cmd)             launcher — runs the GUI
 *   ~/Desktop/PRTS.desktop | PRTS.command | PRTS.lnk   桌面快捷方式
 *   ~/.local/share/applications/PRTS.desktop    应用菜单（Linux）
 *   ~/.local/share/icons/prts.png               稳定图标路径
 *
 * The GUI boots the OFFICIAL `web` profile (`dsh --profile web --port 3081`)
 * so every plugin the wizard installed is visible inside the window.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, platform } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const IS_WIN = platform() === 'win32'
const HOME = process.env.HOME || process.env.USERPROFILE || homedir()
const APP_DIR = join(HOME, '.local', 'share', 'prts', 'app')
const BIN_DIR = join(HOME, '.local', 'bin')
const LAUNCHER = join(BIN_DIR, IS_WIN ? 'prts.cmd' : 'prts')
const DSH_WS_URL = 'http://127.0.0.1:3081'   // GUI 专用端口（web profile），不与 3080 冲突

const say = (m) => console.log(m)

/** 1. 复制 GUI 运行时到稳定目录（覆盖旧的，保证每次安装都是全新副本）。 */
function copyRuntime() {
  const entries = [
    'package.json', 'bin', 'src', 'electron', 'web', 'vendor', 'assets',
    'lib', 'scripts', 'cordis.patch.yml', 'README.md', 'README.zh.md',
    'LICENSE', 'prts.config.example.json',
  ]
  rmSync(APP_DIR, { recursive: true, force: true })
  mkdirSync(APP_DIR, { recursive: true })
  for (const e of entries) {
    if (!existsSync(join(ROOT, e))) continue
    cpSync(join(ROOT, e), join(APP_DIR, e), { recursive: true })
  }
  say('GUI runtime -> ' + APP_DIR)
}

/** 2. `prts` 启动命令：运行 GUI（Electron 窗口包住官方 dsh web 的 web profile）。 */
function writeLauncher() {
  mkdirSync(BIN_DIR, { recursive: true })
  if (IS_WIN) {
    writeFileSync(LAUNCHER, [
      '@echo off',
      'rem PRTS — 桌面 GUI（官方 dsh web 内核 + Electron 窗口）',
      'set PRTS_DSH_PROFILE=web',
      'set PRTS_DSH_URL=' + DSH_WS_URL,
      'node "' + APP_DIR.replace(/\\/g, '\\\\') + '\\bin\\dsh-prts-ui.js" %*',
    ].join('\r\n') + '\r\n')
  } else {
    writeFileSync(LAUNCHER, [
      '#!/bin/sh',
      '# PRTS — 桌面 GUI（官方 dsh web 内核 + Electron 窗口）',
      'export PRTS_DSH_PROFILE=web',
      'export PRTS_DSH_URL=' + DSH_WS_URL,
      'exec node "' + APP_DIR + '/bin/dsh-prts-ui.js" "$@"',
    ].join('\n') + '\n', { mode: 0o755 })
  }
  say('prts command -> ' + LAUNCHER)
  return LAUNCHER
}

function desktopDir() {
  if (process.env.DSH_PRTS_DESKTOP) return process.env.DSH_PRTS_DESKTOP
  if (platform() === 'linux') return process.env.XDG_DESKTOP_DIR || join(HOME, 'Desktop')
  if (platform() === 'darwin') return join(HOME, 'Desktop')
  if (IS_WIN) return join(HOME, 'Desktop')
  return null
}

/** PRTS 图标（包内 prts.png）复制到稳定路径，避免版本化路径失效。 */
function stableIcon() {
  const src = join(ROOT, 'assets', 'prts.png')
  if (!existsSync(src)) return ''
  try {
    const dir = join(HOME, '.local', 'share', 'icons')
    mkdirSync(dir, { recursive: true })
    copyFileSync(src, join(dir, 'prts.png'))
    return join(dir, 'prts.png')
  } catch (e) { return src }
}

/** 3. 快捷方式，名字一律叫 PRTS。 */
function writeShortcuts(launcher) {
  const out = []
  const desktop = desktopDir()
  const hasDesktop = desktop && existsSync(desktop)
  if (platform() === 'linux') {
    const icon = stableIcon()
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=PRTS',
      'Comment=PRTS — DeepSeek Harness 桌面 GUI',
      'Exec=' + launcher,
      ...(icon ? ['Icon=' + icon] : []),
      'Terminal=false',
      'Categories=Utility;Chat;',
      '',
    ].join('\n')
    try {
      const apps = join(HOME, '.local', 'share', 'applications')
      mkdirSync(apps, { recursive: true })
      const menu = join(apps, 'PRTS.desktop')
      writeFileSync(menu, content)
      chmodSync(menu, 0o755)
      out.push(menu)
    } catch (e) { /* non-fatal */ }
    if (hasDesktop) {
      const target = join(desktop, 'PRTS.desktop')
      writeFileSync(target, content)
      chmodSync(target, 0o755)
      out.push(target)
    }
  } else if (platform() === 'darwin') {
    if (hasDesktop) {
      const target = join(desktop, 'PRTS.command')
      writeFileSync(target, '#!/bin/bash\nexec "$HOME/.local/bin/prts"\n')
      chmodSync(target, 0o755)
      out.push(target)
    }
  } else if (IS_WIN) {
    const targets = [
      join(HOME, 'Desktop', 'PRTS.lnk'),
      join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PRTS.lnk'),
    ]
    const icon = join(ROOT, 'assets', 'prts.ico')
    const list = targets.map((t) => JSON.stringify(t)).join(', ')
    const ps =
      '$ws = New-Object -ComObject WScript.Shell;' +
      'foreach ($p in @(' + list + ')) { ' +
      '$s = $ws.CreateShortcut($p);' +
      '$s.TargetPath = "cmd.exe";' +
      '$s.Arguments = ' + JSON.stringify('/c ""' + launcher + '""') + ';' +
      (existsSync(icon) ? '$s.IconLocation = ' + JSON.stringify(icon + ',0') + ';' : '') +
      '$s.WorkingDirectory = ' + JSON.stringify(HOME) + ';' +
      '$s.Description = "PRTS";' +
      '$s.Save();' +
      '}'
    try {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 60000 })
    } catch (e) { /* non-fatal */ }
    out.push(...targets)
  }
  for (const s of out) say('shortcut -> ' + s)
  return out
}

copyRuntime()
const launcher = writeLauncher()
writeShortcuts(launcher)
say('GUI 打包完成 — 运行 `prts` 或双击桌面 PRTS 图标启动。')
