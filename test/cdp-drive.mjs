#!/usr/bin/env node
/**
 * CDP driver for the PRTS Electron window: collects console errors and
 * exceptions, samples application state, and captures screenshots.
 * Usage: node cdp-drive.mjs <out-prefix> [waitMs]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const OUT = process.argv[2] || '/tmp/prts-shot'
const WAIT = Number(process.argv[3] || 8000)

// Find the PRTS page target.
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url)) || list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const events = []
const call = (method, params) => new Promise((resolve, reject) => {
  const mid = ++id
  pending.set(mid, { resolve, reject })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message))
    else p.resolve(m.result)
    return
  }
  if (m.method) events.push(m)
}
await new Promise((r) => ws.onopen = r)
await call('Runtime.enable')
await call('Log.enable')
await call('Page.enable')

await new Promise((r) => setTimeout(r, WAIT))

const evaluate = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { exception: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '') }
  return r.result && r.result.value
}

const state = await evaluate(`(() => {
  const A = window.PRTS && window.PRTS.app
  const S = window.PRTS && window.PRTS.dshState
  return {
    ready: A ? A.ready : null,
    introDone: A ? A.introDone : null,
    connected: S ? window.PRTS.dsh.connected : null,
    url: S ? S.url : null,
    workspaces: S ? S.workspaces.length : null,
    sessions: S ? S.sessions.length : null,
    currentSessionId: S ? S.currentSessionId : null,
    currentModel: S ? S.currentModel : null,
    presets: S ? S.presets.length : null,
    permissions: S ? S.permissions : null,
    chatMessages: window.PRTS && window.PRTS.chat ? window.PRTS.chat.messages.length : null,
    phase: document.getElementById('cvt') ? document.getElementById('cvt').dataset.phase : null,
    introDisplay: document.getElementById('intro') ? getComputedStyle(document.getElementById('intro')).display : null,
    headerHidden: document.getElementById('header') ? document.getElementById('header').hidden : null,
    modelChip: document.getElementById('modelChipLabel') ? document.getElementById('modelChipLabel').textContent : null,
    reasoningChipHidden: document.getElementById('reasoningChip') ? document.getElementById('reasoningChip').hidden : null,
    reasoningChip: document.getElementById('reasoningChipLabel') ? document.getElementById('reasoningChipLabel').textContent : null,
    permissionChipHidden: document.getElementById('permissionChip') ? document.getElementById('permissionChip').hidden : null,
    permissionChip: document.getElementById('permissionChipLabel') ? document.getElementById('permissionChipLabel').textContent : null,
    meter: document.getElementById('meterLabel') ? document.getElementById('meterLabel').textContent : null,
    title: document.title,
    lang: document.documentElement.lang,
  }
})()`)
console.log('STATE', JSON.stringify(state, null, 1))

const errors = events.filter((e) =>
  (e.method === 'Runtime.exceptionThrown') ||
  (e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level)) ||
  (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
console.log('CONSOLE_EVENTS', errors.length)
for (const e of errors.slice(0, 20)) {
  if (e.method === 'Runtime.exceptionThrown') console.log('EXC', e.params.exceptionDetails.text, (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || ''))
  else if (e.method === 'Log.entryAdded') console.log('LOG', e.params.entry.level, e.params.entry.text)
  else console.log('ERR', e.params.args.map((a) => a.value || a.description || '').join(' '))
}

// Screenshot the current frame.
const shot = await call('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT + '.png', Buffer.from(shot.data, 'base64'))
console.log('SHOT', OUT + '.png')

ws.close()
process.exit(0)
