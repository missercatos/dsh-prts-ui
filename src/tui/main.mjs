#!/usr/bin/env node
/**
 * PRTS TUI — monochrome terminal client. Same core (store/i18n/api) and the
 * same project files as the GUI, so both surfaces share history. ANSI only
 * uses dim/bold intensity (never color): pure black & white. Particle-style
 * boot splash (rhombus + wordmark drift), streaming composer, slash commands,
 * Ctrl+L language toggle, shared history.
 */
import { runInThisContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { pkgRoot } from '../root.js'

globalThis.__PRTS_FS__ = await import('node:fs')
globalThis._prtsRequire = createRequire(import.meta.url)

/* ---------- core (shared with GUI) ---------- */
for (const f of ['platform', 'i18n', 'io', 'store', 'api']) {
  const code = readFileSync(join(pkgRoot, 'src', 'core', f + '.js'), 'utf8')
  runInThisContext(code, { filename: 'prts-core/' + f + '.js' })
}
const P = globalThis.PRTS

/* ---------- ansi ---------- */
const C = {
  home: '\x1b[H',
  to: (r) => '\x1b[' + r + ';1H',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  r: '\x1b[0m',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  altOn: '\x1b[?1049h',
  altOff: '\x1b[?1049l',
}
const clean = (s) => String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
const pad = (s, w) => {
  const t = clean(s).slice(0, w)
  return t + ' '.repeat(Math.max(0, w - t.length))
}
const wrap = (s, w) => {
  const lines = []
  for (const seg of clean(s).split('\n')) {
    for (let i = 0; i < seg.length; i += w) lines.push(seg.slice(i, i + w))
  }
  return lines
}

/* ---------- state ---------- */
const T = {
  config: null,
  locale: 'en',
  projectId: 'default',
  projects: [],
  messages: [],
  bounds: [],
  composer: '',
  composerHist: [],
  histIdx: -1,
  streaming: false,
  abortCtrl: null,
  cols: 80,
  rows: 24,
  splashUntil: 0,
  promptCb: null,
}
function t(key, params) { return P.i18n.t(key, T.locale, params) }

/* ---------- splash: rhombus + PRTS wordmark on a particle drift ---------- */
const L = {
  P: ['█████', '█   █', '█████', '█    ', '█    '],
  R: ['█████', '█   █', '█████', '██   ', '█  █'],
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  S: ['█████', '█    ', '█████', '    █', '█████'],
}
function logoGrid() {
  const rhom = ['   ██   ', '  ████  ', ' ██████ ', '████████', ' ██████ ', '  ████  ', '   ██   ']
  const letters = ['P', 'R', 'T', 'S'].map((ch) => L[ch])
  const rows = Math.max(rhom.length, 5)
  const grid = []
  for (let i = 0; i < rows; i++) {
    const rh = i < rhom.length ? rhom[i] : ' '.repeat(9)
    const ls = letters.map((col) => (i < 5 ? col[i] : '     ')).join('  ')
    grid.push(rh + '  ' + ls)
  }
  return grid
}
function splashLines(w, h) {
  const logo = logoGrid()
  const lw = logo[0].length
  const lh = logo.length
  const ox = Math.floor((w - lw) / 2)
  const oy = Math.floor((h - lh) / 2)
  const lines = []
  for (let r = 0; r < h; r++) {
    let line = ''
    for (let c2 = 0; c2 < w; c2++) {
      const lx = c2 - ox
      const ly = r - oy
      const inLogo = lx >= 0 && lx < lw && ly >= 0 && ly < lh && logo[ly][lx] === '█'
      if (inLogo) line += Math.random() < 0.9 ? '█' : '░'
      else if (Math.random() < 0.045) line += '·'
      else line += ' '
    }
    lines.push(line)
  }
  return lines
}

/* ---------- screen ---------- */
function buildMessages(w) {
  const rows = []
  for (const m of T.messages) {
    if (m.k === 'b') { rows.push(C.dim + '·'.repeat(w) + C.r); continue }
    const who = m.role === 'user' ? t('tui.you') : m.role === 'system' ? '·' : 'PRTS'
    const body = m.streaming ? (m.content + (m.content ? '' : ' ') + '▍') : m.content
    const text = m.error ? '! ' + m.error : body
    const lines = wrap(text || '', w - 6)
    if (m.role === 'system') {
      rows.push(C.dim + pad(lines[0] || '', w) + C.r)
      continue
    }
    if (!lines.length) { rows.push(who); continue }
    rows.push((m.role === 'user' ? '' : '') + who + '  ' + lines[0])
    const indent = ' '.repeat(Math.min(clean(who).length + 2, w - 3))
    for (let i = 1; i < lines.length; i++) rows.push(indent + lines[i])
    if (!m.streaming && m.durationMs) {
      const parts = ['ELAPSED ' + P.api.formatDuration(m.durationMs)]
      if (m.usage) parts.push(t('chat.tokens', { in: m.usage.prompt_tokens || 0, out: m.usage.completion_tokens || 0 }))
      rows.push(C.dim + indent + '· ' + parts.join(' · ') + C.r)
    }
  }
  return rows
}

function buildHeader(w) {
  const model = (T.config && T.config.api && T.config.api.model) || '-'
  const strength = (T.config && T.config.api && T.config.api.strength) || '-'
  const left = ' PRTS ◆ ' + T.projectId
  const right = model + ' · ' + t('strength.' + strength) + ' · ' + (T.locale === 'zh' ? 'ZH' : 'EN')
  const space = Math.max(1, w - clean(left).length - clean(right).length - 4)
  return C.bold + '┌─' + left + ' '.repeat(space) + right + '─┐' + C.r
}

function buildFooter(w) {
  const line = '> ' + T.composer
  const hint = t('tui.hint')
  return ['└' + '─'.repeat(w - 2) + '┘',
    ' ' + pad(line, w - clean(hint).length - 3) + '  ' + C.dim + hint + C.r,
    C.dim + '  /help · ' + t('tui.help') + C.r]
}

function renderFull() {
  const w = T.cols
  const h = T.rows
  let rows
  if (Date.now() < T.splashUntil) {
    rows = splashLines(w, h)
  } else {
    const header = buildHeader(w)
    const footer = buildFooter(w)
    const body = buildMessages(w)
    const avail = h - footer.length
    rows = [header].concat(body.slice(-(avail - 1)), footer)
  }
  let s = C.hide + C.home
  for (let i = 0; i < rows.length; i++) s += pad(rows[i], w) + (i < rows.length - 1 ? '\n' : '')
  s += C.show
  process.stdout.write(s)
}

/* ---------- input ---------- */
function setupRaw() {
  if (!process.stdin.isTTY) return false
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', handleChunk)
  return true
}

function handleChunk(chunk) {
  let i = 0
  while (i < chunk.length) {
    const ch = chunk[i]
    if (ch === '\x1b') {
      let j = i + 1
      while (j < chunk.length && !/[a-zA-Z~]/.test(chunk[j]) && j - i < 32) j++
      if (j < chunk.length) j++
      handleKey(chunk.slice(i, j))
      i = j
      continue
    }
    const cp = chunk.codePointAt(i)
    handleKey(String.fromCodePoint(cp))
    i += cp > 0xFFFF ? 2 : 1
  }
}

function handleKey(seq) {
  if (seq === '\x03') { // Ctrl+C
    if (T.streaming) { if (T.abortCtrl) T.abortCtrl.abort() }
    else { teardown(); process.exit(0) }
    return
  }
  if (seq === '\x0c') { // Ctrl+L — language toggle
    T.locale = T.locale === 'zh' ? 'en' : 'zh'
    T.dirty = false
    renderFull()
    return
  }
  if (T.promptCb) {
    if (seq === '\r' || seq === '\n') {
      const cb = T.promptCb
      const val = T.composer.trim()
      T.promptCb = null
      T.composer = ''
      renderFull()
      cb(val)
      return
    }
    if (seq === '\x7f' || seq === '\b') { T.composer = T.composer.slice(0, -1); renderFull(); return }
    if (seq.length === 1 && seq >= ' ') { T.composer += seq; renderFull(); return }
    return
  }
  if (seq === '\r' || seq === '\n') {
    const line = T.composer
    T.composer = ''
    T.histIdx = -1
    if (line.trim()) {
      T.composerHist.unshift(line)
      if (T.composerHist.length > 50) T.composerHist.pop()
      routeCommand(line)
    } else {
      renderFull()
    }
    return
  }
  if (seq === '\x7f' || seq === '\b') { T.composer = T.composer.slice(0, -1); renderFull(); return }
  if (seq === '\x15') { T.composer = ''; renderFull(); return } // Ctrl+U
  if (seq === '\x04') { teardown(); process.exit(0); return } // Ctrl+D
  if (seq === '\x1b[A') {
    if (T.histIdx < T.composerHist.length - 1) { T.histIdx++; T.composer = T.composerHist[T.histIdx] || ''; renderFull() }
    return
  }
  if (seq === '\x1b[B') {
    if (T.histIdx > 0) { T.histIdx--; T.composer = T.composerHist[T.histIdx] || ''; renderFull() }
    else { T.histIdx = -1; T.composer = ''; renderFull() }
    return
  }
  if (seq.length === 1 && seq >= ' ' && seq.charCodeAt(0) < 0x110000) {
    T.composer += seq
    renderFull()
  }
}

function promptInput(promptText) {
  T.composer = promptText + ' > '
  renderFull()
  return new Promise((resolve) => {
    T.promptCb = (val) => resolve(val)
  })
}

/* ---------- commands ---------- */
async function routeCommand(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const arg = rest.join(' ')
  switch (cmd) {
    case '/help':
      for (const r of [
        '── ' + t('tui.commands') + ' ──',
        '/model [n|name]', '/strength off|low|medium|high',
        '/lang zh|en', '/project <id> | new <name>', '/projects',
        '/key · /base <url>', '/new · /clear · /log · /quit',
      ]) pushSystem(r)
      break
    case '/model':
      if (arg) await setModel(arg)
      else pushSystem(t('tui.helpModel') + ': ' + P.store.MODELS.map((m, i) => (i + 1) + '=' + m).join('  '))
      break
    case '/strength':
      if (arg) await setStrength(arg)
      else pushSystem(t('tui.helpStrength') + ': off · low · medium · high')
      break
    case '/lang':
      if (/^zh/i.test(arg)) T.locale = 'zh'
      else if (/^en/i.test(arg)) T.locale = 'en'
      else T.locale = T.locale === 'zh' ? 'en' : 'zh'
      renderFull()
      break
    case '/new':
      await saveBound()
      break
    case '/project':
      await projectCmd(arg)
      break
    case '/projects':
      pushSystem(t('tui.projects') + ': ' + T.projects.map((p) => p.id).join(' · '))
      break
    case '/key': {
      const val = await promptInput(t('tui.enterKey'))
      if (val) { T.config.api.apiKey = val; await P.store.saveConfig(T.config); pushSystem(t('settings.saved')) }
      break
    }
    case '/base': {
      const val = arg || await promptInput('baseUrl')
      if (val) { T.config.api.baseUrl = val; await P.store.saveConfig(T.config); pushSystem(t('settings.saved')) }
      break
    }
    case '/clear':
      T.messages = []
      renderFull()
      break
    case '/log': {
      const raw = await P.store.readHistory(T.projectId)
      const out = join(P.platform.configDir(), 'export-' + Date.now() + '.jsonl')
      globalThis.__PRTS_FS__.writeFileSync(out, raw.map((e) => JSON.stringify(e)).join('\n') + '\n')
      pushSystem(t('tui.exported') + ' ' + out)
      break
    }
    case '/quit':
    case '/exit':
      teardown()
      process.exit(0)
      break
    default:
      if (cmd[0] === '/') pushSystem(t('tui.unknown') + ': ' + cmd)
      else await sendUser(line)
  }
}

async function projectCmd(arg) {
  if (!arg) { pushSystem(t('tui.projects') + ': ' + T.projects.map((p) => p.id).join(' · ')); return }
  const [sub, name] = arg.split(/\s+/)
  const id = sub === 'new' && name ? P.store.slugify(name) : T.projects.some((p) => p.id === sub) ? sub : P.store.slugify(sub)
  if (sub === 'new' && name) {
    await P.store.ensureProject(id)
    await P.store.renameProject(id, name)
  } else if (!T.projects.some((p) => p.id === id)) {
    await P.store.ensureProject(id)
  }
  await P.store.openProject(id)
  T.projectId = id
  await reloadProject()
  T.projects = await P.store.listProjects()
  pushSystem(t('tui.project') + ': ' + T.projectId)
}

async function setModel(arg) {
  const n = parseInt(arg, 10)
  const list = P.store.MODELS
  const model = n >= 1 && n <= list.length ? list[n - 1] : list.includes(arg) ? arg : null
  if (!model) { pushSystem(t('tui.badModel')); return }
  T.config.api.model = model
  await P.store.saveConfig(T.config)
  pushSystem('model: ' + model)
}

async function setStrength(arg) {
  if (!['off', 'low', 'medium', 'high'].includes(arg)) { pushSystem(t('tui.badStrength')); return }
  T.config.api.strength = arg
  await P.store.saveConfig(T.config)
  pushSystem('strength: ' + arg)
}

/* ---------- chat ---------- */
async function sendUser(text) {
  if (T.streaming) return
  const cfg = T.config
  if (!cfg.api.apiKey) { pushSystem(t('chat.error.noKey') + ' — /key'); return }
  const userMsg = { id: 'u' + Date.now(), k: 'm', role: 'user', content: text, ts: Date.now() }
  T.messages.push(userMsg)
  await P.store.appendHistory(T.projectId, userMsg)
  await P.store.touchProject(T.projectId)
  renderFull()

  const asstMsg = { id: 'a' + Date.now(), k: 'm', role: 'assistant', content: '', reasoning: '', ts: Date.now(), streaming: true, model: cfg.api.model, strength: cfg.api.strength }
  T.messages.push(asstMsg)
  T.streaming = true
  T.abortCtrl = new AbortController()
  const budget = P.store.STRENGTH_BUDGET[cfg.api.strength] || 0
  const history = T.messages
    .filter((m) => m !== asstMsg && !m.streaming && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content }))

  const run = (b) => P.api.chat({
    config: cfg,
    messages: history,
    budget: b,
    signal: T.abortCtrl.signal,
    onDelta() { renderFull() },
    onReasoning() { renderFull() },
  })

  let res = await run(budget)
  if (!res.ok && !res.aborted && res.error && res.error.message && /thinking/i.test(res.error.message) && budget > 0) {
    res = await run(0)
  }
  asstMsg.streaming = false
  asstMsg.content = res.content
  asstMsg.reasoning = res.reasoning
  if (res.usage) asstMsg.usage = res.usage
  if (res.durationMs) asstMsg.durationMs = res.durationMs
  if (!res.ok && !res.aborted) {
    asstMsg.error = P.i18n.t('chat.error.' + (res.error && res.error.code || 'http'), T.locale, { msg: res.error && res.error.message || '' })
  }
  T.streaming = false
  await P.store.appendHistory(T.projectId, asstMsg)
  await P.store.touchProject(T.projectId)
  renderFull()
}

