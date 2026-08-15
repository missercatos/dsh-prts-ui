#!/usr/bin/env node
/**
 * Post-install: rebuild the single-file GUI if the bundle is missing and
 * install the desktop shortcut. Best-effort — never fail the install.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = join(root, 'web', 'index.html')

function log(msg) {
  process.stdout.write('dsh-prts-ui: ' + msg + '\n')
}

async function main() {
  if (!existsSync(html)) {
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'bundle-gui.mjs')], { stdio: 'inherit' })
    } catch (error) {
      log('bundle rebuild failed: ' + (error && error.message))
    }
  }
  try {
    const { refreshShortcut } = await import(join(root, 'src', 'shortcut.js'))
    const result = await refreshShortcut()
    log('shortcut: ' + result.message)
  } catch (error) {
    log('shortcut skipped: ' + (error && error.message))
  }
}

main()
