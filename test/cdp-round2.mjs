#!/usr/bin/env node
/**
 * Verification suite for the round-2 fixes:
 *   1. mode selection (locked session -> new-session confirm; blank -> apply)
 *   2. settings model-config collapse toggle
 *   3. sidebar collapse -> floating expand button -> reopen
 *   4. session select mode + bulk archive (throwaway sessions only)
 *   5. hidden-attribute fixes (attach strip / status row / chips)
 *   6. render throttle during a synthetic chunk burst
 */
const PORT = process.env.CDP_PORT || '9225'
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

// Wait for boot.
for (let i = 0; i < 30; i++) { if (await ev('window.PRTS && window.PRTS.app && window.PRTS.app.ready')) break; await sleep(500) }

// 0. hidden-attribute sanity: attach strip + status row hidden by default.
const hiddenState = await ev(`({ attach: document.getElementById('attachStrip').hidden, status: document.getElementById('statusRow').hidden, perm: document.getElementById('permissionChip').hidden })`)
check('hidden attributes respected', hiddenState.attach === true && hiddenState.status === true && hiddenState.perm === false, JSON.stringify(hiddenState))

// 1. Mode on the current (started) session -> locked confirm modal.
await click('#modeChip')
await sleep(400)
const modeItems = await ev(`document.querySelectorAll('#modeChip .pop .popItem[data-preset]').length`)
check('mode popover lists presets', modeItems > 0, modeItems + ' presets')
await ev(`(() => { const it = document.querySelector('#modeChip .pop .popItem[data-preset="code"]'); if (it) it.click(); return !!it; })()`)
await sleep(500)
const lockedModal = await ev(`(() => { const o = document.getElementById('modalOverlay'); return { open: o.classList.contains('open'), text: document.getElementById('modalTitle').textContent }; })()`)
check('locked session offers a new session', lockedModal.open && /mode|模式|code/i.test(lockedModal.text), JSON.stringify(lockedModal))
await click('#modalCancel')
await sleep(300)

// 2. Mode on a blank session -> applies directly.
await click('#newSessionBtn')
await sleep(1200)
const blankSession = await ev(`window.PRTS.dshState.currentSessionId`)
const isBlank = await ev(`window.PRTS.dshState.isSessionBlank(window.PRTS.dshState.currentSessionId)`)
await click('#modeChip')
await sleep(300)
await ev(`(() => { const it = document.querySelector('#modeChip .pop .popItem[data-preset="minimal"]'); if (it) it.click(); return !!it; })()`)
await sleep(800)
const appliedPreset = await ev(`(() => { const s = window.PRTS.dshState.sessionSummary(window.PRTS.dshState.currentSessionId); return s && s.agentPreset; })()`)
const headerMode = await ev(`document.getElementById('headerMode').textContent`)
check('blank session applies mode directly', isBlank === true && (appliedPreset === 'minimal' || /极简|MINIMAL/i.test(headerMode)), appliedPreset + ' / ' + headerMode)

// 3. Settings model-config collapse toggle.
await click('#settingsBtn')
await sleep(500)
const beforeToggle = await ev(`document.getElementById('modelCfgBody').hidden`)
await click('#modelCfgToggle')
await sleep(300)
const afterToggle = await ev(`document.getElementById('modelCfgBody').hidden`)
check('model-config toggle works', beforeToggle === true && afterToggle === false, beforeToggle + ' → ' + afterToggle)
await click('#settingsClose')
await sleep(300)

// 4. Sidebar collapse -> expand chip -> reopen.
await click('#sbCollapseBtn')
await sleep(400)
const collapsed = await ev(`(() => ({ cls: document.getElementById('app').classList.contains('sbCollapsed'), chip: !document.getElementById('sbExpandBtn').hidden }))()`)
await click('#sbExpandBtn')
await sleep(400)
const reopened = await ev(`(() => ({ cls: document.getElementById('app').classList.contains('sbCollapsed'), chip: !document.getElementById('sbExpandBtn').hidden }))()`)
check('sidebar collapse + floating reopen', collapsed.cls === true && collapsed.chip === true && reopened.cls === false && reopened.chip === false, JSON.stringify({ collapsed, reopened }))

// 5. Selection mode + bulk archive on the two throwaway sessions.
// Create two throwaways first.
await click('#newSessionBtn')
await sleep(900)
await click('#newSessionBtn')
await sleep(900)
await click('#sessionSelectBtn')
await sleep(300)
const selectUi = await ev(`(() => { const boxes = [...document.querySelectorAll('#sessionList .sbCheck')]; return { mode: window.PRTS.app.selecting, visible: boxes.filter(b => !b.hidden).length, bar: !document.getElementById('sessionBulkBar').hidden }; })()`)
check('select mode shows checkboxes + bulk bar', selectUi.mode === true && selectUi.visible > 0 && selectUi.bar === true, JSON.stringify(selectUi))
// Select the first two rows.
await ev(`(() => { const rows = [...document.querySelectorAll('#sessionList .sbItem')].slice(0, 2); rows.forEach(r => r.click()); return rows.length; })()`)
await sleep(300)
const selected = await ev(`window.PRTS.app.selectedSessions.size`)
const label = await ev(`document.getElementById('sessionBulkLabel').textContent`)
check('two sessions selected', selected === 2, label)
await click('#sessionBulkArchive')
await sleep(400)
const bulkConfirm = await ev(`document.getElementById('modalOverlay').classList.contains('open')`)
check('bulk archive asks for confirmation', bulkConfirm)
await click('#modalOk')
await sleep(1500)
const afterArchive = await ev(`window.PRTS.app.selectedSessions.size`)
check('bulk archive executed and cleared selection', afterArchive === 0)

// 6. Render throttle: count real DOM rewrites of #flow with a
// MutationObserver during a live turn — with the throttle this must stay
// far below the raw chunk count (a live turn streams hundreds of chunks).
await ev(`(() => {
  window.__flowMutations = 0;
  window.__flowObserver = new MutationObserver(() => { window.__flowMutations++; });
  window.__flowObserver.observe(document.getElementById('flow'), { childList: true, subtree: true });
  return 'observing';
})()`)
const sent = await ev(`(() => { const i = document.getElementById('composerInput'); i.value = 'Reply with a short paragraph.'; i.dispatchEvent(new Event('input')); document.getElementById('sendBtn').click(); return 'sent'; })()`)
await sleep(9000)
const mutationCount = await ev(`(() => { window.__flowObserver.disconnect(); return window.__flowMutations; })()`)
const msgs = await ev(`window.PRTS.chat.messages.length`)
check('live turn renders are throttled (bounded)', mutationCount >= 2 && mutationCount < 300, mutationCount + ' DOM rewrites during a ~9s live turn, ' + msgs + ' messages folded')

const failed = results.filter((r) => !r.ok).length
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed')
ws.close()
process.exit(failed ? 1 : 0)
