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
    P.dshState.selectedModel = null;
    A.enterChat();
    await P.chat.loadHistory(id);
    renderSessions();
    updateModelChip();
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
    await loadCredentialState();
    if (!P.dshState.currentWorkspaceId && P.dshState.workspaces.length) {
      P.dshState.currentWorkspaceId = P.dshState.workspaces[0].workspaceId;
    }
    renderWorkspaces();
    renderSessions();
    updateModelChip();
    if (A.refreshModelPop) A.refreshModelPop();
    if (A.refreshModePop) A.refreshModePop();
    if (A.refreshWorkspacePop) A.refreshWorkspacePop();
    updateCrumb();
  }

  /* ---------- model chip (dsh provider + model selection) ---------- */
  function currentModel() {
    const g = P.dshState.models;
    if (!g || !g.length) return null;
    const grp = g[0];
    return (grp.models && grp.models[0]) ? { group: grp, model: grp.models[0] } : null;
  }

  function updateModelChip() {
    const label = $('modelChipLabel');
    if (!label) return;
    if (P.dshState.selectedModel && P.dshState.selectedModel.model) {
      label.textContent = P.dshState.selectedModel.model;
      return;
    }
    const m = currentModel();
    label.textContent = m ? m.model.id : '—';
  }

  // Make sure a session is open so the composer, model switch and mode switch
  // all work immediately. Selects the first workspace, then the most recent
  // session, and creates a blank one when none exists.
  A.ensureSession = async function () {
    if (P.dshState.currentSessionId) return P.dshState.currentSessionId;
    if (!P.dshState.currentWorkspaceId && P.dshState.workspaces.length) {
      P.dshState.currentWorkspaceId = P.dshState.workspaces[0].workspaceId;
    }
    if (P.dshState.sessions.length) {
      await selectSession(P.dshState.sessions[0].sessionId);
      return P.dshState.currentSessionId;
    }
    const id = await P.dshState.createSession(P.dshState.currentWorkspaceId || undefined);
    if (!id) return null;
    await selectSession(id);
    await refreshSessions();
    return id;
  };

  /** Provider -> credential ref, by the dsh convention (e.g. deepseek -> DEEPSEEK_API_KEY). */
  function providerRef(provider) {
    const base = String(provider || '').replace(/^llm-/, '').toUpperCase().replace(/-/g, '_');
    return base + '_API_KEY';
  }

  // Credential state by provider: { provider -> { ref, configured } }.
  A.credentialState = {};
  async function loadCredentialState() {
    const providers = P.dshState.providers || [];
    const refs = providers.map((p) => providerRef(p.provider));
    let creds = {};
    try { creds = await P.dshState.credentialsDescribe(refs); } catch (e) { /* noop */ }
    const map = {};
    for (const p of providers) {
      const ref = providerRef(p.provider);
      map[p.provider] = { ref, configured: !!(creds[ref] && creds[ref].configured) };
    }
    A.credentialState = map;
    return map;
  }

  // Only providers whose API key is configured are usable in the composer.
  function configuredProviders() {
    return (P.dshState.providers || []).filter((p) => A.credentialState[p.provider] && A.credentialState[p.provider].configured);
  }

  let currentModelProvider = null;

  async function pickProvider(provider) {
    currentModelProvider = provider;
    renderModelsPicker();
  }

  function renderModelsPicker() {
    const box = A.modelPop;
    const grp = P.dshState.models.find((g) => g.id === currentModelProvider);
    if (!grp || !grp.models || !grp.models.length) {
      box.innerHTML = '<div class="popItem" data-back="1"><span class="label">← ' + A.t('model.back') + '</span></div><div class="popMeta">' + A.t('model.none') + '</div>';
      return;
    }
    box.innerHTML =
      '<div class="popItem" data-back="1"><span class="label">← ' + A.t('model.back') + '</span></div>' +
      grp.models.map((m) => '<div class="popItem" data-model="' + m.id + '"><span class="label">' + m.id + '</span><span class="tick">&#10003;</span></div>').join('');
  }

  function buildModelPop() {
    if (currentModelProvider) return '<div class="popMeta">' + currentModelProvider + '</div>';
    const avail = configuredProviders();
    if (!avail.length) {
      return '<div class="popItem" data-settings="1"><span class="label">' + A.t('model.noConfiguredKey') + '</span></div>';
    }
    return avail.map((p) => '<div class="popItem" data-provider="' + p.provider + '"><span class="label">' + (p.displayName || p.provider) + '</span></div>').join('');
  }

  /* ---------- settings overlay (Language / Model config / Plugins / Version) ---------- */
  async function openSettings() {
    $('cfgLocale').value = A.config.locale || 'auto';
    $('settingsOverlay').classList.add('open');
    renderModelConfig();
    renderPlugins();
    renderVersion();
  }
  function closeSettings() { $('settingsOverlay').classList.remove('open'); }

  // opencode-style: a flat list of providers; expand one to edit its API key
  // and see its models. The key is written to dsh's own credential store.
  async function renderModelConfig() {
    const box = $('cfgProviders');
    box.textContent = '';
    await P.dshState.listProviders();
    await P.dshState.listModels();
    await loadCredentialState();
    const providers = P.dshState.providers;
    if (!providers || !providers.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: A.t('settings.providers.empty') }));
      return;
    }
    for (const p of providers) {
      const ref = providerRef(p.provider);
      const configured = A.credentialState[p.provider] && A.credentialState[p.provider].configured;

      const card = document.createElement('div');
      card.className = 'pCard';

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'pCardHead';
      head.innerHTML =
        '<span class="pName">' + (p.displayName || p.provider) + '</span>' +
        '<span class="pState" data-state="' + (configured ? 'ok' : 'none') + '">' + (configured ? A.t('settings.provider.set') : A.t('settings.provider.unset')) + '</span>' +
        '<svg class="chev" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.7 4.2a.6.6 0 0 1 .9 0L6 6.7l2.4-2.5a.6.6 0 1 1 .9.9l-2.9 3a.6.6 0 0 1-.9 0l-2.9-3a.6.6 0 0 1 0-.9Z" fill="currentColor"/></svg>';

      const body = document.createElement('div');
      body.className = 'pCardBody';

      const keyRow = document.createElement('div');
      keyRow.className = 'inlineForm';
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'sInput';
      input.placeholder = ref;
      input.autocomplete = 'off';
      input.spellcheck = false;
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'sBtn';
      save.textContent = A.t('settings.provider.save');
      save.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;
        try {
          await P.dshState.credentialsSet(ref, value);
          await loadCredentialState();
          input.value = '';
          A.toast(A.t('settings.provider.saved', { ref }));
          renderModelConfig();
          if (A.refreshModelPop) A.refreshModelPop();
        } catch (e) { A.toast(e.message); }
      });
      keyRow.appendChild(input); keyRow.appendChild(save);
      body.appendChild(keyRow);

      const grp = P.dshState.models.find((g) => g.id === p.provider);
      const models = (grp && grp.models) || [];
      const modelsLine = document.createElement('div');
      modelsLine.className = 'pModels';
      modelsLine.textContent = models.length
        ? models.map((m) => m.id).join(' · ')
        : A.t('model.none');
      body.appendChild(modelsLine);

      const state = head.querySelector('.pState');
      head.addEventListener('click', () => {
        const open = card.classList.toggle('open');
        body.style.display = open ? '' : 'none';
        if (open) input.focus();
      });
      body.style.display = 'none';
      card.appendChild(head); card.appendChild(body);
      box.appendChild(card);
    }
  }

  async function renderPlugins() {
    const box = $('cfgPlugins');
    box.textContent = '';
    let plugins = [];
    try { plugins = await P.dshState.pluginsList(); } catch (e) { /* noop */ }
    if (!plugins.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: A.t('settings.plugins.empty') }));
      return;
    }
    for (const pl of plugins) {
      const row = document.createElement('div');
      row.className = 'projectRow';
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = pl.name;
      const meta = document.createElement('span');
      meta.className = 'pmeta';
      meta.textContent = (pl.version || '') + (pl.profile ? ' · ' + pl.profile : '');
      row.appendChild(name); row.appendChild(meta);
      box.appendChild(row);
    }
  }

  async function renderVersion() {
    const box = $('cfgVersion');
    box.textContent = '';
    let prtsVer = '?';
    try { prtsVer = (window.prts && window.prts.env && window.prts.env.prtsVersion) || '?'; } catch (e) { /* noop */ }
    let dshVer = '—';
    try {
      const h = await P.dshState.hostDescribe();
      dshVer = (h && h.version) || '—';
    } catch (e) { /* noop */ }
    const row = document.createElement('div');
    row.className = 'projectRow';
    const n = document.createElement('span');
    n.className = 'pname';
    n.textContent = 'PRTS';
    const v = document.createElement('span');
    v.className = 'pmeta';
    v.textContent = prtsVer;
    row.appendChild(n); row.appendChild(v);
    box.appendChild(row);
    const row2 = document.createElement('div');
    row2.className = 'projectRow';
    const n2 = document.createElement('span');
    n2.className = 'pname';
    n2.textContent = 'dsh';
    const v2 = document.createElement('span');
    v2.className = 'pmeta';
    v2.textContent = dshVer;
    row2.appendChild(n2); row2.appendChild(v2);
    box.appendChild(row2);
  }

  /* ---------- cost meter (right sidebar) ---------- */
  function renderCost(container) {
    container.textContent = '';
    const c = P.cost ? P.cost.session : null;
    const rows = [
      [A.t('cost.sessionCost'), c ? P.cost.formatMoney(c.usd) : '—'],
      [A.t('cost.inputTokens'), c ? P.cost.fmtTokens(c.input) : '—'],
      [A.t('cost.outputTokens'), c ? P.cost.fmtTokens(c.output) : '—'],
      [A.t('cost.cacheTokens'), c ? P.cost.fmtTokens(c.cacheRead + c.cacheWrite) : '—'],
      [A.t('cost.calls'), c ? String(c.calls) : '—'],
    ];
    for (const [k, v] of rows) {
      const f = document.createElement('div');
      f.className = 'dtField';
      const kk = document.createElement('div');
      kk.className = 'k';
      kk.textContent = k;
      const vv = document.createElement('div');
      vv.className = 'v';
      vv.textContent = v;
      f.appendChild(kk); f.appendChild(vv);
      container.appendChild(f);
    }
    const note = document.createElement('div');
    note.className = 'hint';
    note.style.marginTop = '8px';
    note.textContent = A.t('cost.hint');
    container.appendChild(note);
  }
  A.showCost = function () {
    openDetails();
    $('dtTitle').textContent = A.t('cost.title');
    renderCost($('dtBody'));
  };
  function showDetailsDefault() {
    $('dtTitle').textContent = A.t('details.title');
    $('dtBody').innerHTML = '<div class="dtEmpty">' + A.t('details.empty') + '</div>';
  }

  /* ---------- plugin market ---------- */
  // The catalog comes from web/market.json (built by scripts/scan-market.mjs,
  // which discovers real dsh plugins on GitHub + npm and filters them). The
  // three known-good entries are always kept as a fallback.
  const MARKET_FALLBACK = [
    { pkg: '@liustack/modlens', displayName: 'ModLens', description: () => A.t('market.modlens'), source: 'npm' },
    { pkg: 'dsh-cost-meter', displayName: 'Cost Meter', description: () => A.t('market.costMeter'), source: 'npm' },
    { pkg: 'dsh-better-sidebar', displayName: 'Better Sidebar', description: () => A.t('market.betterSidebar'), source: 'npm' },
  ];
  function marketCatalog() {
    let scanned = [];
    try { scanned = (window.PRTS_MARKET && window.PRTS_MARKET.plugins) || []; } catch (e) { scanned = []; }
    const map = new Map();
    for (const p of MARKET_FALLBACK.concat(scanned)) {
      const key = p.pkg || p.repo;
      if (!key || map.has(key)) continue;
      map.set(key, p);
    }
    return [...map.values()];
  }
  async function renderMarket() {
    const box = $('marketList');
    box.textContent = '';
    let installed = [];
    try { installed = (await P.dshState.pluginsList()).map((p) => p.name); } catch (e) { installed = []; }
    const items = marketCatalog();
    if (!items.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hint', textContent: A.t('market.empty') }));
      return;
    }
    for (const item of items) {
      const isInstalled = installed.includes(item.pkg) || (item.pkg && installed.includes(item.pkg.replace(/^@[^/]+\//, '')));
      const card = document.createElement('div');
      card.className = 'pCard';
      const head = document.createElement('div');
      head.className = 'pCardHead';
      head.style.cursor = 'default';
      const name = document.createElement('span');
      name.className = 'pName';
      name.textContent = item.displayName || item.name || item.pkg || item.repo;
      const badge = document.createElement('span');
      badge.className = 'pState';
      badge.textContent = item.source === 'github' ? 'github' : 'npm';
      head.appendChild(name); head.appendChild(badge);
      const body = document.createElement('div');
      body.className = 'pCardBody';
      body.style.display = '';
      const desc = document.createElement('div');
      desc.className = 'pModels';
      desc.textContent = typeof item.description === 'function' ? item.description() : (item.description || '');
      body.appendChild(desc);
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'sBtn' + (isInstalled ? '' : ' primary');
      action.textContent = isInstalled ? A.t('market.installed') : A.t('market.install');
      action.disabled = isInstalled;
      action.addEventListener('click', async () => {
        action.disabled = true;
        action.textContent = A.t('market.installing');
        try {
          const bridge = window.prts && window.prts.bridge;
          let r;
          if (item.source === 'github' && item.repo) r = bridge && bridge.pluginClone ? await bridge.pluginClone(item.repo) : { ok: false, stderr: 'no bridge' };
          else r = bridge && bridge.pluginAdd ? await bridge.pluginAdd(item.pkg || item.repo) : { ok: false, stderr: 'no bridge' };
          if (r && r.ok) {
            A.toast(A.t('market.installed', { pkg: item.pkg || item.repo }));
            renderMarket();
          } else {
            A.toast(A.t('market.failed', { msg: (r && (r.stderr || r.stdout)) || 'error' }));
            action.disabled = false;
            action.textContent = A.t('market.install');
          }
        } catch (e) {
          A.toast(e.message);
          action.disabled = false;
          action.textContent = A.t('market.install');
        }
      });
      body.appendChild(action);
      card.appendChild(head); card.appendChild(body);
      box.appendChild(card);
    }
  }
  function openMarket() { $('marketOverlay').classList.add('open'); renderMarket(); }
  function closeMarket() { $('marketOverlay').classList.remove('open'); }

  /* ---------- header / crumbs ---------- */
  function updateCrumb() {
    const ws = P.dshState.workspaces.find((w) => w.workspaceId === P.dshState.currentWorkspaceId);
    const label = ws ? (ws.title || ws.workspaceId) : 'dsh';
    const crumb = $('crumbProjectLabel');
    if (crumb) crumb.textContent = label;
    $('workspaceLabel').textContent = label;
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
    $('dtTitle').textContent = A.t('details.title');
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
      e.stopPropagation();
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
      // No key configured yet -> send the user to Model configuration.
      if (item.dataset.settings === '1') { closePops(); openSettings(); return; }
      // Back to provider list.
      if (item.dataset.back === '1') { currentModelProvider = null; A.refreshModelPop(); return; }
      // Provider picked -> its models.
      if (item.dataset.provider) { await pickProvider(item.dataset.provider); return; }
      // Model picked -> select, then close the pop.
      if (item.dataset.model) {
        try {
          await P.dshState.selectModel(P.dshState.currentSessionId, currentModelProvider, item.dataset.model);
          updateModelChip();
          closePops();
        } catch (e) { A.toast(e.message); }
      }
    });
    A.modelPop = modelPop;
    A.refreshModelPop = () => { modelPop.innerHTML = buildModelPop(); };

    // Work modes = dsh's own agent presets (the same set dsh web offers).
    const modePop = attachPop($('modeChip'), '<div class="popMeta">' + A.t('mode.loading') + '</div>', async (item) => {
      if (!item.dataset.preset) return;
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      try {
        await P.dshState.agentPresetSelect(P.dshState.currentSessionId, item.dataset.preset);
        A.currentPreset = item.dataset.preset;
        $('headerMode').textContent = item.dataset.preset;
        closePops();
      } catch (e) { A.toast(e.message); }
    });
    A.modePop = modePop;
    A.refreshModePop = async () => {
      try {
        const presets = await P.dshState.agentPresetList();
        modePop.innerHTML = presets.length
          ? presets.map((p) => {
            const id = p.id || p.agentPreset;
            const label = p.name || id;
            return '<div class="popItem" data-preset="' + id + '"><span class="label">' + label + '</span></div>';
          }).join('')
          : '<div class="popMeta">' + A.t('mode.none') + '</div>';
      } catch (e) {
        modePop.innerHTML = '<div class="popMeta">' + A.t('mode.none') + '</div>';
      }
    };
    $('modeChip').addEventListener('click', () => { A.refreshModePop(); });

    // Workspace selector — lives on the header crumb (always visible) so it is
    // reachable from the chat view, not just the hero.
    const wsPop = attachPop($('crumbProject'), '', async (item) => {
      if (item.dataset.value === '__add') { await newWorkspace(); closePops(); return; }
      await selectWorkspace(item.dataset.value);
      closePops();
    });
    A.refreshWorkspacePop = () => {
      wsPop.innerHTML =
        '<div class="popItem" data-value="__add"><span class="label">' + A.t('workspace.add') + '</span></div>' +
        P.dshState.workspaces.map((w) => '<div class="popItem" data-value="' + w.workspaceId + '"><span class="label">' + (w.title || w.workspaceId) + '</span><span class="tick">&#10003;</span></div>').join('');
    };
    A.refreshWorkspacePop();

    // Commands chip — lists dsh's installed commands (e.g. givemyflag's).
    const cmdPop = attachPop($('commandsChip'), '<div class="popMeta">' + A.t('commands.loading') + '</div>', async (item) => {
      const input = $('composerInput');
      if (input) {
        input.value = '/' + (item.dataset.name || '') + ' ';
        input.focus();
        P.chat.updateSend();
        closePops();
      }
    });
    A.cmdPop = cmdPop;
    A.refreshCmdPop = async () => {
      if (!P.dshState.currentSessionId) { cmdPop.innerHTML = '<div class="popMeta">' + A.t('session.selectFirst') + '</div>'; return; }
      try {
        const cmds = await P.dshState.commandsList(P.dshState.currentSessionId);
        cmdPop.innerHTML = cmds.length
          ? cmds.map((c) => '<div class="popItem" data-name="' + c.name + '"><span class="label">/' + c.name + '</span><span class="desc">' + (c.description || '') + '</span></div>').join('')
          : '<div class="popMeta">' + A.t('commands.none') + '</div>';
      } catch (e) {
        cmdPop.innerHTML = '<div class="popMeta">' + A.t('commands.none') + '</div>';
      }
    };
    $('commandsChip').addEventListener('click', () => { A.refreshCmdPop(); });
  }

  /* ---------- particles: intro + hero ---------- */
  function runIntro() {
    const cv = $('introCanvas');
    A.introEngine = P.particles.create(cv, { count: 10000, speedRange: [0.02, 0.05] });
    A.introEngine.start();
    const tag = $('introTag');
    tag.textContent = A.t('intro.welcome');

    // The intro is a loading shell: it cycles the three wordmark phases until
    // dsh is connected and the first session is ready. No progress bar.
    A.introDone = false;
    A.ready = false;

    const finish = () => {
      if (A.introDone) return;
      A.introDone = true;
      clearTimeout(A.introTimer);
      $('intro').classList.add('done');
      setTimeout(() => { $('intro').style.display = 'none'; A.introEngine.stop(); }, 800);
      // If dsh never connected we are still on the hero view — start its field.
      if (!$('cvt').dataset.phase || $('cvt').dataset.phase === 'hero') startHeroAmbient();
    };
    A.finishIntro = finish;

    // Early click: if ready, enter at once; otherwise show a particle "WAIT".
    const skip = (e) => {
      if (A.ready) finish();
      else showWaitHint(e);
    };
    window.addEventListener('pointerdown', skip);
    window.addEventListener('keydown', skip);

    // Three-phase loop. It always plays the full three-image cycle at least
    // once, then keeps cycling until dsh is ready — only a click skips ahead.
    A.phaseCount = 0;
    let phase = 0;
    const tick = () => {
      if (A.introDone) return;
      if (A.ready && A.phaseCount >= 3) { finish(); return; }
      if (phase === 0) { A.introEngine.showIntro(9000); tag.classList.add('show'); }
      else if (phase === 1) { A.introEngine.showPp(10000); tag.classList.remove('show'); }
      else { A.introEngine.showMark(1.05, 9000); tag.classList.remove('show'); }
      A.phaseCount++;
      phase = (phase + 1) % 3;
      A.introTimer = setTimeout(tick, 2400);
    };
    A.introTimer = setTimeout(tick, 500);
  }

  // Particle "WAIT" hint at the click point, one second then dissipates.
  function showWaitHint(e) {
    const x = (e && (e.clientX ?? e.x)) ?? window.innerWidth / 2;
    const y = (e && (e.clientY ?? e.y)) ?? window.innerHeight / 2;
    const hint = document.createElement('canvas');
    hint.className = 'waitHint';
    hint.width = 150; hint.height = 56;
    hint.style.left = x + 'px';
    hint.style.top = y + 'px';
    document.body.appendChild(hint);
    const eng = P.particles.create(hint, { count: 520, speedRange: [0.04, 0.10], drift: false });
    eng.start();
    eng.showText('WAIT', 22, 900);
    setTimeout(() => {
      eng.scatter();
      hint.classList.add('fade');
      setTimeout(() => { eng.stop(); hint.remove(); }, 500);
    }, 1000);
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
  // Central diamond: dB drives the scale, the dominant frequency nudges the
  // rotation. The inner square vibrates too, but on its own phase. `.speaking`
  // is the same path reserved for dsh voice *output* — when dsh gains speech,
  // produced audio drives this diamond identically.
  function drawVoiceDiamond(frame) {
    const el = $('voiceDiamond');
    if (!el) return;
    const on = A.voiceOn || frame.speaking;
    el.classList.toggle('on', !!on);
    el.classList.toggle('speaking', !!frame.speaking);
    const bars = (frame.bars && frame.bars.length) ? frame.bars : [];
    const peak = bars.length ? bars.reduce((a, b) => Math.max(a, b), 0) : 0;
    const level = on ? Math.max(0, Math.min(1, peak)) : 0;
    const freq = Math.max(0, Math.min(1, (frame.dominant || 0) / 4000));
    const now = performance.now();
    const dScale = 1 + level * (0.10 + 0.05 * freq);
    const dRot = on ? Math.sin(now / 90) * 2.5 * level : 0;
    const sScale = 1 + level * (0.07 + 0.03 * freq);
    const sRot = on ? Math.sin(now / 70 + 1.2) * 3 * level : 0;
    const diamond = $('diamondShape');
    const square = $('squareShape');
    if (diamond) diamond.style.transform = 'rotate(45deg) scale(' + dScale.toFixed(3) + ') rotate(' + dRot.toFixed(2) + 'deg)';
    if (square) square.style.transform = 'scale(' + sScale.toFixed(3) + ') rotate(' + sRot.toFixed(2) + 'deg)';
    el.style.setProperty('--vd-level', level.toFixed(3));
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
      drawVoiceDiamond(frame);
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
      if (appEl().hasAttribute('data-details-collapsed')) { showDetailsDefault(); openDetails(); }
      else closeDetails();
    });
    $('costBtn').addEventListener('click', () => {
      if (appEl().hasAttribute('data-details-collapsed')) { A.showCost(); }
      else closeDetails();
    });
    $('marketBtn').addEventListener('click', openMarket);
    $('marketClose').addEventListener('click', closeMarket);
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
    // Model configuration is hidden until the abstract toggle is clicked.
    $('modelCfgToggle').addEventListener('click', () => {
      const btn = $('modelCfgToggle');
      const body = $('modelCfgBody');
      const open = !!body.hidden;
      body.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('open', open);
    });
    // Update: run the packaged updater script from the main process.
    $('updateBtn').addEventListener('click', async () => {
      const status = $('updateStatus');
      status.textContent = A.t('settings.updating');
      try {
        const bridge = window.prts && window.prts.bridge;
        const r = bridge && bridge.update ? await bridge.update() : { ok: false, stderr: 'no bridge' };
        if (r && r.ok) {
          status.textContent = A.t('settings.updated');
          A.toast(A.t('settings.updated'));
        } else {
          status.textContent = A.t('settings.updateFail', { msg: (r && (r.stderr || r.error)) || 'error' });
        }
      } catch (e) { status.textContent = A.t('settings.updateFail', { msg: e.message }); }
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
      if (!e.target.closest('.chip') && !e.target.closest('.meterBtn') && !e.target.closest('.workspaceBtn') && !e.target.closest('.crumb')) closePops();
      if (e.target === $('settingsOverlay')) closeSettings();
      if (e.target === $('marketOverlay')) closeMarket();
    });
    let lastEscAt = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      closePops(); closeSettings(); closeMarket();
      if (P.system && P.system.open) P.system.close();
      if (now - lastEscAt < 500) {
        // Double-Esc: cancel the running conversation / task.
        lastEscAt = 0;
        if (P.chat && P.chat.stop) P.chat.stop();
        A.toast(A.t('chat.cancelled'));
      } else {
        lastEscAt = now;
      }
    });
    window.addEventListener('resize', () => {
      placeHandles();
      if (A.introEngine) A.introEngine.resize();
      if (A.heroEngine) A.heroEngine.resize();
    });

    P.chat.init();

    // The window shows immediately; the particle intro acts as a loading shell
    // while dsh connects and the first session is prepared in the background.
    updateCrumb();
    placeHandles();
    runIntro();

    P.dsh.on('connect', () => { refreshAll().catch(() => { /* dsh may still be warming up */ }); });
    (async () => {
      try {
        await P.dshState.connect();
        // Wait until dsh actually answers (the /api route may still be warming
        // up); the intro keeps cycling meanwhile.
        let up = false;
        for (let i = 0; i < 40; i++) {
          if (await P.dshState.ping()) { up = true; break; }
          await new Promise((r) => setTimeout(r, 750));
        }
        if (up) {
          await refreshAll();
          await A.ensureSession();
        } else {
          A.toast(A.t('dsh.connectFail', { msg: A.t('dsh.noResponse') }));
        }
      } catch (e) {
        A.toast(A.t('dsh.connectFail', { msg: e.message }));
      }
      // Mark ready — the intro finishes once its full three-image cycle has
      // played (or immediately on a click).
      A.ready = true;
    })();
  }

  A.updateCrumb = updateCrumb;
  A.renderWorkspaces = renderWorkspaces;
  A.renderSessions = renderSessions;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
