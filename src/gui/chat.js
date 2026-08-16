/**
 * PRTS conversation surface — renders dsh session events (user/message,
 * assistant/message, tool/result) streamed over the /api mux WebSocket.
 * No local persistence: the source of truth is the dsh session.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const C = P.chat = { messages: [], streaming: false, sessionId: null };

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

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function blockText(block) {
    if (!block) return '';
    if (block.type === 'text') return block.text || '';
    return '';
  }
  function blockReasoning(block) {
    if (!block) return '';
    if (block.type === 'thinking' || block.type === 'reasoning') return block.text || block.content || '';
    return '';
  }

  function messageText(msg) {
    const content = msg && msg.content;
    if (Array.isArray(content)) return content.map(blockText).join('');
    if (typeof content === 'string') return content;
    return '';
  }
  function messageReasoning(msg) {
    if (!msg) return '';
    if (typeof msg.reasoning === 'string') return msg.reasoning;
    if (Array.isArray(msg.content)) return msg.content.map(blockReasoning).filter(Boolean).join('\n');
    return '';
  }

  /* ---------- event fold ---------- */
  function foldEvent(ev) {
    const type = ev && ev.type;
    const data = (ev && ev.data) || {};
    if (type === 'user/message') {
      const msg = data.message || data;
      C.messages.push({
        id: msg.id || ('u' + ev.seq), _seq: ev.seq, role: 'user',
        content: messageText(msg), ts: ev.time,
      });
    } else if (type === 'assistant/message') {
      const msg = data.message || data;
      const text = messageText(msg);
      const reasoning = messageReasoning(msg) || messageReasoning(data);
      const existing = C.messages.find((m) => m._seq === ev.seq || m.id === msg.id);
      if (existing) {
        existing.content = text;
        if (reasoning) existing.reasoning = reasoning;
        existing.usage = msg.usage || existing.usage;
        existing.model = msg.model || existing.model;
        existing.streaming = false;
      } else {
        C.messages.push({
          id: msg.id || ('a' + ev.seq), _seq: ev.seq, role: 'assistant',
          content: text, reasoning, ts: ev.time, usage: msg.usage, model: msg.model,
        });
      }
    } else if (type === 'tool/result') {
      const name = data.name || data.tool || 'tool';
      C.messages.push({ id: 't' + ev.seq, _seq: ev.seq, role: 'tool', content: (data.text || data.output || ''), name, ts: ev.time });
    }
  }

  /* ---------- rendering ---------- */
  function renderUser(msg) {
    const wrap = el('div', 'userRow');
    const bubble = el('div', 'userBubble', msg.content);
    wrap.appendChild(bubble);
    const t = el('span', 'maTime', clock(msg.ts));
    wrap.appendChild(t);
    return wrap;
  }

  function renderAssistant(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    if (msg.reasoning) {
      const d = el('div', 'disclosure');
      const row = el('button', 'dRow');
      row.innerHTML = '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.2 2.7a.6.6 0 0 1 0 .9L6.7 6l-2.5 2.4a.6.6 0 1 0 .9.9l3-2.9a.6.6 0 0 0 0-.9l-3-2.9a.6.6 0 0 0-.9 0Z" fill="currentColor"/></svg>';
      row.appendChild(el('span', 'dTitle', P.i18n.t('chat.thinking', P.app.locale)));
      const body = el('div', 'dBody');
      body.appendChild(el('div', 'thinkBody', msg.reasoning));
      row.addEventListener('click', () => d.classList.toggle('open'));
      d.appendChild(row); d.appendChild(body);
      item.appendChild(d);
    }
    const p = el('p', 'para', msg.content);
    if (msg.streaming) p.appendChild(el('span', 'caret'));
    item.appendChild(p);
    if (msg.usage && (msg.usage.prompt_tokens || msg.usage.completion_tokens)) {
      item.appendChild(el('div', 'statsLine', '· ' + P.i18n.t('chat.tokens', P.app.locale, { in: msg.usage.prompt_tokens || 0, out: msg.usage.completion_tokens || 0 })));
    }
    return item;
  }

  function renderTool(msg) {
    const item = el('div', 'assistantItem');
    const p = el('p', 'para', '⟳ ' + msg.name);
    item.appendChild(p);
    if (msg.content) item.appendChild(el('div', 'thinkBody', msg.content));
    return item;
  }

  function renderFlow() {
    const flow = $('flow');
    flow.textContent = '';
    for (const m of C.messages) {
      if (m.role === 'user') flow.appendChild(renderUser(m));
      else if (m.role === 'assistant') flow.appendChild(renderAssistant(m));
      else if (m.role === 'tool') flow.appendChild(renderTool(m));
    }
    if (!C.messages.length) {
      flow.appendChild(el('div', 'emptyChat', P.i18n.t('chat.empty', P.app.locale)));
    }
    scrollBottom();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { const s = $('chatScroll'); s.scrollTop = s.scrollHeight; });
  }

  /* ---------- actions ---------- */
  async function loadHistory(sessionId) {
    C.sessionId = sessionId;
    C.messages = [];
    const items = await P.dshState.history(sessionId);
    for (const it of items) {
      if (it && it.event) foldEvent(it.event);
      else if (it && it.type) foldEvent(it);
    }
    renderFlow();
  }

  async function send(text) {
    if (C.streaming || !C.sessionId) return;
    const input = $('composerInput');
    input.value = '';
    C.streaming = true;
    swapSendStop(true);
    // Optimistic user bubble; the real event will reconcile on the mux.
    try {
      await P.dshState.prompt(C.sessionId, text);
    } catch (e) {
      C.streaming = false;
      swapSendStop(false);
      P.app.toast(P.i18n.t('chat.error.http', P.app.locale, { msg: e.message }));
    }
  }

  function stop() {
    if (C.sessionId) P.dshState.cancel(C.sessionId);
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
    }
  }

  function updateSend() {
    const input = $('composerInput');
    const send = $('sendBtn');
    if (send.dataset.state === 'stop') return;
    send.disabled = !input.value.trim() || C.streaming;
  }
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

  /* ---------- mux subscription ---------- */
  function bindEvents() {
    P.dsh.on('session/event', (frame) => {
      const ev = frame.payload && frame.payload.event ? frame.payload.event : frame.payload;
      if (!ev || ev.sessionId !== C.sessionId) {
        // sessionId on the frame itself
        if (frame.sessionId !== undefined && frame.sessionId !== C.sessionId) return;
        if (frame.payload && frame.payload.sessionId && frame.payload.sessionId !== C.sessionId) return;
      }
      foldEvent(ev);
      // Detect turn completion: an assistant/message that is not streaming.
      if (ev && ev.type === 'assistant/message' && C.streaming) {
        C.streaming = false;
        swapSendStop(false);
      }
      renderFlow();
    });
    P.dsh.on('session/subscribed', () => {});
    P.dsh.on('disconnect', () => { C.streaming = false; swapSendStop(false); });
  }

  function init() {
    const input = $('composerInput');
    input.addEventListener('input', () => { updateSend(); scrollInputBottom(); onComposeChange(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        // If a command completion is open and the input starts with '/',
        // Tab/Enter completes the command name first.
        if (input.value.indexOf('/') === 0 && cmdCompletion) {
          e.preventDefault();
          completeCommand();
          return;
        }
        e.preventDefault();
        const v = input.value.trim();
        if (v) send(v);
      } else if (e.key === 'Tab' && cmdCompletion) {
        e.preventDefault();
        completeCommand();
      }
    });
    $('composerExpand').addEventListener('click', toggleExpand);
    $('sendBtn').addEventListener('click', () => {
      if ($('sendBtn').dataset.state === 'stop') stop();
      else { const v = input.value.trim(); if (v) send(v); }
    });
    bindEvents();
  }

  /* ---------- slash-command auto-detection ---------- */
  let cmdCompletion = null;   // [{name, description}]
  let composeToken = 0;
  function onComposeChange() {
    const token = ++composeToken;
    const input = $('composerInput');
    const v = input.value;
    // Only when the very first char is '/', with no space yet.
    if (v.length > 1 && v[0] === '/' && v.indexOf(' ') === -1) {
      const partial = v.slice(1).toLowerCase();
      if (!P.dshState.currentSessionId) return;
      P.dshState.commandsList(P.dshState.currentSessionId).then((cmds) => {
        if (token !== composeToken) return;   // stale keystroke
        const matches = cmds.filter((c) => c.name.toLowerCase().indexOf(partial) === 0);
        if (matches.length) {
          cmdCompletion = matches;
          showCompletion(matches);
        } else { cmdCompletion = null; hideCompletion(); }
      }).catch(() => { if (token === composeToken) { cmdCompletion = null; hideCompletion(); } });
    } else {
      cmdCompletion = null;
      hideCompletion();
    }
  }
  function showCompletion(matches) {
    let pop = $('cmdCompletionPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'cmdCompletionPop';
      pop.className = 'pop cmdCompletion';
      $('composerArea').appendChild(pop);
    }
    pop.innerHTML = matches.slice(0, 6).map((c) => '<div class="popItem" data-name="' + c.name + '"><span class="label">/' + c.name + '</span></div>').join('');
    pop.style.display = 'block';
    pop.style.bottom = '';
    const composer = $('composerCard');
    const r = composer.getBoundingClientRect();
    pop.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    pop.style.left = '0';
    pop.style.right = '0';
    pop.style.maxWidth = '420px';
  }
  function hideCompletion() {
    const pop = $('cmdCompletionPop');
    if (pop) { pop.classList.remove('open'); pop.style.display = 'none'; }
  }
  function completeCommand() {
    const input = $('composerInput');
    if (!cmdCompletion || !cmdCompletion.length) return;
    const first = cmdCompletion[0];
    input.value = '/' + first.name + ' ';
    cmdCompletion = null;
    hideCompletion();
    input.focus();
    updateSend();
    scrollInputBottom();
  }

  C.send = send;
  C.stop = stop;
  C.renderFlow = renderFlow;
  C.loadHistory = loadHistory;
  C.updateSend = updateSend;
  C.scrollInputBottom = scrollInputBottom;
  C.toggleExpand = toggleExpand;
  C.init = init;
  C.fmtDate = fmtDate;
  C.clock = clock;
  C.esc = esc;
  C.el = el;
})(typeof globalThis !== 'undefined' ? globalThis : this);
