/**
 * PRTS runner: dispatches the booted selection to the GUI window (default),
 * the ANSI terminal client (--tui), or the desktop-shortcut refresh (--shortcut).
 * @module dsh-prts-ui/runner
 */

export const name = 'prts-runner'

/** Core services required before the app can start. */
export const inject = ['prtsStartup']

/**
 * Dispatch the selected surface and request process exit when it settles.
 * @param ctx - plugin context carrying the startup selection and launcher IO.
 */
export async function apply(ctx) {
  const dbg = (msg) => { if (process.env.DSH_PRTS_DEBUG) console.error('[prts-runner]', msg) }
  dbg('apply start')
  const loader = ctx.get('loader')
  dbg('loader = ' + (loader ? 'yes' : 'none'))
  if (loader) {
    // Loader siblings mount concurrently. Bound the readiness wait so the app
    // still starts in constrained environments where the full tree never
    // settles; the startup selection and launcher IO are ready regardless.
    const READY_TIMEOUT_MS = Number(process.env.DSH_PRTS_READY_TIMEOUT ?? 4000)
    if (READY_TIMEOUT_MS > 0) {
      await Promise.race([
        loader.await(),
        new Promise((resolve) => setTimeout(resolve, READY_TIMEOUT_MS)),
      ])
    } else {
      await loader.await()
    }
    dbg('loader await settled or timed out')
  }
  dbg('loader awaited')
  const startup = ctx.get('prtsStartup')
  dbg('startup = ' + (startup ? JSON.stringify(startup) : 'null'))
  if (!startup) return

  const io = {
    out(text) { process.stdout.write(text) },
    err(text) { process.stderr.write(text) },
    exit(code) {
      const exit = ctx.get('appExit')
      if (typeof exit === 'function') exit(code)
      else process.exit(code)
    },
  }

  try {
    if (startup.mode === 'shortcut') {
      const { refreshShortcut } = await import('./shortcut.js')
      const result = await refreshShortcut()
      io.out((result.skipped ? 'PRTS: ' : 'PRTS: shortcut -> ') + result.message + '\n')
      io.exit(0)
      return
    }
    if (startup.mode === 'gui') {
      const { launchGui } = await import('./gui-boot.js')
      const launched = await launchGui({ locale: startup.locale, project: startup.project })
      if (!launched) {
        io.err('PRTS: could not start the GUI (see above). Try `dsh --profile prts --tui`.\n')
        io.exit(1)
        return
      }
      io.exit(0)
      return
    }
    // tui
    const { runTui } = await import('./tui/main.mjs')
    dbg('runTui module loaded')
    await runTui({ locale: startup.locale, project: startup.project })
    dbg('runTui settled')
    io.exit(0)
  } catch (error) {
    dbg('error: ' + (error instanceof Error ? error.stack : String(error)))
    io.exit(1)
  }
}
