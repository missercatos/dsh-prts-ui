/**
 * PRTS desktop shortcut: installs a launcher on the user desktop
 * (linux .desktop, macOS .command, Windows .lnk) that opens the PRTS window.
 * Idempotent BY CONTENT: the launcher embeds the CURRENT install path, so a
 * version bump or a fresh reinstall rewrites the shortcut automatically
 * (the old marker-file skip left stale launchers pointing at deleted pnpm
 * dirs — "PRTS won't open"). Override DSH_PRTS_DESKTOP to redirect the
 * desktop dir (tests), DSH_PRTS_NO_SHORTCUT=1 to disable (CI).
 */
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
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

/** Prefer the resilient launcher (~/.local/bin/prts): it probes the prts
 *  profile (legacy web profile fallback) and never embeds a versioned pnpm
 *  path, so the shortcut cannot go stale across upgrades. */
function launchCmd() {
  const launcher = join(homedir(), '.local', 'bin', 'prts')
  if (existsSync(launcher)) return launcher
  return 'node ' + join(pkgRoot, 'bin', 'dsh-prts-ui.js')
}

/** Compute the linux .desktop content (target + app-menu copy). The icon is
 *  copied to a STABLE path (~/.local/share/icons) — a versioned pnpm path
 *  would break on the next upgrade, exactly like the old Exec did. */
function linuxContent() {
  const stableIcon = join(homedir(), '.local', 'share', 'icons', 'prts.png')
  try {
    mkdirSync(join(homedir(), '.local', 'share', 'icons'), { recursive: true })
    writeFileSync(stableIcon, readFileSync(iconPath))
  } catch (e) { /* non-fatal: fall back to the packaged icon */ }
  const icon = existsSync(stableIcon) ? stableIcon : iconPath
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=PRTS',
    'Comment=PRTS — monochrome DeepSeek client for dsh',
    'Exec=' + launchCmd(),
    'Icon=' + icon,
    'Terminal=false',
    'Categories=Utility;Chat;',
    '',
  ].join('\n')
}

function macContent() {
  return '#!/bin/bash\nexec ' + launchCmd() + '\n'
}

function windowsVbs() {
  const dir = process.platform === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'prts')
    : join(homedir(), '.prts')
  mkdirSync(dir, { recursive: true })
  const vbs = join(dir, 'prts.vbs')
  writeFileSync(vbs, 'CreateObject("WScript.Shell").Run "node ""' + join(pkgRoot, 'bin', 'dsh-prts-ui.js').replace(/\\/g, '/') + '""", 0, False\n')
  return vbs
}

async function installLinux(desktop) {
  const target = join(desktop, 'dsh-prts.desktop')
  const content = linuxContent()
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
  return { target, content }
}

async function installMac(desktop) {
  const target = join(desktop, 'PRTS.command')
  const content = macContent()
  writeFileSync(target, content, 'utf8')
  chmodSync(target, 0o755)
  return { target, content }
}

async function installWindows(desktop) {
  // A windowless VBS launcher avoids the console flash when starting the GUI.
  windowsVbs()
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
    '$s.Arguments = ' + JSON.stringify(JSON.stringify(windowsVbs())) + ';' +
    '$s.IconLocation = ' + JSON.stringify(icon + ',0') + ';' +
    '$s.WorkingDirectory = ' + JSON.stringify(homedir()) + ';' +
    '$s.Description = "PRTS";' +
    '$s.Save();' +
    '}'
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps])
  return { target: targets[0], content: ps }
}

export async function refreshShortcut() {
  if (process.env.DSH_PRTS_NO_SHORTCUT === '1') {
    return { skipped: true, message: 'disabled by DSH_PRTS_NO_SHORTCUT' }
  }
  const desktop = desktopDir()
  if (!desktop || !existsSync(desktop)) {
    return { skipped: true, message: 'no desktop directory found' }
  }
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'other'
  try {
    const built = os === 'linux' ? await installLinux(desktop)
      : os === 'macos' ? await installMac(desktop)
        : await installWindows(desktop)
    if (!built) return { skipped: true, message: 'unsupported platform' }
    // Idempotent by content: if the shortcut already carries THIS install's
    // launcher, leave it alone; otherwise it was stale (old version path)
    // and has now been rewritten.
    let current = ''
    try { current = readFileSync(built.target, 'utf8') } catch (e) { /* missing */ }
    if (current.trim() === built.content.trim()) {
      return { skipped: true, message: 'shortcut up to date' }
    }
    return { skipped: false, message: built.target }
  } catch (error) {
    return { skipped: true, message: (error && error.message) || String(error) }
  }
}
