#!/usr/bin/env node
/**
 * Bundle the PRTS GUI into one standalone HTML file (web/index.html).
 * Styles (web/src/style/*.css) and scripts (src/core/*.js, src/gui/*.js) are
 * inlined into web/src/template.html at the <!--STYLES-->/<!--SCRIPTS--> markers.
 * The renderer never touches the network or the filesystem, so the same file
 * runs in Electron (via preload bridge), a plain browser, or a test runner.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pkgRoot } from '../src/root.js'

const STYLE_DIR = join(pkgRoot, 'web', 'src', 'style')
const CORE_DIR = join(pkgRoot, 'src', 'core')
const GUI_DIR = join(pkgRoot, 'src', 'gui')
const TEMPLATE = join(pkgRoot, 'web', 'src', 'template.html')
const OUT = join(pkgRoot, 'web', 'index.html')

const css = readdirSync(STYLE_DIR)
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => readFileSync(join(STYLE_DIR, f), 'utf8'))
  .join('\n')

const js = [
  'platform.js', 'i18n.js', 'io.js', 'store.js', 'api.js',
].map((f) => readFileSync(join(CORE_DIR, f), 'utf8'))
  .concat([
    'particles.js', 'icons.js', 'plugins.js', 'asr.js', 'system.js', 'chat.js', 'app.js',
  ].map((f) => readFileSync(join(GUI_DIR, f), 'utf8')))
  .join('\n\n')

const html = readFileSync(TEMPLATE, 'utf8')
  .replace('<!--STYLES-->', css)
  .replace('<!--SCRIPTS-->', js)

writeFileSync(OUT, html)
console.log('bundle ->', OUT, html.length, 'bytes')
