#!/usr/bin/env node
/**
 * Convenience wrapper: `prts [flags]` boots the PRTS profile through the dsh
 * launcher. PRTS is a GUI shell for dsh, so it always opens the window
 * (there is no TUI); `--shortcut` refreshes the desktop launcher instead.
 */

import { spawnSync } from 'node:child_process'

const result = spawnSync('dsh', ['--profile', 'prts', ...process.argv.slice(2)], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
