/**
 * dsh RPC client — the browser half of dsh's `/api` transport.
 *
 * PRTS is a GUI *for* dsh, so it never talks to the model directly and never
 * stores its own sessions: every interaction goes through dsh's client-request /
 * server-response RPC (HTTP POST `/api/<method>`) and the mux stream
 * (`/api/events.mux`) that carries server-request frames (session events,
 * questions, approvals).
 *
 * Wire shapes (from @deepseek-ai/dsh-host-apiproxy):
 *   client-request : { type: 'client-request', rpcId, method, payload }
 *   server-response: { type: 'server-response', rpcId, result: {ok,value}|{ok:false,error} }
 *   server-request : { type: 'server-request', rpcId, method, payload }  (push frames)
 *   client-response: { type: 'client-response', rpcId, result }
 *
 * The mux carrier differs by deployment: current harness builds serve
 * `/api/events.mux` as a **WebSocket** (a plain GET answers "upgrade
 * required"), while older builds served it as an SSE stream. PRTS tries the
 * WebSocket first and falls back to SSE parsing, so it stays compatible with
 * both generations of dsh.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const D = P.dsh = { baseUrl: 'http://127.0.0.1:3081', connected: false };

  let seq = 0;
  const pending = new Map();     // rpcId -> { resolve, reject }  (HTTP responses)
  const listeners = new Map();   // event type -> Set<fn>
  const onceListeners = new Map();
  let manualClose = false;
  let muxAbort = null;
  let retryTimer = null;
  let lastErrorNotified = false;

  function rpcId() {
    return 'prts-' + Date.now().toString(36) + '-' + (++seq).toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function apiUrl(method) {
    return D.baseUrl.replace(/\/+$/, '') + '/api/' + method;
  }

  function dshBridge() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge && window.prts.bridge.dsh) {
        return window.prts.bridge.dsh;
      }
    } catch (e) { /* no bridge */ }
    return null;
  }

  function parseResponse(id, body) {
    if (body && body.type === 'server-response' && body.result) {
      if (body.result.ok) return body.result.value;
      const e = body.result.error || {};
      const err = new Error(e.message || ('dsh: ' + id));
      err.code = e.code;
      err.details = e.details;
      throw err;
    }
    throw new Error('dsh: unexpected response');
  }

  /** Invoke an RPC method. Resolves with the business `value`, rejects on error.
   *  `opts.timeoutMs` aborts the browser fetch after the given time (the
   *  Electron bridge cannot abort; it simply stays pending there). */
  async function request(method, payload, opts) {
    const id = rpcId();
    const env = { type: 'client-request', rpcId: id, method, payload: payload || {} };
    const bridge = dshBridge();
    if (bridge) {
      const body = await bridge.request(method, payload || {});
      return parseResponse(id, body);
    }
    const timeoutMs = opts && opts.timeoutMs;
    const ac = timeoutMs ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    let res;
    try {
      res = await fetch(apiUrl(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(env),
        signal: ac ? ac.signal : undefined,
      });
    } catch (e) {
      throw new Error('dsh: network error (' + (e && e.message) + ')');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error('dsh: HTTP ' + res.status);
    return parseResponse(id, await res.json().catch(() => null));
  }

  /** Respond to a server-request frame (questions, approvals, steers) via
   *  POST /api/respond — the dsh client-response carrier, not the mux.
   *  `value` is the business value; the {ok:true, value} envelope is added
   *  here so callers never hand-roll the wire result. */
  async function respond(rpcIdValue, value) {
    const result = value && value.ok !== undefined && (value.value !== undefined || value.error !== undefined)
      ? value
      : { ok: true, value };
    const bridge = dshBridge();
    if (bridge) { try { await bridge.respond(rpcIdValue, result); } catch (e) { /* noop */ } return; }
    try {
      await fetch(D.baseUrl.replace(/\/+$/, '') + '/api/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-response', rpcId: rpcIdValue, result }),
      });
    } catch (e) { /* noop */ }
  }

  function emit(type, frame) {
    const set = listeners.get(type);
    if (set) for (const fn of [...set]) { try { fn(frame); } catch (e) { /* listener errors must not kill the socket */ } }
    const once = onceListeners.get(type);
    if (once) { onceListeners.delete(type); for (const fn of [...once]) { try { fn(frame); } catch (e) { /* noop */ } } }
  }

  function onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'server-request') {
      // A push frame from the host. `method` doubles as the event name
      // (e.g. 'session/event', 'session/subscribed', 'question/requested',
      // 'approval/requested').
      emit(msg.method, msg);
      // The frame payload carries the semantic type too; also emit under it so
      // listeners can subscribe either way.
      if (msg.payload && msg.payload.type && msg.payload.type !== msg.method) emit(msg.payload.type, msg);
      return;
    }
    if (msg.type === 'server-response' && pending.has(msg.rpcId)) {
      const p = pending.get(msg.rpcId);
      pending.delete(msg.rpcId);
      if (msg.result && msg.result.ok) p.resolve(msg.result.value);
      else p.reject((msg.result && msg.result.error) || new Error('dsh rpc error'));
    }
  }

  /* ---------- mux carrier: WebSocket first, SSE fallback ---------- */

  function scheduleRetry(delayMs) {
    if (manualClose) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => connect(), delayMs || 1500);
  }

  function openWebSocket() {
    const base = D.baseUrl.replace(/\/+$/, '');
    const wsUrl = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/api/events.mux';
    let ws;
    try {
      if (typeof WebSocket === 'undefined') return false;
      ws = new WebSocket(wsUrl);
    } catch (e) { return false; }
    let opened = false;
    ws.onopen = () => {
      opened = true;
      D.connected = true;
      lastErrorNotified = false;
      emit('connect', {});
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      onMessage(msg);
    };
    const teardown = () => {
      if (muxAbort === ws) muxAbort = null;
      D.connected = false;
      emit('disconnect', {});
      if (!manualClose && !opened) {
        // The upgrade was refused — this deployment serves SSE instead.
        openSse();
        return;
      }
      if (!manualClose) scheduleRetry(1500);
    };
    ws.onclose = teardown;
    ws.onerror = teardown;
    muxAbort = ws;
    return true;
  }

  function openSse() {
    if (manualClose) return;
    const base = D.baseUrl.replace(/\/+$/, '');
    const ac = new AbortController();
    muxAbort = ac;
    fetch(base + '/api/events.mux', { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error('mux ' + res.status);
        D.connected = true;
        lastErrorNotified = false;
        emit('connect', {});
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of chunk.split('\n')) {
              if (line.startsWith('data: ')) {
                try { onMessage(JSON.parse(line.slice(6).trim())); } catch (e) { /* skip */ }
              }
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (muxAbort === ac) muxAbort = null;
        D.connected = false;
        emit('disconnect', {});
        if (!manualClose) scheduleRetry(1500);
      });
  }

  /** Open the mux stream and subscribe to session events. Non-blocking: it
   *  keeps retrying in the background until dsh is reachable. When running in
   *  Electron, the main process owns the stream and relays frames via IPC. */
  function connect(url) {
    if (url) D.baseUrl = url;
    clearTimeout(retryTimer);
    const bridge = dshBridge();
    if (bridge) {
      try { bridge.onFrame((data) => { try { onMessage(typeof data === 'string' ? JSON.parse(data) : data); } catch (e) { /* noop */ } }); } catch (e) { /* noop */ }
      D.connected = true;
      emit('connect', {});
      return;
    }
    manualClose = false;
    if (muxAbort) {
      try {
        if (typeof muxAbort.abort === 'function') muxAbort.abort();
        else if (typeof muxAbort.close === 'function') muxAbort.close();
      } catch (e) { /* noop */ }
      muxAbort = null;
    }
    // WebSocket first; on refused upgrades the WS close path falls back to SSE.
    if (!openWebSocket()) openSse();
  }

  function close() {
    manualClose = true;
    clearTimeout(retryTimer);
    if (muxAbort) {
      try {
        if (typeof muxAbort.abort === 'function') muxAbort.abort();
        else if (typeof muxAbort.close === 'function') muxAbort.close();
      } catch (e) { /* noop */ }
      muxAbort = null;
    }
    D.connected = false;
  }

  /** Subscribe to a push event (method name). Returns an unsubscribe fn. */
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => { const s = listeners.get(type); if (s) s.delete(fn); };
  }
  function once(type, fn) {
    if (!onceListeners.has(type)) onceListeners.set(type, new Set());
    onceListeners.get(type).add(fn);
  }

  D.request = request;
  D.respond = respond;
  D.connect = connect;
  D.close = close;
  D.on = on;
  D.once = once;
})(typeof globalThis !== 'undefined' ? globalThis : this);
