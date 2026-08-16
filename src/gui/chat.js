/**
 * PRTS conversation surface — renders dsh session events streamed over the
 * /api mux WebSocket. Events folded: user/message, assistant/message,
 * assistant/chunk (+ reasoning-delta / text-delta / tool-call-delta / usage /
 * finish), tool/call, tool/result, step/start, step/end, command/run and the
 * policy rows (permission/preset, sandbox/mode, approval/policy). History is
 * paged backwards over the tail window so a 20k-event session still opens in
 * one hop. No local persistence: the source of truth is the dsh session.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const C = P.chat = {
    messages: [], streaming: false, sessionId: null,
    attachments: [],   // [{ name, mediaType, data(base64) }]
    rawEvents: [],     // recent raw events (trajectory view)
    activeSteps: 0,
    onStatus: null,    // (text|null) callback for the status row
    onStreaming: null, // (streaming:boolean) callback
  };

  const $ = (id) => document.getElementById(id);
  const t = (key, params) => (P.app && P.app.t ? P.app.t(key, params) : key);

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

  // Minimal markdown: images (built-in — the model may return one), code
  // blocks, inline code, bold, links. Everything is HTML-escaped first.
  function mdToHtml(text) {
    let s = esc(text);
    const codeBlocks = [];
    s = s.replace(/```([\s\S]*?)```/g, (m, code) => { codeBlocks.push(code); return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000'; });
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="mdImg" src="$2" alt="$1">');
    s = s.replace(/(^|\n)(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?\S*)?)/gi, '$1<img class="mdImg" src="$2" alt="">');
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => '<pre>' + codeBlocks[Number(i)] + '</pre>');
    return s;
  }

  /* ---------- content blocks ---------- */
  function blockKind(block) {
    const ty = block && block.type;
    if (ty === 'thinking' || ty === 'reasoning') return 'reasoning';
    if (ty === 'text') return 'text';
    if (ty === 'image') return 'image';
    return 'other';
  }
  function imageSrcOf(block) {
    if (!block || block.type !== 'image') return null;
    if (block.data && typeof block.data === 'string') {
      return 'data:' + (block.mediaType || 'image/png') + ';base64,' + block.data;
    }
    if (block.attachment && block.attachment.attachmentId) {
      return { attachmentId: block.attachment.attachmentId, mediaType: block.attachment.mediaType || 'image/png' };
    }
    return null;
  }

  /** message -> { reasoning, text, images: [src|{attachmentId}] , usage, model } */
  function messageParts(msg) {
    const out = { reasoning: '', text: '', images: [], usage: null, model: null };
    if (!msg) return out;
    if (typeof msg.reasoning === 'string') out.reasoning = msg.reasoning;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      const k = blockKind(b);
      if (k === 'reasoning') out.reasoning += (b.text || b.content || '');
      else if (k === 'text') out.text += (b.text || '');
      else if (k === 'image') {
        const src = imageSrcOf(b);
        if (src) out.images.push(src);
      }
    }
    out.usage = msg.usage || null;
    out.model = msg.model || null;
    return out;
  }

  /* ---------- live streaming fold state ---------- */
  const live = {
    seq: -1,
    id: null,
    reasoning: '',
    text: '',
    usage: null,
    model: null,
    toolCalls: [],   // [{ callId, name, args }]
    turn: null,
    step: null,
    finished: false,
    msgRef: null,    // the assistant message object owned by C.messages
  };

  function resetLive() {
    live.seq = -1; live.id = null; live.reasoning = ''; live.text = '';
    live.usage = null; live.model = null; live.toolCalls = [];
    live.turn = null; live.step = null; live.finished = false;
    live.msgRef = null;
  }

  // Streaming bursts (assistant/chunk) arrive faster than frames — schedule
  // one render per animation frame, never more often than every 90 ms, so a
  // heavy turn re-renders the flow a handful of times instead of once per chunk.
  let renderScheduled = false;
  let lastRenderAt = 0;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const now = performance.now();
      if (now - lastRenderAt < 90) {
        setTimeout(scheduleRender, 90 - (now - lastRenderAt));
        return;
      }
      lastRenderAt = now;
      renderFlow();
    });
  }

  function upsertLive(msg) {
    // The live message is kept by reference — no per-chunk array scan.
    if (live.msgRef && C.messages.indexOf(live.msgRef) >= 0) {
      live.msgRef.content = msg.content;
      live.msgRef.reasoning = msg.reasoning;
      live.msgRef.usage = msg.usage || live.msgRef.usage;
      live.msgRef.model = msg.model || live.msgRef.model;
      live.msgRef.streaming = !live.finished;
      return;
    }
    C.messages.push(msg);
    live.msgRef = msg;
  }

  function snapshotLive() {
    const msg = {
      id: live.id || ('a' + live.seq),
      _seq: live.seq,
      _live: true,
      role: 'assistant',
      content: live.text,
      reasoning: live.reasoning,
      usage: live.usage,
      model: live.model,
      ts: Date.now(),
      streaming: !live.finished,
    };
    upsertLive(msg);
    return msg;
  }

  function foldChunk(ev) {
    const d = ev.data || {};
    const chunk = d.chunk || {};
    if (live.seq < 0) {
      live.seq = ev.seq;
      live.turn = d.turn;
      live.step = d.step;
      live.id = null;
    }
    switch (chunk.type) {
      case 'reasoning-delta':
        live.reasoning += chunk.text || '';
        break;
      case 'text-delta':
        live.text += chunk.text || '';
        break;
      case 'tool-call-delta': {
        // Aggregated per callId: { callId, name, args }
        const callId = chunk.id || chunk.callId || (chunk.toolCall && chunk.toolCall.id);
        let tc = live.toolCalls.find((x) => x.callId === callId);
        if (!tc) {
          tc = { callId, name: chunk.name || (chunk.toolCall && chunk.toolCall.name) || '', args: '' };
          live.toolCalls.push(tc);
        }
        if (!tc.name && (chunk.name || (chunk.toolCall && chunk.toolCall.name))) tc.name = chunk.name || chunk.toolCall.name;
        if (chunk.arguments || chunk.argumentsDelta || (chunk.toolCall && chunk.toolCall.arguments)) {
          tc.args += chunk.arguments || chunk.argumentsDelta || (chunk.toolCall && chunk.toolCall.arguments) || '';
        }
        break;
      }
      case 'usage':
        live.usage = chunk.usage || chunk;
        break;
      case 'finish':
        live.finished = true;
        break;
      default:
        break; // block-start / block-end / unknown
    }
    // The final assistant/message owns durable truth; the live message just
    // mirrors the stream until then.
    snapshotLive();
  }

  function finishStreaming() {
    if (!C.streaming) return;
    C.streaming = false;
    if (C.onStreaming) { try { C.onStreaming(false); } catch (e) { /* noop */ } }
  }

  /* ---------- event fold ---------- */
  function foldEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    const type = ev.type;
    const data = (ev && ev.data) || {};
    C.rawEvents.push(ev);
    if (C.rawEvents.length > 800) C.rawEvents.splice(0, C.rawEvents.length - 800);

    if (type === 'user/message') {
      const msg = data.message || data;
      const parts = messageParts(msg);
      const existing = C.messages.find((m) => m._seq === ev.seq || (msg.id && m.id === msg.id));
      if (existing) return;
      C.messages.push({
        id: (msg && msg.id) || ('u' + ev.seq), _seq: ev.seq, role: 'user',
        content: parts.text, images: parts.images, ts: ev.time,
      });
    } else if (type === 'assistant/message') {
      const msg = data.message || data;
      const parts = messageParts(msg);
      if (live.msgRef) { live.msgRef = null; }
      resetLive();
      const id = msg && msg.id;
      const existing = C.messages.find((m) => m._seq === ev.seq || (id && m.id === id));
      if (existing) {
        existing.content = parts.text;
        if (parts.reasoning) existing.reasoning = parts.reasoning;
        existing.images = parts.images;
        existing.usage = parts.usage || existing.usage;
        existing.model = parts.model || existing.model;
        existing.streaming = false;
        existing._live = false;
      } else {
        C.messages.push({
          id: id || ('a' + ev.seq), _seq: ev.seq, role: 'assistant',
          content: parts.text, reasoning: parts.reasoning, images: parts.images,
          ts: ev.time, usage: parts.usage, model: parts.model, streaming: false,
        });
      }
      if (P.cost && parts.usage) {
        P.cost.addUsage({ id: id || ('a' + ev.seq), _seq: ev.seq, usage: parts.usage, model: parts.model });
      }
      finishStreaming();
    } else if (type === 'assistant/chunk') {
      foldChunk(ev);
    } else if (type === 'tool/call') {
      const existing = C.messages.find((m) => m._seq === ev.seq);
      if (existing) return;
      C.messages.push({
        id: 't' + ev.seq, _seq: ev.seq, role: 'tool',
        content: '', name: data.name || data.tool || 'tool',
        callId: data.callId || null, args: data.arguments || '', ts: ev.time,
      });
    } else if (type === 'tool/result') {
      // Attach the result to its tool call (callId travels in source.callId).
      const msg = data.message || data;
      const src = msg && msg.source ? msg.source : null;
      const callId = (src && src.callId) || data.callId || null;
      let text = '';
      if (Array.isArray(msg && msg.content)) {
        text = msg.content.map((b) => {
          if (Array.isArray(b.content)) return b.content.map((bb) => bb.text || '').join('');
          return b.text || '';
        }).join('\n');
      } else {
        text = data.text || data.output || '';
      }
      let target = null;
      if (callId) target = C.messages.filter((m) => m.role === 'tool').reverse().find((m) => m.callId === callId);
      if (target) {
        target.content = text;
        target.resultSeq = ev.seq;
      } else {
        C.messages.push({ id: 'r' + ev.seq, _seq: ev.seq, role: 'tool', content: text, name: data.name || 'tool', callId, ts: ev.time });
      }
    } else if (type === 'step/start') {
      C.activeSteps += 1;
      if (C.onStatus) { try { C.onStatus(t('chat.step', { n: C.activeSteps })); } catch (e) { /* noop */ } }
    } else if (type === 'step/end') {
      C.activeSteps = Math.max(0, C.activeSteps - 1);
      if (C.activeSteps <= 0 && C.onStatus) { try { C.onStatus(null); } catch (e) { /* noop */ } }
    } else if (type === 'command/run') {
      C.messages.push({
        id: 'c' + ev.seq, _seq: ev.seq, role: 'system', ts: ev.time,
        content: '/' + (data.name || 'command') + (data.args ? ' ' + data.args : ''),
      });
    } else if (type === 'permission/preset') {
      C.messages.push({ id: 'p' + ev.seq, _seq: ev.seq, role: 'system', ts: ev.time, content: t('chat.permissionSet', { preset: data.preset }) });
    } else if (type === 'sandbox/mode') {
      C.messages.push({ id: 's' + ev.seq, _seq: ev.seq, role: 'system', ts: ev.time, content: t('chat.sandboxMode', { mode: data.mode }) });
    } else if (type === 'approval/policy') {
      C.messages.push({ id: 'ap' + ev.seq, _seq: ev.seq, role: 'system', ts: ev.time, content: t('chat.approvalPolicy', { policy: data.policy }) });
    }
  }

  /* ---------- rendering ---------- */
  function renderUser(msg) {
    const wrap = el('div', 'userRow');
    const bubble = el('div', 'userBubble');
    if (msg.content) bubble.innerHTML = mdToHtml(msg.content);
    for (const img of msg.images || []) bubble.appendChild(imageEl(img));
    wrap.appendChild(bubble);
    const tr = el('div', 'maRow timeStart');
    tr.appendChild(el('span', 'maTime', clock(msg.ts)));
    wrap.appendChild(tr);
    return wrap;
  }

  function imageEl(src) {
    const img = document.createElement('img');
    img.className = 'mdImg';
    img.alt = '';
    if (typeof src === 'string') {
      img.src = src;
    } else if (src && src.attachmentId && P.dshState && P.dshState.attachment && C.sessionId) {
      img.dataset.attachmentId = src.attachmentId;
      img.src = '';
      P.dshState.attachment(C.sessionId, src.attachmentId)
        .then((url) => { if (img.isConnected) img.src = url; })
        .catch(() => { /* attachment unreadable */ });
    }
    return img;
  }

  function renderAssistant(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    if (msg.reasoning) {
      const d = el('div', 'disclosure');
      const row = el('button', 'dRow');
      row.type = 'button';
      row.innerHTML = '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.2 2.7a.6.6 0 0 1 0 .9L6.7 6l-2.5 2.4a.6.6 0 1 0 .9.9l3-2.9a.6.6 0 0 0 0-.9l-3-2.9a.6.6 0 0 0-.9 0Z" fill="currentColor"/></svg>';
      row.appendChild(el('span', 'dTitle', t('chat.thinking')));
      const body = el('div', 'dBody');
      body.appendChild(el('div', 'thinkBody', msg.reasoning));
      row.addEventListener('click', () => d.classList.toggle('open'));
      d.appendChild(row); d.appendChild(body);
      item.appendChild(d);
    }
    if (msg.content) {
      const p = el('p', 'para');
      p.innerHTML = mdToHtml(msg.content);
      if (msg.streaming) p.appendChild(el('span', 'caret'));
      item.appendChild(p);
    }
    for (const img of msg.images || []) item.appendChild(imageEl(img));
    if (msg.usage && (msg.usage.prompt_tokens || msg.usage.completion_tokens)) {
      item.appendChild(el('div', 'statsLine', '· ' + t('chat.tokens', { in: msg.usage.prompt_tokens || 0, out: msg.usage.completion_tokens || 0 })));
    }
    return item;
  }

  function renderTool(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    const head = el('button', 'dRow');
    head.type = 'button';
    head.innerHTML = '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.2 2.7a.6.6 0 0 1 0 .9L6.7 6l-2.5 2.4a.6.6 0 1 0 .9.9l3-2.9a.6.6 0 0 0 0-.9l-3-2.9a.6.6 0 0 0-.9 0Z" fill="currentColor"/></svg>';
    head.appendChild(el('span', 'dTitle', '⟳ ' + msg.name));
    item.appendChild(head);
    if (msg.args) {
      const argsBody = el('div', 'dBody');
      argsBody.appendChild(el('div', 'thinkBody', String(msg.args).slice(0, 1200)));
      item.appendChild(argsBody);
      head.addEventListener('click', () => item.classList.toggle('openArgs'));
      item.classList.add('openArgs');
    }
    if (msg.content) {
      const d = el('div', 'disclosure open');
      const body = el('div', 'dBody');
      body.style.display = 'block';
      body.appendChild(el('div', 'thinkBody', String(msg.content).slice(0, 4000)));
      d.appendChild(body);
      item.appendChild(d);
    }
    return item;
  }

  function renderSystem(msg) {
    const row = el('div', 'sysLine');
    row.appendChild(el('span', 'sysDot'));
    row.appendChild(el('span', 'sysText', msg.content));
    return row;
  }

  function renderFlow() {
    const flow = $('flow');
    if (!flow) return;
    flow.textContent = '';
    for (const m of C.messages) {
      if (m.role === 'user') flow.appendChild(renderUser(m));
      else if (m.role === 'assistant') flow.appendChild(renderAssistant(m));
      else if (m.role === 'tool') flow.appendChild(renderTool(m));
      else if (m.role === 'system') flow.appendChild(renderSystem(m));
    }
    if (!C.messages.length) {
      flow.appendChild(el('div', 'emptyChat', t('chat.empty')));
    }
    scrollBottom();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { const s = $('chatScroll'); if (s) s.scrollTop = s.scrollHeight; });
  }

  /* ---------- trajectory ---------- */
  function renderTraj() {
    const box = $('trajView');
    if (!box) return;
    box.textContent = '';
    if (!C.rawEvents.length) {
      box.appendChild(el('div', 'trajEmpty', t('traj.empty')));
      return;
    }
    C.rawEvents.slice(-300).forEach((ev, i) => {
      const row = el('div', 'trajItem');
      row.appendChild(el('span', 'idx', String(ev.seq !== undefined ? ev.seq : i)));
      const body = el('div', 'trajBody');
      body.appendChild(el('div', 'trajType', String(ev.type)));
      const brief = ev.type === 'assistant/chunk'
        ? ((ev.data && ev.data.chunk && ev.data.chunk.type) || 'chunk')
        : summaryOf(ev);
      if (brief) body.appendChild(el('div', 'trajBrief', brief));
      row.appendChild(body);
      box.appendChild(row);
    });
  }
  function summaryOf(ev) {
    const d = ev.data || {};
    if (ev.type === 'tool/call') return d.name + (d.arguments ? ' ' + String(d.arguments).slice(0, 160) : '');
    if (ev.type === 'tool/result') return String((d.text || d.output || '')).slice(0, 160);
    if (ev.type === 'user/message' || ev.type === 'assistant/message') {
      const m = d.message || d;
      const parts = messageParts(m);
      return String(parts.text || parts.reasoning || '').slice(0, 160);
    }
    if (ev.type === 'command/run') return '/' + d.name + (d.args ? ' ' + d.args : '');
    return '';
  }

  /* ---------- history (paged backwards over the tail) ---------- */
  async function loadHistory(sessionId) {
    C.sessionId = sessionId;
    C.messages = [];
    C.rawEvents = [];
    C.streaming = false;
    resetLive();
    if (P.cost) P.cost.reset();
    const MAX_PAGES = 14, MAX_EVENTS = 6000, MAX_ANCHORS = 100;
    const pages = [];
    let beforeSeq;
    let anchors = 0;
    let total = 0;
    for (let i = 0; i < MAX_PAGES; i++) {
      let page;
      try {
        page = await P.dshState.history(sessionId, { beforeSeq, maxMessages: 200 });
      } catch (e) {
        break;
      }
      const evs = page.events || [];
      if (!evs.length) break;
      pages.unshift(evs);
      total += evs.length;
      anchors += evs.filter((e) => {
        const ty = e.event && e.event.type;
        return ty === 'user/message' || ty === 'assistant/message';
      }).length;
      if (!page.hasMore) break;
      const minSeq = evs.reduce((m, e) => Math.min(m, e.event ? e.event.seq : m), Infinity);
      if (!isFinite(minSeq) || minSeq <= 0) break;
      beforeSeq = minSeq - 1;
      if (anchors >= MAX_ANCHORS || total >= MAX_EVENTS) break;
    }
    for (const evs of pages) {
      for (const it of evs) foldEvent(it.event || it);
    }
    // The tail may end mid-step — a folded history must never leave the
    // "working" status row stuck on.
    C.activeSteps = 0;
    if (C.onStatus) { try { C.onStatus(null); } catch (e) { /* noop */ } }
    // If the tail was mid-stream, keep the composer in the streaming state.
    renderFlow();
  }

  /* ---------- attachments ---------- */
  function attachFiles(fileList) {
    const files = Array.from(fileList || []);
    const MEDIA = { 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'image/gif': 1 };
    for (const f of files) {
      if (!MEDIA[f.type] || !f.type) { P.app.toast(t('composer.attachBad')); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const comma = dataUrl.indexOf(',');
        C.attachments.push({ name: f.name, mediaType: f.type || 'image/png', data: comma >= 0 ? dataUrl.slice(comma + 1) : '' });
        renderAttachments();
      };
      reader.readAsDataURL(f);
    }
  }
  function removeAttachment(i) {
    C.attachments.splice(i, 1);
    renderAttachments();
  }
  function renderAttachments() {
    const strip = $('attachStrip');
    if (!strip) return;
    strip.textContent = '';
    if (!C.attachments.length) { strip.hidden = true; return; }
    strip.hidden = false;
    C.attachments.forEach((a, i) => {
      const chip = el('div', 'attachChip');
      const thumb = document.createElement('img');
      thumb.className = 'attachThumb';
      thumb.src = 'data:' + a.mediaType + ';base64,' + a.data;
      chip.appendChild(thumb);
      chip.appendChild(el('span', 'attachName', a.name));
      const x = el('button', 'attachX', '×');
      x.type = 'button';
      x.title = t('common.delete');
      x.addEventListener('click', () => removeAttachment(i));
      chip.appendChild(x);
      strip.appendChild(chip);
    });
  }
  function attachmentBlocks() {
    return C.attachments.map((a) => ({ type: 'image', mediaType: a.mediaType, data: a.data, name: a.name }));
  }

  /* ---------- actions ---------- */
  async function send(text) {
    if (C.streaming) return;
    if (!C.sessionId) {
      // No session yet — create one on the fly (it lands in the sidebar).
      const id = await P.app.ensureSession();
      if (!id) {
        P.app.toast(t('session.createFail'));
        return;
      }
    }
    const input = $('composerInput');
    if (input) input.value = '';
    const content = attachmentBlocks();
    content.push({ type: 'text', text });
    C.attachments = [];
    renderAttachments();
    C.streaming = true;
    swapSendStop(true);
    if (C.onStreaming) { try { C.onStreaming(true); } catch (e) { /* noop */ } }
    try {
      await P.dshState.prompt(C.sessionId, content);
      // The mux delivers the events; the prompt only needs to be accepted.
    } catch (e) {
      C.streaming = false;
      swapSendStop(false);
      if (C.onStreaming) { try { C.onStreaming(false); } catch (e) { /* noop */ } }
      P.app.toast(t('chat.error.http', { msg: e.message }));
    }
  }

  function stop() {
    if (C.sessionId) P.dshState.cancel(C.sessionId);
    C.streaming = false;
    swapSendStop(false);
    if (C.onStreaming) { try { C.onStreaming(false); } catch (e) { /* noop */ } }
  }

  function swapSendStop(streaming) {
    const send = $('sendBtn');
    if (!send) return;
    if (streaming && send.dataset.state !== 'stop') {
      send.dataset.state = 'stop';
      send.disabled = false;
      send.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="currentColor"/></svg>';
      send.title = t('composer.stop');
      send.classList.add('stopBtn');
    } else if (!streaming && send.dataset.state === 'stop') {
      delete send.dataset.state;
      send.innerHTML = P.icons['send'] || '';
      send.title = t('composer.send');
      send.classList.remove('stopBtn');
      updateSend();
    }
  }

  function updateSend() {
    const input = $('composerInput');
    const send = $('sendBtn');
    if (!input || !send) return;
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
    if (!area || !btn) return;
    const expanded = area.classList.toggle('expanded');
    btn.setAttribute('aria-expanded', String(expanded));
    btn.title = t(expanded ? 'composer.collapse' : 'composer.expand');
    scrollInputBottom();
  }

  /* ---------- mux subscription ---------- */
  let lastHistoryLoad = 0;
  function maybeReloadHistory(force) {
    if (!C.sessionId) return;
    const now = Date.now();
    if (!force && now - lastHistoryLoad < 30000) return;   // reconnect storms stay cheap
    lastHistoryLoad = now;
    loadHistory(C.sessionId).catch(() => { /* noop */ });
  }
  function bindEvents() {
    P.dsh.on('session/event', (frame) => {
      const ev = frame.payload && frame.payload.event ? frame.payload.event : frame.payload;
      if (!ev || ev.sessionId !== C.sessionId) {
        if (frame.sessionId !== undefined && frame.sessionId !== C.sessionId) return;
        if (frame.payload && frame.payload.sessionId && frame.payload.sessionId !== C.sessionId) return;
        if (!ev || !ev.type) return;
      }
      foldEvent(ev);
      scheduleRender();
    });
    P.dsh.on('session/subscribed', (frame) => {
      // Fresh mux generation: our in-memory fold may be behind — refresh the
      // open session's history silently (throttled against reconnect storms).
      const sid = (frame.payload && frame.payload.sessionId) || frame.sessionId;
      if (sid === C.sessionId) maybeReloadHistory(false);
    });
    P.dsh.on('disconnect', () => {
      C.streaming = false;
      swapSendStop(false);
      if (C.onStreaming) { try { C.onStreaming(false); } catch (e) { /* noop */ } }
    });
    P.dsh.on('connect', () => {
      maybeReloadHistory(true);
    });
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
    const fileInput = $('fileInput');
    const attachBtn = $('attachBtn');
    if (attachBtn && fileInput) {
      attachBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        attachFiles(fileInput.files);
        fileInput.value = '';
      });
    }
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
  C.renderTraj = renderTraj;
  C.loadHistory = loadHistory;
  C.attachFiles = attachFiles;
  C.updateSend = updateSend;
  C.scrollInputBottom = scrollInputBottom;
  C.toggleExpand = toggleExpand;
  C.init = init;
  C.fmtDate = fmtDate;
  C.clock = clock;
  C.esc = esc;
  C.el = el;
})(typeof globalThis !== 'undefined' ? globalThis : this);
