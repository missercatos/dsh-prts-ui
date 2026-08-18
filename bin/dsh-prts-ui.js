#!/usr/bin/env node
/**
 * prts — PRTS window launcher. Boots (or reuses) the PRTS backend — the
 * isolated `prts` dsh profile on its own port (default 3081) — and opens
 * the PRTS window over it. The official `dsh web` profile is untouched:
 * `dsh web` keeps the original DeepSeek Harness UI, while the PRTS window
 * shows dsh-web with the PRTS skin and panels. `prts --shortcut` refreshes
 * the desktop launcher.
 */
import { launchGui } from '../src/gui-boot.js'
import { refreshShortcut } from '../src/shortcut.js'

if (process.argv.includes('--shortcut')) {
  const r = await refreshShortcut()
  console.log('PRTS: shortcut ->', r.message)
  process.exit(0)
}
let launched
try {
  launched = await launchGui({})
} catch (error) {
  // Never die with a bare stack trace: a double-clicked shortcut has no
  // console, so leave a readable one-liner (stderr + exit code) instead.
  console.error('PRTS: 启动失败 — ' + (error && error.message ? error.message : error))
  process.exit(1)
}
if (!launched) process.exit(1)
const onSignal = () => { launched.cleanup(); process.exit(130) }
process.on('SIGINT', onSignal)
process.on('SIGTERM', onSignal)
await launched.electronExited
launched.cleanup()
process.exit(0)
