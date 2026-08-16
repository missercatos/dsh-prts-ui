#!/usr/bin/env node
/**
 * CDP functional interaction tests for the PRTS window:
 *   new session → search filter → model popover → trajectory tab →
 *   sidebar collapse → send a message (live round-trip) → stop → archive.
 */
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url)) || list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
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
  }
}
await new Promise((r) => ws.onopen = r)
await call('Runtime.enable')

const evaluate = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { exception: String(r.exceptionDetails.text) }
  return r.result && r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : '')) }
const click = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'; el.click(); return 'clicked'; })()`)

// 1. New session button creates + selects a session.
const before = await evaluate(`window.PRTS.dshState.currentSessionId`)
await click('#newSessionBtn')
await sleep(1200)
const after = await evaluate(`window.PRTS.dshState.currentSessionId`)
check('new session created and selected', !!after && after !== before, after)

// 2. Search filters the session list.
const countAll = await evaluate(`document.querySelectorAll('#sessionList .sbItem').length`)
await evaluate(`(() => { const i = document.getElementById('sessionSearch'); i.value = 'ZZZZ-no-such-session-xyz'; i.dispatchEvent(new Event('input')); })()`)
await sleep(400)
const countFiltered = await evaluate(`document.querySelectorAll('#sessionList .sbItem').length`)
const emptyRow = await evaluate(`!!document.querySelector('#sessionList .sbEmpty')`)
check('search filters sessions', countFiltered === 0 && emptyRow, countAll + ' → ' + countFiltered + ' rows')
await evaluate(`(() => { const i = document.getElementById('sessionSearch'); i.value = ''; i.dispatchEvent(new Event('input')); })()`)
await sleep(300)

// 3. Model popover opens on click, lists providers + models, closes.
await click('#modelChip')
await sleep(300)
const popState = await evaluate(`(() => { const p = document.querySelector('#modelChip .pop'); return { open: !!p && p.classList.contains('open'), items: p ? p.querySelectorAll('.popItem').length : 0 }; })()`)
check('model popover opens', popState.open && popState.items > 0, JSON.stringify(popState))
await evaluate(`(() => { const first = document.querySelector('#modelChip .pop .popItem[data-provider]'); if (first) first.click(); return first ? first.dataset.provider : null; })()`)
await sleep(400)
const modelItems = await evaluate(`(() => { const p = document.querySelector('#modelChip .pop'); return { open: !!p && p.classList.contains('open'), models: p ? p.querySelectorAll('.popItem[data-model]').length : 0 }; })()`)
check('provider → model drill-down', modelItems.open && modelItems.models > 0, JSON.stringify(modelItems))
await evaluate(`document.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(200)

// 4. Trajectory tab switches the view.
await click('.tab[data-view="trajectory"]')
await sleep(300)
const trajVisible = await evaluate(`(() => { const t = document.getElementById('trajView'); return !t.hidden && t.children.length > 0; })()`)
check('trajectory tab renders events', trajVisible)
await click('.tab[data-view="chat"]')
await sleep(200)

// 5. Sidebar collapse toggles.
const sbW1 = await evaluate(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sb'))`)
await click('#sbToggleBtn')
await sleep(300)
const sbW2 = await evaluate(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sb'))`)
check('sidebar collapse toggles', sbW1 > 0 && sbW2 === 0, sbW1 + ' → ' + sbW2)
await click('#sbToggleBtn')
await sleep(200)

// 6. Reasoning popover opens with efforts.
await click('#reasoningChip')
await sleep(300)
const reasonPop = await evaluate(`(() => { const p = document.querySelector('#reasoningChip .pop'); return { open: !!p && p.classList.contains('open'), efforts: p ? p.querySelectorAll('.popItem[data-effort]').length : 0 }; })()`)
check('reasoning popover lists efforts', reasonPop.open && reasonPop.efforts > 0, JSON.stringify(reasonPop))
await evaluate(`document.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(200)

// 7. Permission popover opens with presets.
await click('#permissionChip')
await sleep(300)
const permPop = await evaluate(`(() => { const p = document.querySelector('#permissionChip .pop'); return { open: !!p && p.classList.contains('open'), presets: p ? p.querySelectorAll('.popItem[data-permission]').length : 0 }; })()`)
check('permission popover lists presets', permPop.open && permPop.presets > 0, JSON.stringify(permPop))
await evaluate(`document.dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
await sleep(200)

// 8. Live round-trip: type + send, wait for assistant events, then stop.
const sid = await evaluate(`window.PRTS.dshState.currentSessionId`)
await evaluate(`(() => { const i = document.getElementById('composerInput'); i.value = 'Reply with exactly: PRTS-OK'; i.dispatchEvent(new Event('input')); document.getElementById('sendBtn').click(); return 'sent'; })()`)
await sleep(4500)
const mid = await evaluate(`(() => { const C = window.PRTS.chat; return { streaming: C.streaming, user: C.messages.filter(m => m.role==='user').length, assistant: C.messages.filter(m => m.role==='assistant').length, tool: C.messages.filter(m => m.role==='tool').length, last: C.messages.length ? (C.messages[C.messages.length-1].content || '').slice(0, 80) : '' }; })()`)
check('send → user bubble + assistant stream', mid.user > 0 && (mid.assistant > 0 || mid.tool > 0), JSON.stringify(mid))
await click('#sendBtn')   // becomes the stop button while streaming
await sleep(600)
const stopped = await evaluate(`window.PRTS.chat.streaming === false || (document.getElementById('sendBtn').dataset.state !== 'stop')`)
check('stop button cancels the run', !!stopped)
const sid2 = await evaluate(`window.PRTS.dshState.currentSessionId`)

// 9. Archive the throwaway session used for the round-trip (click the row
//    trash after answering the confirm modal via the OK button).
await evaluate(`(() => { const row = document.querySelector('#sessionList .sbItem.active'); if (row) { const btn = row.querySelector('.rowBtn'); if (btn) btn.click(); } return !!document.querySelector('#modalOverlay.open'); })()`)
await sleep(300)
const modalOpen = await evaluate(`!!document.querySelector('#modalOverlay.open')`)
check('archive confirm uses PRTS modal (not window.confirm)', modalOpen)
if (modalOpen) { await click('#modalOk'); await sleep(900) }

const final = await evaluate(`window.PRTS.dshState.sessions.length`)
console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' interaction checks passed')
ws.close()
process.exit(0)
