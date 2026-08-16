/**
 * PRTS system panel — hardware + agent telemetry overlay opened from the
 * brand mark. Left: a slow-rotating, flat composed-circle (few, long, rounded
 * arc segments — Arknights-style). Right: centered stat cards for hardware
 * (OS/CPU/GPU/RAM/swap/disk/power/temps) and the agent (model, mode, token
 * usage). Live metrics ease toward their targets at 30fps so the numbers and
 * bars flow like water instead of jumping.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = P.system = { open: false };

  const TICK_MS = 1000 / 30;     // 30 fps
  const SNAPSHOT_MS = 1500;       // hardware/agent snapshot cadence
  const SMOOTH = 0.12;            // per-tick easing toward target
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = 0;
  let lastTick = 0;
  let snapshotTimer = null;
  let ringCanvas = null;
  let ringCtx = null;

  // Latest raw snapshot and the eased display copy; `refs` holds live DOM
  // value spans + bar fills.
  let targets = {};
  let disp = {};
  let refs = {};
  let built = false;

  const $ = (id) => document.getElementById(id);
  const t = (key, params) => (P.app && P.app.t ? P.app.t(key, params) : key);

  /* ---------- formatting ---------- */
  function fmtBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return t('sys.unknown');
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function fmt1(n) {
    return n === null || n === undefined || isNaN(n) ? t('sys.unknown') : n.toFixed(1);
  }
  function fmt0(n) {
    return n === null || n === undefined || isNaN(n) ? t('sys.unknown') : String(Math.round(n));
  }
  function shortCpu(model) {
    if (!model) return t('sys.unknown');
    const s = String(model).replace(/\(R\)|\(TM\)|CPU|Processor/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 30 ? s.slice(0, 29) + '…' : s;
  }

  /* ---------- composed-circle renderer ---------- */
  function drawRing() {
    if (!ringCtx || !ringCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = ringCanvas.clientWidth;
    if (size <= 0) return;
    if (ringCanvas.width !== size * dpr) {
      ringCanvas.width = size * dpr;
      ringCanvas.height = size * dpr;
    }
    const ctx = ringCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--prts-ink').trim() || '#FAFAFA';
    // ~3°/s — slow, deliberate.
    const rot = performance.now() / 1000 * (Math.PI / 60);

    function segments(radius, count, span, width, opacity, offset) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot + offset);
      ctx.strokeStyle = ink;
      ctx.globalAlpha = opacity;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      const gap = (Math.PI * 2 - span * count) / count;
      for (let i = 0; i < count; i++) {
        const a0 = i * (span + gap) + gap / 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, a0, a0 + span);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Few, long, well-spaced arcs with staggered phases — rounder, calmer,
    // interleaved so no ring's gap lines up with another's.
    segments(size * 0.44, 6, 0.72, Math.max(2, size * 0.016), 0.72, 0);
    segments(size * 0.35, 4, 0.9, Math.max(1.6, size * 0.012), 0.5, 0.62);
    segments(size * 0.27, 3, 1.1, Math.max(1.4, size * 0.010), 0.34, 1.25);
    segments(size * 0.20, 2, 1.4, Math.max(1.6, size * 0.012), 0.55, 2.0);
  }

  /* ---------- stat rows (fastfetch/btop style) ---------- */
  function barEl() {
    const wrap = document.createElement('div');
    wrap.className = 'sysBar';
    const fill = document.createElement('div');
    fill.className = 'sysBarFill';
    wrap.appendChild(fill);
    return { wrap, fill };
  }

  function valueSpan(text) {
    const s = document.createElement('span');
    s.className = 'sysVal';
    s.textContent = text;
    return s;
  }

  function addRow(box, key, label, hasBar) {
    const row = document.createElement('div');
    row.className = 'sysRow';
    const k = document.createElement('div');
    k.className = 'sysK';
    k.textContent = label;
    const v = document.createElement('div');
    v.className = 'sysV';
    const val = valueSpan(t('sys.unknown'));
    v.appendChild(val);
    row.appendChild(k); row.appendChild(v);
    let b = null;
    if (hasBar) { b = barEl(); row.appendChild(b.wrap); }
    box.appendChild(row);
    refs[key] = { val, bar: b };
  }

  function buildHardware() {
    const box = $('sysHardware');
    box.textContent = '';
    refs = {};
    const add = (key, label, hasBar) => addRow(box, key, label, hasBar);
    add('os', t('sys.os'), false);
    add('host', t('sys.host'), false);
    add('cpu', t('sys.cpu'), false);
    add('cpuLoad', t('sys.load'), true);
    add('cpuPower', t('sys.cpuPower'), false);
    add('gpu', t('sys.gpu'), false);
    add('mem', t('sys.memory'), true);
    add('swap', t('sys.swap'), true);
    add('disk', t('sys.disk'), true);
    add('temps', t('sys.temps'), false);
  }

  function buildAgent() {
    const box = $('sysAgent');
    box.textContent = '';
    const add = (key, label, hasBar) => addRow(box, key, label, hasBar);
    add('model', t('sys.model'), false);
    add('mode', t('sys.mode'), false);
    add('tokIn', t('sys.tokensIn'), true);
    add('tokOut', t('sys.tokensOut'), true);
    add('sessions', t('sys.sessions'), false);
    add('messages', t('sys.messages'), false);
    add('updated', t('sys.updated'), false);
  }

  /* ---------- snapshot ---------- */
  function agentSnapshot() {
    const msgs = (P.chat && P.chat.messages) || [];
    const sessions = (P.dshState && P.dshState.sessions) || [];
    const model = (P.dshState && P.dshState.models && P.dshState.models.length)
      ? ((P.dshState.models[0].models && P.dshState.models[0].models[0]) ? P.dshState.models[0].models[0].id : t('sys.unknown'))
      : t('sys.unknown');
    let usedIn = 0, usedOut = 0;
    for (const m of msgs) {
      if (m.usage) {
        usedIn += m.usage.prompt_tokens || 0;
        usedOut += m.usage.completion_tokens || 0;
      }
    }
    const used = usedIn + usedOut;
    return {
      model, usedIn, usedOut, used,
      sessions: Math.max(1, sessions.length), messages: msgs.length,
    };
  }

  function buildTargets(info, agent) {
    const mem = (info && info.memory) || null;
    const swap = (info && info.swap) || null;
    const disk = (info && info.disk) || null;
    const cpu = (info && info.cpu) || null;
    const gpu = (info && info.gpu) || null;
    const loadPct = cpu && cpu.cores && cpu.load ? Math.min(100, (cpu.load[0] / cpu.cores) * 100) : null;
    const temps = {};
    if (info && info.temps) {
      for (const z of info.temps) temps[z.type] = z.temp;
    }
    return {
      os: info && info.os ? (info.os.type + ' ' + (info.os.release || '')) : t('sys.unknown'),
      host: (info && info.host) || t('sys.unknown'),
      cpu: cpu ? (shortCpu(cpu.model) + ' · ' + cpu.cores + 'C') : t('sys.unknown'),
      gpu: gpu && gpu.name ? gpu.name + (gpu.tempC ? ' · ' + fmt0(gpu.tempC) + '°C' : '') : t('sys.none'),
      memPct: mem ? mem.pct : null,
      memUsed: mem ? mem.used : null,
      memTotal: mem ? mem.total : null,
      swapPct: swap && swap.total ? Math.round(((swap.total - swap.free) / swap.total) * 100) : null,
      swapUsed: swap && swap.total ? swap.total - swap.free : null,
      swapTotal: swap ? swap.total : null,
      diskPct: disk ? disk.pct : null,
      diskUsed: disk ? disk.used : null,
      diskTotal: disk ? disk.total : null,
      cpuLoad: loadPct,
      cpuPower: info ? info.cpuPowerW : null,
      temps,
      model: agent.model,
      mode: (P.app && P.app.currentPreset) ? String(P.app.currentPreset) : t('sys.unknown'),
      tokUsed: agent.used,
      tokUsedIn: agent.usedIn,
      tokUsedOut: agent.usedOut,
      tokLeft: 0,
      tokBudget: 0,
      sessions: String(agent.sessions),
      messages: String(agent.messages),
      now: new Date().toLocaleTimeString(),
    };
  }

  async function refreshSnapshot() {
    let info = null;
    try { info = await P.io.systemInfo(); } catch (e) { info = null; }
    const agent = agentSnapshot();
    targets = buildTargets(info, agent);
    if (!built) {
      buildHardware();
      buildAgent();
      built = true;
      seedDisplay();
    }
    paintStatic();
  }

  function seedDisplay() {
    const keys = ['memPct', 'memUsed', 'swapPct', 'swapUsed', 'diskPct', 'diskUsed',
      'cpuLoad', 'cpuPower', 'gpuUsage', 'tokUsed'];
    disp = {};
    for (const k of keys) disp[k] = targets[k] === null || targets[k] === undefined ? 0 : targets[k];
    disp.temps = {};
    for (const key in targets.temps) disp.temps[key] = targets.temps[key];
  }

  function easeDisplay() {
    const keys = ['memPct', 'memUsed', 'swapPct', 'swapUsed', 'diskPct', 'diskUsed',
      'cpuLoad', 'cpuPower', 'gpuUsage', 'tokUsed'];
    for (const k of keys) {
      const tgt = targets[k];
      if (tgt === null || tgt === undefined) continue;
      disp[k] += (tgt - disp[k]) * (reducedMotion ? 1 : SMOOTH);
    }
    for (const key in targets.temps) {
      if (disp.temps[key] === undefined) disp.temps[key] = targets.temps[key];
      else disp.temps[key] += (targets.temps[key] - disp.temps[key]) * (reducedMotion ? 1 : SMOOTH);
    }
  }

  function paintStatic() {
    const byKey = { os: targets.os, host: targets.host, cpu: targets.cpu, gpu: targets.gpu,
      model: targets.model, mode: targets.mode, sessions: targets.sessions, messages: targets.messages };
    for (const k in byKey) {
      if (refs[k] && refs[k].val) refs[k].val.textContent = byKey[k];
    }
  }

  function paintDynamic() {
    const R = refs;
    const set = (key, text, pct) => {
      const r = R[key];
      if (!r) return;
      if (r.val) r.val.textContent = text;
      if (r.bar && pct !== null && pct !== undefined) r.bar.fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    };

    if (targets.memTotal) set('mem', fmtBytes(disp.memUsed) + ' / ' + fmtBytes(targets.memTotal), disp.memPct);
    if (targets.swapTotal) set('swap', fmtBytes(disp.swapUsed) + ' / ' + fmtBytes(targets.swapTotal), disp.swapPct);
    if (targets.diskTotal) set('disk', fmtBytes(disp.diskUsed) + ' / ' + fmtBytes(targets.diskTotal), disp.diskPct);
    set('cpuLoad', fmt0(disp.cpuLoad) + '%', disp.cpuLoad);
    set('cpuPower', fmt1(disp.cpuPower) + ' W');
    const tokTotal = Math.max(1, targets.tokUsedIn + targets.tokUsedOut);
    set('tokIn', fmt0(targets.tokUsedIn), (targets.tokUsedIn / tokTotal) * 100);
    set('tokOut', fmt0(targets.tokUsedOut), (targets.tokUsedOut / tokTotal) * 100);

    const tempNames = Object.keys(targets.temps);
    if (tempNames.length && R.temps && R.temps.val) {
      R.temps.val.textContent = tempNames.map((name) => name + ' ' + fmt1(disp.temps[name]) + '°C').join('  ');
    }
    if (R.updated && R.updated.val) R.updated.val.textContent = t('sys.updated', { t: targets.now });
  }

  /* ---------- 3D logo: tilts toward the cursor, keeps rolling ---------- */
  let logoImg = null;
  let tiltX = 0, tiltY = 0, curX = 0, curY = 0;
  async function loadLogo() {
    const vis = $('sysVisual');
    if (!vis) return;
    let src = '';
    try {
      const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
      if (b && b.prtsLogo) src = 'data:image/png;base64,' + (await b.prtsLogo());
      else {
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
        const res = await fetch(origin + '/prts/api/logo');
        const data = await res.json();
        if (data && data.b64) src = 'data:image/png;base64,' + data.b64;
      }
    } catch (e) { src = ''; }
    if (src) {
      if (!logoImg) {
        logoImg = document.createElement('img');
        logoImg.className = 'sys3d';
        vis.appendChild(logoImg);
      }
      logoImg.src = src;
    }
  }
  function bindTilt() {
    const vis = $('sysVisual');
    if (!vis || vis._tiltBound) return;
    vis._tiltBound = true;
    vis.addEventListener('pointermove', (e) => {
      const r = vis.getBoundingClientRect();
      tiltX = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
      tiltY = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
    });
    vis.addEventListener('pointerleave', () => { tiltX = 0; tiltY = 0; });
  }
  function drawLogo3D(ts) {
    if (!logoImg) return;
    curX += (tiltX - curX) * 0.08;
    curY += (tiltY - curY) * 0.08;
    const roll = ts / 1000 * 0.35;
    logoImg.style.transform = 'rotateY(' + (roll + curX * 0.9).toFixed(4) + 'rad) rotateX(' + (-curY * 0.7).toFixed(4) + 'rad)';
  }

  /* ---------- 30fps loop ---------- */
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    if (ts - lastTick < TICK_MS) return;
    lastTick = ts;
    if (built) {
      easeDisplay();
      paintDynamic();
    }
    if (logoImg) drawLogo3D(ts);
    else drawRing();
  }

  function startPanel() {
    ringCanvas = $('sysRing');
    if (ringCanvas) ringCtx = ringCanvas.getContext('2d');
    if (reducedMotion) drawRing();
    loadLogo();
    bindTilt();
    lastTick = 0;
    raf = requestAnimationFrame(loop);
    refreshSnapshot();
    snapshotTimer = setInterval(refreshSnapshot, SNAPSHOT_MS);
  }
  function stopPanel() {
    cancelAnimationFrame(raf);
    if (snapshotTimer) { clearInterval(snapshotTimer); snapshotTimer = null; }
  }

  /* ---------- open / close ---------- */
  function open() {
    S.open = true;
    $('sysOverlay').classList.add('open');
    built = false;
    targets = {}; disp = {};
    startPanel();
  }
  function close() {
    S.open = false;
    $('sysOverlay').classList.remove('open');
    stopPanel();
  }

  function bind() {
    $('brandBtn').addEventListener('click', () => open());
    $('sysClose').addEventListener('click', close);
    $('sysOverlay').addEventListener('click', (e) => { if (e.target === $('sysOverlay')) close(); });
  }

  S.open = open;
  S.close = close;
  S.toggle = function () { (S.open ? close() : open()); };
  S.bind = bind;
  S.refresh = refreshSnapshot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
