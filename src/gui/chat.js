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
        const prevUser = [...C.messages].reverse().find((m) => m.role === 'user');
        const durMs = prevUser && ev.time ? Math.max(0, ev.time - prevUser.ts) : null;
        C.messages.push({
          id: id || ('a' + ev.seq), _seq: ev.seq, role: 'assistant',
          content: parts.text, reasoning: parts.reasoning, images: parts.images,
          ts: ev.time, usage: parts.usage, model: parts.model, streaming: false,
          durMs,
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

  /* ---------- message actions (dsh-web parity, PRTS marks) ---------- */

  const TL_COLORS = {
    'user/message': '#9C9CA1',
    'assistant/message': '#9ece6a',
    'assistant/chunk': '#7aa2f7',
    'tool/call': '#e0af68',
    'tool/result': '#e0af68',
    'command/run': '#bb9af7',
    'permission/preset': '#bb9af7',
    'sandbox/mode': '#bb9af7',
    'approval/policy': '#bb9af7',
    'step/start': '#626266',
    'step/end': '#626266',
  };
  function chunkColor(ev) {
    const t = ev && ev.data && ev.data.chunk && ev.data.chunk.type;
    if (t === 'reasoning-delta') return '#9d7cd8'; // think
    if (t === 'text-delta') return '#9ece6a';      // output
    if (t === 'usage') return '#7aa2f7';           // tokens
    if (t === 'tool-call-delta') return '#e0af68'; // tool
    return TL_COLORS['assistant/chunk'] || '#7aa2f7';
  }
  function colorOf(ev) {
    if (ev.type === 'assistant/chunk') return chunkColor(ev);
    return TL_COLORS[ev.type] || '#7aa2f7';
  }
  function roleNameOf(ev) {
    switch (ev.type) {
      case 'user/message': return t('traj.user');
      case 'assistant/message': return t('traj.output');
      case 'assistant/chunk': {
        const c = ev.data && ev.data.chunk && ev.data.chunk.type;
        if (c === 'reasoning-delta') return t('traj.think');
        if (c === 'tool-call-delta') return t('traj.tool');
        if (c === 'usage') return t('traj.usage');
        return t('traj.stream');
      }
      case 'tool/call': return t('traj.toolCall');
      case 'tool/result': return t('traj.toolResult');
      case 'command/run': return t('traj.command');
      case 'step/start': return t('traj.stepStart');
      case 'step/end': return t('traj.stepEnd');
      default: return String(ev.type);
    }
  }

  /** Open a path in the file manager/system editor (dsh-web underline parity). */
  function openFilePath(path) {
    if (P.app && P.app.openFile) P.app.openFile(path).catch(() => {});
  }
  const PATH_RE = /(?:[\s("'])(\/(?:home|workspace|workspaces|tmp|var|usr|etc|opt|srv|root|mnt|media|run|data)\/[^\s<>"']+)/g;
  function extractPaths(text) {
    const out = [];
    const re = new RegExp(PATH_RE.source, 'g');
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
      const clean = m[1].replace(/[),.;，。；：]+$/, '');
      if (out.indexOf(clean) < 0) out.push(clean);
    }
    return out.slice(0, 12);
  }
  /** Deliverable chips: every file the answer produced, clickable. */
  function deliverablesEl(text) {
    const paths = extractPaths(text);
    if (!paths.length) return null;
    const box = el('div', 'dlvChips');
    for (const p of paths) {
      const chip = el('button', 'dlvChip');
      chip.type = 'button';
      chip.title = p;
      chip.innerHTML = P.icons['ma.read'] + '<span>' + esc(p.split('/').pop() || p) + '</span>';
      chip.addEventListener('click', (e) => { e.stopPropagation(); openFilePath(p); });
      box.appendChild(chip);
    }
    return box;
  }
  /** Absolute paths get an underline link (click opens the file). */
  function linkifyPaths(html) {
    return String(html || '').replace(PATH_RE, (m, pre, path) => {
      const clean = path.replace(/[),.;，。；：]+$/, '');
      return pre + '<a class="pathLink" data-path="' + esc(clean) + '">' + esc(clean) + '</a>';
    });
  }

  async function sendFeedback(msg, value) {
    try {
      if (value) await P.dsh.request('messageFeedback.put', { messageId: msg.id, value });
      else await P.dsh.request('messageFeedback.delete', { messageId: msg.id });
      C.msgFeedback = C.msgFeedback || {};
      if (value) C.msgFeedback[msg.id] = value;
      else delete C.msgFeedback[msg.id];
      renderFlow();
      if (P.app && P.app.toast) P.app.toast(t('chat.feedbackSent'));
    } catch (e) {
      if (P.app && P.app.toast) P.app.toast(t('chat.feedbackFail'));
    }
  }

  async function branchFrom(msg) {
    try {
      let r = null;
      try { r = await P.dsh.request('session.fork', { sessionId: C.sessionId, boundary: msg._seq }); } catch (e1) { r = null; }
      if (!r || !r.sessionId) r = await P.dsh.request('session.fork', { sourceSessionId: C.sessionId, boundary: msg._seq });
      const child = r && r.sessionId;
      if (!child) throw new Error('no child session');
      P.dshState.currentSessionId = child;
      await P.dshState.listSessions();
      if (P.app && P.app.renderSessions) P.app.renderSessions();
      if (P.app && P.app.selectSession) await P.app.selectSession(child);
      else await C.loadHistory(child);
      if (P.app && P.app.toast) P.app.toast(t('chat.branched'));
    } catch (e) {
      if (P.app && P.app.toast) P.app.toast(t('chat.branchFail', { msg: (e && e.message) || e }));
    }
  }

  function renderAssistant(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    if (msg.reasoning) {
      const d = el('div', 'disclosure');
      const row = el('button', 'dRow');
      row.type = 'button';
      row.innerHTML = P.icons['ma.think'] || '';
      row.appendChild(el('span', 'dTitle', t('chat.thinking')));
      const body = el('div', 'dBody');
      const tb = el('div', 'thinkBody');
      tb.textContent = msg.reasoning;
      body.appendChild(tb);
      row.addEventListener('click', () => d.classList.toggle('open'));
      d.appendChild(row); d.appendChild(body);
      item.appendChild(d);
    }
    if (msg.content) {
      const p = el('p', 'para');
      p.innerHTML = linkifyPaths(mdToHtml(msg.content));
      if (msg.streaming) p.appendChild(el('span', 'caret'));
      item.appendChild(p);
    }
    for (const img of msg.images || []) item.appendChild(imageEl(img));
    // deliverables: every produced file, clickable, always visible at the end
    const dlv = deliverablesEl(msg.content || '');
    if (dlv) item.appendChild(dlv);
    // meta: 完成时间 · 用时 · token (appears on hover)
    const meta = el('div', 'msgMeta');
    meta.appendChild(el('span', '', clock(msg.ts)));
    if (msg.durMs) meta.appendChild(el('span', '', ' · ' + fmtDurShort(msg.durMs)));
    if (msg.usage && (msg.usage.prompt_tokens || msg.usage.completion_tokens)) {
      meta.appendChild(el('span', '', ' · ' + t('chat.tokens', { in: msg.usage.prompt_tokens || 0, out: msg.usage.completion_tokens || 0 })));
    }
    item.appendChild(meta);
    // actions: 复制 / 好 / 坏 / 分支
    const actions = el('div', 'msgActions');
    const mk = (icon, label, fn) => {
      const b = el('button', 'maBtn');
      b.type = 'button';
      b.title = label;
      b.innerHTML = P.icons[icon] || icon;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    actions.appendChild(mk('ma.copy', t('chat.copy'), () => {
      const txt = [msg.reasoning ? msg.reasoning : '', msg.content || ''].filter(Boolean).join('\n');
      const p = navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject(new Error('no clipboard'));
      p.then(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copied')); })
        .catch(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copyFail')); });
    }));
    const fb = C.msgFeedback || {};
    const up = mk('ma.good', t('chat.good'), () => sendFeedback(msg, fb[msg.id] === 'good' ? null : 'good'));
    if (fb[msg.id] === 'good') up.classList.add('on');
    const dn = mk('ma.bad', t('chat.bad'), () => sendFeedback(msg, fb[msg.id] === 'bad' ? null : 'bad'));
    if (fb[msg.id] === 'bad') dn.classList.add('on');
    actions.appendChild(up); actions.appendChild(dn);
    actions.appendChild(mk('ma.branch', t('chat.branch'), () => branchFrom(msg)));
    item.appendChild(actions);
    return item;
  }

  function renderTool(msg) {
    const item = el('div', 'assistantItem toolItem');
    item.dataset.msg = msg.id;
    const head = el('button', 'dRow');
    head.type = 'button';
    head.innerHTML = P.icons['ma.tool'] || '⟳';
    head.appendChild(el('span', 'dTitle', msg.name));
    item.appendChild(head);
    if (msg.args) {
      const argsBody = el('div', 'dBody');
      const pre = el('div', 'thinkBody');
      pre.textContent = String(msg.args).slice(0, 1200);
      argsBody.appendChild(pre);
      item.appendChild(argsBody);
      head.addEventListener('click', () => item.classList.toggle('openArgs'));
      item.classList.add('openArgs');
    }
    if (msg.content) {
      const d = el('div', 'disclosure open');
      const body = el('div', 'dBody toolBody');
      const pre = el('div', 'thinkBody');
      pre.innerHTML = linkifyPaths(mdToHtml(String(msg.content).slice(0, 20000)));
      body.appendChild(pre);
      d.appendChild(body);
      item.appendChild(d);
      const dlv = deliverablesEl(msg.content);
      if (dlv) item.appendChild(dlv);
    }
    return item;
  }

  function renderSystem(msg) {
    const row = el('div', 'sysLine');
    row.appendChild(el('span', 'sysDot'));
    row.appendChild(el('span', 'sysText', msg.content));
    return row;
  }

  let flowRenderToken = 0;
  let flowDoneResolve = null;
  function renderFlow() {
    const flow = $('flow');
    C.flowDone = new Promise((r) => { flowDoneResolve = r; });
    if (!flow) {
      if (flowDoneResolve) { flowDoneResolve(); flowDoneResolve = null; }
      return;
    }
    const token = ++flowRenderToken;
    flow.textContent = '';
    if (!C.messages.length) {
      flow.appendChild(el('div', 'emptyChat', t('chat.empty')));
      scrollBottom();
      if (flowDoneResolve) { flowDoneResolve(); flowDoneResolve = null; }
      return;
    }
    const CHUNK = 60;   // messages per frame — big histories stop janking switches
    let i = 0;
    const step = () => {
      if (token !== flowRenderToken) return;
      const end = Math.min(i + CHUNK, C.messages.length);
      for (; i < end; i++) {
        const m = C.messages[i];
        if (m.role === 'user') flow.appendChild(renderUser(m));
        else if (m.role === 'assistant') flow.appendChild(renderAssistant(m));
        else if (m.role === 'tool') flow.appendChild(renderTool(m));
        else if (m.role === 'system') flow.appendChild(renderSystem(m));
      }
      if (i < C.messages.length) {
        requestAnimationFrame(step);
      } else {
        scrollBottom();
        if (flowDoneResolve) { flowDoneResolve(); flowDoneResolve = null; }
      }
    };
    step();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { const s = $('chatScroll'); if (s) s.scrollTop = s.scrollHeight; });
  }

  /* ---------- trajectory (dsh-web parity: colored blocks, per-node time &
     token cost, search — no black box) ---------- */
  /** Waveform above the trajectory: color = activity kind (think/output/tool),
   *  direction/area = token spend (in = up, out = down). */
  function renderWave() {
    const box = $('trajView');
    if (!box) return;
    const holder = el('div', 'tlWave');
    const events = C.rawEvents.filter((ev) => {
      const d = ev.data || {};
      return d.turn !== undefined || d.step !== undefined;
    });
    if (!events.length) { box.appendChild(holder); return; }
    const W = 900, H = 74;
    const cols = [];
    let pending = { in: 0, out: 0 };
    for (const ev of events) {
      const d = ev.data || {};
      const c = d.chunk || {};
      if (ev.type === 'assistant/chunk' && c.type === 'usage') {
        const u = c.usage || c;
        pending.in += u.prompt_tokens || 0;
        pending.out += u.completion_tokens || 0;
        cols.push({ kind: 'usage', color: '#7aa2f7', in: u.prompt_tokens || 0, out: u.completion_tokens || 0 });
      } else if (ev.type === 'assistant/chunk' && c.type === 'reasoning-delta') {
        cols.push({ kind: 'think', color: '#9d7cd8' });
      } else if (ev.type === 'assistant/chunk' && c.type === 'text-delta') {
        cols.push({ kind: 'output', color: '#9ece6a' });
      } else if (ev.type === 'tool/call' || ev.type === 'tool/result' || (ev.type === 'assistant/chunk' && c.type === 'tool-call-delta')) {
        cols.push({ kind: 'tool', color: '#e0af68' });
      } else if (ev.type === 'user/message') {
        cols.push({ kind: 'user', color: '#9C9CA1' });
      } else {
        cols.push({ kind: 'sys', color: '#626266' });
      }
    }
    const n = Math.max(cols.length, 1);
    const bw = Math.max(2, Math.floor(W / n) - 1);
    let svg = '';
    const maxTok = Math.max(1, Math.max(...cols.map((c) => Math.max(c.in || 0, c.out || 0))));
    cols.forEach((c, i) => {
      const x = i * (bw + 1);
      if (c.kind === 'usage') {
        const up = Math.max(2, Math.round((c.in / maxTok) * (H / 2 - 4)));
        const down = Math.max(2, Math.round((c.out / maxTok) * (H / 2 - 4)));
        svg += '<rect x="' + x + '" y="' + (H / 2 - up) + '" width="' + bw + '" height="' + up + '" fill="' + c.color + '" opacity="0.9"/>';
        svg += '<rect x="' + x + '" y="' + (H / 2 + 1) + '" width="' + bw + '" height="' + down + '" fill="' + c.color + '" opacity="0.45"/>';
      } else {
        const h = c.kind === 'sys' ? 3 : 8;
        svg += '<rect x="' + x + '" y="' + (H / 2 - h / 2) + '" width="' + bw + '" height="' + h + '" fill="' + c.color + '" opacity="0.75"/>';
      }
    });
    const legend = el('div', 'tlWaveLegend');
    [['#9d7cd8', t('traj.think')], ['#9ece6a', t('traj.output')], ['#e0af68', t('traj.tool')], ['#7aa2f7', t('traj.tokenUpDown')]].forEach(([c, l]) => {
      const s = el('span', 'tlWaveKey');
      const dot = el('span', 'tlWaveDot');
      dot.style.background = c;
      s.appendChild(dot);
      s.appendChild(el('span', '', l));
      legend.appendChild(s);
    });
    holder.appendChild(legend);
    holder.innerHTML += '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:74px">' + svg + '</svg>';
    box.appendChild(holder);
  }

  let tlQuery = '';
  function renderTimeline() {
    const box = $('trajView');
    if (!box) return;
    box.textContent = '';
    renderWave();
    const searchRow = el('div', 'tlSearch');
    searchRow.innerHTML = P.icons.search || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('traj.search');
    input.spellcheck = false;
    input.value = tlQuery;
    input.addEventListener('input', () => { tlQuery = input.value; renderTimeline(); });
    searchRow.appendChild(input);
    box.appendChild(searchRow);
    if (!C.rawEvents.length) {
      box.appendChild(el('div', 'trajEmpty', t('traj.empty')));
      return;
    }
    const q = tlQuery.trim().toLowerCase();
    const rows = [];
    for (let i = 0; i < C.rawEvents.length; i++) {
      const ev = C.rawEvents[i];
      const d = ev.data || {};
      let turn = d.turn, step = d.step;
      if (ev.type === 'step/start' || ev.type === 'step/end') { turn = d.turn; step = d.step; }
      if (step === undefined && turn === undefined) continue;
      const brief = summaryOf(ev);
      const role = roleNameOf(ev);
      if (q && !(String(ev.type).toLowerCase().indexOf(q) >= 0 || String(brief || '').toLowerCase().indexOf(q) >= 0 || String(role).toLowerCase().indexOf(q) >= 0)) continue;
      const next = C.rawEvents[i + 1];
      const dur = next && next.time && ev.time && next.time > ev.time ? next.time - ev.time : null;
      rows.push({ ev, brief, dur, turn, step, role });
    }
    let lastKey = null;
    for (const r of rows) {
      const key = r.turn + '/' + r.step;
      if (key !== lastKey) {
        const head = el('div', 'tlHead');
        head.appendChild(el('span', 'tlLabel', t('traj.stepHeader', { turn: r.turn === undefined ? '?' : r.turn, step: r.step === undefined ? '?' : r.step })));
        box.appendChild(head);
        lastKey = key;
      }
      const row = el('div', 'tlRow');
      const bar = el('span', 'tlBar');
      bar.style.background = colorOf(r.ev);
      row.appendChild(bar);
      const badge = el('span', 'tlType', r.role);
      badge.style.color = colorOf(r.ev);
      row.appendChild(badge);
      if (r.brief) {
        const bf = el('span', 'tlBrief');
        bf.textContent = String(r.brief).slice(0, 240);
        bf.title = r.brief;
        row.appendChild(bf);
      }
      const meta = el('span', 'tlMeta');
      if (r.dur !== null && r.dur >= 0 && r.dur < 300000) meta.appendChild(el('span', '', fmtDurShort(r.dur)));
      const usage = r.ev.type === 'assistant/chunk' && r.ev.data && r.ev.data.chunk && r.ev.data.chunk.type === 'usage'
        ? (r.ev.data.chunk.usage || r.ev.data.chunk) : null;
      if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
        meta.appendChild(el('span', '', t('chat.tokens', { in: usage.prompt_tokens || 0, out: usage.completion_tokens || 0 })));
      }
      row.appendChild(meta);
      box.appendChild(row);
    }
    if (!rows.length) box.appendChild(el('div', 'trajEmpty', t('traj.none')));
  }
  function fmtDurShort(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
  }

  /* ---------- session log (raw event list, overlay) ---------- */
  function renderLog() {
    const box = $('logBody');
    if (!box) return;
    box.textContent = '';
    if (!C.rawEvents.length) {
      box.appendChild(el('div', 'trajEmpty', t('traj.empty')));
      return;
    }
    C.rawEvents.slice(-500).forEach((ev, i) => {
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
  function exportLog() {
    if (!C.rawEvents.length) return;
    const blob = new Blob([JSON.stringify(C.rawEvents, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prts-session-log-' + (C.sessionId || 'session').slice(0, 12) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
    try { await C.flowDone; } catch (e) { /* render never resolves? */ }
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
      C.sessionId = id;
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
    // Sending from the welcome screen starts the conversation: leave the
    // hero (dsh web behaviour) so the stream is visible.
    if (P.app && P.app.enterChat) P.app.enterChat();
    try {
      await P.dshState.prompt(C.sessionId, content);
      // The mux delivers the events; the prompt only needs to be accepted.
      const sendBtnEl = $('sendBtn');
      if (sendBtnEl) {
        sendBtnEl.classList.remove('sent');
        void sendBtnEl.offsetWidth;
        sendBtnEl.classList.add('sent');
      }
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
    const flowEl = $('flow');
    if (flowEl) {
      flowEl.addEventListener('click', (e) => {
        const link = e.target.closest('.pathLink');
        if (link && link.dataset.path) openFilePath(link.dataset.path);
      });
    }

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
        if (!v) return;
        // A leading '/' is a command: run it through the host command
        // executor (dsh web's path). Unknown commands fall back to a
        // normal message so the line is never lost.
        if (v[0] === '/') { tryCommandLine(v); return; }
        send(v);
      } else if (e.key === 'Tab' && cmdCompletion) {
        e.preventDefault();
        completeCommand();
      } else if (e.key === 'ArrowDown' && cmdCompletion && cmdCompletion.length) {
        e.preventDefault();
        cmdActive = Math.min(cmdCompletion.length - 1, cmdActive + 1);
        renderCompletion();
      } else if (e.key === 'ArrowUp' && cmdCompletion && cmdCompletion.length) {
        e.preventDefault();
        cmdActive = Math.max(0, cmdActive - 1);
        renderCompletion();
      } else if (e.key === 'Escape' && cmdCompletion) {
        e.preventDefault();
        cmdCompletion = null;
        hideCompletion();
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
  let cmdActive = 0;
  let composeToken = 0;
  function onComposeChange() {
    const token = ++composeToken;
    const input = $('composerInput');
    const v = input.value;
    // Command mode: the very first char is '/', with no space yet. A bare
    // '/' lists every command (host directory incl. plugin-extended ones).
    if (v[0] === '/' && v.indexOf(' ') === -1) {
      const partial = v.slice(1).toLowerCase();
      if (!P.dshState.currentSessionId) return;
      P.dshState.commandsList(P.dshState.currentSessionId).then((cmds) => {
        if (token !== composeToken) return;   // stale keystroke
        const matches = cmds.filter((c) => String(c.name || '').toLowerCase().indexOf(partial) === 0);
        if (matches.length) {
          cmdCompletion = matches;
          cmdActive = 0;
          renderCompletion();
        } else { cmdCompletion = null; hideCompletion(); }
      }).catch(() => { if (token === composeToken) { cmdCompletion = null; hideCompletion(); } });
    } else {
      cmdCompletion = null;
      hideCompletion();
    }
  }
  function showCompletion() {
    let pop = $('cmdCompletionPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'cmdCompletionPop';
      pop.className = 'pop cmdCompletion';
      $('composerArea').appendChild(pop);
    }
    const composer = $('composerCard');
    const r = composer.getBoundingClientRect();
    pop.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    pop.style.left = '0';
    pop.style.right = '0';
    pop.style.maxWidth = '420px';
    pop.style.display = 'block';
  }
  function renderCompletion() {
    const pop = $('cmdCompletionPop');
    if (!pop || !cmdCompletion || !cmdCompletion.length) { hideCompletion(); return; }
    showCompletion();
    pop.innerHTML = cmdCompletion.slice(0, 7).map((c, i) =>
      '<div class="popItem' + (i === cmdActive ? ' active' : '') + '" data-name="' + esc(c.name) + '" data-i="' + i + '">' +
      '<span class="label">/' + esc(c.name) + '</span>' +
      (c.description ? '<span class="desc">' + esc(c.description) + '</span>' : '') +
      '</div>'
    ).join('');
    for (const row of pop.querySelectorAll('.popItem')) {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cmdActive = Number(row.dataset.i || 0);
        completeCommand();
      });
      row.addEventListener('mouseenter', () => {
        cmdActive = Number(row.dataset.i || 0);
        pop.querySelectorAll('.popItem').forEach((x, i) => x.classList.toggle('active', i === cmdActive));
      });
    }
  }
  function hideCompletion() {
    const pop = $('cmdCompletionPop');
    if (pop) { pop.classList.remove('open'); pop.style.display = 'none'; }
  }
  function completeCommand() {
    const input = $('composerInput');
    if (!cmdCompletion || !cmdCompletion.length) return;
    const first = cmdCompletion[Math.min(cmdActive, cmdCompletion.length - 1)] || cmdCompletion[0];
    input.value = '/' + first.name + ' ';
    cmdCompletion = null;
    hideCompletion();
    input.focus();
    updateSend();
    scrollInputBottom();
  }

  /** Execute a slash line through the host command executor; fall back to a
   *  normal message when the host doesn't know the command. */
  async function tryCommandLine(line) {
    if (!C.sessionId) {
      const id = await P.app.ensureSession();
      if (!id) { P.app.toast(t('session.createFail')); return; }
      C.sessionId = id;
    }
    const input = $('composerInput');
    let admitted = false;
    let errText = null;
    try {
      const out = await P.dshState.executeCommand(C.sessionId, line);
      admitted = !!(out && out.admitted);
      if (admitted && out.result && out.result.kind === 'error' && out.result.text) errText = out.result.text;
    } catch (e) {
      admitted = false;
    }
    if (admitted) {
      if (input) input.value = '';
      updateSend();
      if (errText) P.app.toast(t('commands.execFailed', { msg: errText }));
    } else {
      // Unknown or transport failure — never lose the line.
      if (input) input.value = '';
      send(line);
    }
  }

  C.send = send;
  C.stop = stop;
  C.tryCommandLine = tryCommandLine;
  C.renderFlow = renderFlow;
  C.renderTimeline = renderTimeline;
  C.renderLog = renderLog;
  C.exportLog = exportLog;
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
