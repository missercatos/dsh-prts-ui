#!/usr/bin/env node
/**
 * Live transport verification for the fixed PRTS client:
 *   - mux over WebSocket connects to the real dsh at $DSH_URL (default 3081)
 *   - workspace.list / session.list / llm.models / llm.providers /
 *     agentPreset.list shapes fold correctly
 *   - session.models / session.history paging / permission projection
 *   - live session/event frames arrive over the mux
 * Reads nothing from disk: it evaluates the two bundle sources directly.
 */
import { readFileSync } from 'node:fs'

const URL_BASE = process.env.DSH_URL || 'http://127.0.0.1:3081'

const ctx = { console, WebSocket, fetch, URL, AbortController, setTimeout, clearTimeout, TextDecoder, TextEncoder }
const g = globalThis

// Load the client + state scripts (IIFEs attach to the passed global).
function load(file) {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8')
  new Function('globalThis', src + '\n//# sourceURL=' + file)(g)
}
load('../src/dsh/client.js')
load('../src/dsh/state.js')

const P = g.PRTS
const results = []
const ok = (name, cond, detail) => {
  results.push({ name, ok: !!cond, detail })
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''))
}

let sessionEvents = 0
P.dsh.on('session/event', () => { sessionEvents++ })
P.dsh.on('session/subscribed', (f) => console.log('INFO  subscribed frame for', f.payload && f.payload.sessionId))

await P.dshState.connect(URL_BASE)
await new Promise((r) => setTimeout(r, 1200))
ok('mux websocket connected', P.dsh.connected === true)

await P.dshState.refreshAll()

ok('workspace.list items', Array.isArray(P.dshState.workspaces) && P.dshState.workspaces.length > 0,
  P.dshState.workspaces.map((w) => w.title || w.workspaceId).join(', '))
ok('session.list items', Array.isArray(P.dshState.sessions) && P.dshState.sessions.length > 0,
  P.dshState.sessions.length + ' sessions')

const first = P.dshState.sessions[0]
ok('session title from projection', typeof P.dshState.sessionTitle(first) === 'string' && P.dshState.sessionTitle(first).length > 0,
  JSON.stringify(P.dshState.sessionTitle(first)))
ok('permission projection', P.dshState.permissionState(first.sessionId) !== null,
  JSON.stringify(P.dshState.permissionState(first.sessionId)))

ok('llm.models groups', Array.isArray(P.dshState.models) && P.dshState.models.length > 0,
  P.dshState.models.map((g) => g.id + ':' + g.models.length).join(' '))
ok('llm.providers', P.dshState.providers.length > 0, P.dshState.providers.length + ' providers')
ok('agentPreset.list', P.dshState.presets.length > 0, P.dshState.presets.map((p) => p.id).join(', '))

// session.models — the model+effort source of truth
try {
  const cur = await P.dshState.sessionModels(first.sessionId)
  ok('session.models current', cur && cur.model, JSON.stringify(cur))
} catch (e) { ok('session.models current', false, e.message) }

// history paging
try {
  const page = await P.dshState.history(first.sessionId, { maxMessages: 60 })
  ok('session.history events', Array.isArray(page.events) && page.events.length > 0, page.events.length + ' events, hasMore=' + page.hasMore)
  const kinds = {}
  for (const it of page.events) { const t = it.event && it.event.type; kinds[t] = (kinds[t] || 0) + 1 }
  ok('history carries chunks', !!kinds['assistant/chunk'], JSON.stringify(kinds))
  const cmds = await P.dshState.commandsList(first.sessionId, page.events)
  ok('commands from history', cmds.length > 0, cmds.map((c) => '/' + c.name).join(' '))
} catch (e) { ok('session.history events', false, e.message) }

// session.search — deployed disabled → must degrade, not crash
try {
  const r = await P.dshState.searchSessions('PRTS')
  ok('session.search degrades gracefully', r === null || Array.isArray(r), 'result=' + (r === null ? 'null (disabled)' : JSON.stringify(r)))
} catch (e) { ok('session.search degrades gracefully', false, e.message) }

// Live frames: create a throwaway session — the harness emits its bootstrap
// events (sandbox/mode etc.) as session/event frames on the mux immediately.
let framesAll = 0
let throwawayId = null
P.dsh.on('session/event', () => { framesAll++ })
try {
  throwawayId = await P.dshState.createSession()
  await new Promise((r) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (framesAll > 0 || Date.now() - t0 > 15000) { clearInterval(iv); r() }
    }, 250)
  })
} catch (e) { console.log('INFO  session.create failed:', e.message) }
ok('live session/event frames received', framesAll > 0, framesAll + ' frames')
if (throwawayId) {
  try { await P.dshState.archiveSession(throwawayId); console.log('INFO  throwaway session archived') }
  catch (e) { console.log('INFO  could not archive throwaway session:', e.message) }
}

const failed = results.filter((r) => !r.ok).length
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed')
process.exit(failed ? 1 : 0)
