#!/usr/bin/env node
/**
 * Convenience wrapper: `dsh-prts-ui [flags]` boots the PRTS profile through
 * the dsh launcher, mirroring `dsh --profile prts [flags]`.
 */

import { spawnSync } from 'node:child_process'

const result = spawnSync('dsh', ['--profile', 'prts', ...process.argv.slice(2)], {
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
