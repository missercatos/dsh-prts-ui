#!/usr/bin/env node
/**
 * PRTS stable-channel updater CLI (also used by the Electron bridge).
 *
 *   node scripts/update-runner.mjs check    -> JSON { current, latest, update, url, channel }
 *   node scripts/update-runner.mjs update   -> JSON { ok, updated, version }
 *
 * The shared logic lives in scripts/update-core.mjs — the web host plugin
 * imports it directly (the shell service is sandboxed and cannot reach the
 * package files, so the host never shells out for updates).
 */
import { check, update } from './update-core.mjs'

const mode = process.argv[2] || 'check'
const out = mode === 'update' ? await update() : await check()
process.stdout.write(JSON.stringify(out))
process.exit(0)
