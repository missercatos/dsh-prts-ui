/**
 * dsh RPC client — the browser half of dsh's `/api` transport.
 *
 * PRTS is a GUI *for* dsh, so it never talks to the model directly and never
 * stores its own sessions: every interaction goes through dsh's client-request /
 * server-response RPC (HTTP POST `/api/<method>`) and the mux WebSocket
 * (`/api/events.mux`) that carries server-request frames (session events,
 * questions, approvals).
 *
 * Wire shapes (from @deepseek-ai/dsh-host-apiproxy):
 *   client-request : { type: 'client-request', rpcId, method, payload }
 *   server-response: { type: 'server-response', rpcId, result: {ok,value}|{ok:false,error} }
 *   server-request : { type: 'server-request', rpcId, method, payload }  (push frames)
 *   client-response: { type: 'client-response', rpcId, result }
 *
 * The connection is robust to dsh upgrades: it is only this wire contract, not
 * dsh's UI code.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const D = P.dsh = { baseUrl: 'http://127.0.0.1:3085', connected: false };

  let seq = 0;
  const pending = new Map();     // rpcId -> { resolve, reject }
  let ws = null;
  const listeners = new Map();   // event type -> Set<fn>
  const onceListeners = new Map();
  let manualClose = false;

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

  /** Invoke an RPC method. Resolves with the business `value`, rejects on error. */
  async function request(method, payload) {
    const id = rpcId();
    const env = { type: 'client-request', rpcId: id, method, payload: payload || {} };
    const bridge = dshBridge();
    if (bridge) {
      const body = await bridge.request(method, payload || {});
      return parseResponse(id, body);
    }
    const res = await fetch(apiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(env),
    });
    return parseResponse(id, await res.json());
  }

  /** Respond to a server-request frame (questions, approvals, steers) via
   *  POST /api/respond — the dsh client-response carrier, not the mux. */
  async function respond(rpcIdValue, result) {
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

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg && msg.type === 'server-request') {
      // A push frame from the host. `method` doubles as the event name
      // (e.g. 'session/event', 'session/subscribed', 'question/requested').
      emit(msg.method, msg);
      return;
    }
    if (msg && msg.type === 'server-response' && pending.has(msg.rpcId)) {
      const p = pending.get(msg.rpcId);
      pending.delete(msg.rpcId);
      if (msg.result && msg.result.ok) p.resolve(msg.result.value);
      else p.reject((msg.result && msg.result.error) || new Error('dsh rpc error'));
    }
  }

  /** Open the mux SSE stream and subscribe to session events. Non-blocking: it
   *  keeps retrying in the background until dsh is reachable. When running in
   *  Electron, the main process owns the stream and relays frames via IPC. */
  let muxAbort = null;
  function connect(url) {
    if (url) D.baseUrl = url;
    const bridge = dshBridge();
    if (bridge) {
      bridge.onFrame((data) => onMessage(data));
      D.connected = true;
      emit('connect', {});
      return;
    }
    manualClose = false;
    try { if (muxAbort) muxAbort.abort(); } catch (e) { /* noop */ }
    const ac = new AbortController();
    muxAbort = ac;
    const muxUrl = D.baseUrl.replace(/\/+$/, '') + '/api/events.mux';
    fetch(muxUrl, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) throw new Error('mux ' + res.status);
        D.connected = true;
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
              if (line.startsWith('data: ')) onMessage(line.slice(6).trim());
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        D.connected = false;
        emit('disconnect', {});
        if (!manualClose) setTimeout(() => connect(), 1000);
      });
  }

  function close() { manualClose = true; try { if (muxAbort) muxAbort.abort(); } catch (e) { /* noop */ } D.connected = false; }

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
