/**
 * PRTS GUI shell — the window over dsh. It boots the dsh connection, lists
 * dsh workspaces + sessions, renders the conversation (session events), and
 * keeps the PRTS chrome: particle intro, theme, system panel, plugin buttons,
 * voice input. On top of that it carries the full dsh control surface:
 * workspace picker, session search, mode (agent preset), model + reasoning
 * level, permission level, file attachment, approvals and questions.
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
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
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

  /* ---------- PRTS modal (replaces window.prompt / window.confirm, which
     Electron disables) ---------- */
  let modalResolve = null;
  function openModal(kind, title, placeholder) {
    const ov = $('modalOverlay');
    $('modalTitle').textContent = title;
    const input = $('modalInput');
    input.value = '';
    input.placeholder = placeholder || '';
    input.hidden = kind !== 'prompt';
    $('modalOk').textContent = A.t('common.ok');
    $('modalCancel').hidden = kind === 'alert';
    ov.classList.add('open');
    if (kind === 'prompt') setTimeout(() => input.focus(), 40);
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function settleModal(value) {
    $('modalOverlay').classList.remove('open');
    const r = modalResolve;
    modalResolve = null;
    if (r) r(value);
  }
  A.askPrompt = (title, placeholder) => openModal('prompt', title, placeholder);
  A.askConfirm = (title) => openModal('confirm', title);
  A.alert = (title) => openModal('alert', title);

  /* ---------- sidebar: workspaces + sessions (dsh) ---------- */
  let sessionFilter = '';

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

  function visibleSessions() {
    const ss = P.dshState.sessions;
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return ss;
    return ss.filter((s) => {
      const title = P.dshState.sessionTitle(s);
      const sid = String(s.sessionId || '');
      return title.toLowerCase().indexOf(q) >= 0 || sid.toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderSessions() {
    const list = $('sessionList');
    list.textContent = '';
    const ss = visibleSessions();
    if (!ss.length) {
      const empty = document.createElement('div');
      empty.className = 'sbEmpty';
      empty.textContent = A.t(sessionFilter ? 'sidebar.searchNone' : 'sidebar.sessionsEmpty');
      list.appendChild(empty);
    }
    for (const s of ss) {
      const row = document.createElement('div');
      row.className = 'sbItem' + (s.sessionId === P.dshState.currentSessionId ? ' active' : '');
      row.dataset.session = s.sessionId;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = P.dshState.sessionTitle(s);
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
    refreshWorkspacePop();
  }

  async function refreshSessions() {
    await P.dshState.listSessions();
    renderSessions();
  }

  async function selectSession(id) {
    P.dshState.currentSessionId = id;
    const summary = P.dshState.sessionSummary(id);
    if (summary && summary.agentPreset) {
      P.dshState.currentPreset = summary.agentPreset;
      $('headerMode').textContent = presetLabel(summary.agentPreset);
    }
    P.dshState.permissions = P.dshState.permissionState(id);
    updatePermissionChip();
    if (A.refreshPermissionPop) A.refreshPermissionPop();
    A.enterChat();
    try { await P.dshState.sessionModels(id); } catch (e) { /* model catalog may be warming up */ }
    updateModelChip();
    updateReasoningChip();
    await P.chat.loadHistory(id);
    renderSessions();
    updateMeter();
    updateCrumb();
  }

  async function newSession() {
    const wsId = P.dshState.currentWorkspaceId;
    const id = await P.dshState.createSession(wsId, A.currentPreset || undefined);
    if (id) {
      await refreshSessions();
      await selectSession(id);
    }
  }

  async function archiveSession(id) {
    const ok = await A.askConfirm(A.t('session.confirmArchive'));
    if (!ok) return;
    await P.dshState.archiveSession(id);
    await refreshSessions();
    if (P.dshState.currentSessionId === id) {
      P.dshState.currentSessionId = null;
      P.chat.messages = [];
      P.chat.renderFlow();
    }
  }

  async function deleteWorkspace(id) {
    const ok = await A.askConfirm(A.t('workspace.confirmDelete'));
    if (!ok) return;
    await P.dshState.deleteWorkspace(id);
    await refreshAll();
  }

  async function newWorkspace() {
    const path = await A.askPrompt(A.t('workspace.pathPrompt'), '/path/to/project');
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
    updateReasoningChip();
    updatePermissionChip();
    if (A.refreshModelPop) A.refreshModelPop();
    if (A.refreshReasoningPop) A.refreshReasoningPop();
    if (A.refreshPermissionPop) A.refreshPermissionPop();
    if (A.refreshModePop) A.refreshModePop();
    if (A.refreshWorkspacePop) A.refreshWorkspacePop();
    updateMeter();
    updateCrumb();
  }

  /* ---------- mode (agent preset) ---------- */
  function presetLabel(id) {
    const p = P.dshState.presets.find((x) => (x.id || x.agentPreset) === id);
    return p ? (p.name || id) : id;
  }

  /* ---------- model + reasoning chips ---------- */
  function modelGroup(provider) {
    return P.dshState.models.find((g) => g.id === provider) || null;
  }
  function currentModelEntry() {
    const cm = P.dshState.currentModel;
    if (cm && cm.model) {
      const grp = modelGroup(cm.provider);
      if (grp) {
        const m = grp.models.find((x) => x.id === cm.model);
        if (m) return { group: grp, model: m, provider: cm.provider };
      }
      return { group: null, model: { id: cm.model }, provider: cm.provider };
    }
    const g = P.dshState.models;
    if (!g || !g.length) return null;
    const grp = g[0];
    return (grp.models && grp.models[0]) ? { group: grp, model: grp.models[0], provider: grp.id } : null;
  }

  function updateModelChip() {
    const label = $('modelChipLabel');
    if (!label) return;
    const e = currentModelEntry();
    label.textContent = e ? e.model.id : '—';
    label.title = e ? (e.provider || '') + ' / ' + e.model.id : '';
  }

  function updateReasoningChip() {
    const chip = $('reasoningChip');
    const label = $('reasoningChipLabel');
    if (!chip || !label) return;
    const e = currentModelEntry();
    const reasoning = e && e.model.reasoning;
    if (!reasoning || !reasoning.efforts || !reasoning.efforts.length) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    const cur = (P.dshState.currentModel && P.dshState.currentModel.reasoningEffort) || reasoning.defaultEffort;
    const eff = reasoning.efforts.find((x) => x.id === cur) || reasoning.efforts[0];
    label.textContent = eff.name || eff.id;
    chip.title = A.t('reasoning.title');
  }

  /* ---------- permission chip ---------- */
  function updatePermissionChip() {
    const chip = $('permissionChip');
    const label = $('permissionChipLabel');
    if (!chip || !label) return;
    const st = P.dshState.permissions;
    if (!st || !st.options || !st.options.length) { chip.hidden = true; return; }
    chip.hidden = false;
    const cur = st.options.find((o) => o.value === st.currentValue);
    label.textContent = cur ? (cur.name || cur.value) : (st.currentValue || '—');
    chip.title = A.t('permission.title');
  }

  /* ---------- context meter (composer ring) ---------- */
  function sessionUsage(sessionId) {
    const s = P.dshState.sessionSummary(sessionId);
    const v = s && s.projections && s.projections.values;
    if (!v) return null;
    return {
      pressure: v.contextPressure && v.contextPressure.pressureTokens,
      window: v.contextPressure && v.contextPressure.contextWindow,
      usage: v.tokenUsage || null,
    };
  }
  function updateMeter() {
    const ring = $('meterRing');
    const label = $('meterLabel');
    if (!ring || !label) return;
    const u = sessionUsage(P.dshState.currentSessionId);
    const pct = u && u.pressure && u.window ? Math.min(100, Math.max(0, (u.pressure / u.window) * 100)) : 0;
    const R = 5.5, CIRC = 2 * Math.PI * R;
    ring.style.strokeDasharray = String(CIRC);
    ring.style.strokeDashoffset = String(CIRC * (1 - pct / 100));
    label.textContent = Math.round(pct) + '%';
    label.title = A.t('meter.context', { pct: Math.round(pct) });
  }
  function renderMeterPop() {
    const u = sessionUsage(P.dshState.currentSessionId);
    if (!u) return '<div class="popMeta">' + A.t('meter.none') + '</div>';
    const usage = u.usage || {};
    const rows = [
      [A.t('meter.pressure'), u.pressure !== undefined ? String(u.pressure) : '—'],
      [A.t('meter.window'), u.window ? String(u.window) : '—'],
      [A.t('meter.input'), usage.uncachedInputTokens !== undefined ? String(usage.uncachedInputTokens) : '—'],
      [A.t('meter.output'), usage.outputTokens !== undefined ? String(usage.outputTokens) : '—'],
      [A.t('meter.cache'), usage.cacheReadTokens !== undefined ? String(usage.cacheReadTokens) : '—'],
    ];
    return rows.map(([k, v]) => '<div class="meterRow"><span class="label">' + k + '</span><span class="value">' + v + '</span></div>').join('');
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

  /* ---------- phase / tabs ---------- */
  A.enterChat = function () {
    A.heroVisible = false;
    const cvt = $('cvt');
    cvt.dataset.phase = 'active';
    $('header').hidden = false;
    $('heroView').hidden = true;
    $('chatScroll').hidden = false;
    if (A.heroEngine) A.heroEngine.stop();
    switchView('chat');
  };
  function switchView(view) {
    const chat = $('chatScroll');
    const traj = $('trajView');
    const composer = $('composerArea');
    if (view === 'trajectory') {
      chat.hidden = true;
      traj.hidden = false;
      composer.style.display = 'none';
      P.chat.renderTraj();
    } else {
      chat.hidden = false;
      traj.hidden = true;
      composer.style.display = '';
    }
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

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
      appEl().classList.remove('sbCollapsed');
    });
    attachDrag($('handleDetails'), (x) => {
      const r = appEl().getBoundingClientRect();
      A_.dtWidth = Math.min(560, Math.max(320, r.width - x));
      appEl().style.setProperty('--dsh-dt', A_.dtWidth + 'px');
      $('handleDetails').style.left = (r.width - A_.dtWidth - 4) + 'px';
    });
  }
  function toggleSidebar() {
    const collapsed = appEl().classList.toggle('sbCollapsed');
    appEl().style.setProperty('--dsh-sb', collapsed ? '0px' : A_.sbWidth + 'px');
    placeHandles();
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
      // Header chips open downward (the composer chips open upward).
      const r = trigger.getBoundingClientRect();
      if (r.top < 220) { pop.classList.add('below'); }
      pop.classList.add('open');
      openPop = pop;
    });
    return pop;
  }

  function buildModelPop() {
    // Provider list: session.models groups (with provider display names).
    const groups = P.dshState.models || [];
    if (!groups.length) return '<div class="popMeta">' + A.t('model.none') + '</div>';
    if (currentModelProvider) {
      const grp = groups.find((g) => g.id === currentModelProvider);
      if (!grp || !grp.models || !grp.models.length) {
        return '<div class="popItem" data-back="1"><span class="label">← ' + A.t('model.back') + '</span></div><div class="popMeta">' + A.t('model.none') + '</div>';
      }
      const cur = P.dshState.currentModel;
      return '<div class="popItem" data-back="1"><span class="label">← ' + A.t('model.back') + '</span></div>' +
        grp.models.map((m) => {
          const sel = cur && cur.provider === grp.id && cur.model === m.id;
          const eff = m.reasoning && m.reasoning.efforts ? m.reasoning.efforts.map((e) => e.name || e.id).join(' / ') : '';
          return '<div class="popItem' + (sel ? ' selected' : '') + '" data-model="' + m.id + '"><span class="label">' + m.id + (eff ? '<span class="desc"> ' + eff + '</span>' : '') + '</span><span class="tick">&#10003;</span></div>';
        }).join('');
    }
    const provName = (id) => {
      const p = P.dshState.providers.find((x) => x.provider === id);
      return p ? (p.displayName || p.provider) : (id || 'provider');
    };
    const cur = P.dshState.currentModel;
    return groups.map((g) => {
      const sel = cur && cur.provider === g.id;
      return '<div class="popItem' + (sel ? ' selected' : '') + '" data-provider="' + g.id + '"><span class="label">' + provName(g.id) + '</span><span class="tick">&#10003;</span></div>';
    }).join('');
  }

  function buildReasoningPop() {
    const e = currentModelEntry();
    const reasoning = e && e.model.reasoning;
    if (!reasoning || !reasoning.efforts) return '<div class="popMeta">' + A.t('reasoning.none') + '</div>';
    const cur = (P.dshState.currentModel && P.dshState.currentModel.reasoningEffort) || reasoning.defaultEffort;
    return reasoning.efforts.map((x) =>
      '<div class="popItem' + (x.id === cur ? ' selected' : '') + '" data-effort="' + x.id + '"><span class="label">' + (x.name || x.id) + '</span><span class="desc">' + (x.description || '') + '</span><span class="tick">&#10003;</span></div>'
    ).join('');
  }

  function buildPermissionPop() {
    const st = P.dshState.permissions;
    if (!st || !st.options || !st.options.length) return '<div class="popMeta">' + A.t('permission.none') + '</div>';
    return st.options.map((o) =>
      '<div class="popItem' + (o.value === st.currentValue ? ' selected' : '') + '" data-permission="' + o.value + '"><span class="label">' + (o.name || o.value) + '</span><span class="tick">&#10003;</span></div>'
    ).join('');
  }

  function bindPopovers() {
    const modelPop = attachPop($('modelChip'), buildModelPop(), async (item) => {
      if (item.dataset.back === '1') { currentModelProvider = null; A.refreshModelPop(); return; }
      if (item.dataset.provider) { currentModelProvider = item.dataset.provider; A.refreshModelPop(); return; }
      if (item.dataset.model) {
        if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
        try {
          const eff = (P.dshState.currentModel && P.dshState.currentModel.reasoningEffort) || undefined;
          await P.dshState.selectModel(P.dshState.currentSessionId, currentModelProvider, item.dataset.model, eff);
          await P.dshState.sessionModels(P.dshState.currentSessionId);
          updateModelChip();
          updateReasoningChip();
          closePops();
        } catch (e) { A.toast(e.message); }
      }
    });
    A.modelPop = modelPop;
    A.refreshModelPop = () => { modelPop.innerHTML = buildModelPop(); };

    const reasoningPop = attachPop($('reasoningChip'), buildReasoningPop(), async (item) => {
      if (!item.dataset.effort) return;
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      const e = currentModelEntry();
      if (!e) return;
      try {
        await P.dshState.selectModel(P.dshState.currentSessionId, e.provider, e.model.id, item.dataset.effort);
        await P.dshState.sessionModels(P.dshState.currentSessionId);
        updateModelChip();
        updateReasoningChip();
        closePops();
      } catch (err) { A.toast(err.message); }
    });
    A.reasoningPop = reasoningPop;
    A.refreshReasoningPop = () => { reasoningPop.innerHTML = buildReasoningPop(); };

    const permissionPop = attachPop($('permissionChip'), buildPermissionPop(), async (item) => {
      if (!item.dataset.permission) return;
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      try {
        await P.dshState.setPermissionPreset(P.dshState.currentSessionId, item.dataset.permission);
        closePops();
        A.toast(A.t('permission.applying', { preset: item.dataset.permission }));
        setTimeout(async () => {
          await P.dshState.listSessions();
          P.dshState.permissions = P.dshState.permissionState(P.dshState.currentSessionId);
          updatePermissionChip();
        }, 1200);
      } catch (e) { A.toast(e.message); }
    });
    A.permissionPop = permissionPop;
    A.refreshPermissionPop = () => { permissionPop.innerHTML = buildPermissionPop(); };
    $('permissionChip').addEventListener('click', () => { A.refreshPermissionPop(); });

    // Work modes = dsh's own agent presets (the same set dsh web offers).
    const modePop = attachPop($('modeChip'), '<div class="popMeta">' + A.t('mode.loading') + '</div>', async (item) => {
      if (!item.dataset.preset) return;
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      try {
        await P.dshState.agentPresetSelect(P.dshState.currentSessionId, item.dataset.preset);
        A.currentPreset = item.dataset.preset;
        $('headerMode').textContent = presetLabel(item.dataset.preset);
        closePops();
      } catch (e) { A.toast(e.message); }
    });
    A.modePop = modePop;
    A.refreshModePop = async () => {
      try {
        const presets = await P.dshState.listPresets();
        const cur = A.currentPreset || (P.dshState.currentSessionId ? (P.dshState.sessionSummary(P.dshState.currentSessionId) || {}).agentPreset : null);
        modePop.innerHTML = presets.length
          ? presets.map((p) => {
            const id = p.id || p.agentPreset;
            const label = p.name || id;
            return '<div class="popItem' + (id === cur ? ' selected' : '') + '" data-preset="' + id + '"><span class="label">' + label + '</span><span class="tick">&#10003;</span></div>';
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

    // Commands chip — lists the session's known commands (from its own
    // command/run history plus well-known built-ins; dsh exposes no
    // command-directory RPC on the /api wire).
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

    // Context meter popover.
    const meterPop = attachPop($('meterBtn'), '<div class="popMeta">' + A.t('meter.none') + '</div>', () => {});
    $('meterBtn').addEventListener('click', () => { meterPop.innerHTML = renderMeterPop(); });
  }

  /* ---------- approvals + questions (server-request frames) ---------- */
  const openRequests = new Map();   // key -> { el, rpcId, kind }

  function closeRequest(key) {
    const rec = openRequests.get(key);
    if (!rec) return;
    openRequests.delete(key);
    rec.el.classList.add('closing');
    setTimeout(() => rec.el.remove(), 180);
    if (!openRequests.size) $('requestOverlay').classList.remove('open');
  }
  function addRequestCard(key, card) {
    const box = $('requestCards');
    box.appendChild(card);
    openRequests.set(key, { el: card });
    $('requestOverlay').classList.add('open');
  }

  function bindRequests() {
    P.dsh.on('approval/requested', (frame) => {
      const pl = frame.payload || {};
      if (!pl.approvalId) return;
      const key = 'ap-' + pl.approvalId;
      if (openRequests.has(key)) return;
      const card = document.createElement('div');
      card.className = 'reqCard';
      const head = el0('div', 'reqHead');
      head.appendChild(el0('span', 'reqKicker', A.t('approval.title')));
      head.appendChild(el0('span', 'reqMeta', pl.toolName || ''));
      card.appendChild(head);
      const reason = el0('div', 'reqReason', pl.reason || '');
      card.appendChild(reason);
      const actions = el0('div', 'reqActions');
      const reject = el0('button', 'sBtn', A.t('approval.reject'));
      reject.type = 'button';
      reject.addEventListener('click', () => {
        P.dsh.respond(frame.rpcId, { sessionId: pl.sessionId, approvalId: pl.approvalId, outcome: 'rejected' });
        closeRequest(key);
      });
      const allow = el0('button', 'sBtn primary', A.t('approval.allow'));
      allow.type = 'button';
      allow.addEventListener('click', () => {
        P.dsh.respond(frame.rpcId, { sessionId: pl.sessionId, approvalId: pl.approvalId, outcome: 'allowed-once' });
        closeRequest(key);
      });
      actions.appendChild(reject); actions.appendChild(allow);
      card.appendChild(actions);
      addRequestCard(key, card);
    });
    P.dsh.on('approval/resolved', (frame) => {
      const pl = frame.payload || {};
      closeRequest('ap-' + pl.approvalId);
    });

    P.dsh.on('question/requested', (frame) => {
      const pl = frame.payload || {};
      const questions = pl.questions || [];
      if (!questions.length) return;
      const key = 'q-' + frame.rpcId;
      if (openRequests.has(key)) return;
      const card = document.createElement('div');
      card.className = 'reqCard';
      card.appendChild(el0('div', 'reqKicker', A.t('question.title')));
      const answers = [];
      for (const q of questions) {
        const block = el0('div', 'reqQ');
        const head = el0('div', 'reqQHead');
        head.appendChild(el0('span', 'reqQTitle', q.question || q.header || q.id || ''));
        const multi = !!(q.multiSelect);
        if (multi) head.appendChild(el0('span', 'reqMeta', A.t('question.multi')));
        block.appendChild(head);
        const opts = el0('div', 'reqOpts');
        const selected = new Set();
        const optionBtns = [];
        for (const o of q.options || []) {
          const b = el0('button', 'reqOpt', o.label || o);
          b.type = 'button';
          b.dataset.value = String(o.value !== undefined ? o.value : (o.label || o));
          b.addEventListener('click', () => {
            if (!multi) {
              selected.clear();
              optionBtns.forEach((x) => x.classList.remove('on'));
            }
            if (selected.has(b.dataset.value)) { selected.delete(b.dataset.value); b.classList.remove('on'); }
            else { selected.add(b.dataset.value); b.classList.add('on'); }
          });
          optionBtns.push(b);
          opts.appendChild(b);
        }
        block.appendChild(opts);
        const custom = document.createElement('input');
        custom.type = 'text';
        custom.className = 'sInput reqCustom';
        custom.placeholder = A.t('question.custom');
        block.appendChild(custom);
        card.appendChild(block);
        answers.push({ q, selected, optionBtns, custom });
      }
      const actions = el0('div', 'reqActions');
      const submit = el0('button', 'sBtn primary', A.t('question.answer'));
      submit.type = 'button';
      submit.addEventListener('click', () => {
        const answer = { answers: answers.map((a) => ({ id: a.q.id, selected: [...a.selected], custom: a.custom.value })) };
        P.dsh.respond(frame.rpcId, { sessionId: pl.sessionId, answer });
        closeRequest(key);
      });
      actions.appendChild(submit);
      card.appendChild(actions);
      addRequestCard(key, card);
    });
    P.dsh.on('question/resolved', (frame) => {
      const pl = frame.payload || {};
      closeRequest('q-' + pl.questionRpcId);
    });
  }
  function el0(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- particles: intro + hero ---------- */
  function runIntro() {
    const cv = $('introCanvas');
    A.introEngine = P.particles.create(cv, { count: 10000, speedRange: [0.02, 0.05] });
    A.introEngine.start();
    const tag = $('introTag');
    tag.textContent = A.t('intro.welcome');

    A.introDone = false;
    A.ready = false;

    const finish = () => {
      if (A.introDone) return;
      A.introDone = true;
      clearTimeout(A.introTimer);
      removeIntroSkip();
      $('intro').classList.add('done');
      setTimeout(() => { $('intro').style.display = 'none'; A.introEngine.stop(); }, 800);
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
    const removeIntroSkip = () => {
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };

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
    if (A.heroEngine) { A.heroEngine.stop(); A.heroEngine = null; }
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
  function renderCommunityPlugins() {
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

  /* ---------- provider credentials ---------- */
  function providerRef(provider) {
    const base = String(provider || '').replace(/^llm-/, '').toUpperCase().replace(/-/g, '_');
    return base + '_API_KEY';
  }
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
  let currentModelProvider = null;

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
    bindRequests();
    if (P.plugins) { P.plugins.onChange(renderCommunityPlugins); P.plugins.adoptSeeded(); renderCommunityPlugins(); }
    if (P.system && P.system.bind) P.system.bind();

    $('themeBtn').addEventListener('click', A.toggleTheme);
    $('sbCollapseBtn').addEventListener('click', toggleSidebar);
    $('clearHistoryBtn').addEventListener('click', async () => {
      const ok = await A.askConfirm(A.t('session.confirmArchive'));
      if (!ok) return;
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
    $('modelCfgToggle').addEventListener('click', () => {
      const btn = $('modelCfgToggle');
      const body = $('modelCfgBody');
      const open = !!body.hidden;
      body.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('open', open);
    });
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
    // Search sessions: client-side filter (instant) — the wire session.search
    // stays a best-effort supplement for deployments where the index is on.
    const searchInput = $('sessionSearch');
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
      sessionFilter = searchInput.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderSessions(), 120);
    });
    $('sessionSearchClear').addEventListener('click', () => {
      searchInput.value = '';
      sessionFilter = '';
      renderSessions();
    });

    // Tabs: chat / trajectory.
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => switchView(b.dataset.view));
    });
    $('logBtn').addEventListener('click', () => switchView('trajectory'));

    // Modal (prompt / confirm).
    $('modalOk').addEventListener('click', () => {
      const input = $('modalInput');
      const value = input.hidden ? true : input.value;
      settleModal(value);
    });
    $('modalCancel').addEventListener('click', () => settleModal(inputHidden() ? false : null));
    $('modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('modalOverlay')) settleModal(inputHidden() ? false : null);
    });
    function inputHidden() { return $('modalInput').hidden; }

    $('flow').addEventListener('click', (e) => {
      const item = e.target.closest('.assistantItem') || e.target.closest('.userBubble');
      if (!item) return;
      if (item.classList.contains('assistantItem')) {
        const id = item.dataset.msg;
        const msg = P.chat.messages.find((m) => m.id === id);
        if (msg) A.showDetails(msg);
      } else {
        const msg = P.chat.messages.filter((m) => m.role === 'user').pop();
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

    // Status row + streaming sync.
    const statusRow = $('statusRow');
    const statusText = $('statusText');
    P.chat.onStatus = (text) => {
      if (!statusRow || !statusText) return;
      if (text) { statusRow.hidden = false; statusText.textContent = text; }
      else statusRow.hidden = true;
    };
    P.chat.onStreaming = () => { /* swapSendStop is handled inside chat.js */ };

    P.chat.init();

    updateCrumb();
    placeHandles();
    runIntro();

    P.dsh.on('connect', () => { refreshAll().catch(() => { /* dsh may still be warming up */ }); });
    (async () => {
      try {
        await P.dshState.connect();
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
      A.ready = true;
    })();
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
    await refreshSessions();
    await selectSession(id);
    return id;
  };

  A.updateCrumb = updateCrumb;
  A.renderWorkspaces = renderWorkspaces;
  A.renderSessions = renderSessions;
  A.updateModelChip = updateModelChip;
  A.updateReasoningChip = updateReasoningChip;
  A.updatePermissionChip = updatePermissionChip;
  A.updateMeter = updateMeter;
  A.switchView = switchView;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
