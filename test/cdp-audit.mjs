#!/usr/bin/env node
/**
 * CDP clickability + layout audit for the PRTS window:
 * every control must be visible, sized, and actually hit by elementFromPoint
 * at its center (proves no overlay is swallowing the click).
 * Usage: node cdp-audit.mjs
 */
import { readFileSync } from 'node:fs'

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

const audit = await evaluate(`(() => {
  const ids = ['brandBtn','themeBtn','sbCollapseBtn','newProjectBtn','newSessionBtn',
    'sessionSearch','sessionSearchClear','costBtn','marketBtn','detailsBtn','settingsBtn',
    'crumbProject','modeChip','permissionChip','clearHistoryBtn','logBtn',
    'modelChip','reasoningChip','commandsChip','attachBtn','voiceBtn','meterBtn','sendBtn',
    'composerExpand','composerInput','flow','sessionList','projectList'];
  const out = [];
  const vis = (el) => {
    if (!el) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const hit = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (!top) return null;
    if (top === el || el.contains(top)) return top.tagName + '.' + (top.className && String(top.className).split(' ')[0]);
    return 'COVERED by ' + top.tagName + '.' + (top.id || (top.className && String(top.className).split(' ')[0]));
  };
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out.push({ id, status: 'MISSING' }); continue; }
    const visible = vis(el);
    const r = el.getBoundingClientRect();
    out.push({
      id, status: visible ? 'visible' : 'HIDDEN',
      size: Math.round(r.width) + 'x' + Math.round(r.height),
      hit: visible ? hit(el) : null,
    });
  }
  // Overlay audit: closed overlays must not intercept clicks.
  const overlays = ['settingsOverlay','marketOverlay','modalOverlay','requestOverlay','sysOverlay','intro'];
  for (const id of overlays) {
    const el = document.getElementById(id);
    if (!el) continue;
    const st = getComputedStyle(el);
    out.push({ id: id + '(overlay)', status: st.display === 'none' ? 'display:none' : (st.pointerEvents === 'none' || !el.classList.contains('open') ? 'closed(pe:' + st.pointerEvents + ')' : 'OPEN'), size: '', hit: null });
  }
  return out;
})()`)

let pass = 0, fail = 0
for (const row of audit) {
  const bad = row.status !== 'visible' || (row.hit && String(row.hit).indexOf('COVERED') === 0)
  if (bad) { fail++; console.log('BAD ', JSON.stringify(row)) }
  else { pass++; console.log('OK  ', row.id, row.status, row.size, row.hit || '') }
}
console.log('\n' + pass + ' controls OK, ' + fail + ' problems')
ws.close()
process.exit(0)
