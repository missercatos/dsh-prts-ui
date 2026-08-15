/**
 * PRTS GUI bootstrap and shell: i18n, theme, sidebar, settings overlay,
 * details panel, drag handles, particle intro sequence, hero ambience,
 * popovers, tabs, toast. Initialized last (after core + chat).
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

  /* ---------- sidebar ---------- */
  function renderProjects() {
    const list = $('projectList');
    list.textContent = '';
    for (const p of A.projects) {
      const row = document.createElement('div');
      row.className = 'sbItem' + (p.id === A.config.project ? ' active' : '');
      row.dataset.project = p.id;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      row.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = new Date(p.updatedAt || 0).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
      row.appendChild(meta);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'rowBtn';
      del.title = A.t('common.delete');
      del.setAttribute('aria-label', A.t('common.delete'));
      del.innerHTML = P.icons['ma.trash'] || '';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteProjectRow(p.id); });
      row.appendChild(del);
      row.addEventListener('click', () => switchProject(p.id));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchProject(p.id); }
      });
      list.appendChild(row);
    }
    $('projectCount').textContent = String(A.projects.length);
  }

  async function deleteProjectRow(id) {
    const proj = A.projects.find((p) => p.id === id);
    if (!confirm(A.t('project.confirmDelete', { name: (proj && proj.name) || id }))) return;
    await P.store.deleteProject(id);
    if (A.config.project === id) await switchProject('default');
    A.projects = await P.store.listProjects();
    renderProjects();
  }

  async function clearCurrentHistory() {
    if (!confirm(A.t('project.confirmClear'))) return;
    await P.chat.clearHistory();
  }

  async function switchProject(id) {
    if (A.chatLoading) return;
    await P.store.openProject(id);
    const cfg = await P.store.loadConfig();
    A.config = cfg;
    await P.chat.loadHistory();
    P.chat.renderFlow();
    P.chat.updateMeter();
    updateCrumb();
    renderProjects();
    A.updateSidebar();
    refreshWsPop();
  }

  function refreshWsPop() {
    const pop = $('wsPop');
    if (!pop) return;
    pop.innerHTML = '<div class="popItem" data-value="__add"><span class="label">' + A.t('workspace.add') + '</span></div>' +
      '<div class="popMeta">' + A.t('workspace.hint') + '</div>' +
      A.projects.map((p) => '<div class="popItem' + (p.id === A.config.project ? ' selected' : '') + '" data-value="' + p.id + '"><span class="label">' + p.name + '</span><span class="tick">&#10003;</span></div>').join('');
  }

  function renderSessions() {
    const list = $('sessionList');
    list.textContent = '';
    const bounds = [Date.now() - 86400000 * 365].concat(P.chat.bounds);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const groups = {};
    for (const b of bounds) {
      const key = b >= today.getTime() ? 'today' : new Date(b).toLocaleDateString();
      groups[key] = (groups[key] || 0) + 1;
    }
    for (const key of Object.keys(groups)) {
      const row = document.createElement('div');
      row.className = 'sbItem';
      row.style.cursor = 'default';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = key;
      row.appendChild(name);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = String(groups[key]);
      row.appendChild(meta);
      list.appendChild(row);
    }
    $('sessionCount').textContent = String(Math.max(1, Object.keys(groups).length));
  }

  A.updateSidebar = function () {
    renderSessions();
    P.chat.updateMeter();
  };

  /* ---------- phase switch: hero → chat ---------- */
  A.enterChat = function () {
    A.heroVisible = false;
    const cvt = $('cvt');
    cvt.dataset.phase = 'active';
    $('header').hidden = false;
    $('heroView').hidden = true;
    $('chatScroll').hidden = false;
    if (A.heroEngine) A.heroEngine.stop();
    P.chat.updateMeter();
  };

  /* ---------- header / crumbs ---------- */
  function updateCrumb() {
    const id = A.config.project;
    const proj = A.projects.find((p) => p.id === id);
    $('crumbProject').textContent = (proj && proj.name) || id;
    $('workspaceLabel').textContent = (proj && proj.name) || id;
    $('workspaceBtn').title = id;
  }

  /* ---------- details panel ---------- */
  A.showDetails = function (msg) {
    openDetails();
    const body = $('dtBody');
    body.textContent = '';
    const fields = [
      ['role', msg.role],
      ['model', msg.model || (A.config.api && A.config.api.model) || '-'],
      ['strength', msg.strength || (A.config.api && A.config.api.strength) || '-'],
      ['created', P.chat.fmtDate(msg.ts)],
    ];
    if (msg.durationMs) fields.push(['duration', P.api.formatDuration(msg.durationMs)]);
    if (msg.usage) {
      fields.push(['tokens', 'in ' + (msg.usage.prompt_tokens || 0) + ' · out ' + (msg.usage.completion_tokens || 0)]);
    }
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
  function attachDrag(handle, onDrag, onEnd) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      appEl().dataset.dragging = 'true';
      handle.dataset.dragging = 'true';
      const move = (ev) => { const x = ev.clientX - appEl().getBoundingClientRect().left; onDrag(x); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        delete appEl().dataset.dragging;
        delete handle.dataset.dragging;
        onEnd && onEnd();
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
    }, placeHandles);
    attachDrag($('handleDetails'), (x) => {
      const r = appEl().getBoundingClientRect();
      A_.dtWidth = Math.min(560, Math.max(320, r.width - x));
      appEl().style.setProperty('--dsh-dt', A_.dtWidth + 'px');
      $('handleDetails').style.left = (r.width - A_.dtWidth - 4) + 'px';
    }, placeHandles);
  }

  /* ---------- tabs ---------- */
  function bindTabs() {
    $('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      $('tabs').querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      const view = tab.dataset.view;
      $('heroView').hidden = view !== 'chat' ? true : false;
      $('chatScroll').hidden = view !== 'chat';
      $('composerArea').hidden = view !== 'chat';
      $('trajView').hidden = view !== 'trajectory';
      if (view === 'trajectory') renderTrajectory();
    });
  }
  function renderTrajectory() {
    const tv = $('trajView');
    tv.textContent = '';
    const rows = [];
    let i = 0;
    for (const m of P.chat.messages) {
      if (m.role === 'assistant' && m.reasoning) {
        rows.push({ i: ++i, text: m.reasoning });
      }
    }
    if (!rows.length) {
      tv.appendChild(P.chat.el('div', 'trajEmpty', A.t('details.empty')));
      return;
    }
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'trajItem';
      const idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = String(r.i).padStart(2, '0');
      const text = document.createElement('div');
      text.textContent = r.text;
      item.appendChild(idx); item.appendChild(text);
      tv.appendChild(item);
    }
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
      if (item && onPick) onPick(item.dataset.value, item);
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
    // Model
    attachPop($('modelChip'),
      P.store.MODELS.map((m) => '<div class="popItem' + (A.config.api.model === m ? ' selected' : '') + '" data-value="' + m + '"><span class="label">' + m + '</span><span class="tick">&#10003;</span></div>').join('') +
      '<div class="popMeta">DeepSeek API models. deepseek-reasoner ignores strength.</div>',
      async (value) => {
        A.config.api.model = value;
        await P.store.saveConfig(A.config);
        updateChips();
      });
    // Strength
    attachPop($('strengthChip'),
      ['off', 'low', 'medium', 'high'].map((s) => '<div class="popItem' + (A.config.api.strength === s ? ' selected' : '') + '" data-value="' + s + '"><span class="label">' + A.t('strength.' + s) + '</span><span class="tick">&#10003;</span></div>').join('') +
      '<div class="popMeta">Thinking-budget preset: ' + [0, 1024, 4096, 32768].join(' / ') + ' reasoning tokens.</div>',
      async (value) => {
        A.config.api.strength = value;
        await P.store.saveConfig(A.config);
        updateChips();
      });
    // Mode (standard / ptc / minimal / creative)
    attachPop($('modeChip'),
      P.store.MODES.map((m) => '<div class="popItem' + ((A.config.mode || 'standard') === m ? ' selected' : '') + '" data-value="' + m + '"><span class="label">' + A.t('mode.' + m) + '</span><span class="tick">&#10003;</span></div>').join('') +
      '<div class="popMeta">' + A.t('mode.hint') + '</div>',
      async (value) => {
        A.config.mode = value;
        await P.store.saveConfig(A.config);
        updateChips();
      });
    // Commands
    attachPop($('commandsChip'),
      '<div class="popItem" data-value="new"><span class="label">' + A.t('sidebar.newSession') + '</span></div>' +
      '<div class="popItem" data-value="settings"><span class="label">' + A.t('sidebar.settings') + '</span></div>' +
      '<div class="popItem" data-value="theme"><span class="label">' + A.t('common.theme') + '</span></div>',
      async (value) => {
        if (value === 'new') { await P.chat.branch(); }
        else if (value === 'settings') A.openSettings();
        else if (value === 'theme') A.toggleTheme();
      });
    // Meter
    attachPop($('meterBtn'),
      '<div class="popMeta" id="meterPopDetail" style="border:none;margin:0;">—</div>',
      null, true);
    // Workspace (project switch) — with "Add workspace" at the top.
    attachPop($('workspaceBtn'),
      '<div class="popItem" data-value="__add"><span class="label">' + A.t('workspace.add') + '</span></div>' +
      '<div class="popMeta">' + A.t('workspace.hint') + '</div>' +
      A.projects.map((p) => '<div class="popItem' + (p.id === A.config.project ? ' selected' : '') + '" data-value="' + p.id + '"><span class="label">' + p.name + '</span><span class="tick">&#10003;</span></div>').join(''),
      async (value) => {
        if (value === '__add') { await addWorkspace(); return; }
        await switchProject(value);
      });
  }

  async function addWorkspace() {
    const name = prompt(A.t('project.name'));
    if (!name || !name.trim()) return;
    const id = P.store.slugify(name.trim());
    await P.store.ensureProject(id);
    await P.store.renameProject(id, name.trim());
    await switchProject(id);
    A.projects = await P.store.listProjects();
    renderProjects();
    refreshWsPop();
  }

  function updateChips() {
    $('modelChipLabel').textContent = A.config.api.model;
    $('strengthChipLabel').textContent = 'STRENGTH: ' + A.t('strength.' + A.config.api.strength);
    $('strengthChip').classList.toggle('on', A.config.api.strength !== 'off');
    const mode = A.config.mode || 'standard';
    $('modeChipLabel').textContent = A.t('mode.' + mode);
    $('modeChip').classList.toggle('on', mode !== 'standard');
    const hm = $('headerMode');
    if (hm) hm.textContent = A.t('mode.' + mode);
    updateMeterPop();
    P.chat.updateMeter();
  }
  function updateMeterPop() {
    const detail = $('meterPopDetail');
    if (!detail) return;
    const budget = A.config.api.model === 'deepseek-reasoner' ? 65536 : 131072;
    const chars = P.chat.messages.reduce((n, m) => n + (m.content || '').length + (m.reasoning || '').length, 0);
    const pct = Math.min(100, Math.round(chars / 4 / budget * 100));
    detail.textContent = '≈ ' + chars + ' chars · ' + budget + ' tok window · ' + pct + '% used';
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
    cv.classList.toggle('listening', on && frame.listening && !frame.speaking);
    cv.classList.toggle('speaking', on && frame.speaking);
    if (!on) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--prts-ink').trim() || '#FAFAFA';
    const bars = (frame.bars && frame.bars.length) ? frame.bars : new Array(14).fill(0);
    const n = 14, w = cv.width, h = cv.height;
    const bw = w / n;
    const amp = frame.speaking ? 1 : 0.34;
    ctx.fillStyle = ink;
    for (let i = 0; i < n; i++) {
      const v = Math.max(0.03, bars[i] * amp);
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
        btn.title = A.t('voice.off');
        return;
      }
      const ok = await P.asr.start();
      if (ok !== 'ok') {
        // A specific toast is emitted through P.asr.onError for the failure mode.
        if (ok === 'unsupported') A.toast(A.t('voice.unsupported'));
        else if (ok === 'not-allowed') A.toast(A.t('voice.noMic'));
        return;
      }
      A.voiceOn = true;
      btn.classList.add('on');
      btn.title = A.t('voice.on');
    });
    P.asr.onFrame((frame) => {
      const recognizing = frame.state === 'recognizing';
      btn.classList.toggle('recognizing', A.voiceOn && recognizing);
      drawBrandFx(frame);
    });
    P.asr.onResult((text) => {
      const input = $('composerInput');
      if (!input) return;
      if (input.value) input.value += ' ';
      input.value += text;
      if (P.chat.updateSend) P.chat.updateSend();
      if (P.chat.scrollInputBottom) P.chat.scrollInputBottom();
      input.focus();
    });
    P.asr.onError((code) => {
      if (code === 'not-allowed') A.toast(A.t('voice.noMic'));
      else if (code === 'unsupported') A.toast(A.t('voice.unsupported'));
      else if (code && code !== 'no-speech' && code !== 'aborted') A.toast(A.t('voice.error', { msg: String(code) }));
    });
  }

  /* ---------- community plugin buttons ---------- */
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
        btn.setAttribute('aria-label', btn.title);
        if (pl.icon) btn.innerHTML = pl.icon;
        else btn.textContent = String(pl.label || pl.id).slice(0, 1).toUpperCase();
        if (pl.badge) {
          const dot = document.createElement('span');
          dot.className = 'pluginBadge';
          btn.appendChild(dot);
        }
        btn.addEventListener('click', (e) => {
          try {
            if (pl.onClick) pl.onClick({ app: P.app, config: A.config, store: P.store, chat: P.chat, event: e });
          } catch (err) {
            A.toast(String(err && err.message || err));
          }
        });
        host.appendChild(btn);
      }
    }
  }

  /* ---------- settings ---------- */
  A.openSettings = function () {
    fillSettings();
    $('settingsOverlay').classList.add('open');
  };
  function closeSettings() { $('settingsOverlay').classList.remove('open'); }
  function fillSettings() {
    $('cfgApiKey').value = A.config.api.apiKey || '';
    $('cfgBaseUrl').value = A.config.api.baseUrl || '';
    $('cfgModel').value = A.config.api.model || 'deepseek-chat';
    $('cfgStrength').value = A.config.api.strength || 'medium';
    $('cfgLocale').value = A.config.locale || 'auto';
    renderCfgProjects();
    $('cfgStatus').textContent = '';
  }
  function renderCfgProjects() {
    const box = $('cfgProjects');
    box.textContent = '';
    for (const p of A.projects) {
      const row = document.createElement('div');
      row.className = 'projectRow';
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name + (p.id === A.config.project ? ' ◂' : '');
      const meta = document.createElement('span');
      meta.className = 'pmeta';
      meta.textContent = p.id;
      const use = document.createElement('button');
      use.className = 'sBtn';
      use.textContent = A.t('project.switch') === 'Switch project' ? 'USE' : '使用';
      use.style.height = '26px';
      use.addEventListener('click', () => switchProject(p.id));
      const del = document.createElement('button');
      del.className = 'sBtn';
      del.textContent = A.t('common.delete');
      del.style.height = '26px';
      del.style.marginLeft = '4px';
      del.disabled = p.id === 'default';
      del.addEventListener('click', async () => {
        if (!confirm(A.t('project.confirmDelete', { name: p.name }))) return;
        await P.store.deleteProject(p.id);
        if (A.config.project === p.id) await switchProject('default');
        A.projects = await P.store.listProjects();
        renderProjects();
        renderCfgProjects();
      });
      row.appendChild(name); row.appendChild(use); row.appendChild(del);
      box.appendChild(row);
    }
    const form = document.createElement('div');
    form.className = 'inlineForm';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = A.t('project.name');
    input.maxLength = 40;
    const create = document.createElement('button');
    create.className = 'sBtn primary';
    create.textContent = A.t('project.create');
    create.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      const id = P.store.slugify(name);
      await P.store.ensureProject(id);
      await P.store.renameProject(id, name);
      await switchProject(id);
      A.projects = await P.store.listProjects();
      renderProjects();
      fillSettings();
    });
    form.appendChild(input); form.appendChild(create);
    box.appendChild(form);
  }
  async function saveSettings() {
    A.config.api.apiKey = $('cfgApiKey').value.trim();
    A.config.api.baseUrl = $('cfgBaseUrl').value.trim() || 'https://api.deepseek.com';
    A.config.api.model = $('cfgModel').value;
    A.config.api.strength = $('cfgStrength').value;
    A.config.locale = $('cfgLocale').value;
    await P.store.saveConfig(A.config);
    const prev = A.locale;
    A.locale = A.config.locale === 'auto' ? P.platform.detectLocale() : A.config.locale;
    applyI18n();
    updateChips();
    A.toast(A.t('settings.saved'));
    if (prev !== A.locale) P.chat.renderFlow();
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
    // Same particles reorganize throughout — no scatter, no fade-out, no new
    // particles: field -> "welcome to / PRTS" -> PRTS·DEEPSEEK banner -> mark.
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

  /* ---------- new project inline (sidebar) ---------- */
  function bindNewProject() {
    $('newProjectBtn').addEventListener('click', () => {
      const list = $('projectList');
      const form = document.createElement('div');
      form.className = 'inlineForm';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = A.t('project.name');
      input.maxLength = 40;
      const go = async () => {
        const name = input.value.trim();
        if (!name) return;
        await P.store.ensureProject(P.store.slugify(name));
        await P.store.renameProject(P.store.slugify(name), name);
        await switchProject(P.store.slugify(name));
        A.projects = await P.store.listProjects();
        renderProjects();
      };
      const ok = document.createElement('button');
      ok.className = 'sBtn';
      ok.textContent = 'OK';
      ok.style.height = '26px';
      ok.addEventListener('click', go);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') form.remove(); });
      form.appendChild(input); form.appendChild(ok);
      list.prepend(form);
      input.focus();
    });
  }

  /* ---------- boot ---------- */
  async function boot() {
    A.config = await P.store.loadConfig();
    A.locale = A.config.locale === 'auto' ? P.platform.detectLocale() : A.config.locale;
    applyTheme(A.config.ui && A.config.ui.theme === 'light' ? 'light' : 'dark');
    applyI18n();
    A.projects = await P.store.listProjects();
    A.heroVisible = true;
    await P.chat.loadHistory();

    bindTabs();
    bindDrag();
    bindNewProject();
    bindPopovers();
    bindVoice();

    if (P.plugins) {
      P.plugins.onChange(renderPlugins);
      P.plugins.adoptSeeded();
      renderPlugins();
    }
    if (P.system && P.system.bind) P.system.bind();

    $('themeBtn').addEventListener('click', A.toggleTheme);
    $('clearHistoryBtn').addEventListener('click', clearCurrentHistory);
    $('settingsBtn').addEventListener('click', () => A.openSettings());
    $('settingsClose').addEventListener('click', closeSettings);
    $('cfgSave').addEventListener('click', saveSettings);
    $('cfgApiKeyToggle').addEventListener('click', () => {
      const input = $('cfgApiKey');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('cfgApiKeyToggle').textContent = show ? 'HIDE' : 'SHOW';
    });
    $('cfgTest').addEventListener('click', async () => {
      const status = $('cfgStatus');
      status.textContent = A.t('settings.testing');
      const testCfg = {
        api: {
          baseUrl: $('cfgBaseUrl').value.trim() || 'https://api.deepseek.com',
          apiKey: $('cfgApiKey').value.trim(),
          model: $('cfgModel').value,
        },
      };
      const res = await P.api.ping(testCfg);
      status.textContent = res.ok ? A.t('settings.test.ok', { ms: res.ms }) : A.t('settings.test.fail', { msg: res.message });
    });
    $('detailsBtn').addEventListener('click', () => {
      if (appEl().hasAttribute('data-details-collapsed')) openDetails();
      else closeDetails();
    });
    $('dtClose').addEventListener('click', closeDetails);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chip') && !e.target.closest('.meterBtn') && !e.target.closest('.workspaceBtn')) closePops();
      if (e.target === $('settingsOverlay')) closeSettings();
      if (P.system && e.target === $('sysOverlay')) P.system.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePops(); closeSettings(); if (P.system && P.system.open) P.system.close(); }
    });
    window.addEventListener('resize', () => {
      placeHandles();
      // Fullscreen must extend the canvas view, not zoom the effect: refresh
      // the backing store so the particle layers stay crisp.
      if (A.introEngine) A.introEngine.resize();
      if (A.heroEngine) A.heroEngine.resize();
    });

    P.chat.init();
    updateCrumb();
    renderProjects();
    renderSessions();
    updateChips();
    P.chat.renderFlow();
    placeHandles();
    runIntro();
  }

  A.updateCrumb = updateCrumb;
  A.renderProjects = renderProjects;
  A.closeSettings = closeSettings;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