function pushSystem(text) {
  T.messages.push({ id: 's' + Date.now() + Math.random(), k: 'm', role: 'system', content: text, ts: Date.now() })
  renderFull()
}

async function saveBound() {
  const ts = Date.now()
  await P.store.appendHistory(T.projectId, { k: 'b', ts })
  T.bounds.push(ts)
  renderFull()
}

async function reloadProject() {
  const entries = await P.store.readHistory(T.projectId)
  T.messages = []
  T.bounds = []
  for (const e of entries) {
    if (e.k === 'b') T.bounds.push(e.ts)
    else T.messages.push(e)
  }
}

function onResize() {
  T.cols = process.stdout.columns || 80
  T.rows = process.stdout.rows || 24
  renderFull()
}

function teardown() {
  process.stdout.write(C.altOff + C.show)
  if (process.stdin.isTTY) process.stdin.setRawMode(false)
  process.stdin.pause()
}

/* ---------- boot ---------- */
export async function runTui(opts) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write('PRTS TUI requires an interactive terminal.\n')
    return
  }
  T.config = await P.store.loadConfig()
  T.locale = opts && opts.locale ? opts.locale : (T.config.locale === 'auto' ? P.platform.detectLocale() : T.config.locale)
  if (opts && opts.project) {
    T.projectId = opts.project
    await P.store.openProject(T.projectId)
  }
  T.projects = await P.store.listProjects()
  await reloadProject()

  onResize()
  process.stdout.on('resize', onResize)
  process.on('exit', teardown)
  process.stdout.write(C.altOn)
  T.splashUntil = Date.now() + 1600
  renderFull()
  setTimeout(() => { T.splashUntil = 0; renderFull() }, 1650)

  setupRaw()
}

/* ---------- standalone entry ---------- */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.cwd(), process.argv[1]) || process.argv[1] && fileURLToPath(import.meta.url) === new URL('file://' + process.argv[1]).pathname
if (isMain) runTui({})
