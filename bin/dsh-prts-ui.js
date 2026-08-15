#!/usr/bin/env node
/**
 * Convenience wrapper: `prts [flags]` boots the PRTS profile through the dsh
 * launcher. It defaults to the terminal client (`--tui`) so typing `prts` in a
 * shell starts the TUI; pass `--gui` for the window or `--shortcut` to refresh
 * the desktop launcher.
 */

import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const hasMode = args.some((a) => a === '--tui' || a === '--gui' || a === '--shortcut')
const finalArgs = hasMode ? args : ['--tui', ...args]

const result = spawnSync('dsh', ['--profile', 'prts', ...finalArgs], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
