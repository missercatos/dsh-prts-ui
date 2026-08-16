#!/usr/bin/env node
/**
 * Round-3 verification:
 *   1. intro plays the 3-phase cycle (phaseCount reaches >=3 before finish)
 *   2. settings model-config collapse animates (class open toggles, inner
 *      height transitions — measured via computed style over time)
 *   3. stats dock renders turn/step + LLM/tool + cache lines from projections
 *   4. trajectory tab shows step timeline; session log button opens the
 *      separate raw-log overlay with export
 */
const PORT = process.env.CDP_PORT || '9227'
const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()
const page = list.find((t) => t.type === 'page' && /index\.html/.test(t.url)) || list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pending = new Map()
const call = (method, params) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
  }
}
await new Promise((r) => ws.onopen = r)
await call('Runtime.enable')
const ev = async (expr) => {
  const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { exception: String(r.exceptionDetails.text) }
  return r.result && r.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : '')) }
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'; el.click(); return 'clicked'; })()`)

// 1. Intro: sample phaseCount right after boot; it must reach >=3 before the
// intro auto-finishes, and each phase lasts ~3.2s.
const early = await ev(`({ phaseCount: window.PRTS.app.phaseCount, introDone: window.PRTS.app.introDone, display: getComputedStyle(document.getElementById('intro')).display })`)
check('intro runs the 3-phase cycle', early.introDone === false && early.display !== 'none' && early.phaseCount >= 0, JSON.stringify(early))
await sleep(9000)
const later = await ev(`({ phaseCount: window.PRTS.app.phaseCount, introDone: window.PRTS.app.introDone })`)
check('intro finished after the full cycle', later.introDone === true && later.phaseCount >= 3, JSON.stringify(later))

// 2. Settings collapse animation.
await click('#settingsBtn')
await sleep(500)
await click('#modelCfgToggle')
const h0 = await ev(`document.querySelector('#modelCfgBody').getBoundingClientRect().height`)
await sleep(180)
const hMid = await ev(`document.querySelector('#modelCfgBody').getBoundingClientRect().height`)
await sleep(300)
const hEnd = await ev(`document.querySelector('#modelCfgBody').getBoundingClientRect().height`)
const openClass = await ev(`document.getElementById('modelCfgBody').classList.contains('open')`)
check('settings collapse animates smoothly', openClass === true && h0 >= 0 && hMid > h0 && hEnd > hMid, 'heights ' + h0 + ' → ' + hMid + ' → ' + hEnd)
await click('#modelCfgToggle')
await sleep(450)
const hClosed = await ev(`document.querySelector('#modelCfgBody').getBoundingClientRect().height`)
check('collapse closes back down', hClosed <= 1, 'height ' + hClosed)
await click('#settingsClose')
await sleep(200)

// 3. Stats dock: switch to the real session (has stats) and read the dock.
await ev(`(() => { const row = [...document.querySelectorAll('#sessionList .sbItem')].find(r => r.dataset.session && r.dataset.session.indexOf('7647eae0') >= 0); if (row) row.click(); return !!row; })()`)
await sleep(2500)
const dock = await ev(`(() => { const d = document.getElementById('statsDock'); return { hidden: d.hidden, text: d.textContent }; })()`)
check('stats dock shows session stats', dock.hidden === false && /轮|turns/.test(dock.text) && /步|steps/.test(dock.text), dock.text.slice(0, 140))

// 4. Trajectory timeline (tab) vs session log (overlay).
await click('.tab[data-view="trajectory"]')
await sleep(500)
const timeline = await ev(`(() => { const t = document.getElementById('trajView'); return { visible: !t.hidden, steps: t.querySelectorAll('.tlStep').length, labels: t.querySelectorAll('.tlLabel').length }; })()`)
check('trajectory tab renders step timeline', timeline.visible === true && timeline.steps > 0 && timeline.labels > 0, JSON.stringify(timeline))
await click('.tab[data-view="chat"]')
await sleep(300)
await click('#logBtn')
await sleep(400)
const log = await ev(`(() => { const o = document.getElementById('logOverlay'); return { open: o.classList.contains('open'), rows: document.querySelectorAll('#logBody .trajItem').length, exportBtn: !!document.getElementById('logExport') }; })()`)
check('session log is a separate overlay', log.open === true && log.rows > 0 && log.exportBtn === true, JSON.stringify(log))
await click('#logClose')
await sleep(200)
const logClosed = await ev(`!document.getElementById('logOverlay').classList.contains('open')`)
check('log overlay closes', logClosed)

// 5. Voice consent modal appears on first enable (no mic needed for the modal).
await click('#voiceBtn')
await sleep(400)
const consent = await ev(`(() => { const o = document.getElementById('modalOverlay'); return { open: o.classList.contains('open'), title: document.getElementById('modalTitle').textContent, ok: document.getElementById('modalOk').textContent }; })()`)
check('first voice enable asks for microphone consent', consent.open === true && /麦克风|Microphone/i.test(consent.title) && /允许|Allow/i.test(consent.ok), JSON.stringify(consent))
await click('#modalCancel')
await sleep(200)

const failed = results.filter((r) => !r.ok).length
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed')
ws.close()
process.exit(failed ? 1 : 0)
