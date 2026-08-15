/**
 * PRTS io adapter: filesystem + http. In Node (TUI, Electron main tests) it
 * uses node:fs and the built-in fetch. In the web renderer it proxies through
 * `window.prts.bridge` (Electron preload) so persistence and API calls avoid
 * CORS. A plain browser (no bridge) gets read-only in-memory fallbacks plus
 * direct fetch for http, which is only used for local development/testing.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  function isNode() {
    return typeof process !== 'undefined' && typeof process.versions !== 'undefined' && !!process.versions.node;
  }

  let bridge = null;
  try {
    if (!isNode() && typeof window !== 'undefined' && window.prts && window.prts.bridge) bridge = window.prts.bridge;
  } catch (e) { bridge = null; }

  const memory = {};
  let bridgeSeq = 0;

  const io = {
    hasBridge: !!bridge,
    readFile(path) {
      if (bridge) return bridge.readFile(path);
      if (isNode()) {
        try { return Promise.resolve(requireFs().readFileSync(path, 'utf8')); } catch (e) { return Promise.reject(e); }
      }
      if (path in memory) return Promise.resolve(memory[path]);
      return Promise.reject(new Error('ENOENT'));
    },
    writeFile(path, data) {
      if (bridge) return bridge.writeFile(path, data);
      if (isNode()) {
        try { requireFs().writeFileSync(path, data, 'utf8'); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
      }
      memory[path] = String(data);
      return Promise.resolve();
    },
    appendFile(path, data) {
      if (bridge) return bridge.appendFile(path, data);
      if (isNode()) {
        try { requireFs().appendFileSync(path, data, 'utf8'); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
      }
      memory[path] = (memory[path] || '') + String(data);
      return Promise.resolve();
    },
    deleteFile(path) {
      if (bridge) return bridge.deleteFile(path);
      if (isNode()) {
        try { requireFs().rmSync(path, { force: true }); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
      }
      delete memory[path];
      return Promise.resolve();
    },
    exists(path) {
      if (bridge) return bridge.exists(path);
      if (isNode()) {
        try { return Promise.resolve(requireFs().existsSync(path)); } catch (e) { return Promise.resolve(false); }
      }
      return Promise.resolve(path in memory);
    },
    mkdir(path) {
      if (bridge) return bridge.mkdir(path);
      if (isNode()) {
        try { requireFs().mkdirSync(path, { recursive: true }); return Promise.resolve(); } catch (e) { return Promise.reject(e); }
      }
      return Promise.resolve();
    },
    listDir(path) {
      if (bridge) return bridge.listDir(path);
      if (isNode()) {
        try { return Promise.resolve(requireFs().readdirSync(path)); } catch (e) { return Promise.reject(e); }
      }
      return Promise.resolve(Object.keys(memory).filter((k) => k.indexOf(path) === 0));
    },
    systemInfo() {
      if (bridge && bridge.systemInfo) return bridge.systemInfo();
      return Promise.resolve(null);
    },
    http(request) {
      // request: { method, url, headers, body, onChunk(data), signal }
      if (bridge) {
        return new Promise((resolve) => {
          const token = 'h' + (++bridgeSeq);
          if (request.signal) {
            request.signal.addEventListener('abort', () => {
              try { bridge.abort(token); } catch (e) { /* preload gone */ }
            }, { once: true });
          }
          bridge.http({
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: request.body,
            token,
            onChunk: request.onChunk,
            onEnd: (result) => {
              if (request.onEnd) request.onEnd(result);
              resolve({ status: result ? result.status : 0 });
            },
          });
        });
      }
      if (isNode()) return nodeFetch(request);
      return browserFetch(request);
    },
  };

  function requireFs() {
    return G.__PRTS_FS__ || (G.__PRTS_FS__ = G._prtsRequire ? G._prtsRequire('node:fs') : null);
  }

  async function nodeFetch(request) {
    const res = await fetch(request.url, {
      method: request.method || 'GET',
      headers: request.headers || {},
      body: request.body,
      signal: request.signal,
    });
    if (request.onChunk) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        request.onChunk(dec.decode(value, { stream: true }));
      }
    } else {
      const text = await res.text();
      request.onChunk && request.onChunk(text);
    }
    request.onEnd && request.onEnd({ status: res.status });
    return { status: res.status, headers: {}, body: '' };
  }

  async function browserFetch(request) {
    const res = await fetch(request.url, {
      method: request.method || 'GET',
      headers: request.headers || {},
      body: request.body,
      signal: request.signal,
    });
    const text = await res.text();
    if (request.onChunk) request.onChunk(text);
    request.onEnd && request.onEnd({ status: res.status });
    return { status: res.status, headers: {}, body: text };
  }

  P.io = io;
})(typeof globalThis !== 'undefined' ? globalThis : this);
