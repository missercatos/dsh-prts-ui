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
  const INLINE_MD = (t) => String(t)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  function tableHtml(rows) {
    const grid = rows.map((r) => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()));
    let html = '<div class="tblWrap"><table>';
    grid.forEach((cs, ri) => {
      if (ri === 1 && cs.every((c) => /^:?-{2,}:?$/.test(c))) return;
      html += '<tr>' + cs.map((c) => (ri === 0 ? '<th>' : '<td>') + INLINE_MD(c) + (ri === 0 ? '</th>' : '</td>')).join('') + '</tr>';
    });
    html += '</table></div>';
    return html;
  }
  function mdToHtml(text) {
    let s = esc(text);
    // emoji → monochrome glyphs (webUI-style rendered marks, not color emoji)
    s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, (m) => '<span class="emoji">' + m + '</span>');
    const codeBlocks = [];
    s = s.replace(/```([\s\S]*?)```/g, (m, code) => { codeBlocks.push(code); return '\u0000CODE' + (codeBlocks.length - 1) + '\u0000'; });
    s = s.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img class="mdImg" src="$2" alt="$1">');
    s = s.replace(/(^|\n)(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?\S*)?)/gi, '$1<img class="mdImg" src="$2" alt="">');
    // pipe tables first (line-based), everything else inline
    const lines = s.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        out.push(tableHtml(rows));
        i--;
      } else {
        out.push(INLINE_MD(lines[i]));
      }
    }
    s = out.join('<br>');
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

  /** message -> ordered blocks + aggregated fields (webUI block parity). */
  function messageParts(msg) {
    const out = { blocks: [], reasoning: '', text: '', images: [], usage: null, model: null };
    if (!msg) return out;
    if (typeof msg.reasoning === 'string' && msg.reasoning) {
      out.reasoning = msg.reasoning;
      out.blocks.push({ kind: 'reasoning', text: msg.reasoning });
    }
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      const ty = b && b.type;
      if (ty === 'reasoning' || ty === 'thinking') {
        const t = (b.text || b.content || '');
        if (t) { out.reasoning += t; out.blocks.push({ kind: 'reasoning', text: t }); }
      } else if (ty === 'text') {
        const t = b.text || '';
        if (t) { out.text += t; out.blocks.push({ kind: 'text', text: t }); }
      } else if (ty === 'image') {
        const s2 = imageSrcOf(b);
        if (s2) { out.images.push(s2); out.blocks.push({ kind: 'image', src: s2 }); }
      } else if (ty === 'tool-call' || ty === 'tool_use') {
        out.blocks.push({ kind: 'toolcall', callId: b.id || b.callId || null, name: b.name || 'tool', arguments: b.arguments || b.input || '' });
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
    blocks: [],      // ordered streamed blocks (toolcall entries)
    turn: null,
    step: null,
    finished: false,
    msgRef: null,    // the assistant message object owned by C.messages
  };

  function resetLive() {
    live.seq = -1; live.id = null; live.reasoning = ''; live.text = '';
    live.usage = null; live.model = null; live.toolCalls = []; live.blocks = [];
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
      // carry the message id when the wire provides one (text/reasoning
      // chunks share the assistant message's id on current dsh builds)
      live.id = d.messageId || d.message || chunk.messageId || null;
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
          live.blocks.push({ kind: 'toolcall', callId, name: tc.name, arguments: '', result: null });
        }
        const blk = live.blocks.find((b) => b.kind === 'toolcall' && b.callId === callId);
        if (blk) blk.arguments = tc.args;
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
    swapSendStop(false);
    if (C.workTimer) { clearInterval(C.workTimer); C.workTimer = null; }
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
      const id = msg && msg.id;
      const existing = C.messages.find((m) => m._seq === ev.seq || (id && m.id === id));
      const liveMsg = live.msgRef;
      if (liveMsg) {
        // drop the streamed copy unless it IS the deduped target — this is
        // the "agent replies twice" bug: live + final used to coexist.
        const idx = C.messages.indexOf(liveMsg);
        if (idx >= 0 && existing !== liveMsg) C.messages.splice(idx, 1);
        live.msgRef = null;
      }
      resetLive();
      if (existing) {
        existing.content = parts.text;
        if (parts.reasoning) existing.reasoning = parts.reasoning;
        existing.images = parts.images;
        existing.blocks = parts.blocks;
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
          blocks: parts.blocks,
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
      let targetBlock = null;
      if (callId) {
        // 1) streamed live blocks
        const lb = live.blocks.find((b) => b.kind === 'toolcall' && b.callId === callId);
        if (lb) { lb.result = text; targetBlock = lb; target = live.msgRef || null; }
        // 2) blocks inside final assistant messages
        if (!targetBlock) {
          for (let i = C.messages.length - 1; i >= 0; i--) {
            const m = C.messages[i];
            if (m.role !== 'assistant' || !Array.isArray(m.blocks)) continue;
            const blk = m.blocks.find((b) => b.kind === 'toolcall' && b.callId === callId);
            if (blk) { blk.result = text; targetBlock = blk; target = m; break; }
          }
        }
        // 3) standalone tool messages (fallback)
        if (!targetBlock) target = C.messages.filter((m) => m.role === 'tool').reverse().find((m) => m.callId === callId);
      }
      if (target && !targetBlock) {
        target.content = text;
        target.resultSeq = ev.seq;
      } else if (!targetBlock) {
        C.messages.push({ id: 'r' + ev.seq, _seq: ev.seq, role: 'tool', content: text, name: data.name || 'tool', callId, ts: ev.time });
      }
      scheduleRender();
    } else if (type === 'step/start') {
      C.activeSteps += 1;
      if (!C.workTimer) {
        C.workStartAt = Date.now();
        C.workTimer = setInterval(() => {
          const s = Math.round((Date.now() - C.workStartAt) / 1000);
          if (C.onStatus) { try { C.onStatus(t('chat.working', { s })); } catch (e) { /* noop */ } }
        }, 1000);
      }
      if (C.onStatus) { try { C.onStatus(t('chat.working', { s: 0 })); } catch (e) { /* noop */ } }
    } else if (type === 'step/end') {
      C.activeSteps = Math.max(0, C.activeSteps - 1);
      if (C.activeSteps <= 0) {
        if (C.workTimer) { clearInterval(C.workTimer); C.workTimer = null; }
        if (C.onStatus) { try { C.onStatus(null); } catch (e) { /* noop */ } }
      }
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
    // Any event that changed the message list repaints the flow — webUI
    // parity: your own sends show up instantly, results attach in place.
    if (type === 'user/message' || type === 'assistant/message' || type === 'tool/call' || type === 'tool/result' || type === 'command/run' || type === 'permission/preset' || type === 'sandbox/mode' || type === 'approval/policy') {
      scheduleRender();
    }
  }

  /* ---------- rendering ---------- */
  function renderUser(msg) {
    const wrap = el('div', 'userRow');
    const bubble = el('div', 'userBubble');
    if (msg.content) bubble.innerHTML = linkifyPaths(mdToHtml(msg.content));
    for (const img of msg.images || []) bubble.appendChild(imageEl(img));
    wrap.appendChild(bubble);
    const foot = el('div', 'msgFoot');
    const tr = el('div', 'maRow');
    tr.appendChild(el('span', 'maTime', clock(msg.ts)));
    foot.appendChild(tr);
    const actions = el('div', 'msgActions');
    const cp = el('button', 'maBtn');
    cp.type = 'button';
    cp.title = t('chat.copy');
    cp.innerHTML = P.icons['ma.copy'] || '';
    cp.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = navigator.clipboard ? navigator.clipboard.writeText(msg.content || '') : Promise.reject(new Error('no clipboard'));
      p.then(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copied')); })
        .catch(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copyFail')); });
    });
    actions.appendChild(cp);
    foot.appendChild(actions);
    wrap.appendChild(foot);
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

  function toolIcon(name) {
    const map = {
      bash: 'ma.bash', terminal: 'ma.bash', read: 'ma.read', read_file: 'ma.read',
      edit: 'ma.edit', str_replace_editor: 'ma.edit', str_replace: 'ma.edit', write: 'ma.edit',
      web_fetch: 'search', web_search: 'search', grep: 'search', glob: 'search',
    };
    return P.icons[map[name]] || P.icons['ma.tool'] || '⟳';
  }

  /** Collapsible block row: glyph → chevron on hover, summary line, hidden
   *  body. Shared by think / bash / read / edit blocks (webUI interaction). */
  function blkRow(kind, title, summary, bodyHtml, rawText) {
    const item = el('div', 'toolBlock blkRow');
    const head = el('button', 'dRow blkHead');
    head.type = 'button';
    const glyph = el('span', 'blkGlyph');
    glyph.innerHTML = toolIcon(kind) || P.icons['ma.tool'] || '⟳';
    const chev = el('span', 'blkChev');
    chev.innerHTML = P.icons.chev || '›';
    const copyBtn = el('button', 'blkCopy');
    copyBtn.type = 'button';
    copyBtn.title = t('chat.copy');
    copyBtn.innerHTML = P.icons['ma.copy'] || '';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = navigator.clipboard ? navigator.clipboard.writeText(rawText || '') : Promise.reject(new Error('no clipboard'));
      p.then(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copied')); })
        .catch(() => { if (P.app && P.app.toast) P.app.toast(t('chat.copyFail')); });
    });
    head.appendChild(glyph);
    head.appendChild(chev);
    head.appendChild(el('span', 'dTitle', title));
    head.appendChild(copyBtn);
    item.appendChild(head);
    if (summary) {
      const s = el('div', 'blkSummary');
      s.textContent = summary;
      s.title = summary;
      item.appendChild(s);
    }
    const body = el('div', 'dBody');
    body.style.display = 'none';
    if (bodyHtml) body.appendChild(bodyHtml);
    item.appendChild(body);
    head.addEventListener('click', (e) => {
      if (e.target.closest('.blkCopy')) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      item.classList.toggle('open', !open);
    });
    return item;
  }

  function toolSummary(name, args) {
    const a = String(args || '').trim();
    if (name === 'read' || name === 'read_file') {
      let p = '';
      try { p = (JSON.parse(a).file_path || JSON.parse(a).path) || ''; } catch (e) { p = ''; }
      return p ? '读取 ' + p : '读取文件';
    }
    if (name === 'bash' || name === 'terminal') {
      const line = a.replace(/\n/g, ' ').slice(0, 100);
      return line || '执行命令';
    }
    if (name === 'edit' || name === 'str_replace_editor' || name === 'str_replace' || name === 'write') {
      let p = '';
      try { p = (JSON.parse(a).file_path || JSON.parse(a).path) || ''; } catch (e) { p = ''; }
      return p ? '编辑 ' + p : '编辑文件';
    }
    return a.slice(0, 100) || String(name);
  }

  /** One tool-call block: Bash/Read/Edit card — collapsed by default. */
  function renderToolBlock(blk) {
    const name = String(blk.name || 'tool');
    const argsText = String(blk.arguments || '').slice(0, 1200);
    const body = el('div');
    if (blk.arguments) {
      const argsBody = el('div');
      const pre = el('div', 'thinkBody');
      pre.textContent = argsText;
      const paths = extractPaths(String(blk.arguments));
      const pathRow = el('div', 'dlvChips');
      for (const p of paths.slice(0, 6)) {
        const chip = el('button', 'dlvChip');
        chip.type = 'button';
        chip.innerHTML = P.icons['ma.read'] + '<span>' + esc(p.split('/').pop() || p) + '</span>';
        chip.addEventListener('click', (e) => { e.stopPropagation(); openFilePath(p); });
        pathRow.appendChild(chip);
      }
      if (pathRow.childNodes.length) body.appendChild(pathRow);
      body.appendChild(argsBody.appendChild(pre));
    }
    if (blk.result) {
      const d = el('div');
      const pre = el('div', 'thinkBody');
      const err = /(^|\n)(error|failed|stderr|not allowed|denied)/i.test(String(blk.result).slice(0, 400));
      if (err) pre.classList.add('errText');
      pre.innerHTML = linkifyPaths(mdToHtml(String(blk.result).slice(0, 20000)));
      d.appendChild(pre);
      body.appendChild(d);
    }
    return blkRow(name, name, toolSummary(name, blk.arguments), body, [argsText, blk.result || ''].filter(Boolean).join('\n'));
  }

  /** Think block row — collapsed, summary line shows the gist. */
  function renderThinkBlock(text) {
    const pre = el('div', 'thinkBody');
    pre.textContent = String(text || '');
    return blkRow('ma.think', t('chat.thinking'), String(text || '').replace(/\n/g, ' ').slice(0, 100), pre, text || '');
  }

  function renderAssistant(msg) {
    const item = el('div', 'assistantItem');
    item.dataset.msg = msg.id;
    // Ordered blocks (webUI parity): think folds, text is the main output,
    // tool-call blocks render Bash/Read/Edit cards with their results.
    const blocks = Array.isArray(msg.blocks) && msg.blocks.length ? msg.blocks : null;
    if (blocks) {
      for (const blk of blocks) {
        if (blk.kind === 'reasoning') {
          item.appendChild(renderThinkBlock(blk.text));
        } else if (blk.kind === 'text') {
          const p = el('p', 'para');
          p.innerHTML = linkifyPaths(mdToHtml(blk.text));
          if (msg.streaming) p.appendChild(el('span', 'caret'));
          item.appendChild(p);
        } else if (blk.kind === 'image') {
          item.appendChild(imageEl(blk.src));
        } else if (blk.kind === 'toolcall') {
          item.appendChild(renderToolBlock(blk));
        }
      }
    } else {
      // legacy fallback (no block info)
      if (msg.reasoning) {
        item.appendChild(renderThinkBlock(msg.reasoning));
      }
      if (msg.content) {
        const p = el('p', 'para');
        p.innerHTML = linkifyPaths(mdToHtml(msg.content));
        if (msg.streaming) p.appendChild(el('span', 'caret'));
        item.appendChild(p);
      }
    }
    for (const img of msg.images || []) item.appendChild(imageEl(img));
    // deliverables: every produced file, clickable, always visible at the end
    const dlv = deliverablesEl(msg.content || '');
    if (dlv) item.appendChild(dlv);
    // meta + persistent actions (bottom-right of the OUTPUT, not on think/tool)
    const foot = el('div', 'msgFoot');
    const meta = el('div', 'msgMeta');
    meta.appendChild(el('span', '', clock(msg.ts)));
    if (msg.durMs) meta.appendChild(el('span', '', ' · ' + fmtDurShort(msg.durMs)));
    if (msg.usage && (msg.usage.prompt_tokens || msg.usage.completion_tokens)) {
      meta.appendChild(el('span', '', ' · ' + t('chat.tokens', { in: msg.usage.prompt_tokens || 0, out: msg.usage.completion_tokens || 0 })));
    }
    foot.appendChild(meta);
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
      const txt = [msg.reasoning || '', msg.content || ''].filter(Boolean).join('\n');
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
    foot.appendChild(actions);
    item.appendChild(foot);
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

  // Each renderFlow call owns a token; waiters resolve per token so a newer
  // render superseding an older one can never strand an await (the 0.6.1
  // "stuck on the particle intro" bug: the single resolver got overwritten).
  C.historyToken = C.historyToken || 0;
  let flowRenderToken = 0;
  const flowWaiters = new Map();   // token -> resolve
  function releaseFlowWaiters() {
    for (const r of flowWaiters.values()) { try { r(); } catch (e) { /* noop */ } }
    flowWaiters.clear();
  }
  function renderFlow() {
    releaseFlowWaiters();           // superseded renders finish immediately
    const flow = $('flow');
    const token = ++flowRenderToken;
    C.flowDone = new Promise((r) => { flowWaiters.set(token, r); });
    const finish = () => {
      scrollBottom();
      const r = flowWaiters.get(token);
      if (r) { flowWaiters.delete(token); r(); }
    };
    if (!flow) { finish(); return; }
    flow.textContent = '';
    if (!C.messages.length) {
      flow.appendChild(el('div', 'emptyChat', C._loading ? t('chat.loading') : t('chat.empty')));
      finish();
      return;
    }
    const CHUNK = 24;   // messages per frame — big histories stop janking switches
    let i = 0;
    const step = () => {
      if (token !== flowRenderToken) {
        // superseded: resolve this token's waiter so nobody waits on it
        const r = flowWaiters.get(token);
        if (r) { flowWaiters.delete(token); r(); }
        return;
      }
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
        finish();
      }
    };
    step();
  }

  function scrollBottom() {
    requestAnimationFrame(() => { const s = $('chatScroll'); if (s) s.scrollTop = s.scrollHeight; });
  }

  /* ---------- trajectory (dsh-web parity: colored blocks, per-node time &
     token cost, search — no black box) ---------- */
  /* ============================================================
     Trajectory (webUI parity): 4-lane waveform, click-to-jump,
     SUMMARY/PREVIEW/RAW details, Duration/Turns/Calls grouping,
     and a live task view while the agent is running.
     ============================================================ */
  let trajQuery = '';
  let trajSort = 'duration';       // duration | turns | calls
  let trajSelected = null;         // node index
  let trajDetailTab = 'summary';   // summary | preview | raw
  let trajNodesCache = null;
  let trajTickTimer = null;

  // Fixed quartet on every theme (webUI parity): USER blue on top,
  // ASSISTANT purple below, TOOL yellow under it, ERROR red at the bottom.
  const TRAJ_COLORS_DEFAULT = { user: '#7aa2f7', assistant: '#bb9af7', tool: '#e0af68', error: '#f7768e' };
  function trajColor(kind) {
    return TRAJ_COLORS_DEFAULT[kind] || TRAJ_COLORS_DEFAULT.assistant;
  }
  function trajResultText(ev) {
    const d = ev.data || {};
    const msg = d.message || {};
    if (Array.isArray(msg.content)) {
      return msg.content.map((b) => {
        if (Array.isArray(b.content)) return b.content.map((bb) => bb.text || '').join('');
        return b.text || '';
      }).join('\n');
    }
    return d.text || d.output || '';
  }
  function trajKindOf(ev) {
    if (ev.type === 'user/message') return 'user';
    if (ev.type === 'tool/result') {
      return /(^|\n)(error|failed|stderr|not allowed|denied)/i.test(trajResultText(ev).slice(0, 400)) ? 'error' : 'tool';
    }
    if (ev.type === 'tool/call' || (ev.type === 'assistant/chunk' && ev.data && ev.data.chunk && ev.data.chunk.type === 'tool-call-delta')) return 'tool';
    if (/error|failed|turn-error/i.test(ev.type)) return 'error';
    return 'assistant';
  }
  function trajNodes() {
    if (trajNodesCache) return trajNodesCache;
    const nodes = [];
    for (let i = 0; i < C.rawEvents.length; i++) {
      const ev = C.rawEvents[i];
      const d = ev.data || {};
      if (d.turn === undefined && d.step === undefined && ev.type !== 'tool/result' && ev.type !== 'tool/call') continue;
      const next = C.rawEvents[i + 1];
      const dur = next && next.time && ev.time && next.time > ev.time ? next.time - ev.time : null;
      let usage = null;
      if (ev.type === 'assistant/chunk' && d.chunk && d.chunk.type === 'usage') usage = d.chunk.usage || d.chunk;
      nodes.push({ ev, kind: trajKindOf(ev), brief: summaryOf(ev), dur, time: ev.time, turn: d.turn, step: d.step, usage, seq: ev.seq });
    }
    trajNodesCache = nodes;
    return nodes;
  }

  /** 4-lane waveform: USER top, ASSISTANT below, TOOL under it, ERROR bottom.
   *  Height = activity density (count in a window), alpha = intensity. */
  function trajWaveSvg(nodes, onPick) {
    const W = 900, H = 80, LANE = 19;
    const lanes = { user: 0, assistant: 1, tool: 2, error: 3 };
    const bw = nodes.length ? Math.max(2, Math.floor(W / nodes.length) - 1) : 2;
    const win = 7;
    const counts = nodes.map((n, i) => {
      const c = { user: 0, assistant: 0, tool: 0, error: 0 };
      for (let j = Math.max(0, i - win); j <= Math.min(nodes.length - 1, i + win); j++) c[nodes[j].kind]++;
      return c;
    });
    const maxC = Math.max(1, ...counts.map((c) => Math.max(c.user, c.assistant, c.tool, c.error)));
    let svg = '';
    nodes.forEach((n, i) => {
      const x = i * (bw + 1);
      const lane = lanes[n.kind];
      const cy = lane * LANE + LANE / 2 + 4;
      const c = counts[i][n.kind];
      const h = 4 + 13 * (c / maxC);
      const alpha = 0.3 + 0.65 * (c / maxC);
      svg += '<rect x="' + x + '" y="' + (cy - h / 2) + '" width="' + bw + '" height="' + h + '" fill="' + trajColor(n.kind) + '" opacity="' + alpha.toFixed(2) + '"/>';
    });
    const legend = ['user', 'assistant', 'tool', 'error'].map((k) =>
      '<span class="tlWaveKey"><span class="tlWaveDot" style="background:' + trajColor(k) + '"></span><span>' + t('traj.lane.' + k) + '</span></span>').join('');
    const svgEl = '<div class="trajWaveLegend">' + legend + '</div>' +
      '<svg class="trajWave" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:80px;cursor:pointer">' + svg + '</svg>';
    const wrap = el('div', 'trajWaveWrap');
    wrap.innerHTML = svgEl;
    const s = wrap.querySelector('svg.trajWave');
    s.addEventListener('click', (e) => {
      const r = s.getBoundingClientRect();
      const x = (e.clientX - r.left) / Math.max(1, r.width);
      const idx = Math.min(nodes.length - 1, Math.max(0, Math.floor(x * nodes.length)));
      if (onPick) onPick(idx);
    });
    return wrap;
  }

  function trajNodeRow(node, idx) {
    const row = el('div', 'tlRow' + (trajSelected === idx ? ' sel' : ''));
    row.dataset.trajIdx = String(idx);
    const bar = el('span', 'tlBar');
    bar.style.background = trajColor(node.kind);
    row.appendChild(bar);
    const badge = el('span', 'tlType', t('traj.lane.' + node.kind));
    badge.style.color = trajColor(node.kind);
    row.appendChild(badge);
    if (node.brief) {
      const bf = el('span', 'tlBrief');
      bf.textContent = String(node.brief).slice(0, 200);
      bf.title = node.brief;
      row.appendChild(bf);
    }
    const meta = el('span', 'tlMeta');
    if (node.dur !== null && node.dur >= 0 && node.dur < 300000) meta.appendChild(el('span', '', fmtDurShort(node.dur)));
    if (node.usage && (node.usage.prompt_tokens || node.usage.completion_tokens)) {
      meta.appendChild(el('span', '', t('chat.tokens', { in: node.usage.prompt_tokens || 0, out: node.usage.completion_tokens || 0 })));
    }
    row.appendChild(meta);
    row.addEventListener('click', () => {
      trajSelected = idx;
      renderTrajectory();
    });
    return row;
  }

  function trajGroupHead(label) {
    const head = el('div', 'tlHead');
    head.appendChild(el('span', 'tlLabel', label));
    return head;
  }

  function renderTrajLeft(left) {
    left.textContent = '';
    const searchRow = el('div', 'tlSearch');
    searchRow.innerHTML = P.icons.search || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('traj.search');
    input.spellcheck = false;
    input.value = trajQuery;
    input.addEventListener('input', () => { trajQuery = input.value; trajNodesCache = null; renderTrajectory(); });
    searchRow.appendChild(input);
    left.appendChild(searchRow);

    // sorting: Duration / Turns / Calls
    const sorts = el('div', 'mTabs');
    [['duration', 'traj.sort.duration'], ['turns', 'traj.sort.turns'], ['calls', 'traj.sort.calls']].forEach(([v, k]) => {
      const b = el('button', 'mTab' + (trajSort === v ? ' on' : ''), t(k));
      b.type = 'button';
      b.addEventListener('click', () => { trajSort = v; renderTrajectory(); });
      sorts.appendChild(b);
    });
    left.appendChild(sorts);

    const nodes = trajNodes();
    if (!nodes.length) {
      left.appendChild(el('div', 'trajEmpty', t('traj.empty')));
      return;
    }
    left.appendChild(trajWaveSvg(nodes, (idx) => {
      trajSelected = idx;
      renderTrajectory();
      const row = left.querySelector('[data-traj-idx="' + idx + '"]');
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }));

    const q = trajQuery.trim().toLowerCase();
    const rows = el('div', 'trajRows');
    let lastKey = null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const role = t('traj.lane.' + node.kind);
      if (q && !(String(node.ev.type).toLowerCase().indexOf(q) >= 0 || String(node.brief || '').toLowerCase().indexOf(q) >= 0 || String(role).toLowerCase().indexOf(q) >= 0)) continue;
      let key;
      if (trajSort === 'turns') key = 'turn:' + (node.turn === undefined ? '?' : node.turn);
      else if (trajSort === 'calls') key = node.kind === 'tool' ? 'call:' + (node.brief || node.seq) : 'step:' + node.step;
      else key = 'step:' + (node.turn === undefined ? '?' : node.turn) + '/' + node.step;
      if (key !== lastKey) {
        rows.appendChild(trajGroupHead(trajSort === 'turns' ? t('traj.turn', { n: node.turn === undefined ? '?' : node.turn })
          : trajSort === 'calls' ? t('traj.callGroup', { k: node.kind === 'tool' ? (node.brief || '') : ('step ' + node.step) })
          : t('traj.stepHeader', { turn: node.turn === undefined ? '?' : node.turn, step: node.step === undefined ? '?' : node.step })));
        lastKey = key;
      }
      rows.appendChild(trajNodeRow(node, i));
    }
    left.appendChild(rows);
  }

  function renderTrajDetail(right) {
    right.textContent = '';
    const nodes = trajNodes();
    const node = nodes[trajSelected];
    if (!node) {
      right.appendChild(el('div', 'trajEmpty', t('traj.pickHint')));
      return;
    }
    const tabs = el('div', 'mTabs');
    [['summary', 'traj.tab.summary'], ['preview', 'traj.tab.preview'], ['raw', 'traj.tab.raw']].forEach(([v, k]) => {
      const b = el('button', 'mTab' + (trajDetailTab === v ? ' on' : ''), t(k));
      b.type = 'button';
      b.addEventListener('click', () => { trajDetailTab = v; renderTrajectory(); });
      tabs.appendChild(b);
    });
    right.appendChild(tabs);
    const body = el('div', 'trajDetailBody');
    const tok = node.usage ? (node.usage.prompt_tokens || 0) + ' in / ' + (node.usage.completion_tokens || 0) + ' out' : t('traj.na');
    if (trajDetailTab === 'summary') {
      const rows = [
        [t('traj.lane.' + node.kind), ''],
        [t('traj.time'), node.time ? clock(node.time) : t('traj.na')],
        [t('traj.dur'), node.dur !== null ? fmtDurShort(node.dur) : t('traj.na')],
        [t('traj.tokens'), tok],
      ];
      for (const [k, v] of rows) {
        const r = el('div', 'dtField');
        r.appendChild(el('div', 'k', k));
        r.appendChild(el('div', 'v', v));
        body.appendChild(r);
      }
      body.appendChild(el('div', 'hint', String(node.brief || '').slice(0, 600)));
    } else if (trajDetailTab === 'preview') {
      const p = el('div', 'thinkBody');
      p.innerHTML = linkifyPaths(mdToHtml(String(node.brief || '').slice(0, 4000)));
      body.appendChild(p);
      // thinking inside preview stays collapsed with its own chevron
      const d = ev2reasoning(node);
      if (d) body.appendChild(renderThinkBlock(d));
    } else {
      const pre = el('pre', 'rawPre');
      pre.textContent = JSON.stringify(node.ev, null, 2).slice(0, 4000);
      body.appendChild(pre);
    }
    right.appendChild(body);
  }

  function ev2reasoning(node) {
    const d = node.ev && node.ev.data;
    const chunk = d && d.chunk;
    if (chunk && chunk.type === 'reasoning-delta') return chunk.text;
    return null;
  }

  /** Live task view while running: completed above, current marked with an
   *  arrow + live elapsed seconds, upcoming below. */
  function renderTaskView(right) {
    right.textContent = '';
    right.appendChild(el('div', 'sSecTitle eyebrow', t('traj.tasks')));
    const cur = [...C.messages].reverse().find((m) => m.role === 'assistant' && m.streaming !== false);
    const blocks = (cur && cur.blocks) || [];
    const done = blocks.filter((b) => b.kind === 'toolcall' && b.result);
    const running = blocks.filter((b) => b.kind === 'toolcall' && !b.result);
    const jobs = (P.dshState && P.dshState.liveJobs && P.dshState.liveJobs[C.sessionId]) || [];
    const jobsDone = jobs.filter((j) => j.status === 'completed');
    const jobsRun = jobs.filter((j) => j.status === 'running' || j.status === 'starting');
    const jobsPending = jobs.filter((j) => j.status !== 'completed' && j.status !== 'running' && j.status !== 'starting');
    const list = el('div', 'trajTaskList');
    const mk = (label, name, cls, extra) => {
      const row = el('div', 'trajTask ' + cls);
      row.appendChild(el('span', 'trajTaskMark'));
      const meta = el('div', 'skItemMeta');
      const nl = el('div', 'skNameLine');
      nl.appendChild(el('span', 'skItemName', name));
      meta.appendChild(nl);
      if (label) meta.appendChild(el('div', 'pmeta', label));
      row.appendChild(meta);
      if (extra) row.appendChild(extra);
      list.appendChild(row);
    };
    for (const j of jobsDone) mk(t('traj.taskDoneAt', { t: j.finishedAt ? clock(j.finishedAt) : '—' }), j.name || j.id, 'done');
    for (const b of done) mk('', toolSummary(b.name, b.arguments), 'done');
    if (running.length) {
      for (const b of running) {
        const timer = el('span', 'trajTaskTimer', '0s');
        mk(t('traj.taskRunning'), toolSummary(b.name, b.arguments), 'running', timer);
      }
    }
    for (const j of jobsRun) {
      const timer = el('span', 'trajTaskTimer', '0s');
      mk(t('traj.taskRunning'), j.name || j.id, 'running', timer);
    }
    for (const j of jobsPending) mk(t('traj.taskPending'), j.name || j.id, 'pending');
    if (!done.length && !running.length && !jobs.length) {
      list.appendChild(el('div', 'hint', t('jobs.none')));
    }
    right.appendChild(list);
    // live elapsed seconds for running tasks
    if (trajTickTimer) clearInterval(trajTickTimer);
    const tick = () => {
      const timers = right.querySelectorAll('.trajTaskTimer');
      const s = C.workStartAt ? Math.round((Date.now() - C.workStartAt) / 1000) : 0;
      for (const t of timers) t.textContent = s + 's';
    };
    tick();
    trajTickTimer = setInterval(tick, 1000);
  }

  function renderTrajRight(right) {
    right.textContent = '';
    if (C.streaming || (C.workTimer)) {
      renderTaskView(right);
    } else if (trajSelected !== null) {
      renderTrajDetail(right);
    } else {
      right.appendChild(el('div', 'trajEmpty', t('traj.pickHint')));
    }
  }

  function renderTrajectory() {
    const box = $('trajView');
    if (!box) return;
    if (trajTickTimer) { clearInterval(trajTickTimer); trajTickTimer = null; }
    box.textContent = '';
    if (!C.rawEvents.length) {
      box.appendChild(el('div', 'trajEmpty', t('traj.empty')));
      return;
    }
    const grid = el('div', 'trajGrid');
    const left = el('div', 'trajLeft');
    const right = el('div', 'trajRight');
    grid.appendChild(left); grid.appendChild(right);
    box.appendChild(grid);
    renderTrajLeft(left);
    renderTrajRight(right);
  }

  // invalidate the node cache whenever raw events change
  const _origFoldEvent = foldEvent;
  foldEvent = function (ev) {
    trajNodesCache = null;
    return _origFoldEvent(ev);
  };

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
    const token = ++C.historyToken;
    C.messages = [];
    C.rawEvents = [];
    C.streaming = false;
    resetLive();
    if (P.cost) P.cost.reset();
    // Instantly clear the previous session's DOM and show a loading state —
    // the switch must feel immediate, history arrives in background frames.
    C._loading = true;
    renderFlow();
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
      // a faster switch supersedes this load — stop early
      if (token !== C.historyToken) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
    // Fold in frame-sized slices so paging/folding never janks the UI.
    let folded = 0;
    for (const evs of pages) {
      if (token !== C.historyToken) return;
      for (const it of evs) {
        foldEvent(it.event || it);
        if (++folded % 300 === 0) await new Promise((r) => requestAnimationFrame(r));
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    // The tail may end mid-step — a folded history must never leave the
    // "working" status row stuck on.
    C.activeSteps = 0;
    if (C.onStatus) { try { C.onStatus(null); } catch (e) { /* noop */ } }
    // If the tail was mid-stream, keep the composer in the streaming state.
    C._loading = false;
    renderFlow();
    // Wait for the render pass, but with a hard ceiling: the intro gate must
    // never hang on a stuck animation frame.
    await Promise.race([C.flowDone, new Promise((r) => setTimeout(r, 8000))]);
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
  C.renderTimeline = renderTrajectory;
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
