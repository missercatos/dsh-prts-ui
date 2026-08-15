/**
 * PRTS API client: DeepSeek chat completions with streaming (SSE).
 * `thinking.budget_tokens` drives the reasoning strength preset. Works in the
 * renderer (through the Electron bridge) and in Node (built-in fetch).
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  function endpoint(baseUrl, model, budget) {
    const base = String(baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
    const body = {
      model,
      messages: [],
      stream: true,
    };
    if (model === 'deepseek-chat' && budget > 0) {
      body.thinking = { budget_tokens: budget };
    }
    return { url: base + '/chat/completions', body };
  }

  function sseSplit(buffer, onData) {
    // buffer: accumulated partial text; returns the remainder.
    let text = buffer;
    for (;;) {
      const nl = text.indexOf('\n');
      if (nl < 0) break;
      const line = text.slice(0, nl).replace(/\r$/, '');
      text = text.slice(nl + 1);
      if (line.indexOf('data:') !== 0) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { onData({ done: true }); continue; }
      try {
        onData({ json: JSON.parse(payload) });
      } catch (e) { /* partial frame */ }
    }
    return text;
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  /**
   * Stream one assistant turn.
   * @param opts { config, messages, budget, onDelta(text), onReasoning(text), onMeta(meta), signal }
   * @returns Promise<{ content, reasoning, usage, durationMs, status, ok, error }>
   */
  async function chat(opts) {
    const cfg = opts.config;
    const { url, body } = endpoint(cfg.api.baseUrl, cfg.api.model, opts.budget);
    body.messages = opts.messages;
    const started = Date.now();
    let content = '';
    let reasoning = '';
    let usage = null;
    let status = 0;
    let aborted = false;

    try {
      await P.io.http({
        method: 'POST',
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (cfg.api.apiKey || ''),
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: opts.signal,
        onChunk(chunk) {
          let pending = chunk;
          if (opts._pending) { pending = opts._pending + chunk; opts._pending = undefined; }
          opts._pending = sseSplit(pending, (ev) => {
            if (ev.done) return;
            const delta = ev.json && ev.json.choices && ev.json.choices[0];
            if (!delta) return;
            if (delta.delta) {
              if (delta.delta.reasoning_content) {
                reasoning += delta.delta.reasoning_content;
                opts.onReasoning && opts.onReasoning(delta.delta.reasoning_content);
              }
              if (delta.delta.content) {
                content += delta.delta.content;
                opts.onDelta && opts.onDelta(delta.delta.content);
              }
            }
            if (ev.json.usage) usage = ev.json.usage;
          });
        },
        onEnd(result) {
          status = result ? result.status : 0;
          if (result && result.aborted) aborted = true;
        },
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        return { ok: false, aborted: true, content, reasoning, usage, durationMs: Date.now() - started, status: 0 };
      }
      return { ok: false, error: e && e.message ? e.message : String(e), content, reasoning, usage, durationMs: Date.now() - started, status };
    }

    const ok = status >= 200 && status < 300 && !aborted;
    const meta = {
      model: cfg.api.model,
      strength: cfg.api.strength,
      budget: opts.budget,
      durationMs: Date.now() - started,
      usage,
      contentLength: content.length,
      reasoningLength: reasoning.length,
    };
    opts.onMeta && opts.onMeta(meta);
    return { ok, status, content, reasoning, usage, durationMs: meta.durationMs, aborted, error: ok ? undefined : (aborted ? undefined : httpError(status, content)) };
  }

  function httpError(status, body) {
    if (status === 401) return { code: 'auth' };
    if (status === 429) return { code: 'rate' };
    let msg = 'HTTP ' + status;
    try {
      const j = JSON.parse(body);
      if (j.error && j.error.message) msg = j.error.message;
    } catch (e) { /* body not json */ }
    return { code: 'http', message: msg };
  }

  /** Non-streaming ping used by "Test connection". */
  async function ping(cfg) {
    const started = Date.now();
    const { url, body } = endpoint(cfg.api.baseUrl, cfg.api.model, 0);
    body.messages = [{ role: 'user', content: 'ping' }];
    body.stream = false;
    body.max_tokens = 1;
    let status = 0;
    let text = '';
    try {
      await P.io.http({
        method: 'POST', url,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (cfg.api.apiKey || '') },
        body: JSON.stringify(body),
        onChunk(c) { text += c; },
        onEnd(r) { status = r ? r.status : 0; },
      });
    } catch (e) {
      return { ok: false, ms: Date.now() - started, message: e && e.message ? e.message : String(e) };
    }
    if (status >= 200 && status < 300) return { ok: true, ms: Date.now() - started };
    const err = httpError(status, text);
    return { ok: false, ms: Date.now() - started, message: err.message || err.code };
  }

  P.api = { chat, ping, formatDuration };
})(typeof globalThis !== 'undefined' ? globalThis : this);
