/**
 * PRTS runner: dispatches the booted selection to the GUI window (the only
 * interactive surface) or the desktop-shortcut refresh. The GUI boots the dsh
 * web backend and opens the PRTS window over it — PRTS is a shell, dsh is the
 * agent.
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
  // Backend mode: gui-boot spawns `dsh --profile prts --port <port>` with
  // PRTS_BACKEND=1 as the window's backend. That process must ONLY serve the
  // web surface — no window of its own, no exit, no backend respawn cascade.
  if (process.env.PRTS_BACKEND === '1') return
  const dbg = (msg) => { if (process.env.DSH_PRTS_DEBUG) console.error('[prts-runner]', msg) }
  dbg('apply start')
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
    // GUI (default): boot the dsh web backend and open the window over it.
    const { launchGui } = await import('./gui-boot.js')
    const launched = await launchGui({ locale: startup.locale })
    if (!launched) {
      io.err('PRTS: could not start the GUI (see above).\n')
      io.exit(1)
      return
    }
    // Stay alive for the life of the window, then tear down the PRTS backend
    // we spawned so it never lingers on the PRTS port (which would keep a
    // stale backend running after the window closes).
    const onSignal = () => { launched.cleanup(); io.exit(130) }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
    await launched.electronExited
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    launched.cleanup()
    io.exit(0)
  } catch (error) {
    dbg('error: ' + (error instanceof Error ? error.stack : String(error)))
    io.exit(1)
  }
}
