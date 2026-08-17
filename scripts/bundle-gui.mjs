#!/usr/bin/env node
/**
 * Bundle the PRTS GUI into one standalone HTML file (web/index.html).
 * Styles (web/src/style/*.css) and scripts (src/core/*.js, src/gui/*.js) are
 * inlined into web/src/template.html at the <!--STYLES-->/<!--SCRIPTS--> markers.
 * The renderer never touches the network or the filesystem, so the same file
 * runs in Electron (via preload bridge), a plain browser, or a test runner.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pkgRoot } from '../src/root.js'

const STYLE_DIR = join(pkgRoot, 'web', 'src', 'style')
const CORE_DIR = join(pkgRoot, 'src', 'core')
const GUI_DIR = join(pkgRoot, 'src', 'gui')
const SRC_DIR = join(pkgRoot, 'src')
const TEMPLATE = join(pkgRoot, 'web', 'src', 'template.html')
const MARKET = join(pkgRoot, 'web', 'market.json')
const OUT = join(pkgRoot, 'web', 'index.html')

const css = readdirSync(STYLE_DIR)
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => readFileSync(join(STYLE_DIR, f), 'utf8'))
  .join('\n')

// Plugin-market catalog (scripts/scan-market.mjs output) is inlined as a data
// script so the renderer reads it offline. Falls back to an empty list.
const market = existsSync(MARKET) ? readFileSync(MARKET, 'utf8').trim() : '{"plugins":[]}'

const js = [
  'platform.js', 'i18n.js', 'io.js', 'store.js',
].map((f) => readFileSync(join(CORE_DIR, f), 'utf8'))
  .concat([
    'dsh/client.js', 'dsh/state.js',
  ].map((f) => readFileSync(join(SRC_DIR, f), 'utf8')))
  .concat([
    'particles.js', 'icons.js', 'plugins.js', 'stt.js', 'asr.js', 'system.js', 'cost.js', 'chat.js', 'app.js',
    'balance.js', 'git.js', 'skills.js', 'market.js', 'settings.js',
  ].map((f) => readFileSync(join(GUI_DIR, f), 'utf8')))
  .join('\n\n')

const html = readFileSync(TEMPLATE, 'utf8')
  .replace('<!--STYLES-->', () => css)
  .replace('<!--SCRIPTS-->', () => js)
  .replace('<!--MARKET-->', () => 'window.PRTS_MARKET = ' + market + ';')

writeFileSync(OUT, html)
console.log('bundle ->', OUT, html.length, 'bytes')

// lib/ for the dsh bundle faces: client plugin + host plugin (ESM copies).
const LIB_DIR = join(pkgRoot, 'lib')
import { mkdirSync } from 'node:fs'
mkdirSync(LIB_DIR, { recursive: true })
const catalog = JSON.parse(existsSync(join(pkgRoot, 'web', 'skills-catalog.json'))
  ? readFileSync(join(pkgRoot, 'web', 'skills-catalog.json'), 'utf8') : '{"skills":[]}').skills
const clientSrc = readFileSync(join(pkgRoot, 'src', 'prts-client.js'), 'utf8')
  .replace("'__SKILL_CATALOG__'", JSON.stringify(catalog))
writeFileSync(join(LIB_DIR, 'client.js'), clientSrc)
writeFileSync(join(LIB_DIR, 'host.js'), readFileSync(join(pkgRoot, 'src', 'host.js'), 'utf8'))
console.log('lib -> client.js + host.js')
