#!/usr/bin/env node
/**
 * Boot smoke test: runs the bundled GUI's main script against a minimal DOM
 * shim with a stubbed dsh API, so boot() executes end-to-end (binds, intro,
 * connect, refreshAll, ensureSession -> hero) and any runtime error surfaces.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')
const start = html.lastIndexOf('<script>') + 8
const code = html.slice(start, html.lastIndexOf('</script>'))

const listeners = {}
function makeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    textContent: '',
    innerHTML: '',
    value: '',
    placeholder: '',
    hidden: false,
    disabled: false,
    title: '',
    role: '',
    tabIndex: 0,
    dataset: {},
    attributes: {},
    children: [],
    parentNode: null,
    isConnected: true,
    width: 0,
    height: 0,
    clientWidth: 300,
    clientHeight: 150,
    getContext: () => makeCtx(),
    style: { setProperty() {} },
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)) },
      remove(...c) { c.forEach((x) => this._s.delete(x)) },
      toggle(c, force) {
        const want = force === undefined ? !this._s.has(c) : !!force
        if (want) this._s.add(c); else this._s.delete(c)
        return want
      },
      contains(c) { return this._s.has(c) },
    },
    appendChild(n) { this.children.push(n); n.parentNode = this; return n },
    removeChild(n) { this.children = this.children.filter((x) => x !== n); return n },
    remove() {},
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push([this, fn]) },
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null },
    hasAttribute(k) { return k in this.attributes },
    removeAttribute(k) { delete this.attributes[k] },
    insertBefore() {},
    contains() { return true },
    querySelectorAll() { return [] },
    closest() { return null },
    focus() {},
    click() { for (const [t, fn] of listeners.click || []) if (t === this) fn({ target: this }) },
    getBoundingClientRect() { return { top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300 } },
  }
  if (tag === 'canvas') {
    el.getContext = () => makeCtx()
  }
  return el
}
function makeCtx() {
  const noop = () => {}
  return new Proxy({
    fillStyle: '', strokeStyle: '', font: '', lineWidth: 1, globalAlpha: 1,
    textAlign: '', textBaseline: '', letterSpacing: '',
    clearRect: noop, fillRect: noop, stroke: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, closePath: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, setTransform: noop, drawImage: noop, fillText: noop,
    measureText: () => ({ width: 40 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get(t, k) { return k in t ? t[k] : noop }, set(t, k, v) { t[k] = v; return true } })
}

const byId = new Map()
const document = {
  readyState: 'loading', // boot defers to DOMContentLoaded
  documentElement: makeElement('html'),
  body: makeElement('body'),
  getElementById(id) {
    if (!byId.has(id)) byId.set(id, makeElement('div'))
    return byId.get(id)
  },
  querySelectorAll() { return [] },
  createElement: makeElement,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push([this, fn]) },
  removeEventListener() {},
}

// dsh API stub: minimal working responses (empty catalog).
const fetchLog = []
function fetchStub(url, init) {
  const u = String(url)
  if (/events\.mux/.test(u)) return new Promise(() => {}) // mux: hang
  let body = {}
  try { body = JSON.parse(init && init.body || '{}') } catch (e) { /* noop */ }
  const method = body.method || ''
  fetchLog.push(method)
  const ok = (value) => ({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } })
  const value = (() => {
    switch (method) {
      case 'workspace.list': return { items: [], archivedSessionIds: [] }
      case 'session.list': return { items: [] }
      case 'session.create': return { sessionId: 's-boot-smoke' }
      case 'session.models': return { current: null, groups: [] }
      case 'agentPreset.list': return { presets: [] }
      case 'llm.models': return { groups: [] }
      case 'llm.providers': return { providers: [] }
      case 'workspace.create': return { workspace: { workspaceId: 'w-boot' }, created: true }
      case 'commands/list': return [{ name: 'permission', description: 'Switch the permission preset' }, { name: 'plan', description: 'Enter or leave plan mode' }, { name: 'plugin-extra', description: 'a plugin command' }]
      case 'commands/execute': return undefined // unknown command -> not admitted
      case 'session.prompt': return {}
      default: return {}
    }
  })()
  return Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(ok(value)),
    text: () => Promise.resolve(''),
  })
}

const ctx = {
  console,
  document,
  getComputedStyle: () => ({ getPropertyValue: () => '#FAFAFA' }),
  navigator: { language: 'zh-CN', userAgent: 'smoke' },
  performance: { now: () => 0 },
  fetch: fetchStub,
  WebSocket: undefined,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  process,
  AbortController,
  TextDecoder,
  TextEncoder,
  Blob,
  URL,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push([this, fn]) },
  removeEventListener() {},
  innerWidth: 1200,
  innerHeight: 800,
  devicePixelRatio: 1,
  location: { origin: 'http://127.0.0.1:3080', protocol: 'http:' },
  showDirectoryPicker: undefined,
}
ctx.globalThis = ctx
ctx.window = ctx
vm.createContext(ctx)

const failures = []
process.on('unhandledRejection', (e) => { failures.push('unhandledRejection: ' + (e && e.message || e)); })
process.on('uncaughtException', (e) => { failures.push('uncaughtException: ' + (e && e.message || e)); })

try {
  vm.runInContext(code, ctx, { filename: 'bundle-main.js' })
} catch (e) {
  console.error('BOOT SMOKE FAIL (sync):', e && e.stack || e)
  process.exit(1)
}

