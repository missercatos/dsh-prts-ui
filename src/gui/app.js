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
    if (A.renderStatsDock) A.renderStatsDock();
    if (P.asr && P.asr.setLocale) P.asr.setLocale(A.locale);
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    // The fixed ink for the background marks / hero mark / rhombus must
    // follow light/dark instantly. The client keeps an inline --prts-ink
    // (set from the dsh-web theme snapshot at boot) that would otherwise
    // stay stale — update it here so black↔white switches never leave
    // white-on-white marks.
    document.documentElement.style.setProperty('--prts-ink', theme === 'light' ? '#0A0A0B' : '#FAFAFA');
    if (A.heroEngine) A.heroEngine.refreshInk();
    if (A.introEngine) A.introEngine.refreshInk();
  }
  A.toggleTheme = async function () {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? 'custom' : 'dark';
    applyTheme(next);
    A.config.ui = A.config.ui || {};
    A.config.ui.theme = next;
    if (next === 'custom' && !A.config.ui.accent) {
      A.config.ui.accent = { preset: 'tokyonight', primary: '#7aa2f7', diamond: '#7dcfff', square: '#bb9af7' };
    }
    applyAccent(A.config);
    await P.store.saveConfig(A.config);
    if (A.applySidebarButtons) A.applySidebarButtons(A.config);
  };

  /** Left sidebar buttons are configurable (and extensible): the settings
   *  page toggles them; every id in SIDEBAR_BUTTONS can show/hide. */
  // The settings button is deliberately NOT in this list: settings must
  // always stay reachable in the bottom-left corner.
  const SIDEBAR_BUTTONS = ['themeBtn', 'webBtn', 'gitBtn', 'skillBtn', 'marketBtn', 'detailsBtn'];
  A.SIDEBAR_BUTTONS = SIDEBAR_BUTTONS;
  function applySidebarButtons(cfg) {
    const on = (cfg && cfg.ui && cfg.ui.sidebarButtons) || {};
    for (const id of SIDEBAR_BUTTONS) {
      const elt = document.getElementById(id);
      if (!elt) continue;
      const visible = on[id] !== false;   // default on
      elt.style.display = visible ? '' : 'none';
    }
  }

  /** One entry point for "open a file in the configured editor": Electron
   *  bridge (editor-aware) or the /prts host route. */
  A.openFile = async function (path, editorId) {
    const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
    const ed = editorId || (A.config && A.config.ui && A.config.ui.editor) || 'default';
    if (b && b.openPath) {
      try { await b.openPath(path, ed); return; } catch (e) { /* fall through */ }
    }
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      await fetch(origin + '/prts/api/open-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, editor: ed }),
      });
    } catch (e) { /* noop */ }
  };

  /** Custom accent colors: primary (buttons/logo), diamond and square marks
   *  (independent, neon). Only applied when the theme is 'custom'. */
  function applyAccent(cfg) {
    const root = document.documentElement;
    const a = (cfg && cfg.ui && cfg.ui.accent) || {};
    if ((cfg && cfg.ui && cfg.ui.theme) === 'custom') {
      root.style.setProperty('--prts-accent', a.primary || '');
      root.style.setProperty('--prts-diamond', a.diamond || '');
      root.style.setProperty('--prts-square', a.square || '');
    } else {
      root.style.removeProperty('--prts-accent');
      root.style.removeProperty('--prts-diamond');
      root.style.removeProperty('--prts-square');
    }
  }

  /** Liquid-glass master switch (default on). */
  function applyGlass(cfg) {
    document.body.dataset.glass = cfg && cfg.ui && cfg.ui.glass === false ? 'off' : 'on';
  }

  /** Custom wallpaper layer: image or video under everything except the
   *  background diamond/square marks (they sit in their own layers above). */
  async function applyWallpaper(cfg) {
    const layer = $('wallpaperLayer');
    if (!layer) return;
    const w = (cfg && cfg.ui && cfg.ui.wallpaper) || null;
    if (!w || !w.file) {
      layer.innerHTML = '';
      layer.style.display = 'none';
      delete document.body.dataset.wallpaper;
      return;
    }
    let dataUrl = '';
    try {
      const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
      if (b && b.readFileB64) {
        const b64 = await b.readFileB64(P.platform.prtsProfileDir() + '/wallpaper/' + w.file);
        dataUrl = 'data:' + (w.mime || 'image/jpeg') + ';base64,' + b64;
      } else {
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
        const res = await fetch(origin + '/prts/api/wallpaper?file=' + encodeURIComponent(w.file));
        const data = await res.json();
        if (data && data.dataUrl) dataUrl = data.dataUrl;
      }
    } catch (e) { dataUrl = ''; }
    layer.innerHTML = '';
    layer.style.display = '';
    layer.style.opacity = String(w.opacity !== undefined ? w.opacity : 0.35);
    // wallpapered surfaces (sidebar/details/panels) turn liquid-glass
    document.body.dataset.wallpaper = 'on';
    if (!dataUrl) return;
    let media;
    if (w.type === 'video') {
      const v = document.createElement('video');
      v.src = dataUrl;
      v.autoplay = true;
      v.muted = true;
      v.playsInline = true;
      v.loop = w.loop !== false;
      try { v.playbackRate = Number(w.speed) || 1; } catch (e) { /* noop */ }
      media = v;
    } else {
      const im = document.createElement('img');
      im.src = dataUrl;
      media = im;
    }
    media.style.width = '100%';
    media.style.height = '100%';
    media.style.objectFit = w.fit || 'cover';
    layer.appendChild(media);
  }

  /* ---------- PRTS modal (replaces window.prompt / window.confirm, which
     Electron disables) ---------- */
  let modalResolve = null;
  let modalBrowseCb = null;
  function openModal(kind, title, placeholder, labels, opts) {
    const ov = $('modalOverlay');
    $('modalTitle').textContent = title;
    const input = $('modalInput');
    input.value = '';
    input.placeholder = placeholder || '';
    input.hidden = kind !== 'prompt';
    const bodyEl = $('modalBody');
    if (bodyEl) {
      bodyEl.textContent = opts && opts.body ? opts.body : '';
      bodyEl.style.display = opts && opts.body ? '' : 'none';
    }
    const actions = $('modalActions');
    actions.textContent = '';
    const makeBtn = (label, cls, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sBtn ' + (cls || '');
      b.textContent = label;
      b.addEventListener('click', () => settleModal(value));
      return b;
    };
    if (kind === 'choice' && opts && Array.isArray(opts.choices)) {
      for (const c of opts.choices) actions.appendChild(makeBtn(c.label, c.primary ? 'primary' : '', c.id));
    } else if (kind === 'alert') {
      actions.appendChild(makeBtn((labels && labels.ok) || A.t('common.ok'), 'primary', true));
    } else {
      actions.appendChild(makeBtn((labels && labels.cancel) || A.t('common.cancel'), '', kind === 'confirm' ? false : null));
      actions.appendChild(makeBtn((labels && labels.ok) || A.t('common.ok'), 'primary', kind === 'confirm' ? true : undefined));
    }
    const extra = $('modalExtra');
    if (opts && typeof opts.onBrowse === 'function') {
      modalBrowseCb = opts.onBrowse;
      $('modalBrowseBtn').textContent = opts.browseLabel || '…';
      extra.hidden = false;
    } else {
      modalBrowseCb = null;
      extra.hidden = true;
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && kind === 'prompt') settleModal(input.value);
    });
    ov.classList.add('open');
    if (kind === 'prompt') setTimeout(() => input.focus(), 40);
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  /** Three-way choice dialog: resolves the chosen id. */
  A.askChoice = function (title, body, choices) {
    return openModal('choice', title, '', null, { body, choices });
  };
  function settleModal(value) {
    $('modalOverlay').classList.remove('open');
    const r = modalResolve;
    modalResolve = null;
    if (r) r(value);
  }
  A.askPrompt = (title, placeholder) => openModal('prompt', title, placeholder);
  A.askConfirm = (title, labels) => openModal('confirm', title, '', labels);
  A.alert = (title) => openModal('alert', title);

  /* ---------- sidebar: workspaces + sessions (dsh) ---------- */
  let sessionFilter = '';
  A.selecting = false;
  A.selectedSessions = new Set();

  function setSelecting(on) {
    A.selecting = on;
    if (!on) A.selectedSessions.clear();
    const btn = $('sessionSelectBtn');
    if (btn) btn.classList.toggle('on', on);
    const bar = $('sessionBulkBar');
    if (bar) bar.hidden = !on;
    renderSessions();
  }
  function toggleSelecting() { setSelecting(!A.selecting); }

  function visibleSessionIds() {
    return visibleSessions().map((s) => s.sessionId);
  }

  function updateBulkBar() {
    const bar = $('sessionBulkBar');
    if (!bar) return;
    const label = $('sessionBulkLabel');
    if (label) label.textContent = A.t('session.selected', { n: A.selectedSessions.size });
    const btn = $('sessionBulkArchive');
    if (btn) btn.disabled = A.selectedSessions.size === 0;
    const all = visibleSessionIds();
    const allSel = all.length > 0 && all.every((id) => A.selectedSessions.has(id));
    const allBtn = $('sessionBulkAll');
    if (allBtn) allBtn.textContent = A.t(allSel ? 'session.unselectAll' : 'session.selectAll');
  }

  async function archiveSelected() {
    const ids = [...A.selectedSessions];
    if (!ids.length) return;
    const ok = await A.askConfirm(A.t('session.confirmArchiveSelected', { n: ids.length }));
    if (!ok) return;
    try {
      await P.dshState.archiveSessions(ids);
      A.selectedSessions.clear();
      const clearedCurrent = P.dshState.currentSessionId && ids.indexOf(P.dshState.currentSessionId) >= 0;
      if (clearedCurrent) P.dshState.currentSessionId = null;
      await refreshSessions();
      await P.dshState.listWorkspaces().catch(() => {});
      renderWorkspaces();
      if (clearedCurrent) A.enterHero();
      A.toast(A.t('session.archivedSelected', { n: ids.length }));
    } catch (e) { A.toast(e.message); }
  }

  // File-tree sidebar: each workspace expands into its sessions, sessions
  // nest into sub-sessions (parentSessionId from session.list). The branch
  // is ALWAYS mounted so the collapse/expand animates (grid-rows 0fr↔1fr,
  // speed follows the drawer motion setting).
  A.wsExpanded = new Set()

  function workspaceBranch(w) {
    const branch = document.createElement('div')
    branch.className = 'sbTreeBranch'
    const inner = document.createElement('div')
    inner.className = 'sbTreeInner'
    branch.appendChild(inner)
    // searching force-opens every branch so matches are visible
    if (!A.wsExpanded.has(w.workspaceId) && !sessionFilter.trim()) branch.classList.add('closed')
    return { branch, inner }
  }

  /** Build one workspace row: chevron (toggle expand) + name + count +
   *  delete. Clicking the row itself selects the workspace (unchanged). */
  function buildWorkspaceRow(w) {
    const row = document.createElement('div');
    row.className = 'sbItem sbWsTree' + (w.workspaceId === P.dshState.currentWorkspaceId ? ' active' : '');
    row.dataset.workspace = w.workspaceId;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    const chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'sbTreeChev';
    chev.setAttribute('aria-expanded', String(A.wsExpanded.has(w.workspaceId)));
    chev.setAttribute('aria-label', 'expand');
    chev.innerHTML = P.icons.chev || '▸';
    chev.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = A.wsExpanded.has(w.workspaceId);
      if (open) A.wsExpanded.delete(w.workspaceId);
      else A.wsExpanded.add(w.workspaceId);
      const branch = row.nextElementSibling;
      if (branch && branch.classList.contains('sbTreeBranch')) {
        branch.classList.toggle('closed', open);
        chev.setAttribute('aria-expanded', String(!open));
      }
    });
    row.appendChild(chev);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = w.title || w.workspaceId;
    row.appendChild(name);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = String(w.sessionIds ? w.sessionIds.length : 0);
    row.appendChild(meta);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'rowBtn sbAddBtn';
    add.title = A.t('sidebar.newSession');
    add.innerHTML = '<svg width="11" height="11" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.2v10.6M1.2 6.5h10.6" stroke="currentColor" stroke-width="1.4"/></svg>';
    add.addEventListener('click', (e) => { e.stopPropagation(); P.dshState.currentWorkspaceId = w.workspaceId; newSession(); });
    row.appendChild(add);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rowBtn';
    del.title = A.t('common.delete');
    del.innerHTML = P.icons['ma.trash'] || '';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteWorkspace(w.workspaceId); });
    row.appendChild(del);
    row.addEventListener('click', () => selectWorkspace(w.workspaceId));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectWorkspace(w.workspaceId); } });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (A.selecting) return;
      showTreeMenu(e.clientX, e.clientY, [
        { label: A.t('tree.newSession'), fn: () => { P.dshState.currentWorkspaceId = w.workspaceId; newSession(); } },
        { label: A.t('workspace.rename') || '重命名', fn: () => renameWorkspaceFlow(w) },
        { label: A.t('common.delete'), danger: true, fn: () => deleteWorkspace(w.workspaceId) },
      ]);
    });
    return row;
  }

  /** Sessions of one workspace rendered as a nested tree (children under
   *  their parent, any depth), newest-first like the global list. The
   *  search filter (sessionFilter) applies here — the unified sidebar has
   *  no separate flat list anymore. */
  function buildTreeSessions(w, container) {
    const byId = new Map();
    for (const s of P.dshState.sessions) byId.set(s.sessionId, s);
    const byParent = new Map();
    for (const s of P.dshState.sessions) {
      if (s.parentSessionId) {
        const arr = byParent.get(s.parentSessionId) || [];
        arr.push(s);
        byParent.set(s.parentSessionId, arr);
      }
    }
    const q = sessionFilter.trim().toLowerCase();
    const match = (s) => {
      if (!q) return true;
      const title = P.dshState.sessionTitle(s);
      const sid = String(s.sessionId || '');
      return title.toLowerCase().indexOf(q) >= 0 || sid.toLowerCase().indexOf(q) >= 0;
    };
    const kids = (id) => (byParent.get(id) || []).slice().filter(match).sort((a, b) => b.updatedAt - a.updatedAt);
    const top = (w.sessionIds || [])
      .map((id) => byId.get(id))
      .filter((s) => s && !s.parentSessionId && match(s))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const walk = (sessions, depth) => {
      for (const s of sessions) {
        container.appendChild(buildTreeSessionRow(s, depth, container));
        const children = kids(s.sessionId);
        if (children.length) walk(children, depth + 1);
      }
    };
    walk(top, 0);
  }

  /** Tree session row: the flat-list row plus indentation and a sub-session
   *  marker; right-click offers 新建子会话 / 归档. */
  function buildTreeSessionRow(s, depth, container) {
    const row = document.createElement('div');
    row.className = 'sbItem sbTreeItem' + (s.sessionId === P.dshState.currentSessionId ? ' active' : '');
    row.dataset.session = s.sessionId;
    row.style.paddingLeft = Math.min(10 + depth * 14, 52) + 'px';
    if (depth > 0) {
      const mark = document.createElement('span');
      mark.className = 'sbTreeMark';
      mark.textContent = '↳';
      row.appendChild(mark);
    }
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'sbCheck' + (A.selectedSessions.has(s.sessionId) ? ' on' : '');
    box.setAttribute('aria-label', 'select');
    box.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2 4 7.6 8.5 2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    box.hidden = !A.selecting;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (A.selectedSessions.has(s.sessionId)) A.selectedSessions.delete(s.sessionId);
      else A.selectedSessions.add(s.sessionId);
      row.classList.toggle('checked', A.selectedSessions.has(s.sessionId));
      box.classList.toggle('on', A.selectedSessions.has(s.sessionId));
      updateBulkBar();
    });
    row.appendChild(box);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = P.dshState.sessionTitle(s);
    if (s.running) name.textContent += ' …';
    row.appendChild(name);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'rowBtn sbAddBtn';
    add.title = A.t('tree.newSubSession');
    add.innerHTML = '<svg width="11" height="11" viewBox="0 0 13 13" fill="none"><path d="M6.5 1.2v10.6M1.2 6.5h10.6" stroke="currentColor" stroke-width="1.4"/></svg>';
    add.addEventListener('click', (e) => { e.stopPropagation(); forkSessionFlow(s); });
    row.appendChild(add);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rowBtn';
    del.title = A.t('session.archive');
    del.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.2 2.2l6.6 6.6M8.8 2.2l-6.6 6.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); archiveSession(s.sessionId); });
    row.appendChild(del);
    const onActivate = () => {
      if (A.selecting) { box.click(); return; }
      selectSession(s.sessionId);
    };
    row.addEventListener('click', onActivate);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (A.selecting) return;
      showTreeMenu(e.clientX, e.clientY, [
        { label: A.t('tree.newSubSession'), fn: () => forkSessionFlow(s) },
        { label: A.t('session.archive'), fn: () => archiveSession(s.sessionId) },
      ]);
    });
    // where-you-are caption under the active row (the cwd of the open session)
    if (s.sessionId === P.dshState.currentSessionId && s.cwd && container) {
      const cap = document.createElement('div');
      cap.className = 'sbItemCwd';
      cap.textContent = s.cwd;
      cap.style.marginLeft = (Math.min(10 + depth * 14, 52) + 20) + 'px';
      container.appendChild(cap);
    }
    return row;
  }

  /** Tiny fixed context menu for the sidebar tree. */
  function showTreeMenu(x, y, items) {
    const old = document.getElementById('prtsTreeMenu');
    if (old) old.remove();
    const menu = document.createElement('div');
    menu.id = 'prtsTreeMenu';
    menu.style.cssText = 'position: fixed; z-index: 300; min-width: 150px; padding: 6px; border-radius: 10px; border: 1px solid var(--prts-hairline-strong); background: var(--prts-panel); box-shadow: 0 12px 32px rgba(0,0,0,.4);';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.style.cssText = 'display: block; width: 100%; text-align: left; height: 30px; padding: 0 10px; border: none; border-radius: 7px; background: transparent; color: ' + (it.danger ? '#f7768e' : 'var(--prts-ink-dim)') + '; font-size: 12.5px; cursor: pointer;';
      b.addEventListener('mouseenter', () => { b.style.background = 'var(--prts-surface-2)'; b.style.color = it.danger ? '#f7768e' : 'var(--prts-ink)'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = it.danger ? '#f7768e' : 'var(--prts-ink-dim)'; });
      b.addEventListener('click', () => { menu.remove(); it.fn(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    window.addEventListener('scroll', close, { once: true });
  }

  /** Fork the session into a sub-session, then open it. */
  async function forkSessionFlow(s) {
    try {
      const childId = await P.dshState.forkSession(s.sessionId);
      if (!childId) { A.toast(A.t('session.forkFail')); return; }
      await P.dshState.listWorkspaces().catch(() => {});
      await refreshSessions();
      renderWorkspaces();
      if (childId) {
        P.dshState.currentSessionId = childId;
        A.enterChat();
        await P.chat.loadHistory(childId);
        highlightSessions();
        highlightWorkspaces();
        A.toast(A.t('session.forked'));
      }
    } catch (e) {
      A.toast(A.t('session.forkFail') + ' — ' + String((e && e.message) || e));
    }
  }

  async function renameWorkspaceFlow(w) {
    const next = await A.askPrompt(A.t('workspace.rename'), w.title || w.workspaceId);
    if (!next || !next.trim()) return;
    try {
      await P.dshState.renameWorkspace(w.workspaceId, next.trim());
      await P.dshState.listWorkspaces();
      renderWorkspaces();
      updateCrumb();
    } catch (e) {
      A.toast(String((e && e.message) || e));
    }
  }

  // Chunked DOM renders: every call yields to the animation frame between
  // batches so switching sessions/workspaces (and the intro) never jank.
  let wsRenderToken = 0;
  function renderWorkspaces() {
    const list = $('projectList');
    const done = new Promise((r) => { wsDoneResolve = r; });
    const token = ++wsRenderToken;
    list.textContent = '';
    const ws = P.dshState.workspaces;
    if (!ws.length) {
      $('projectCount').textContent = '0';
      const cnt = $('sessionCount');
      if (cnt) cnt.textContent = '0';
      const empty = document.createElement('div');
      empty.className = 'sbEmpty';
      empty.textContent = A.t(sessionFilter ? 'sidebar.searchNone' : 'sidebar.sessionsEmpty');
      list.appendChild(empty);
      updateBulkBar();
      if (wsDoneResolve) { wsDoneResolve(); wsDoneResolve = null; }
      return done;
    }
    let i = 0;
    const CHUNK = 20;
    const step = () => {
      if (token !== wsRenderToken) { if (wsDoneResolve) { wsDoneResolve(); wsDoneResolve = null; } return done; }
      const end = Math.min(i + CHUNK, ws.length);
      for (; i < end; i++) {
        const w = ws[i];
        list.appendChild(buildWorkspaceRow(w));
        const { branch, inner } = workspaceBranch(w);
        buildTreeSessions(w, inner);
        list.appendChild(branch);
      }
      if (i < ws.length) requestAnimationFrame(step);
      else {
        $('projectCount').textContent = String(ws.length);
        const v = visibleSessions().length;
        const cnt = $('sessionCount');
        if (cnt) cnt.textContent = String(v);
        if (v === 0) {
          const empty = document.createElement('div');
          empty.className = 'sbEmpty';
          empty.textContent = A.t(sessionFilter ? 'sidebar.searchNone' : 'sidebar.sessionsEmpty');
          list.appendChild(empty);
        }
        updateBulkBar();
        if (wsDoneResolve) { wsDoneResolve(); wsDoneResolve = null; }
      }
    };
    step();
    return done;
  }
  let wsDoneResolve = null;

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

  function buildSessionRow(s) {
    const row = document.createElement('div');
    row.className = 'sbItem' + (s.sessionId === P.dshState.currentSessionId ? ' active' : '');
    row.dataset.session = s.sessionId;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'sbCheck' + (A.selectedSessions.has(s.sessionId) ? ' on' : '');
    box.setAttribute('aria-label', 'select');
    box.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2 4 7.6 8.5 2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    box.hidden = !A.selecting;
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (A.selectedSessions.has(s.sessionId)) A.selectedSessions.delete(s.sessionId);
      else A.selectedSessions.add(s.sessionId);
      row.classList.toggle('checked', A.selectedSessions.has(s.sessionId));
      box.classList.toggle('on', A.selectedSessions.has(s.sessionId));
      updateBulkBar();
    });
    row.appendChild(box);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = P.dshState.sessionTitle(s);
    if (s.running) name.textContent += ' …';
    row.appendChild(name);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'rowBtn';
    del.title = A.t('session.archive');
    del.innerHTML = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2.2 2.2l6.6 6.6M8.8 2.2l-6.6 6.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); archiveSession(s.sessionId); });
    row.appendChild(del);
    const onActivate = () => {
      if (A.selecting) { box.click(); return; }
      selectSession(s.sessionId);
    };
    row.addEventListener('click', onActivate);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } });
    return row;
  }

  function renderSessions() {
    // Unified sidebar: the tree IS the session list (search filter applies
    // there), so a session re-render is a workspace/tree re-render.
    updateBulkBar();
    return renderWorkspaces();
  }

  /** Cheap re-highlight: only the active classes change, zero DOM rebuild. */
  function highlightSessions() {
    const list = $('sessionList');
    const trees = document.querySelectorAll('.sbTreeInner');
    if (list) {
      for (const row of list.children) {
        if (!row.dataset || !row.dataset.session) continue;
        row.classList.toggle('active', row.dataset.session === P.dshState.currentSessionId);
      }
    }
    for (const inner of trees) {
      const cap = inner.querySelector('.sbItemCwd');
      if (cap) cap.remove();
      for (const row of inner.children) {
        if (!row.dataset || !row.dataset.session) continue;
        const isActive = row.dataset.session === P.dshState.currentSessionId;
        row.classList.toggle('active', isActive);
        if (isActive) {
          const s = P.dshState.sessions.find((x) => x.sessionId === P.dshState.currentSessionId);
          if (s && s.cwd) {
            const c = document.createElement('div');
            c.className = 'sbItemCwd';
            c.textContent = s.cwd;
            c.style.marginLeft = (parseInt(row.style.paddingLeft || '10', 10) + 20) + 'px';
            inner.insertBefore(c, row.nextSibling);
          }
        }
      }
    }
  }
  function highlightWorkspaces() {
    const list = $('projectList');
    if (!list) return;
    for (const row of list.children) {
      if (!row.dataset || !row.dataset.workspace) continue;
      row.classList.toggle('active', row.dataset.workspace === P.dshState.currentWorkspaceId);
    }
  }

  async function selectWorkspace(id) {
    P.dshState.currentWorkspaceId = id;
    if (!A.wsExpanded.has(id)) {
      A.wsExpanded.add(id);
      renderWorkspaces();
    }
    const loading = refreshSessions();   // list refresh + chunked rebuild
    highlightWorkspaces();               // instant feedback on the current rows
    updateCrumb();
    if (A.refreshWorkspacePop) A.refreshWorkspacePop();
    await loading;
  }

  async function refreshSessions() {
    await P.dshState.listSessions();
    renderSessions();
  }

  async function selectSession(id, opts) {
    P.dshState.currentSessionId = id;
    const summary = P.dshState.sessionSummary(id);
    if (summary && summary.agentPreset) {
      P.dshState.currentPreset = summary.agentPreset;
      setModeLabel(presetLabel(summary.agentPreset));
    }
    P.dshState.permissions = P.dshState.permissionState(id);
    updatePermissionChip();
    if (A.refreshPermissionPop) A.refreshPermissionPop();
    A.enterChat();
    // The switch itself returns immediately: model details, history paging,
    // folding and the chunked render all happen in the background.
    P.dshState.sessionModels(id).then(() => { updateModelChip(); updateReasoningChip(); }).catch(() => { /* catalog warming up */ });
    const hist = P.chat.loadHistory(id);
    highlightSessions();      // cheap: only the active class flips
    highlightWorkspaces();
    revealSession(id);        // expand the branch + scroll the glowing row in
    updateMeter();
    renderStatsDock();
    updateCrumb();
    if (opts && opts.waitHistory) await hist;
  }

  /** Expand the branch holding the given session (if collapsed) and scroll
   *  it into view so the glowing current position is always visible. */
  function revealSession(id) {
    const ws = P.dshState.workspaces.find((w) => (w.sessionIds || []).indexOf(id) >= 0);
    if (!ws) return;
    if (!A.wsExpanded.has(ws.workspaceId)) {
      A.wsExpanded.add(ws.workspaceId);
      renderWorkspaces();
    }
    requestAnimationFrame(() => {
      const row = document.querySelector('#projectList [data-session="' + id + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    });
  }

  async function newSession() {
    try {
      const wsId = P.dshState.currentWorkspaceId;
      const id = await P.dshState.createSession(wsId, A.currentPreset || undefined);
      if (id) {
        // dsh web behaviour: a fresh session lands on the welcome screen
        // (logo + tagline), with the composer ready to take the first line.
        P.dshState.currentSessionId = id;
        if (A.currentPreset) setModeLabel(presetLabel(A.currentPreset));
        await refreshSessions();
        revealSession(id);
        P.dshState.permissions = P.dshState.permissionState(id);
        updatePermissionChip();
        if (A.refreshPermissionPop) A.refreshPermissionPop();
        A.enterHero();
        renderSessions();
        updateCrumb();
        updateMeter();
        renderStatsDock();
        A.toast(A.t('session.created'));
        try { await P.dshState.sessionModels(id); } catch (e) { /* model catalog may be warming up */ }
        updateModelChip();
        updateReasoningChip();
      }
    } catch (e) {
      A.toast(A.t('session.createFail') + ' — ' + String(e && e.message ? e.message : e));
    }
  }

  async function archiveSession(id) {
    const ok = await A.askConfirm(A.t('session.confirmArchive'));
    if (!ok) return;
    try {
      await P.dshState.archiveSession(id);
    } catch (e) {
      A.toast(String(e && e.message || e));
      return;
    }
    await refreshSessions();
    await P.dshState.listWorkspaces().catch(() => {});
    renderWorkspaces();
    if (P.dshState.currentSessionId === id) {
      // The open session was deleted — return to the welcome screen.
      P.dshState.currentSessionId = null;
      A.enterHero();
    }
    A.toast(A.t('session.archivedOne'));
  }

  async function deleteWorkspace(id) {
    const ok = await A.askConfirm(A.t('workspace.confirmDelete'));
    if (!ok) return;
    await P.dshState.deleteWorkspace(id);
    await refreshAll();
    // The open session may have died with its workspace — land on the hero.
    if (P.dshState.currentSessionId && !P.dshState.sessionSummary(P.dshState.currentSessionId)) {
      P.dshState.currentSessionId = null;
      A.enterHero();
    }
  }

  /** Pick a workspace directory through the best available native path:
   *  1. Electron's own OS file manager (the `prts:pickDirectory` bridge) —
   *     this is the system dialog dsh web opens, and it works on every OS.
   *  2. dsh's host.pickDirectory RPC (the same native path dsh web uses).
   *  3. Chromium's showDirectoryPicker (browser mode; reports name only).
   *  Resolves { path } | { nameOnly } | null (cancelled) | undefined (no picker). */
  async function pickWorkspacePath() {
    let bridge = null;
    try { bridge = window.prts && window.prts.bridge; } catch (e) { /* no bridge */ }
    if (bridge && typeof bridge.pickDirectory === 'function') {
      try {
        const r = await bridge.pickDirectory(A.t('workspace.pickTitle'));
        if (r === null || r === undefined) return null;
        if (typeof r === 'string') return { path: r };
        // { error } — fall through to the dsh/browser pickers.
      } catch (e) { /* dialog failed — fall through */ }
    }
    try {
      const path = await P.dshState.pickDirectory();
      if (typeof path === 'string' && path) return { path };
      return null;
    } catch (e) { /* picker-less host — fall through */ }
    if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        return handle ? { nameOnly: handle.name } : null;
      } catch (e2) { return null; }
    }
    return undefined;
  }

  async function browseWorkspacePath() {
    const input = $('modalInput');
    if (!input) return;
    const picked = await pickWorkspacePath();
    if (picked && picked.path) { input.value = picked.path; input.focus(); return; }
    if (picked && picked.nameOnly) {
      input.value = picked.nameOnly;
      input.focus();
      A.toast(A.t('workspace.browseNameOnly'));
      return;
    }
    if (picked === null) return;   // user cancelled the OS dialog — stay silent
    A.toast(A.t('workspace.browseUnavailable'));
  }

  async function createWorkspaceAt(path) {
    try {
      const r = await P.dshState.createWorkspace(path);
      await refreshAll();
      const createdId = r && r.workspace && r.workspace.workspaceId;
      if (createdId) P.dshState.currentWorkspaceId = createdId;
      else {
        const ws = P.dshState.workspaces.find((w) => w.path === path);
        if (ws) P.dshState.currentWorkspaceId = ws.workspaceId;
      }
      renderWorkspaces();
      updateCrumb();
      // dsh web behaviour: a fresh workspace lands on the welcome screen.
      A.enterHero();
      A.toast(A.t('workspace.created'));
    } catch (e) {
      A.toast(e.message);
    }
  }

  async function newWorkspace() {
    // dsh web parity: the OS file manager is the primary path (open it first);
    // typing a path stays available in the fallback modal below.
    const picked = await pickWorkspacePath();
    if (picked && picked.path) { await createWorkspaceAt(picked.path); return; }
    if (picked && picked.nameOnly) {
      const path = await A.askPrompt(A.t('workspace.pathPrompt'), '/path/to/project');
      if (!path || !path.trim()) return;
      await createWorkspaceAt(path.trim());
      return;
    }
    if (picked === null) return;   // cancelled the OS dialog
    // No native picker anywhere: the classic prompt (with browse) is the fallback.
    const path = await A.askPrompt(A.t('workspace.pathPrompt'), '/path/to/project', {
      browseLabel: A.t('workspace.browse'),
      onBrowse: browseWorkspacePath,
    });
    if (!path || !path.trim()) return;
    await createWorkspaceAt(path.trim());
  }

  async function refreshAll() {
    await P.dshState.refreshAll();
    await loadCredentialState();
    if (!P.dshState.currentWorkspaceId && P.dshState.workspaces.length) {
      P.dshState.currentWorkspaceId = P.dshState.workspaces[0].workspaceId;
    }
    if (P.dshState.currentWorkspaceId) A.wsExpanded.add(P.dshState.currentWorkspaceId);
    renderWorkspaces();
    renderSessions();
    if (P.dshState.currentSessionId) revealSession(P.dshState.currentSessionId);
    updateModelChip();
    updateReasoningChip();
    updatePermissionChip();
    if (A.refreshModelPop) A.refreshModelPop();
    if (A.refreshReasoningPop) A.refreshReasoningPop();
    if (A.refreshPermissionPop) A.refreshPermissionPop();
    if (A.refreshModePop) A.refreshModePop();
    const presetId = A.currentPreset || (P.dshState.currentSessionId ? (P.dshState.sessionSummary(P.dshState.currentSessionId) || {}).agentPreset : null);
    if (presetId) setModeLabel(presetLabel(presetId));
    if (A.refreshWorkspacePop) A.refreshWorkspacePop();
    updateMeter();
    renderStatsDock();
    updateCrumb();
  }

  /* ---------- mode (agent preset) ---------- */
  function presetLabel(id) {
    const p = P.dshState.presets.find((x) => (x.id || x.agentPreset) === id);
    return p ? (p.name || id) : id;
  }

  /** Keep every mode label in sync: header chip + hero chip. */
  function modeIconFor(preset) {
    const map = { standard: 'mode.standard', code: 'mode.code', minimal: 'mode.minimal', cordis: 'mode.cordis', prts: 'mode.cordis' };
    return P.icons[map[preset]] || P.icons['mode.standard'] || '';
  }
  A.modeIconFor = modeIconFor;
  function setModeLabel(text, presetId) {
    const h = $('headerMode');
    if (h) h.textContent = text;
    const hero = $('heroModeLabel');
    if (hero) hero.textContent = text;
    // dedicated abstract mark per work mode (standard / PTC / 极简 / 创造)
    const icon = modeIconFor(presetId || A.currentPreset);
    for (const id of ['modeChipIcon', 'heroModeChipIcon']) {
      const box = $(id);
      if (box) box.innerHTML = icon;
    }
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
    const e = currentModelEntry();
    const text = e ? e.model.id : '—';
    const title = e ? (e.provider || '') + ' / ' + e.model.id : '';
    for (const id of ['modelChipLabel', 'heroModelLabel']) {
      const label = $(id);
      if (!label) continue;
      label.textContent = text;
      label.title = title;
    }
  }

  function updateReasoningChip() {
    const e = currentModelEntry();
    const reasoning = e && e.model.reasoning;
    for (const [chipId, labelId] of [['reasoningChip', 'reasoningChipLabel'], ['heroReasoningChip', 'heroReasoningLabel']]) {
      const chip = $(chipId);
      const label = $(labelId);
      if (!chip || !label) continue;
      if (!reasoning || !reasoning.efforts || !reasoning.efforts.length) {
        chip.hidden = true;
        continue;
      }
      chip.hidden = false;
      const cur = (P.dshState.currentModel && P.dshState.currentModel.reasoningEffort) || reasoning.defaultEffort;
      const eff = reasoning.efforts.find((x) => x.id === cur) || reasoning.efforts[0];
      label.textContent = eff.name || eff.id;
      chip.title = A.t('reasoning.title');
    }
  }

  /* ---------- permission chip (header + composer) ---------- */
  function permissionIconFor(value) {
    const map = { 'read-only': 'perm.readonly', 'workspace-write': 'perm.workspacewrite', 'danger-full-access': 'perm.danger' };
    return P.icons[map[value]] || P.icons['perm.readonly'] || '';
  }
  A.permissionIconFor = permissionIconFor;
  function updatePermissionChip() {
    const st = P.dshState.permissions;
    const has = !!(st && st.options && st.options.length);
    const cur = has ? st.options.find((o) => o.value === st.currentValue) : null;
    const label = has ? P.dshState.permissionDisplayName(cur || st.options[0]) : '—';
    for (const [chipId, labelId] of [['permissionChip', 'permissionChipLabel'], ['composerPermissionChip', 'composerPermissionChipLabel']]) {
      const chip = $(chipId);
      const el = $(labelId);
      if (!chip || !el) continue;
      chip.hidden = !has;
      el.textContent = label;
      chip.title = A.t('permission.title');
      // shield mark per permission preset (abstract glyphs inside a shield)
      let iconBox = chip.querySelector('.permIcon');
      if (!iconBox) {
        iconBox = document.createElement('span');
        iconBox.className = 'permIcon';
        chip.insertBefore(iconBox, chip.firstChild);
      }
      iconBox.innerHTML = permissionIconFor(cur ? cur.value : null);
    }
  }

  /* ---------- session stats dock (turns · steps / LLM · tools / TTFT · tok/s / cache / tokens) ---------- */
  function fmtDur(ms) {
    const n = Number(ms);
    if (!isFinite(n) || n <= 0) return '—';
    const s = Math.round(n / 1000);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
  }
  function fmtTok(n) {
    if (n === undefined || n === null || !isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 10e6 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(v));
  }
  function renderStatsDock() {
    const dock = $('statsDock');
    if (!dock) return;
    const v = P.dshState.projectionValues(P.dshState.currentSessionId);
    const st = v && v.sessionStats ? v.sessionStats : {};
    const tu = v && v.tokenUsage ? v.tokenUsage : {};
    const parts = [];
    if (st.turns !== undefined || st.steps !== undefined) {
      parts.push(A.t('stats.turnsSteps', { turns: st.turns || 0, steps: st.steps || 0 }));
    }
    if (st.llmMs || st.toolMs) {
      parts.push(A.t('stats.llmTool', { llm: fmtDur(st.llmMs), tool: fmtDur(st.toolMs) }));
    }
    if (st.ttftMs && st.ttftSteps) {
      const ttft = (st.ttftMs / st.ttftSteps / 1000).toFixed(1) + 's';
      const tps = st.decodeMs ? Math.round(st.decodeTokens / (st.decodeMs / 1000)) : 0;
      parts.push(A.t('stats.ttft', { ttft, tps }));
    }
    const cacheRead = tu.cacheReadTokens || 0;
    const uncached = tu.uncachedInputTokens || 0;
    if (cacheRead + uncached > 0) {
      const pct = Math.round((cacheRead / (cacheRead + uncached)) * 100);
      parts.push(A.t('stats.cache', { pct }));
    }
    if (tu.outputTokens !== undefined || (cacheRead + uncached) > 0) {
      parts.push(A.t('stats.io', { input: fmtTok(cacheRead + uncached), output: fmtTok(tu.outputTokens) }));
    }
    dock.hidden = parts.length === 0;
    dock.textContent = '';
    parts.forEach((text, i) => {
      if (i > 0) dock.appendChild(elSpan(' · '));
      dock.appendChild(elB(text));
    });
  }
  function elSpan(text) {
    const s = document.createElement('span');
    s.className = 'statSep';
    s.textContent = text;
    return s;
  }
  function elB(text) {
    const b = document.createElement('span');
    b.className = 'stat';
    b.textContent = text;
    return b;
  }
  A.renderStatsDock = renderStatsDock;

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

  /* ---------- settings overlay (delegated to src/gui/settings.js) ---------- */
  A.openSettings = function () { if (P.settingsPanel) P.settingsPanel.open(A.config); };
  A.closeSettings = function () { if (P.settingsPanel) P.settingsPanel.close(); };

  /* ---------- details panel ---------- */
  function showDetailsDefault() {
    $('dtTitle').textContent = A.t('details.title');
    $('dtBody').innerHTML = '<div class="dtEmpty">' + A.t('details.empty') + '</div>';
  }

  /* ---------- plugin market (delegated to src/gui/market.js) ---------- */
  A.openMarket = function () {
    $('marketOverlay').classList.add('open');
    if (P.market) P.market.open();
  };
  A.closeMarket = function () { $('marketOverlay').classList.remove('open'); };

  /* ---------- git panel (sidebar) ---------- */
  A.openGit = function () {
    $('gitOverlay').classList.add('open');
    if (P.git) P.git.render($('gitBody'), A.config);
  };
  A.closeGit = function () { $('gitOverlay').classList.remove('open'); };

  /* ---------- WEB panel (iframe: dsh-web itself, incl. its plugin market) ---------- */
  A.openWeb = function () {
    const frame = $('webFrame');
    if (frame && !frame.src) {
      let base = 'http://127.0.0.1:3081';
      try {
        const u = P.dshState && P.dshState.url;
        if (u) base = String(u).replace(/\/+$/, '');
      } catch (e) { /* default */ }
      frame.src = base + '/';
    }
    $('webOverlay').classList.add('open');
  };
  A.closeWeb = function () { $('webOverlay').classList.remove('open'); };

  /* ---------- skill dock (sidebar) ---------- */
  A.openSkills = function () {
    $('skillOverlay').classList.add('open');
    if (P.skills) P.skills.render($('skillBody'), A.config);
  };
  A.closeSkills = function () { $('skillOverlay').classList.remove('open'); };

  /* ---------- header / crumbs ---------- */
  function updateCrumb() {
    const ws = P.dshState.workspaces.find((w) => w.workspaceId === P.dshState.currentWorkspaceId);
    const label = ws ? (ws.title || ws.workspaceId) : 'dsh';
    const crumb = $('crumbProjectLabel');
    if (crumb) crumb.textContent = label;
    for (const id of ['heroWsLabel', 'sidebarWsLabel']) {
      const el = $(id);
      if (el) el.textContent = label;
    }
  }

  /* ---------- phase / tabs ---------- */
  A.enterChat = function () {
    A.heroVisible = false;
    if (A.heroEngine) { A.heroEngine.stop(); A.heroEngine = null; }
    const cvt = $('cvt');
    cvt.dataset.phase = 'active';
    $('header').hidden = false;
    $('heroView').hidden = true;
    $('chatScroll').hidden = false;
    switchView('chat');
  };
  // Welcome screen (dsh web's logo view): the diamond + italic PRTS wordmark
  // with the tagline, ambient particles, and the composer ready below.
  A.enterHero = function () {
    A.heroVisible = true;
    if (A.heroEngine) { A.heroEngine.stop(); A.heroEngine = null; }
    // Keep the composer's session pointer in sync: sending from the welcome
    // screen must address the freshly created/selected session, not null.
    P.chat.sessionId = P.dshState.currentSessionId || null;
    P.chat.messages = [];
    P.chat.renderFlow();
    const cvt = $('cvt');
    cvt.dataset.phase = 'hero';
    $('header').hidden = true;
    $('heroView').hidden = false;
    $('chatScroll').hidden = true;
    const traj = $('trajView');
    if (traj) traj.hidden = true;
    const composer = $('composerArea');
    if (composer) composer.style.display = '';
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === 'chat'));
    syncHeroOffset();
    startHeroAmbient();
  };
  // The logo stack must centre on the background diamond/square behind it.
  // That square sits at the .cvt centre, while the hero area stops above the
  // composer — so the stack is pushed down by half the composer's height.
  function syncHeroOffset() {
    const stack = $('heroStack');
    const area = $('composerArea');
    if (!stack || !area) return;
    stack.style.setProperty('--hero-shift', Math.round(area.offsetHeight / 2) + 'px');
  }
  function switchView(view) {
    const chat = $('chatScroll');
    const traj = $('trajView');
    const composer = $('composerArea');
    if (view === 'trajectory') {
      chat.hidden = true;
      traj.hidden = false;
      composer.style.display = 'none';
      P.chat.renderTimeline();
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
    // Mobile: the sidebar is an off-canvas overlay — the same single toggle
    // slides it in/out without touching the desktop grid widths.
    if (A.mobile) {
      const open = appEl().classList.toggle('mobileNavOpen');
      const btn = $('sbToggleBtn');
      if (btn) {
        btn.title = A.t(open ? 'sidebar.collapse' : 'sidebar.expand');
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', A.t(open ? 'sidebar.collapse' : 'sidebar.expand'));
      }
      return;
    }
    const collapsed = appEl().classList.toggle('sbCollapsed');
    // Restoring always returns to the previous width (the "original position").
    appEl().style.setProperty('--dsh-sb', collapsed ? '0px' : A_.sbWidth + 'px');
    const btn = $('sbToggleBtn');
    if (btn) {
      btn.title = A.t(collapsed ? 'sidebar.expand' : 'sidebar.collapse');
      btn.setAttribute('aria-expanded', String(!collapsed));
      btn.setAttribute('aria-label', A.t(collapsed ? 'sidebar.expand' : 'sidebar.collapse'));
    }
    placeHandles();
  }

  /* ---------- popovers ---------- */
  let openPop = null;
  function closePops() { if (openPop) { openPop.classList.remove('open'); openPop = null; } }
  function attachPop(trigger, itemsHtml, onPick, alignRight) {
    const pop = document.createElement('div');
    pop.className = 'pop';
    if (alignRight) { pop.style.left = 'auto'; pop.style.right = '0'; }
    // A function builder is re-run on EVERY open, so a popover can never
    // show a stale snapshot (the old "Max selected but High is ticked" bug).
    const build = typeof itemsHtml === 'function' ? itemsHtml : () => itemsHtml;
    pop.innerHTML = build();
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
      if (r.top < 220) pop.classList.add('below');
      else pop.classList.remove('below');
      pop.innerHTML = build();
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
      '<div class="popItem' + (o.value === st.currentValue ? ' selected' : '') + '" data-permission="' + o.value + '"><span class="label">' + P.dshState.permissionDisplayName(o) + '</span><span class="tick">&#10003;</span></div>'
    ).join('');
  }

  function bindPopovers() {
    // Model + reasoning + mode + workspace popovers are duplicated between the
    // header/composer chips (chat phase) and the hero bar chips (welcome
    // screen), because the hero must offer the same selectors dsh web's
    // initial page offers. Each handler is written once and shared.
    async function applyModelPick(item) {
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
    }
    const modelPops = [];
    for (const id of ['modelChip', 'heroModelChip']) {
      const trigger = $(id);
      if (!trigger) continue;
      modelPops.push(attachPop(trigger, buildModelPop, applyModelPick));
    }
    A.refreshModelPop = () => { for (const pop of modelPops) pop.innerHTML = buildModelPop(); };

    async function applyReasoningPick(item) {
      if (!item.dataset.effort) return;
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      const e = currentModelEntry();
      if (!e) return;
      try {
        await P.dshState.selectModel(P.dshState.currentSessionId, e.provider, e.model.id, item.dataset.effort);
        await P.dshState.sessionModels(P.dshState.currentSessionId);
        updateModelChip();
        updateReasoningChip();
        if (A.refreshReasoningPop) A.refreshReasoningPop();
        closePops();
      } catch (err) { A.toast(err.message); }
    }
    const reasoningPops = [];
    for (const id of ['reasoningChip', 'heroReasoningChip']) {
      const trigger = $(id);
      if (!trigger) continue;
      reasoningPops.push(attachPop(trigger, buildReasoningPop, applyReasoningPick));
    }
    A.refreshReasoningPop = () => { for (const pop of reasoningPops) pop.innerHTML = buildReasoningPop(); };

    async function applyPermissionPreset(value) {
      if (!P.dshState.currentSessionId) { A.toast(A.t('session.selectFirst')); return; }
      const st = P.dshState.permissions;
      const opt = st && st.options ? st.options.find((o) => o.value === value) : null;
      const label = opt ? P.dshState.permissionDisplayName(opt) : value;
      try {
        await P.dshState.setPermissionPreset(P.dshState.currentSessionId, value);
        closePops();
        A.toast(A.t('permission.applying', { preset: label }));
        setTimeout(async () => {
          await P.dshState.listSessions();
          P.dshState.permissions = P.dshState.permissionState(P.dshState.currentSessionId);
          updatePermissionChip();
        }, 1200);
      } catch (e) { A.toast(e.message); }
    }
    // The permission selector lives in two places — the header chip and the
    // composer chip under the input (dsh web shows it there too).
    const permissionPops = [];
    for (const triggerId of ['composerPermissionChip']) {
      const trigger = $(triggerId);
      if (!trigger) continue;
      const pop = attachPop(trigger, buildPermissionPop, async (item) => {
        if (item.dataset.permission) await applyPermissionPreset(item.dataset.permission);
      });
      permissionPops.push(pop);
    }
    A.refreshPermissionPop = () => {
      for (const pop of permissionPops) pop.innerHTML = buildPermissionPop();
    };

    // Work modes = dsh's own agent presets (the same set dsh web offers).
    // dsh locks the preset once a session has started (`agent-preset-locked`),
    // so switching on a non-blank session offers a fresh session instead.
    async function applyModePick(item) {
      if (!item.dataset.preset) return;
      try {
        if (!P.dshState.currentSessionId || P.dshState.isSessionBlank(P.dshState.currentSessionId)) {
          if (P.dshState.currentSessionId) {
            await P.dshState.agentPresetSelect(P.dshState.currentSessionId, item.dataset.preset);
            A.currentPreset = item.dataset.preset;
            setModeLabel(presetLabel(item.dataset.preset));
          } else {
            A.currentPreset = item.dataset.preset;
            setModeLabel(presetLabel(item.dataset.preset));
          }
          A.refreshModePop();
          closePops();
          return;
        }
        // Started session: the preset is fixed — offer a new session.
        const ok = await A.askConfirm(A.t('mode.locked', { preset: presetLabel(item.dataset.preset) }));
        closePops();
        if (!ok) return;
        A.currentPreset = item.dataset.preset;
        await newSession();
      } catch (e) { A.toast(e.message); }
    }
    // The header mode chip is a pure label (the hero chip keeps its picker).
    const modePops = [];
    for (const id of ['heroModeChip']) {
      const trigger = $(id);
      if (!trigger) continue;
      modePops.push(attachPop(trigger, () => '<div class="popMeta">' + A.t('mode.loading') + '</div>', applyModePick));
      trigger.addEventListener('click', () => { A.refreshModePop(); });
    }
    const modeChipEl = $('modeChip');
    if (modeChipEl) modeChipEl.classList.add('static');
    A.refreshModePop = async () => {
      let html;
      try {
        const presets = await P.dshState.listPresets();
        const cur = A.currentPreset || (P.dshState.currentSessionId ? (P.dshState.sessionSummary(P.dshState.currentSessionId) || {}).agentPreset : null);
        html = presets.length
          ? presets.map((p) => {
            const id = p.id || p.agentPreset;
            const label = p.name || id;
            return '<div class="popItem' + (id === cur ? ' selected' : '') + '" data-preset="' + id + '"><span class="label">' + label + '</span><span class="tick">&#10003;</span></div>';
          }).join('')
          : '<div class="popMeta">' + A.t('mode.none') + '</div>';
      } catch (e) {
        html = '<div class="popMeta">' + A.t('mode.none') + '</div>';
      }
      for (const pop of modePops) pop.innerHTML = html;
    };

    // Workspace selector — three copies: the header crumb (chat view), the
    // hero bar folder chip (welcome screen, dsh web style) and the sidebar
    // chip (left toolbar). All list the workspaces plus "add workspace".
    const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    function buildWsPop() {
      return '<div class="popItem" data-value="__add"><span class="label">' + A.t('workspace.add') + '</span></div>' +
        P.dshState.workspaces.map((w) => '<div class="popItem" data-value="' + escHtml(w.workspaceId) + '"><span class="label">' + escHtml(w.title || w.workspaceId) + '</span><span class="tick">&#10003;</span></div>').join('');
    }
    async function applyWsPick(item) {
      if (item.dataset.value === '__add') { await newWorkspace(); closePops(); return; }
      await selectWorkspace(item.dataset.value);
      closePops();
    }
    const wsPops = [];
    for (const id of ['crumbProject', 'heroWsBtn', 'sidebarWsBtn']) {
      const trigger = $(id);
      if (!trigger) continue;
      wsPops.push(attachPop(trigger, buildWsPop, applyWsPick));
    }
    A.refreshWorkspacePop = () => { for (const pop of wsPops) pop.innerHTML = buildWsPop(); };
    A.refreshWorkspacePop();

    // Commands chip — lists the session's known commands (the real dsh
    // command directory over commands/list) plus the CLI apps of other
    // installed dsh profiles (one-shot plugins like givemyflag), which run
    // as commands too.
    const cmdPop = attachPop($('commandsChip'), '<div class="popMeta">' + A.t('commands.loading') + '</div>', async (item) => {
      if (item.dataset.cli === '1') {
        closePops();
        const usage = item.dataset.usage || '';
        const args = await A.askPrompt(A.t('commands.runCliPrompt', { name: item.dataset.name }), usage);
        if (args === null) return;
        try {
          const r = await P.dshState.runCliPlugin(item.dataset.profile, args.trim() ? args.trim().split(/\s+/) : []);
          if (r && r.ok) A.toast(A.t('commands.runCliStarted', { name: item.dataset.name }));
          else A.toast(A.t('commands.runCliFail', { msg: (r && (r.error || r.stderr)) || 'error' }));
        } catch (e) { A.toast(e.message); }
        return;
      }
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
      const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      try {
        const cmds = await P.dshState.commandsList(P.dshState.currentSessionId);
        cmdPop.innerHTML = cmds.length
          ? cmds.map((c) => c.cli
            ? '<div class="popItem" data-name="' + esc(c.name) + '" data-cli="1" data-profile="' + esc(c.profile || '') + '" data-usage="' + esc(c.usage || '') + '"><span class="label">⌘ ' + esc(c.name) + '</span><span class="desc">' + esc(c.description || '') + '</span><span class="tick">RUN</span></div>'
            : '<div class="popItem" data-name="' + esc(c.name) + '"><span class="label">/' + esc(c.name) + '</span><span class="desc">' + esc(c.description || '') + '</span></div>').join('')
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

  /* ---------- background ambient fx (设置 → 动效 → 背景动效) ----------
   * One fixed canvas layer between the wallpaper (z 0, DOM-earlier) and the
   * frame (z 1). Kinds: star / shoot / zodiac / clouds. rAF-driven, torn
   * down completely when switched off. */
  const ZODIAC_GLYPHS = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  const A_bgFx = { kind: '', raf: 0, layer: null, ctx: null, w: 0, h: 0, items: [], t: 0, spawn: 0 };
  function applyBgFx(kind) {
    const fx = A_bgFx;
    if (fx.raf) cancelAnimationFrame(fx.raf);
    fx.raf = 0;
    if (fx.layer) { fx.layer.remove(); fx.layer = null; fx.ctx = null; }
    fx.kind = kind || '';
    if (!fx.kind) return;
    const layer = document.createElement(fx.kind === 'clouds' ? 'div' : 'canvas');
    layer.id = 'prtsBgFx';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    fx.layer = layer;
    fx.items = [];
    fx.spawn = 0;
    const size = () => {
      if (fx.kind === 'clouds') return;
      fx.w = layer.width = window.innerWidth;
      fx.h = layer.height = window.innerHeight;
    };
    size();
    window.addEventListener('resize', size);
    if (fx.kind === 'clouds') {
      for (let i = 0; i < 5; i++) {
        const b = document.createElement('div');
        b.className = 'prtsFxCloud';
        b.style.left = (Math.random() * 90 - 10) + '%';
        b.style.width = (200 + Math.random() * 260) + 'px';
        b.style.height = (120 + Math.random() * 160) + 'px';
        b.style.animationDuration = (36 + Math.random() * 30) + 's';
        b.style.animationDelay = (-Math.random() * 50) + 's';
        layer.appendChild(b);
      }
      return;
    }
    fx.ctx = layer.getContext('2d');
    if (fx.kind === 'zodiac') {
      for (let i = 0; i < ZODIAC_GLYPHS.length; i++) {
        fx.items.push({
          g: ZODIAC_GLYPHS[i],
          x: Math.random() * fx.w, y: Math.random() * fx.h,
          vx: 6 + Math.random() * 10, vy: 3 + Math.random() * 7,
          ph: Math.random() * Math.PI * 2,
          size: 26 + Math.random() * 28,
          alpha: 0.05 + Math.random() * 0.08,
        });
      }
    } else if (fx.kind === 'star') {
      for (let i = 0; i < 110; i++) {
        fx.items.push({
          x: Math.random() * fx.w, y: Math.random() * fx.h,
          vx: 4 + Math.random() * 10, vy: 2 + Math.random() * 6,
          ph: Math.random() * Math.PI * 2,
          size: 0.6 + Math.random() * 1.6,
          alpha: 0.12 + Math.random() * 0.4,
        });
      }
    }
    const step = (ts) => {
      if (!fx.ctx) return;
      const dt = Math.min(48, (ts - fx.t) || 16);
      fx.t = ts;
      const s = dt / 1000;
      const ctx = fx.ctx;
      ctx.clearRect(0, 0, fx.w, fx.h);
      let accent = getComputedStyle(document.documentElement).getPropertyValue('--prts-accent').trim();
      if (!accent) accent = '#FAFAFA';
      if (fx.kind === 'zodiac') {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const m of fx.items) {
          m.x += (m.vx + Math.sin(fx.t / 900 + m.ph) * 6) * s;
          m.y += (m.vy + Math.cos(fx.t / 1100 + m.ph) * 4) * s;
          if (m.x > fx.w + 60) m.x = -60;
          if (m.y > fx.h + 60) m.y = -60;
          if (m.x < -60) m.x = fx.w + 60;
          if (m.y < -60) m.y = fx.h + 60;
          ctx.save();
          ctx.translate(m.x, m.y);
          ctx.rotate(Math.sin(fx.t / 1600 + m.ph) * 0.18);
          ctx.globalAlpha = m.alpha;
          ctx.fillStyle = accent;
          ctx.font = '500 ' + m.size + 'px "PingFang SC","Noto Serif SC",serif';
          ctx.fillText(m.g, 0, 0);
          ctx.restore();
        }
      } else if (fx.kind === 'star') {
        for (const m of fx.items) {
          m.x += m.vx * s;
          m.y += m.vy * s;
          if (m.x > fx.w + 4) m.x = -4;
          if (m.y > fx.h + 4) m.y = -4;
          const tw = 0.5 + 0.5 * Math.sin(fx.t / 700 + m.ph);
          ctx.globalAlpha = m.alpha * (0.45 + 0.55 * tw);
          ctx.fillStyle = accent;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (fx.kind === 'shoot') {
        fx.spawn -= dt;
        if (fx.spawn <= 0) {
          fx.spawn = 800 + Math.random() * 1500;
          fx.items.push({
            x: Math.random() * fx.w, y: -20,
            vx: 260 + Math.random() * 260, vy: 80 + Math.random() * 90,
            life: 0, ttl: 3.0 + Math.random() * 1.4,
            len: 90 + Math.random() * 120,
          });
          if (fx.items.length > 14) fx.items.shift();
        }
        ctx.lineCap = 'round';
        for (const m of fx.items) {
          m.x += m.vx * s;
          m.y += m.vy * s;
          m.life += dt;
          const k = Math.max(0, 1 - m.life / m.ttl);
          const ang = Math.atan2(m.vy, m.vx);
          ctx.save();
          ctx.globalAlpha = 0.55 * k;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(m.x - Math.cos(ang) * m.len, m.y - Math.sin(ang) * m.len);
          ctx.lineTo(m.x, m.y);
          ctx.stroke();
          ctx.restore();
        }
        fx.items = fx.items.filter((m) => m.life < m.ttl);
      }
      ctx.globalAlpha = 1;
      fx.raf = requestAnimationFrame(step);
    };
    fx.raf = requestAnimationFrame(step);
  }

  /* ---------- particles: intro + hero ---------- */
  function runIntro() {
    const cv = $('introCanvas');
    A.introEngine = P.particles.create(cv, { count: 14000, speedRange: [0.02, 0.05] });
    A.introEngine.start();
    const tag = $('introTag');
    tag.textContent = A.t('intro.welcome');

    A.introDone = false;
    A.ready = false;

    // Loading status: the particle effect is the loading animation while dsh
    // boots in the background. It flips to "ready — click to enter" the moment
    // the connection settles, and nags after a while if dsh stays silent.
    const status = $('introStatus');
    const introStartAt = Date.now();
    const statusTimer = setInterval(() => {
      if (A.introDone || !status) { clearInterval(statusTimer); return; }
      if (A.ready) status.textContent = A.t('intro.ready');
      else if (Date.now() - introStartAt > 45000) status.textContent = A.t('intro.slow');
      else status.textContent = A.t('intro.loading');
    }, 400);

    const finish = () => {
      if (A.introDone) return;
      A.introDone = true;
      clearTimeout(A.introTimer);
      clearInterval(statusTimer);
      if (status) status.textContent = '';
      removeIntroSkip();
      $('intro').classList.add('done');
      setTimeout(() => { $('intro').style.display = 'none'; A.introEngine.stop(); }, 800);
      if (!$('cvt').dataset.phase || $('cvt').dataset.phase === 'hero') startHeroAmbient();
      // Data loading is deliberately parked until the intro is over: the
      // particle effect runs free while dsh boots in the background.
      if (A.afterIntro) { try { A.afterIntro(); } catch (e) { /* noop */ } }
    };
    A.finishIntro = finish;

    // Early click: if ready, enter at once; otherwise show the "not loaded"
    // particle hint — the intro keeps looping until dsh is actually up.
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
      // Play the full three-wordmark cycle at least once (welcome → banner →
      // diamond mark); a click skips at any moment. Each phase lingers 3.2 s.
      // Until the connection is ready the cycle loops forever — the effect
      // doubles as the loading animation.
      if (A.ready && A.phaseCount >= 3) { finish(); return; }
      if (phase === 0) { A.introEngine.showIntro(16000); tag.classList.add('show'); }
      else if (phase === 1) { A.introEngine.showPp(18000); tag.classList.remove('show'); }
      else { A.introEngine.showMark(1.25, 16000); tag.classList.remove('show'); }
      A.phaseCount++;
      phase = (phase + 1) % 3;
      A.introTimer = setTimeout(tick, 3200);
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
    eng.showText(A.t('intro.notReady'), 20, 900);
    setTimeout(() => {
      eng.scatter();
      hint.classList.add('fade');
      setTimeout(() => { eng.stop(); hint.remove(); }, 500);
    }, 1000);
  }

  let heroPointerBound = false;
  function startHeroAmbient() {
    const cv = $('heroCanvas');
    if (A.heroEngine) { A.heroEngine.stop(); A.heroEngine = null; }
    A.heroEngine = P.particles.create(cv, { count: 1600, speedRange: [0.006, 0.02] });
    A.heroEngine.start();
    A.heroEngine.scatter();
    if (heroPointerBound) return;
    heroPointerBound = true;
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
      // First enable asks for microphone consent (in-app; the OS prompt also
      // appears on first getUserMedia).
      if (!(A.config.ui && A.config.ui.voiceConsent)) {
        const ok = await A.askConfirm(A.t('voice.consent.body'), {
          ok: A.t('voice.consent.allow'),
          cancel: A.t('voice.consent.deny'),
        });
        if (!ok) return;
        A.config.ui = A.config.ui || {};
        A.config.ui.voiceConsent = true;
        P.store.saveConfig(A.config).catch(() => { /* noop */ });
      }
      const res = await P.asr.start();
      if (res === 'ok') {
        A.voiceOn = true;
        btn.classList.add('on');
      } else if (res === 'not-allowed') {
        A.toast(A.t('voice.noMic'));
      } else {
        A.toast(A.t('voice.unsupported'));
      }
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
    P.asr.onError((err) => {
      A.toast(A.t('voice.error', { msg: String(err === 'not-allowed' ? 'permission denied' : err || '') }));
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
    // Mobile (phone / tablet): the sidebar becomes an off-canvas overlay and
    // the conversation takes the whole width. Same PRTS theme, touch-first.
    A.mobile = typeof window !== 'undefined' && window.innerWidth <= 760;
    if (A.mobile) {
      document.body.classList.add('mobile');
      // tapping the conversation closes the mobile nav drawer
      $('ctCol') && $('ctCol').addEventListener('pointerdown', () => {
        appEl().classList.remove('mobileNavOpen');
      });
    }
    A.config = await P.store.loadConfig();
    A.locale = A.config.locale === 'auto' ? P.platform.detectLocale() : A.config.locale;
    applyTheme(A.config.ui && A.config.ui.theme === 'light' ? 'light' : A.config.ui && A.config.ui.theme === 'custom' ? 'custom' : 'dark');
    applyAccent(A.config);
    applyWallpaper(A.config).catch(() => { /* wallpaper is decorative */ });
    applySidebarButtons(A.config);
    applyGlass(A.config);
    applyBgFx(A.config.ui && A.config.ui.bgFx);
    applyI18n();
    A.heroVisible = true;

    bindDrag();
    bindPopovers();
    bindVoice();
    bindRequests();
    if (P.plugins) { P.plugins.onChange(renderCommunityPlugins); P.plugins.adoptSeeded(); renderCommunityPlugins(); }
    if (P.system && P.system.bind) P.system.bind();

    $('themeBtn').addEventListener('click', A.toggleTheme);
    // Unified sidebar: workspaces + nested sessions in one tree area
    // (dsh-web parity) — no separate session list / view toggle anymore.
    $('sbToggleBtn').addEventListener('click', toggleSidebar);
    $('sessionSelectBtn').addEventListener('click', toggleSelecting);
    $('sessionBulkArchive').addEventListener('click', archiveSelected);
    $('sessionBulkAll').addEventListener('click', () => {
      const all = visibleSessionIds();
      const allSel = all.length > 0 && all.every((id) => A.selectedSessions.has(id));
      if (allSel) all.forEach((id) => A.selectedSessions.delete(id));
      else all.forEach((id) => A.selectedSessions.add(id));
      renderSessions();
      updateBulkBar();
    });
    $('sessionBulkCancel').addEventListener('click', () => setSelecting(false));
    // Background jobs: session/jobs mux frames + an expandable header chip.
    P.dshState.liveJobs = P.dshState.liveJobs || {};
    const jobsBtn = $('jobsBtn');
    let jobsPop = null;
    if (jobsBtn) {
      jobsPop = document.createElement('div');
      jobsPop.className = 'pop jobsPop';
      jobsBtn.appendChild(jobsPop);
      jobsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openPop === jobsPop) { closePops(); return; }
        closePops();
        const jobs = P.dshState.liveJobs[P.dshState.currentSessionId] || [];
        jobsPop.innerHTML = jobs.length
          ? jobs.map((j) => '<div class="popItem" style="cursor:default"><span class="label">' + esc2(j.name || j.id || 'job') + '</span><span class="desc">' + esc2(j.status || '') + '</span></div>').join('')
          : '<div class="popMeta">' + A.t('jobs.none') + '</div>';
        jobsPop.classList.add('open');
        openPop = jobsPop;
      });
    }
    function esc2(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
    function updateJobsChip() {
      const btn = $('jobsBtn');
      if (!btn) return;
      const jobs = P.dshState.liveJobs[P.dshState.currentSessionId] || [];
      const running = jobs.filter((j) => j.status === 'running' || j.status === 'starting');
      const done = jobs.filter((j) => j.status === 'completed');
      const label = btn.querySelector('.jobsCount');
      if (label) label.textContent = String(jobs.length);
      btn.hidden = false;
      btn.title = A.t('header.jobs.title', { n: jobs.length, running: running.length, done: done.length });
      // live pop keeps itself fresh while open
      if (jobsPop && jobsPop.classList.contains('open')) {
        jobsPop.innerHTML = jobs.length
          ? jobs.map((j, i) => '<div class="popItem" style="cursor:default"><span class="label">' + (i + 1) + '/' + jobs.length + ' ' + esc2(j.name || j.id || 'job') + '</span><span class="desc">' + esc2(j.status || '') + '</span></div>').join('')
          : '<div class="popMeta">' + A.t('jobs.none') + '</div>';
      }
      // streaming: show task progress on the status row (x/y, done count)
      if (P.chat && P.chat.streaming && jobs.length) {
        const idx = running.length ? jobs.indexOf(running[0]) + 1 : 1;
        if (P.chat.onStatus) P.chat.onStatus(A.t('header.jobs.progress', { i: idx, n: jobs.length, done: done.length }));
      }
    }
    A.updateJobsChip = updateJobsChip;
    P.dsh.on('session/jobs', (frame) => {
      const pl = frame.payload || {};
      if (!pl.sessionId) return;
      P.dshState.liveJobs[pl.sessionId] = Array.isArray(pl.jobs) ? pl.jobs : [];
      updateJobsChip();
    });

    $('clearHistoryBtn').addEventListener('click', async () => {
      const ok = await A.askConfirm(A.t('session.confirmArchive'));
      if (!ok) return;
      if (P.dshState.currentSessionId) await P.dshState.archiveSession(P.dshState.currentSessionId);
      await newSession();
    });
    $('newProjectHeadBtn').addEventListener('click', newWorkspace);
    $('detailsBtn') && $('detailsBtn').addEventListener('click', () => {
      if (appEl().hasAttribute('data-details-collapsed')) { showDetailsDefault(); openDetails(); }
      else closeDetails();
    });
    $('marketBtn') && $('marketBtn').addEventListener('click', A.openMarket);
    $('marketClose').addEventListener('click', A.closeMarket);
    $('webBtn') && $('webBtn').addEventListener('click', A.openWeb);
    $('webClose').addEventListener('click', A.closeWeb);
    $('gitBtn') && $('gitBtn').addEventListener('click', A.openGit);
    $('gitClose').addEventListener('click', A.closeGit);
    $('skillBtn') && $('skillBtn').addEventListener('click', A.openSkills);
    $('skillClose').addEventListener('click', A.closeSkills);
    $('dtClose').addEventListener('click', closeDetails);
    $('settingsBtn').addEventListener('click', A.openSettings);
    $('settingsClose').addEventListener('click', A.closeSettings);
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
    // Session log — dsh web's Session log downloads the ZIP archive from
    // `/api/session.export`; PRTS mirrors that, and falls back to the
    // raw-event overlay on older dsh builds without the endpoint.
    async function downloadSessionLog() {
      const sid = P.dshState.currentSessionId;
      if (!sid) { A.toast(A.t('session.selectFirst')); return; }
      const url = P.dshState.sessionLogUrl(sid);
      A.toast(A.t('log.preparing'));
      const bridge = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
      if (bridge && typeof bridge.download === 'function') {
        try {
          const r = await bridge.download(url);
          if (r && r.ok === false) throw new Error(r.error || 'download failed');
          A.toast(A.t('log.started'));
        } catch (e) {
          A.toast(A.t('log.failed', { msg: String(e && e.message || e) }));
        }
        return;
      }
      try {
        const res = await fetch(url, { method: 'HEAD' });
        if (res.ok) {
          const a = document.createElement('a');
          a.href = url;
          a.download = 'dsh-session-' + String(sid).replace(/[^A-Za-z0-9_-]/g, '_') + '.zip';
          document.body.appendChild(a);
          a.click();
          a.remove();
          A.toast(A.t('log.started'));
          return;
        }
      } catch (e) { /* fall through to the raw overlay */ }
      P.chat.renderLog();
      $('logOverlay').classList.add('open');
      A.toast(A.t('log.fallback'));
    }
    $('logBtn').addEventListener('click', downloadSessionLog);
    $('logClose').addEventListener('click', () => $('logOverlay').classList.remove('open'));
    $('logExport').addEventListener('click', () => P.chat.exportLog());

    // Modal (prompt / confirm).
    $('modalBrowseBtn').addEventListener('click', () => { if (modalBrowseCb) modalBrowseCb(); });
    $('modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('modalOverlay')) settleModal($('modalInput').hidden ? false : null);
    });

    $('flow').addEventListener('click', (e) => {
      if (e.target.closest('.blkRow') || e.target.closest('.toolItem') || e.target.closest('.msgActions')) return;
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
      if (!e.target.closest('.chip') && !e.target.closest('.meterBtn') && !e.target.closest('.sbWsBtn') && !e.target.closest('.crumb')) closePops();
      if (e.target === $('settingsOverlay')) A.closeSettings();
      if (e.target === $('marketOverlay')) A.closeMarket();
      if (e.target === $('gitOverlay')) A.closeGit();
      if (e.target === $('skillOverlay')) A.closeSkills();
      if (e.target === $('webOverlay')) A.closeWeb();
    });
    let lastEscAt = 0;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const now = Date.now();
      closePops(); A.closeSettings(); A.closeMarket(); A.closeGit(); A.closeSkills(); A.closeWeb();
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
    // Keep the hero logo centred on the background square even as the
    // composer grows/shrinks (status row, stats dock, expand toggle).
    if (typeof ResizeObserver !== 'undefined') {
      try {
        const ro = new ResizeObserver(() => syncHeroOffset());
        ro.observe($('composerArea'));
      } catch (e) { /* observer unavailable */ }
    }

    P.dsh.on('connect', () => { refreshAll().catch(() => { /* dsh may still be warming up */ }); });
    // The host command directory changed (plugin added/removed a command) —
    // drop the cached directory so the chip and autocomplete repull.
    P.dsh.on('commands/change', () => { if (P.dshState.invalidateCommands) P.dshState.invalidateCommands(); });
    // Live projection frames → stats dock, permission chip and meter.
    P.dsh.on('session/projection', (frame) => {
      const pl = frame.payload || {};
      if (!pl.sessionId) return;
      const bucket = P.dshState.liveProjections[pl.sessionId] || (P.dshState.liveProjections[pl.sessionId] = {});
      bucket[pl.key] = pl.value;
      if (pl.sessionId !== P.dshState.currentSessionId) return;
      if (pl.key === 'sessionStats' || pl.key === 'tokenUsage' || pl.key === 'contextPressure') renderStatsDock();
      if (pl.key === 'contextPressure') updateMeter();
      if (pl.key === 'permissions') {
        P.dshState.permissions = P.dshState.permissionState(pl.sessionId);
        updatePermissionChip();
        if (A.refreshPermissionPop) A.refreshPermissionPop();
      }
    });
    // Periodic session-list refresh keeps summaries (titles, stats, running
    // flags, permissions) fresh even when the mux is quiet.
    setInterval(() => {
      if (!P.dshState.currentSessionId) return;
      const before = P.dshState.sessions.length;
      P.dshState.listSessions().then(() => {
        if (P.dshState.sessions.length !== before) { renderSessions(); renderWorkspaces(); }
        else highlightSessions();   // titles/stats live in projections
        renderStatsDock();
        updateMeter();
      }).catch(() => { /* noop */ });
    }, 8000);
    // Readiness gate: the intro stays "NOT READY" until the workspace +
    // session data actually finished loading. The preload runs frame-yielded
    // so the particle effect never stutters while dsh boots; only when it is
    // done does A.ready flip and the intro offer "READY — click to enter".
    let preloadStarted = false;
    const rafYield = () => new Promise((r) => requestAnimationFrame(r));
    async function preloadData() {
      if (preloadStarted) return;
      preloadStarted = true;
      const dbg = (stage, e) => {
        if (typeof process === 'undefined') return;
        try { if (window.prts && window.prts.env) console.error('[prts-preload] ' + stage + ':', e && e.message ? e.message : e); } catch (err) { /* noop */ }
      };
      try { await P.dshState.listWorkspaces(); } catch (e) { dbg('workspaces', e); }
      await rafYield();
      try { await P.dshState.listSessions(); } catch (e) { dbg('sessions', e); }
      await rafYield();
      await Promise.allSettled([P.dshState.listModels(), P.dshState.listProviders(), P.dshState.listPresets()]);
      await rafYield();
      try { await renderWorkspaces(); } catch (e) { dbg('renderWorkspaces', e); }
      try { await renderSessions(); } catch (e) { dbg('renderSessions', e); }
      await rafYield();
      // "Loaded" means everything: the session is open AND its messages
      // finished rendering. Until then the intro stays NOT READY. A failing
      // step never toasts "无法连接" — only the ping loop does that.
      try { await A.ensureSession(); } catch (e) { dbg('ensureSession', e); }
      await rafYield();
      A.ready = true;
      A._loadOnIntro = false;
    }
    // Hard fuse: whatever happens, the intro must become enterable (silent).
    setTimeout(() => {
      if (!A.ready) A.ready = true;
    }, 30000);
    A.afterIntro = function () {
      if (A.ready) {
        A.ensureSession().catch(() => { /* session load is best-effort */ });
        maybeOnboardApiKey();
      }
    };

    /** First-run onboarding (dsh-web parity): prompt to configure the
     *  DeepSeek API key; if the Doctor has no key, offer a jump to the
     *  official site to register one. Runs exactly once per profile. */
    async function maybeOnboardApiKey() {
      A.config.ui = A.config.ui || {};
      if (A.config.ui.onboardedApiKey) return;
      A.config.ui.onboardedApiKey = true;
      await P.store.saveConfig(A.config);
      let configured = false;
      try {
        const creds = await P.dshState.credentialsDescribe(['DEEPSEEK_OFFICIAL_API_KEY']);
        configured = !!(creds && creds.DEEPSEEK_OFFICIAL_API_KEY && creds.DEEPSEEK_OFFICIAL_API_KEY.configured);
      } catch (e) { /* credential store unavailable */ }
      if (configured) return;
      const choice = await A.askChoice(
        A.t('onboard.apiKey.title'),
        A.t('onboard.apiKey.body'),
        [
          { id: 'settings', label: A.t('onboard.apiKey.settings'), primary: true },
          { id: 'register', label: A.t('onboard.apiKey.register') },
          { id: 'later', label: A.t('onboard.apiKey.later') },
        ],
      );
      if (choice === 'settings') {
        A.openSettings();
        if (P.settingsPanel && P.settingsPanel.show) P.settingsPanel.show('models');
      } else if (choice === 'register') {
        if (P.balance && P.balance.openPlatform) P.balance.openPlatform();
        else { try { window.open('https://platform.deepseek.com/sign_in', '_blank', 'noopener'); } catch (e) { /* noop */ } }
      }
    }
    (async () => {
      // dsh may still be booting in the background (PRTS spawns it silently).
      // Keep polling until it answers — the particle intro keeps looping the
      // whole time, and a click before that shows the "not loaded" hint.
      try {
        await P.dshState.connect();
        let delay = 500;
        for (;;) {
          if (await P.dshState.ping()) break;
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(4000, Math.round(delay * 1.25));
        }
        A._dshUp = true;
        preloadData();
      } catch (e) {
        A.toast(A.t('dsh.connectFail', { msg: e.message }));
      }
    })();
  }

  // Make sure a session is open so the composer, model switch and mode switch
  // all work immediately. Selects the first workspace, then the most recent
  // session, and creates a blank one when none exists. A freshly created
  // session lands on the welcome screen (dsh web behaviour); an existing
  // session opens the chat directly.
  A.ensureSession = async function () {
    if (P.dshState.currentSessionId) return P.dshState.currentSessionId;
    if (!P.dshState.currentWorkspaceId && P.dshState.workspaces.length) {
      P.dshState.currentWorkspaceId = P.dshState.workspaces[0].workspaceId;
    }
    if (P.dshState.sessions.length) {
      await selectSession(P.dshState.sessions[0].sessionId, { waitHistory: true });
      return P.dshState.currentSessionId;
    }
    const id = await P.dshState.createSession(P.dshState.currentWorkspaceId || undefined);
    if (!id) return null;
    P.dshState.currentSessionId = id;
    await refreshSessions();
    A.enterHero();
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
  A.applyTheme = applyTheme;
  A.applySidebarButtons = applySidebarButtons;
  A.applyGlass = applyGlass;
  A.applyAccent = applyAccent;
  A.applyWallpaper = applyWallpaper;
  A.applyI18n = applyI18n;
  A.applyBgFx = applyBgFx;
  A.setModeLabel = setModeLabel;
  A.presetLabel = presetLabel;
  A.newSession = newSession;
  A.loadCredentialState = loadCredentialState;
  A.currentPreset = A.currentPreset || null;
  A.showDetailsDefault = showDetailsDefault;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
