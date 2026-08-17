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

const PROFILE = process.env.DSH_PRTS_PROFILE || 'web'

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
    'Exec=node ' + join(pkgRoot, 'bin', 'dsh-prts-ui.js'),
    'Icon=' + iconPath,
    'Terminal=false',
    'Categories=Utility;Chat;',
    '',
  ].join('\n')
  writeFileSync(target, content, 'utf8')
  chmodSync(target, 0o755)
  // Register the same entry in the app-menu folder so the app shows up in
  // launchers (KDE / GNOME / etc.) and can be pinned to the dock / taskbar.
  try {
    const appsDir = join(homedir(), '.local', 'share', 'applications')
    mkdirSync(appsDir, { recursive: true })
    const menu = join(appsDir, 'dsh-prts.desktop')
    writeFileSync(menu, content, 'utf8')
    chmodSync(menu, 0o755)
  } catch (e) { /* non-fatal */ }
  return target
}

async function installMac(desktop) {
  const target = join(desktop, 'PRTS.command')
  const content = '#!/bin/bash\nexec node ' + join(pkgRoot, 'bin', 'dsh-prts-ui.js') + '\n'
  writeFileSync(target, content, 'utf8')
  chmodSync(target, 0o755)
  return target
}

async function installWindows(desktop) {
  // A windowless VBS launcher avoids the console flash when starting the GUI.
  const configDir = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'prts')
    : join(homedir(), '.prts')
  mkdirSync(configDir, { recursive: true })
  const vbs = join(configDir, 'prts.vbs')
  writeFileSync(vbs, 'CreateObject("WScript.Shell").Run "node ""' + join(pkgRoot, 'bin', 'dsh-prts-ui.js').replace(/\\/g, '/') + '""", 0, False\n')
  const icon = iconPath.replace(/\.png$/, '.ico')
  const targets = [
    join(desktop, 'PRTS.lnk'),
    // Start-menu entry — this is what makes PRTS appear in the Start menu
    // (the app launcher / "dock") and lets users pin it to the taskbar.
    join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'PRTS.lnk'),
  ]
  const { execFileSync } = await import('node:child_process')
  const list = targets.map((t) => JSON.stringify(t)).join(', ')
  const ps =
    '$ws = New-Object -ComObject WScript.Shell;' +
    'foreach ($p in @(' + list + ')) { ' +
    '$s = $ws.CreateShortcut($p);' +
    '$s.TargetPath = "wscript.exe";' +
    '$s.Arguments = ' + JSON.stringify(JSON.stringify(vbs)) + ';' +
    '$s.IconLocation = ' + JSON.stringify(icon + ',0') + ';' +
    '$s.WorkingDirectory = ' + JSON.stringify(homedir()) + ';' +
    '$s.Description = "PRTS";' +
    '$s.Save();' +
    '}'
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps])
  return targets[0]
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