// Fire the deferred boot (readyState was 'loading').
document.readyState = 'complete'
for (const [t, fn] of listeners.DOMContentLoaded || []) fn({ type: 'DOMContentLoaded' })

setTimeout(() => {
  if (failures.length) {
    console.error('BOOT SMOKE FAIL:\n' + failures.join('\n'))
    process.exit(1)
  }
  const P = ctx.PRTS
  console.log('STATE', JSON.stringify({ sid: P.dshState.currentSessionId, calls: fetchLog.slice(0, 24), phase: ctx.document.getElementById('cvt').dataset.phase, ready: P.app.ready, sessions: P.dshState.sessions.length }))
  const checks = [
    ['i18n tagline zh', P.i18n.t('hero.tagline', 'zh') === '欢迎回归，博士'],
    ['i18n tagline en', P.i18n.t('hero.tagline', 'en') === 'Welcome back, Doctor'],
    ['permission label', P.dshState.permissionDisplayName({ value: 'danger-full-access', name: 'danger-full-access' }) === 'Full access'],
    ['session created to hero', P.dshState.currentSessionId === 's-boot-smoke' && ctx.document.getElementById('cvt').dataset.phase === 'hero'],
    ['toggle bound', listeners.click.some(([t]) => t === ctx.document.getElementById('sbToggleBtn'))],
    ['theme bound', listeners.click.some(([t]) => t === ctx.document.getElementById('themeBtn'))],
    ['log bound', listeners.click.some(([t]) => t === ctx.document.getElementById('logBtn'))],
    ['new session bound', listeners.click.some(([t]) => t === ctx.document.getElementById('newSessionBtn'))],
    ['browse bound', listeners.click.some(([t]) => t === ctx.document.getElementById('modalBrowseBtn'))],
  ]
  let bad = 0
  for (const [name, okv] of checks) {
    try { console.log((okv ? 'PASS ' : 'FAIL ') + name); if (!okv) bad++ }
    catch (e) { console.log('FAIL ' + name + ' (' + e.message + ')'); bad++ }
  }

  // ---- Phase 2: interactions through the shim ----
  ;(async () => {
    const $ = (id) => ctx.document.getElementById(id)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    // 1. New session button -> hero again (visible effect).
    $('newSessionBtn').click()
    await sleep(120)
    const s1 = P.dshState.currentSessionId && ctx.document.getElementById('cvt').dataset.phase === 'hero'
    console.log((s1 ? 'PASS ' : 'FAIL ') + 'new session button lands on hero')

    // 2. Sidebar single toggle: collapse then expand to the original width.
    const app = $('app')
    $('sbToggleBtn').click()
    const collapsed = app.classList.contains('sbCollapsed') && $('sbToggleBtn').getAttribute('aria-expanded') === 'false'
    $('sbToggleBtn').click()
    const reopened = !app.classList.contains('sbCollapsed') && $('sbToggleBtn').getAttribute('aria-expanded') === 'true'
    console.log((collapsed && reopened ? 'PASS ' : 'FAIL ') + 'sidebar single-button toggle')
    if (!collapsed || !reopened) bad++

    // 3. Theme toggle flips the document theme.
    $('themeBtn').click()
    const themed = ctx.document.documentElement.dataset.theme === 'light'
    $('themeBtn').click()
    console.log((themed && ctx.document.documentElement.dataset.theme === 'dark' ? 'PASS ' : 'FAIL ') + 'theme toggle')
    if (!themed) bad++

    // 4. Slash autocomplete: typing '/per' lists commands and Enter completes.
    const input = $('composerInput')
    input.value = '/per'
    for (const [t, fn] of listeners.input || []) if (t === input) fn({ target: input })
    await sleep(80)
    for (const [t, fn] of listeners.keydown || []) {
      if (t === input) fn({ key: 'Enter', shiftKey: false, isComposing: false, preventDefault() {} })
    }
    const completed = input.value === '/permission '
    console.log((completed ? 'PASS ' : 'FAIL ') + 'slash command autocomplete')
    if (!completed) bad++

    // 5. Plugin-extended commands appear in the directory.
    const dir = await P.dshState.commandsList(P.dshState.currentSessionId)
    const hasPlugin = dir.some((c) => c.name === 'plugin-extra')
    console.log((hasPlugin ? 'PASS ' : 'FAIL ') + 'plugin commands in directory')
    if (!hasPlugin) bad++

    // 6. Unknown slash line falls back to a normal message (never lost) and
    //    leaves the hero (send -> enterChat).
    input.value = '/nosuchcmd'
    for (const [t, fn] of listeners.keydown || []) {
      if (t === input) fn({ key: 'Enter', shiftKey: false, isComposing: false, preventDefault() {} })
    }
    await sleep(120)
    const fellBack = ctx.document.getElementById('cvt').dataset.phase === 'active'
    console.log((fellBack ? 'PASS ' : 'FAIL ') + 'unknown command falls back to message')
    if (!fellBack) bad++

    console.log(bad === 0 ? 'BOOT SMOKE: ALL OK' : 'BOOT SMOKE: FAILURES')
    process.exit(bad === 0 ? 0 : 1)
  })().catch((e) => { console.error('PHASE2 ERR', e && e.stack || e); process.exit(1) })
}, 900)
