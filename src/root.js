/**
 * Package-root resolution helpers shared by every surface (runner, GUI, TUI,
 * shortcut, build scripts). Pure Node — never imported by the web renderer.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

/** Absolute path to the dsh-prts-ui package root. */
export const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Absolute path to the bundled single-file GUI. */
export const guiHtmlPath = join(pkgRoot, 'web', 'index.html')

/** Absolute path to the Electron main process entry. */
export const electronMainPath = join(pkgRoot, 'electron', 'main.cjs')

/** Read a text file from the package root. */
export function readPkg(rel) {
  return readFileSync(join(pkgRoot, rel), 'utf8')
}
