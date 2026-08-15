/**
 * PRTS GUI shell — the window over dsh. It boots the dsh connection, lists
 * dsh workspaces + sessions, renders the conversation (session events), and
 * keeps the PRTS chrome: particle intro, theme, system panel, plugin buttons,
 * voice input.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const A = P.app = {};

  const $ = (id) => document.getElementById(id);
  const appEl = () => $('app');

  /* ---------- toast ---------- */
  let toastTimer;
  A.toast = function (msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  };

  /* ---------- i18n ---------- */
  A.t = function (key, params) { return P.i18n.t(key, A.locale, params); };
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = A.t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = A.t(n.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = A.t(n.dataset.i18nTitle); });
    document.documentElement.lang = A.locale === 'zh' ? 'zh-CN' : 'en';
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (A.heroEngine) A.heroEngine.refreshInk();
    if (A.introEngine) A.introEngine.refreshInk();
  }
  A.toggleTheme = async function () {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    A.config.ui = A.config.ui || {};
    A.config.ui.theme = theme;
    await P.store.saveConfig(A.config);
  };

  /* ---------- sidebar: workspaces + sessions (dsh) ---------- */
  function renderWorkspaces() {
    const list = $('projectList');
    list.textContent = '';
    const ws = P.dshState.workspaces;
    for (const w of ws) {
      const row = document.createElement('div');
      row.className = 'sbItem' + (w.workspaceId === P.dshState.currentWorkspaceId ? ' active' : '');
      row.dataset.workspace = w.workspaceId;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = w.title || w.workspaceId;
      row.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = String(w.sessionIds ? w.sessionIds.length : 0);
      row.appendChild(meta);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rowBtn';
      del.title = A.t('common.delete');
      del.innerHTML = P.icons['ma.trash'] || '';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteWorkspace(w.workspaceId); });
      row.appendChild(del);
      row.addEventListener('click', () => selectWorkspace(w.workspaceId));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectWorkspace(w.workspaceId); } });
      list.appendChild(row);
    }
    $('projectCount').textContent = String(ws.length);
  }

  function renderSessions() {
    const list = $('sessionList');
    list.textContent = '';
    const ss = P.dshState.sessions;
    for (const s of ss) {
      const row = document.createElement('div');
      row.className = 'sbItem' + (s.sessionId === P.dshState.currentSessionId ? ' active' : '');
      row.dataset.session = s.sessionId;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.title || s.sessionId.slice(0, 8);
      if (s.running) name.textContent += ' …';
      row.appendChild(name);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rowBtn';
      del.title = A.t('session.archive');
      del.innerHTML = P.icons['ma.trash'] || '';
      del.addEventListener('click', (e) => { e.stopPropagation(); archiveSession(s.sessionId); });
      row.appendChild(del);
      row.addEventListener('click', () => selectSession(s.sessionId));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSession(s.sessionId); } });
      list.appendChild(row);
    }
    $('sessionCount').textContent = String(ss.length);
  }

  async function selectWorkspace(id) {
    P.dshState.currentWorkspaceId = id;
    await refreshSessions();
    renderWorkspaces();
    updateCrumb();
  }

  async function refreshSessions() {
    await P.dshState.listSessions();
    renderSessions();
  }

  async function selectSession(id) {
    P.dshState.currentSessionId = id;
    A.enterChat();
    await P.chat.loadHistory(id);
    renderSessions();
    updateCrumb();
  }

  async function newSession() {
    const wsId = P.dshState.currentWorkspaceId;
    const id = await P.dshState.createSession(wsId);
    if (id) await selectSession(id);
  }

  async function archiveSession(id) {
    if (!confirm(A.t('session.confirmArchive'))) return;
    await P.dshState.archiveSession(id);
    await refreshSessions();
    if (P.dshState.currentSessionId === id) {
      P.dshState.currentSessionId = null;
      P.chat.messages = [];
      P.chat.renderFlow();
    }
  }

  async function deleteWorkspace(id) {
    if (!confirm(A.t('workspace.confirmDelete'))) return;
    await P.dshState.deleteWorkspace(id);
    await refreshAll();
  }

  async function newWorkspace() {
    const path = prompt(A.t('workspace.pathPrompt'));
    if (!path || !path.trim()) return;
    try {
      await P.dshState.createWorkspace(path.trim());
      await refreshAll();
    } catch (e) {
      A.toast(e.message);
    }
  }

  async function refreshAll() {
    await P.dshState.refreshAll();
    if (!P.dshState.currentWorkspaceId && P.dshState.workspaces.length) {
      P.dshState.currentWorkspaceId = P.dshState.workspaces[0].workspaceId;
    }
    renderWorkspaces();
    renderSessions();
    updateModelChip();
    updateCrumb();
  }

  /* ---------- model chip (dsh model selection) ---------- */
  function currentModel() {
    const g = P.dshState.models;
    if (!g || !g.length) return null;
    const grp = g[0];
    return (grp.models && grp.models[0]) ? { group: grp, model: grp.models[0] } : null;
  }

  function updateModelChip() {
    const m = currentModel();
    const label = $('modelChipLabel');
    if (label) label.textContent = m ? m.model.id : '—';
  }

  function buildModelPop() {
    const items = [];
    for (const grp of P.dshState.models) {
      for (const m of (grp.models || [])) {
        items.push('<div class="popItem" data-provider="' + grp.id + '" data-model="' + m.id + '"><span class="label">' + m.id + '</span><span class="tick">&#10003;</span></div>');
      }
    }
    return items.join('') || '<div class="popMeta">' + A.t('model.refreshFail') + '</div>';
  }

  function openSettings() {
    $('cfgLocale').value = A.config.locale || 'auto';
    $('settingsOverlay').classList.add('open');
    renderProviders();
  }
  function closeSettings() { $('settingsOverlay').classList.remove('open'); }

  /** Provider -> credential ref, by the dsh convention (e.g. deepseek -> DEEPSEEK_API_KEY). */
  function providerRef(provider) {
    const base = String(provider || '').replace(/^llm-/, '').toUpperCase().replace(/-/g, '_');
    return base + '_API_KEY';
  }

  async function renderProviders() {
    const box = $('cfgProviders');
    box.textContent = '';
    await P.dshState.listProviders();
    const providers = P.dshState.providers;
    if (!providers || !providers.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: A.t('settings.providers.empty') }));
      return;
    }
    const refs = providers.map((p) => providerRef(p.provider));
    let creds = {};
    try { creds = await P.dshState.credentialsDescribe(refs); } catch (e) { /* ignore */ }
    for (const p of providers) {
      const ref = providerRef(p.provider);
      const row = document.createElement('div');
      row.className = 'projectRow';
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.displayName || p.provider;
      const state = document.createElement('span');
      state.className = 'pmeta';
      const c = creds[ref];
      state.textContent = c && c.configured ? A.t('settings.provider.set') : A.t('settings.provider.unset');
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'sInput';
      input.placeholder = ref;
      input.style.width = '180px';
      input.style.height = '26px';
      input.autocomplete = 'off';
      const save = document.createElement('button');
      save.className = 'sBtn';
      save.textContent = A.t('settings.provider.save');
      save.style.height = '26px';
      save.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;
        try {
          await P.dshState.credentialsSet(ref, value);
          state.textContent = A.t('settings.provider.set');
          input.value = '';
          A.toast(A.t('settings.provider.saved', { ref }));
        } catch (e) { A.toast(e.message); }
      });
      row.appendChild(name); row.appendChild(state); row.appendChild(input); row.appendChild(save);
      box.appendChild(row);
    }
  }

  /* ---------- header / crumbs ---------- */
  function updateCrumb() {
    const ws = P.dshState.workspaces.find((w) => w.workspaceId === P.dshState.currentWorkspaceId);
    $('crumbProject').textContent = ws ? (ws.title || ws.workspaceId) : 'dsh';
    $('workspaceLabel').textContent = ws ? (ws.title || ws.workspaceId) : 'dsh';
  }

  /* ---------- phase switch ---------- */
  A.enterChat = function () {
    A.heroVisible = false;
    const cvt = $('cvt');
    cvt.dataset.phase = 'active';
    $('header').hidden = false;
    $('heroView').hidden = true;
    $('chatScroll').hidden = false;
    if (A.heroEngine) A.heroEngine.stop();
  };

  /* ---------- details panel ---------- */
  A.showDetails = function (msg) {
    openDetails();
    const body = $('dtBody');
    body.textContent = '';
    const fields = [
      ['role', msg.role],
      ['model', msg.model || '—'],
      ['created', P.chat.fmtDate(msg.ts)],
    ];
    if (msg.usage) fields.push(['tokens', 'in ' + (msg.usage.prompt_tokens || 0) + ' · out ' + (msg.usage.completion_tokens || 0)]);
    for (const [k, v] of fields) {
      const f = document.createElement('div');
      f.className = 'dtField';
      const kk = document.createElement('div');
      kk.className = 'k';
      kk.textContent = A.t('details.' + k);
      const vv = document.createElement('div');
      vv.className = 'v';
      vv.textContent = String(v);
      f.appendChild(kk); f.appendChild(vv);
      body.appendChild(f);
    }
  };

  function openDetails() {
    appEl().removeAttribute('data-details-collapsed');
    appEl().style.setProperty('--dsh-dt', A.dtWidth + 'px');
    placeHandles();
  }
  function closeDetails() {
    appEl().setAttribute('data-details-collapsed', '');
    appEl().style.setProperty('--dsh-dt', '0px');
    placeHandles();
  }

  /* ---------- drag handles ---------- */
  const A_ = { sbWidth: 272, dtWidth: 360 };
  A.dtWidth = A_.dtWidth;
  function placeHandles() {
    const r = appEl().getBoundingClientRect();
    $('handleSidebar').style.left = (A_.sbWidth - 4) + 'px';
    $('handleDetails').style.left = (r.width - A_.dtWidth - 4) + 'px';
    $('handleDetails').style.display = appEl().hasAttribute('data-details-collapsed') ? 'none' : '';
  }
  function attachDrag(handle, onDrag) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => { const x = ev.clientX - appEl().getBoundingClientRect().left; onDrag(x); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
  function bindDrag() {
    attachDrag($('handleSidebar'), (x) => {
      A_.sbWidth = Math.min(420, Math.max(240, x));
      appEl().style.setProperty('--dsh-sb', A_.sbWidth + 'px');
      $('handleSidebar').style.left = (A_.sbWidth - 4) + 'px';
    });
    attachDrag($('handleDetails'), (x) => {
      const r = appEl().getBoundingClientRect();
      A_.dtWidth = Math.min(560, Math.max(320, r.width - x));
      appEl().style.setProperty('--dsh-dt', A_.dtWidth + 'px');
      $('handleDetails').style.left = (r.width - A_.dtWidth - 4) + 'px';
    });
  }

  /* ---------- popovers ---------- */
  let openPop = null;
  function closePops() { if (openPop) { openPop.classList.remove('open'); openPop = null; } }
  function attachPop(trigger, itemsHtml, onPick, alignRight) {
    const pop = document.createElement('div');
    pop.className = 'pop';
    if (trigger.id === 'workspaceBtn') pop.id = 'wsPop';
    if (alignRight) { pop.style.left = 'auto'; pop.style.right = '0'; }
    pop.innerHTML = itemsHtml;
    trigger.appendChild(pop);
    pop.addEventListener('click', (e) => {
      const item = e.target.closest('.popItem');
      if (item && onPick) onPick(item);
    });
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (openPop === pop) { closePops(); return; }
      closePops();
      pop.classList.add('open');
      openPop = pop;
    });
    return pop;
  }

  function bindPopovers() {
    const modelPop = attachPop($('modelChip'), buildModelPop(), async (item) => {
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      const provider = item.dataset.provider, model = item.dataset.model;
      try {
        await P.dshState.selectModel(P.dshState.currentSessionId, provider, model);
        updateModelChip();
      } catch (e) { A.toast(e.message); }
    });
    A.modelPop = modelPop;
    A.refreshModelPop = () => { modelPop.innerHTML = buildModelPop(); };

    attachPop($('workspaceBtn'),
      '<div class="popItem" data-value="__add"><span class="label">' + A.t('workspace.add') + '</span></div>' +
      P.dshState.workspaces.map((w) => '<div class="popItem" data-value="' + w.workspaceId + '"><span class="label">' + (w.title || w.workspaceId) + '</span><span class="tick">&#10003;</span></div>').join(''),
      async (item) => {
        if (item.dataset.value === '__add') { await newWorkspace(); return; }
        await selectWorkspace(item.dataset.value);
      });
  }

  /* ---------- particles: intro + hero ---------- */
  function runIntro() {
    const cv = $('introCanvas');
    A.introEngine = P.particles.create(cv, { count: 10000, speedRange: [0.02, 0.05] });
    A.introEngine.start();
    const tag = $('introTag');
    tag.textContent = A.t('intro.welcome');
    const finish = () => {
      $('intro').classList.add('done');
      setTimeout(() => { $('intro').style.display = 'none'; A.introEngine.stop(); }, 800);
      startHeroAmbient();
    };
    let done = false;
    const skip = () => { if (done) return; done = true; finish(); };
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    setTimeout(() => { A.introEngine.showIntro(9000); tag.classList.add('show'); }, 700);
    setTimeout(() => { A.introEngine.showPp(10000); tag.classList.remove('show'); }, 4400);
    setTimeout(() => { A.introEngine.showMark(1.05, 9000); }, 8000);
    setTimeout(skip, 12200);
  }

  function startHeroAmbient() {
    const cv = $('heroCanvas');
    A.heroEngine = P.particles.create(cv, { count: 1600, speedRange: [0.006, 0.02] });
    A.heroEngine.start();
    A.heroEngine.scatter();
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      A.heroEngine.onMouse(e.clientX - r.left, e.clientY - r.top);
    });
    cv.addEventListener('pointerleave', () => A.heroEngine.clearMouse());
  }

  /* ---------- voice input ---------- */
  A.voiceOn = false;
  function drawBrandFx(frame) {
    const cv = $('brandFx');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const on = A.voiceOn;
    cv.classList.toggle('on', on);
    cv.classList.toggle('speaking', on && frame.speaking);
    if (!on) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--prts-ink').trim() || '#FAFAFA';
    const bars = (frame.bars && frame.bars.length) ? frame.bars : new Array(14).fill(0);
    const n = 14, w = cv.width, h = cv.height, bw = w / n;
    ctx.fillStyle = ink;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.03, bars[i] * (frame.speaking ? 1 : 0.34));
      const bh = Math.max(1, v * (h - 3));
      ctx.globalAlpha = frame.speaking ? 0.45 + 0.55 * bars[i] : 0.4;
      ctx.fillRect(i * bw + bw * 0.22, (h - bh) / 2, bw * 0.55, bh);
    }
    ctx.globalAlpha = 1;
  }
  function bindVoice() {
    const btn = $('voiceBtn');
    btn.addEventListener('click', async () => {
      if (A.voiceOn) {
        P.asr.stop();
        A.voiceOn = false;
        btn.classList.remove('on', 'recognizing');
        return;
      }
      const ok = await P.asr.start();
      if (ok !== 'ok') { A.toast(A.t('voice.unsupported')); return; }
      A.voiceOn = true;
      btn.classList.add('on');
    });
    P.asr.onFrame((frame) => {
      btn.classList.toggle('recognizing', A.voiceOn && frame.state === 'recognizing');
      drawBrandFx(frame);
    });
    P.asr.onResult((text) => {
      const input = $('composerInput');
      if (!input) return;
      if (input.value) input.value += ' ';
      input.value += text;
      P.chat.updateSend();
      P.chat.scrollInputBottom();
    });
  }

  /* ---------- community plugins ---------- */
  function renderPlugins() {
    for (const area of ['composer', 'header']) {
      const host = area === 'composer' ? $('pluginComposer') : $('pluginHeader');
      host.textContent = '';
      const items = P.plugins.list(area);
      for (const pl of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pluginBtn';
        btn.title = pl.label || pl.id;
        if (pl.icon) btn.innerHTML = pl.icon;
        else btn.textContent = String(pl.label || pl.id).slice(0, 1).toUpperCase();
        btn.addEventListener('click', () => {
          try { pl.onClick && pl.onClick({ app: P.app, config: A.config, store: P.store, chat: P.chat }); }
          catch (err) { A.toast(String(err && err.message || err)); }
        });
        host.appendChild(btn);
      }
    }
  }

  /* ---------- boot ---------- */
  async function boot() {
    A.config = await P.store.loadConfig();
    A.locale = A.config.locale === 'auto' ? P.platform.detectLocale() : A.config.locale;
    applyTheme(A.config.ui && A.config.ui.theme === 'light' ? 'light' : 'dark');
    applyI18n();
    A.heroVisible = true;

    bindDrag();
    bindPopovers();
    bindVoice();
    if (P.plugins) { P.plugins.onChange(renderPlugins); P.plugins.adoptSeeded(); renderPlugins(); }
    if (P.system && P.system.bind) P.system.bind();

    $('themeBtn').addEventListener('click', A.toggleTheme);
    $('clearHistoryBtn').addEventListener('click', async () => {
      if (!confirm(A.t('session.confirmArchive'))) return;
      if (P.dshState.currentSessionId) await P.dshState.archiveSession(P.dshState.currentSessionId);
      await newSession();
    });
    $('newProjectBtn').addEventListener('click', newWorkspace);
    $('newSessionBtn').addEventListener('click', newSession);
    $('detailsBtn').addEventListener('click', () => {
      if (appEl().hasAttribute('data-details-collapsed')) openDetails();
      else closeDetails();
    });
    $('dtClose').addEventListener('click', closeDetails);
    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsClose').addEventListener('click', closeSettings);
    $('cfgSave').addEventListener('click', async () => {
      A.config.locale = $('cfgLocale').value;
      await P.store.saveConfig(A.config);
      A.locale = A.config.locale === 'auto' ? P.platform.detectLocale() : A.config.locale;
      applyI18n();
      closeSettings();
      A.toast(A.t('settings.saved'));
    });
    $('flow').addEventListener('click', (e) => {
      const item = e.target.closest('.assistantItem') || e.target.closest('.userBubble');
      if (item) {
        const id = item.closest('.assistantItem') ? item.closest('.assistantItem').dataset.msg : null;
        const msg = id ? P.chat.messages.find((m) => m.id === id) : P.chat.messages.filter((m) => m.role === 'user').pop();
        if (msg) A.showDetails(msg);
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chip') && !e.target.closest('.meterBtn') && !e.target.closest('.workspaceBtn')) closePops();
      if (e.target === $('settingsOverlay')) closeSettings();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePops(); closeSettings(); if (P.system && P.system.open) P.system.close(); }
    });
    window.addEventListener('resize', () => {
      placeHandles();
      if (A.introEngine) A.introEngine.resize();
      if (A.heroEngine) A.heroEngine.resize();
    });

    P.chat.init();

    // Connect to dsh and mirror its state (re-populate whenever it comes up).
    P.dsh.on('connect', () => { refreshAll().catch(() => { /* dsh may still be warming up */ }); });
    try {
      await P.dshState.connect();
      await refreshAll();
    } catch (e) {
      A.toast(A.t('dsh.connectFail', { msg: e.message }));
    }

    updateCrumb();
    placeHandles();
    runIntro();
  }

  A.updateCrumb = updateCrumb;
  A.renderWorkspaces = renderWorkspaces;
  A.renderSessions = renderSessions;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
