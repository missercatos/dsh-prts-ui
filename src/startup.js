/**
 * PRTS command-line provider: parses the app flags and publishes the
 * `prtsStartup` service for the runner. PRTS is a GUI *for* dsh, so the only
 * surfaces are the GUI window and the desktop-shortcut refresh.
 * @module dsh-prts-ui/startup
 */

import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'prts-startup'

/** Services required before the flags can be parsed. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the PRTS runner. */
export const PRTS_STARTUP_SERVICE = 'prtsStartup'

/**
 * This app's command: GUI window (default) or desktop-shortcut refresh.
 * @returns a fresh program, so one process can parse more than once.
 */
function prtsCommand() {
  return new Command()
    .name('dsh --profile prts')
    .description('PRTS — the GUI shell for dsh. Opens the window by default.')
    .helpOption('-h, --help', 'show this help')
    .option('--lang <locale>', 'ui language: zh or en (default: detect from the system)')
    .option('--shortcut', 'create (or refresh) the desktop shortcut and exit')
    .addHelpText('after', `
Examples:
  dsh --profile prts              open the PRTS GUI window
  dsh --profile prts --lang zh    Chinese GUI
  dsh --profile prts --shortcut   refresh the desktop shortcut
`)
}

/**
 * Parse and provide the startup selection as an ordinary Cordis service. The
 * command's action publishes the selection; `--help` exits before anything is
 * provided, so the runner no-ops in that case.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx) {
  const dbg = (msg) => { if (process.env.DSH_PRTS_DEBUG) console.error('[prts-startup]', msg) }
  dbg('apply start')
  const program = prtsCommand()
  program.action((options) => {
    dbg('action fired')
    ctx.provide(PRTS_STARTUP_SERVICE, {
      mode: options.shortcut ? 'shortcut' : 'gui',
      locale: typeof options.lang === 'string' && options.lang.trim() !== '' ? options.lang.trim() : undefined,
    })
  })
  parseCmdline(ctx, program)
  dbg('parseCmdline done')
}
