/**
 * PRTS desktop shortcut: installs a launcher on the user desktop
 * (linux .desktop, macOS .command, Windows .lnk) that opens the PRTS window
 * via `dsh --profile prts`. Idempotent — a marker file in the PRTS config
 * directory prevents re-creation. Override DSH_PRTS_DESKTOP to redirect the
 * desktop dir (tests), DSH_PRTS_NO_SHORTCUT=1 to disable (CI).
 */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { pkgRoot } from './root.js'

const PROFILE = process.env.DSH_PRTS_PROFILE || 'prts'

/** Absolute path of the packaged PRTS icon (diamond mark). */
export const iconPath = join(pkgRoot, 'assets', 'prts.png')

function homedir() {
  return process.env.HOME || process.env.USERPROFILE || '.'
}

function configDir() {
  const home = homedir()
  if (process.platform === 'linux') return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'prts')
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'prts')
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'prts')
  return join(home, '.prts')
}

function desktopDir() {
  if (process.env.DSH_PRTS_DESKTOP) return process.env.DSH_PRTS_DESKTOP
  const home = homedir()
  if (process.platform === 'linux') return process.env.XDG_DESKTOP_DIR || join(home, 'Desktop')
  if (process.platform === 'darwin') return join(home, 'Desktop')
  if (process.platform === 'win32') return join(home, 'Desktop')
  return null
}

async function installLinux(desktop) {
  const target = join(desktop, 'dsh-prts.desktop')
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=PRTS',
    'Comment=PRTS — monochrome DeepSeek client for dsh',
    'Exec=dsh --profile ' + PROFILE,
    'Icon=' + iconPath,
    'Terminal=false',
    'Categories=Utility;Chat;',
    '',
  ].join('\n')
  writeFileSync(target, content, 'utf8')
  chmodSync(target, 0o755)
  return target
}

async function installMac(desktop) {
  const target = join(desktop, 'PRTS.command')
  const content = '#!/bin/bash\nexec dsh --profile ' + PROFILE + '\n'
  writeFileSync(target, content, 'utf8')
  chmodSync(target, 0o755)
  return target
}

async function installWindows(desktop) {
  const target = join(desktop, 'PRTS.lnk')
  const { execFileSync } = await import('node:child_process')
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    '$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut(' + JSON.stringify(target) + '); $s.TargetPath = "powershell.exe"; $s.Arguments = "-NoProfile -Command dsh --profile ' + PROFILE + '"; $s.Save()',
  ])
  return target
}

export async function refreshShortcut() {
  if (process.env.DSH_PRTS_NO_SHORTCUT === '1') {
    return { skipped: true, message: 'disabled by DSH_PRTS_NO_SHORTCUT' }
  }
  const desktop = desktopDir()
  if (!desktop || !existsSync(desktop)) {
    return { skipped: true, message: 'no desktop directory found' }
  }
  const marker = join(configDir(), '.shortcut-done')
  if (existsSync(marker)) {
    return { skipped: true, message: 'shortcut already installed' }
  }
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'other'
  try {
    const target = os === 'linux' ? await installLinux(desktop)
      : os === 'macos' ? await installMac(desktop)
        : os === 'windows' ? await installWindows(desktop)
          : null
    if (!target) return { skipped: true, message: 'unsupported platform' }
    mkdirSync(configDir(), { recursive: true })
    writeFileSync(marker, new Date().toISOString(), 'utf8')
    return { skipped: false, message: target }
  } catch (error) {
    return { skipped: true, message: (error && error.message) || String(error) }
  }
}
