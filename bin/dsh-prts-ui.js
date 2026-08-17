#!/usr/bin/env node
/**
 * prts — PRTS window launcher. Boots (or reuses) the dsh web backend and
 * opens the PRTS window over it. PRTS itself is a dsh-web client plugin
 * installed in the web profile, so the window shows dsh-web with the PRTS
 * skin and panels. `prts --shortcut` refreshes the desktop launcher.
 */
import { launchGui } from '../src/gui-boot.js'
import { refreshShortcut } from '../src/shortcut.js'

if (process.argv.includes('--shortcut')) {
  const r = await refreshShortcut()
  console.log('PRTS: shortcut ->', r.message)
  process.exit(0)
}
const launched = await launchGui({})
if (!launched) process.exit(1)
const onSignal = () => { launched.cleanup(); process.exit(130) }
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)
await launched.electronExited
launched.cleanup()
process.exit(0)
