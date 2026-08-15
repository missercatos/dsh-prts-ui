/**
 * PRTS chat surface: message store, rendering, streaming turns, message
 * actions, details panel, context meter. Pure DOM — works in the webview
 * (Electron bridge or dev browser) and is driven by the same core as the TUI.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const C = P.chat = { messages: [], bounds: [], streaming: false };

  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function clock(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------- persistence ---------- */
  async function projectId() {
    const cfg = await P.store.loadConfig();
    return cfg.project;
  }
  async function loadHistory() {
    const id = await projectId();
    const entries = await P.store.readHistory(id);
    C.messages = []; C.bounds = [];
    for (const e of entries) {
      if (e.k === 'b') C.bounds.push(e.ts);
      else if (e.k === 'm') C.messages.push(e);
    }
  }
  async function saveMsg(m) {
    const id = await projectId();
    await P.store.appendHistory(id, m);
    await P.store.touchProject(id);
  }
  async function saveBound(ts) {
    const id = await projectId();
    await P.store.appendHistory(id, { k: 'b', ts });
    C.bounds.push(ts);
  }

  /* ---------- rendering ---------- */
  function icon(name, w, h) { return P.icons[name] ? P.icons[name] : ''; }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function metaRow(msg, user) {
    const row = el('div', 'maRow' + (user ? ' timeStart' : ''));
    const t = el('span', 'maTime', clock(msg.ts));
    const actions = el('span', 'maActions');
    if (user) {
      actions.appendChild(actionBtn('copy', msg));
    } else {
      actions.appendChild(actionBtn('copy', msg));
      actions.appendChild(actionBtn('like', msg));
      actions.appendChild(actionBtn('dislike', msg));
      actions.appendChild(actionBtn('branch', msg));
    }
    row.appendChild(t); row.appendChild(actions);
    return row;
  }

  function actionBtn(kind, msg) {
    const b = el('button', 'maBtn');
    b.type = 'button';
    b.dataset.action = kind;
    b.dataset.id = msg.id;
    b.title = P.i18n.t('chat.' + kind, P.app.locale);
    b.setAttribute('aria-label', b.title);
    b.innerHTML = P.icons['ma.' + kind] || '';
    if (kind === 'like') b.innerHTML = P.icons['ma.like'] || '';
    if (kind === 'dislike') b.innerHTML = P.icons['ma.dislike'] || '';
    return b;
  }

  function disclosureRow(title, bodyText, open) {
    const d = el('div', 'disclosure' + (open ? ' open' : ''));
    const row = el('button', 'dRow');
    row.innerHTML = '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.2 2.7a.6.6 0 0 1 0 .9L6.7 6l-2.5 2.4a.6.6 0 1 0 .9.9l3-2.9a.6.6 0 0 0 0-.9l-3-2.9a.6.6 0 0 0-.9 0Z" fill="currentColor"/></svg>';
    const t = el('span', 'dTitle', title);
    row.appendChild(t);
    const body = el('div', 'dBody');
    body.appendChild(el('div', 'thinkBody', bodyText));
    row.addEventListener('click', () => d.classList.toggle('open'));
    d.appendChild(row); d.appendChild(body);
    return d;
  }

  function statsLine(msg) {
    const s = el('div', 'statsLine');
    const parts = [];
    if (msg.durationMs) parts.push('ELAPSED ' + P.api.formatDuration(msg.durationMs));
    if (msg.durationMs) parts.push(P.i18n.t('chat.ranFor', P.app.locale, { d: P.api.formatDuration(msg.durationMs) }));
    if (msg.usage && (msg.usage.prompt_tokens || msg.usage.completion_tokens)) {
      parts.push(P.i18n.t('chat.tokens', P.app.locale, { in: msg.usage.prompt_tokens || 0, out: msg.usage.completion_tokens || 0 }));
    }
    if (msg.usage && msg.usage.completion_tokens_details && msg.usage.completion_tokens_details.reasoning_tokens) {
      parts.push(P.i18n.t('chat.reasoningTokens', P.app.locale, { n: msg.usage.completion_tokens_details.reasoning_tokens }));
    }
    if (parts.length) s.textContent = '· ' + parts.join(' · ');
    return s;
  }

  function renderUser(msg) {
    const wrap = el('div', 'userRow');
    const bubble = el('div', 'userBubble', msg.content);
    wrap.appendChild(bubble);
    wrap.appendChild(metaRow(msg, true));
    return wrap;
  }

  function renderAssistant(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    if (msg.reasoning) {
      item.appendChild(disclosureRow(P.i18n.t('chat.thinking', P.app.locale), msg.reasoning, false));
    }
    const p = el('p', 'para', msg.content);
    if (msg.streaming) {
      const caret = el('span', 'caret');
      p.appendChild(caret);
    }
    item.appendChild(p);
    if (!msg.streaming) {
      item.appendChild(metaRow(msg, false));
      if (msg.durationMs || (msg.usage && msg.usage.completion_tokens)) item.appendChild(statsLine(msg));
    }
    if (msg.error) {
      const e = el('div', 'errorRow');
      e.textContent = msg.error;
      item.appendChild(e);
    }
    return item;
  }

  function renderDivider(ts) {
    const d = el('div', 'sessionDivider');
    d.appendChild(el('span', 'dt', fmtDate(ts)));
    return d;
  }

  function renderFlow() {
    const flow = $('flow');
    flow.textContent = '';
    let bi = 0;
    const nextBound = () => (bi < C.bounds.length ? C.bounds[bi] : Infinity);
    for (const m of C.messages) {
      while (nextBound() < m.ts) { flow.appendChild(renderDivider(C.bounds[bi])); bi++; }
      if (m.role === 'user') flow.appendChild(renderUser(m));
      else flow.appendChild(renderAssistant(m));
    }
    while (bi < C.bounds.length) { flow.appendChild(renderDivider(C.bounds[bi])); bi++; }
    if (!C.messages.length && !P.app.heroVisible) {
      flow.appendChild(el('div', 'emptyChat', P.i18n.t('chat.empty', P.app.locale)));
    }
    scrollBottom();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { const s = $('chatScroll'); s.scrollTop = s.scrollHeight; });
  }

  /* ---------- streaming ---------- */
  let abortCtrl = null;
  let dirty = false;

  async function send() {
    if (C.streaming) return;
    const input = $('composerInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    scrollInputBottom();
    updateSend();

    const cfg = await P.store.loadConfig();
    if (!cfg.api.apiKey) {
      P.app.toast(P.i18n.t('chat.error.noKey', P.app.locale));
      P.app.openSettings();
      return;
    }
    P.app.enterChat();

    const userMsg = { id: 'u' + Date.now(), k: 'm', role: 'user', content: text, ts: Date.now() };
    C.messages.push(userMsg);
    await saveMsg(userMsg);

    const asstMsg = { id: 'a' + Date.now(), k: 'm', role: 'assistant', content: '', reasoning: '', ts: Date.now(), streaming: true, model: cfg.api.model, strength: cfg.api.strength };
    C.messages.push(asstMsg);
    renderFlow();
    startTurn(asstMsg, cfg);
  }

  function startTurn(asstMsg, cfg) {
    C.streaming = true;
    abortCtrl = new AbortController();
    $('statusRow').hidden = false;
    swapSendStop(true);
    // Mode presets (standard / ptc / minimal / creative) may override model,
    // thinking strength, temperature and a token cap.
    const eff = P.store.resolveMode(cfg.mode, cfg.api);
    const budget = P.store.STRENGTH_BUDGET[eff.strength] || 0;
    asstMsg.model = eff.model;
    asstMsg.strength = eff.strength;
    const history = C.messages
      .filter((m) => m !== asstMsg && !m.streaming && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.content }));
    const flush = () => { if (dirty) { dirty = false; renderFlow(); } };

    const run = (b) => P.api.chat({
      config: cfg,
      messages: history,
      budget: b,
      temperature: eff.temperature,
      maxTokens: eff.maxTokens,
      signal: abortCtrl.signal,
      onDelta(t) { asstMsg.content += t; dirty = true; requestAnimationFrame(flush); },
      onReasoning(t) { asstMsg.reasoning += t; dirty = true; requestAnimationFrame(flush); },
    });

    run(budget).then(async (res) => {
      // Some endpoints reject the thinking budget; retry plainly once.
      if (!res.ok && !res.aborted && res.error && res.error.message && /thinking/i.test(res.error.message) && budget > 0) {
        res = await run(0);
      }
      asstMsg.content = res.content;
      asstMsg.reasoning = res.reasoning;
      asstMsg.streaming = false;
      if (res.aborted) {
        asstMsg.content = asstMsg.content || '(interrupted)';
      } else if (!res.ok) {
        asstMsg.error = P.i18n.t('chat.error.' + (res.error && res.error.code || 'http'), P.app.locale, { msg: res.error && res.error.message || '' });
      }
      if (res.usage) asstMsg.usage = res.usage;
      asstMsg.durationMs = res.durationMs;
      flush();
      await saveMsg(asstMsg);
      finishTurn();
    });
  }

  function finishTurn() {
    C.streaming = false;
    abortCtrl = null;
    $('statusRow').hidden = true;
    swapSendStop(false);
    P.app.updateSidebar();
  }

  function stop() {
    if (abortCtrl) abortCtrl.abort();
  }

  function swapSendStop(streaming) {
    const send = $('sendBtn');
    if (streaming && send.dataset.state !== 'stop') {
      send.dataset.state = 'stop';
      send.disabled = false;
      send.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="currentColor"/></svg>';
      send.title = P.i18n.t('composer.stop', P.app.locale);
    } else if (!streaming && send.dataset.state === 'stop') {
      delete send.dataset.state;
      send.innerHTML = P.icons['send'] || '';
      send.title = P.i18n.t('composer.send', P.app.locale);
      updateSend();
    }
  }

  /* ---------- message actions ---------- */
  function copyText(text) {
    const done = () => P.app.toast(P.i18n.t('chat.copied', P.app.locale));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) && done());
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  async function branch() {
    await saveBound(Date.now());
    renderFlow();
    P.app.updateSidebar();
  }

  async function clearHistory() {
    const id = await projectId();
    await P.store.clearHistory(id);
    C.messages = [];
    C.bounds = [];
    renderFlow();
    P.app.updateSidebar();
    P.app.toast(P.i18n.t('chat.cleared', P.app.locale));
  }

  async function handleFlowClick(e) {
    const btn = e.target.closest('.maBtn');
    if (btn) {
      const msg = C.messages.find((m) => m.id === btn.dataset.id);
      if (!msg) return;
      const kind = btn.dataset.action;
      if (kind === 'copy') { copyText(msg.content || ''); return; }
      if (kind === 'like') { btn.classList.toggle('on'); return; }
      if (kind === 'dislike') { btn.classList.toggle('on'); return; }
      if (kind === 'branch') { await branch(); return; }
    }
    const item = e.target.closest('.assistantItem') || e.target.closest('.userBubble');
    if (item) {
      const id = item.closest('.assistantItem') ? item.closest('.assistantItem').dataset.msg : null;
      const msg = id ? C.messages.find((m) => m.id === id) : C.messages.filter((m) => m.role === 'user').pop();
      if (msg) P.app.showDetails(msg);
    }
  }

  /* ---------- context meter ---------- */
  function updateMeter() {
    const cfg = P.app.config || {};
    const budget = cfg.api && cfg.api.model === 'deepseek-reasoner' ? 65536 : 131072;
    const chars = C.messages.reduce((n, m) => n + (m.content || '').length + (m.reasoning || '').length, 0);
    const pct = Math.min(100, Math.round(chars / 4 / budget * 100));
    const ring = $('meterRing');
    ring.style.strokeDashoffset = String(34.56 * (1 - pct / 100));
    $('meterLabel').textContent = pct + '%';
  }

  /* ---------- composer ---------- */
  function updateSend() {
    const input = $('composerInput');
    const send = $('sendBtn');
    if (send.dataset.state === 'stop') return;
    send.disabled = !input.value.trim() || C.streaming;
  }

  // Keep the current line pinned to the bottom of the fixed-height input so
  // overflow scrolls above it.
  function scrollInputBottom() {
    const input = $('composerInput');
    if (input) input.scrollTop = input.scrollHeight;
  }

  function toggleExpand() {
    const area = $('composerArea');
    const btn = $('composerExpand');
    const expanded = area.classList.toggle('expanded');
    btn.setAttribute('aria-expanded', String(expanded));
    btn.title = P.i18n.t(expanded ? 'composer.collapse' : 'composer.expand', P.app.locale);
    scrollInputBottom();
  }

  /* ---------- init ---------- */
  function init() {
    $('composerInput').addEventListener('input', () => { updateSend(); scrollInputBottom(); });
    $('composerInput').addEventListener('keydown', (e) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    $('composerExpand').addEventListener('click', toggleExpand);
    $('sendBtn').addEventListener('click', () => {
      if ($('sendBtn').dataset.state === 'stop') stop();
      else send();
    });
    $('flow').addEventListener('click', handleFlowClick);
    $('newSessionBtn').addEventListener('click', async () => {
      if (C.streaming) stop();
      await saveBound(Date.now());
      C.bounds.push(C.bounds.pop());
      renderFlow();
      P.app.updateSidebar();
    });
    $('logBtn').addEventListener('click', async () => {
      const id = await projectId();
      const raw = await P.store.readHistory(id);
      const blob = new Blob([raw.map((e) => JSON.stringify(e)).join('\n') + '\n'], { type: 'application/jsonl' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'prts-' + id + '-' + Date.now() + '.jsonl';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  C.send = send;
  C.stop = stop;
  C.renderFlow = renderFlow;
  C.loadHistory = loadHistory;
  C.updateMeter = updateMeter;
  C.updateSend = updateSend;
  C.scrollInputBottom = scrollInputBottom;
  C.toggleExpand = toggleExpand;
  C.clearHistory = clearHistory;
  C.init = init;
  C.fmtDate = fmtDate;
  C.clock = clock;
  C.esc = esc;
  C.el = el;
  C.renderDivider = renderDivider;
  C.disclosureRow = disclosureRow;
})(typeof globalThis !== 'undefined' ? globalThis : this);
