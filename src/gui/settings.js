/**
 * PRTS settings panel — rebuilt from scratch.
 *
 * Section structure mirrors the official dsh web settings
 * (通用设置 / 模型 / 插件 / agent预设), then adds the PRTS extensions the
 * Doctor ordered: 余额 (DeepSeek official account), Git (GitHub account) and
 * skill (groups + persona + raw SKILL.md editing).
 *
 * Data sources are the same RPCs the official GUI uses:
 *   settings.describe / settings.update  (locale, ui-theme, ui-conversation…)
 *   llm.providers / llm.models / credentials.*
 *   agentPreset.list / agentPreset.select
 * plus PRTS-local state (config file, profile inventory, skills root).
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const ST = P.settingsPanel = {};

  const SECTIONS = [
    { id: 'general', label: 'settings.nav.general' },
    { id: 'models', label: 'settings.nav.models' },
    { id: 'plugins', label: 'settings.nav.plugins' },
    { id: 'presets', label: 'settings.nav.presets' },
    { id: 'balance', label: 'settings.nav.balance' },
    { id: 'git', label: 'settings.nav.git' },
    { id: 'skills', label: 'settings.nav.skills' },
  ];

  /** Neon-leaning accent presets (Tokyo Night & friends). diamond/square may
   *  differ; primary drives buttons and the logo. */
  const ACCENT_PRESETS = [
    { id: 'tokyonight', name: 'Tokyo Night', primary: '#7aa2f7', diamond: '#7dcfff', square: '#bb9af7' },
    { id: 'tokyonight-storm', name: 'Tokyo Night Storm', primary: '#7aa2f7', diamond: '#2ac3de', square: '#bb9af7' },
    { id: 'nord', name: 'Nord', primary: '#88c0d0', diamond: '#8fbcbb', square: '#b48ead' },
    { id: 'dracula', name: 'Dracula', primary: '#bd93f9', diamond: '#8be9fd', square: '#ff79c6' },
    { id: 'rose-pine', name: 'Rosé Pine', primary: '#ebbcba', diamond: '#9ccfd8', square: '#c4a7e7' },
    { id: 'catppuccin', name: 'Catppuccin', primary: '#89b4fa', diamond: '#89dceb', square: '#cba6f7' },
    { id: 'gruvbox', name: 'Gruvbox', primary: '#83a598', diamond: '#8ec07c', square: '#d3869b' },
    { id: 'mono', name: 'PRTS Mono', primary: '', diamond: '', square: '' },
  ];

  let current = 'general';
  let config = null;

  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function $id(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  /* ---------- settings namespaces (official data) ---------- */

  async function describeAll() {
    try {
      const r = await P.dshState.settingsGet(undefined);
      return (r && r.namespaces) || [];
    } catch (e) { return []; }
  }
  async function nsValue(ns) {
    const all = await describeAll();
    const hit = all.find((x) => x.ns === ns);
    return hit ? (hit.value || {}) : null;
  }
  async function nsUpdate(ns, patch) {
    try {
      await P.dshState.settingsUpdate(ns, patch);
      return true;
    } catch (e) {
      P.app.toast(e.message || String(e));
      return false;
    }
  }

  /* ---------- default model (~/.dsh/settings.yaml, agent-default-model) ---------- */

  function settingsYamlPath() { return P.platform.dshHome() + '/settings.yaml'; }

  async function readAgentDefaultModel() {
    try {
      const raw = await P.io.readFile(settingsYamlPath());
      const m = /(?:^|\n)agent-default-model:\n((?:[ \t]+[^\n]*\n?)*)/.exec(raw);
      if (!m) return null;
      const out = {};
      for (const line of m[1].split('\n')) {
        const kv = /^[ \t]+([A-Za-z]+):[ \t]*(.*)$/.exec(line);
        if (kv) out[kv[1]] = kv[2].trim();
      }
      return out;
    } catch (e) { return null; }
  }

  async function writeAgentDefaultModel(patch) {
    try {
      let raw = '';
      try { raw = await P.io.readFile(settingsYamlPath()); } catch (e) { raw = ''; }
      const block = 'agent-default-model:\n  provider: ' + (patch.provider || '') +
        '\n  model: ' + (patch.model || '') +
        (patch.reasoningEffort ? '\n  reasoningEffort: ' + patch.reasoningEffort : '') + '\n';
      const idx = raw.indexOf('agent-default-model:');
      if (idx >= 0) {
        const end = raw.indexOf('\n', idx);
        let next = raw.indexOf('\n', end + 1);
        // consume following indented lines
        while (next >= 0 && /^[ \t]/.test(raw.slice(end + 1, next))) { const n2 = raw.indexOf('\n', next + 1); if (n2 < 0) break; next = n2; }
        raw = raw.slice(0, idx) + block + raw.slice(end + 1);
      } else {
        raw = raw.replace(/\s*$/, '') + (raw ? '\n' : '') + block;
      }
      await P.io.writeFile(settingsYamlPath(), raw);
      return true;
    } catch (e) {
      P.app.toast(t('settings.models.defaultFail', { msg: e.message || String(e) }));
      return false;
    }
  }

  function providerRef(provider) {
    return String(provider || '').replace(/^llm-/, '').toUpperCase().replace(/-/g, '_') + '_API_KEY';
  }

  async function loadCredentialState() {
    const providers = P.dshState.providers || [];
    const refs = providers.map((p) => providerRef(p.provider));
    let creds = {};
    try { creds = await P.dshState.credentialsDescribe(refs); } catch (e) { creds = {}; }
    const map = {};
    for (const p of providers) {
      const ref = providerRef(p.provider);
      map[p.provider] = { ref, configured: !!(creds[ref] && creds[ref].configured) };
    }
    return map;
  }

  /* ---------- section renderers ---------- */

  /* ---------- accent colors + wallpaper helpers ---------- */

  function bridge() {
    try { return (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null; } catch (e) { return null; }
  }
  async function detectEditors() {
    const b = bridge();
    if (b && typeof b.detectEditors === 'function') {
      try { return await b.detectEditors(); } catch (e) { /* fall through */ }
    }
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      const res = await fetch(origin + '/prts/api/detect-editors');
      if (res.ok) return await res.json();
    } catch (e) { /* no host route */ }
    return [{ id: 'default', name: '系统默认' }];
  }
  function currentAccent() {
    config.ui = config.ui || {};
    if (!config.ui.accent) config.ui.accent = { preset: 'tokyonight', primary: '#7aa2f7', diamond: '#7dcfff', square: '#bb9af7' };
    return config.ui.accent;
  }
  async function saveAccent() {
    await P.store.saveConfig(config);
    P.app.applyTheme((config.ui && config.ui.theme) || 'dark');
    if (P.app.applyAccent) P.app.applyAccent(config);
  }
  function currentWallpaper() {
    config.ui = config.ui || {};
    if (!config.ui.wallpaper) config.ui.wallpaper = { file: '', type: 'image', fit: 'cover', opacity: 0.35, speed: 1, loop: true };
    return config.ui.wallpaper;
  }
  async function saveWallpaperBase64(fileName, mime, b64) {
    const b = bridge();
    const dir = P.platform.prtsProfileDir() + '/wallpaper';
    if (b && b.writeFileB64) {
      try {
        await b.mkdir(dir);
        await b.writeFileB64(dir + '/' + fileName, b64);
        return true;
      } catch (e) { /* fall through */ }
    }
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
      const res = await fetch(origin + '/prts/api/wallpaper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileName, mime, base64: b64 }),
      });
      return res.ok;
    } catch (e) { return false; }
  }
  async function clearWallpaper() {
    const w = currentWallpaper();
    const b = bridge();
    const file = P.platform.prtsProfileDir() + '/wallpaper/' + w.file;
    if (b && b.deleteFile) {
      try { await b.deleteFile(file); } catch (e) { /* noop */ }
    } else {
      try {
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) || '';
        await fetch(origin + '/prts/api/wallpaper', { method: 'DELETE' });
      } catch (e) { /* noop */ }
    }
    w.file = '';
    await P.store.saveConfig(config);
    if (P.app.applyWallpaper) P.app.applyWallpaper(config);
  }

  async function renderGeneral(box) {
    box.textContent = '';

    // Language (official locale ns)
    const langSec = el('div', 'sSection');
    langSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.language')));
    const lang = el('select', 'sInput sSelect');
    const locale = (await nsValue('locale')) || {};
    [['', 'AUTO'], ['zh', '中文'], ['en', 'ENGLISH']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if ((locale.preference || '') === v) o.selected = true;
      lang.appendChild(o);
    });
    lang.addEventListener('change', async () => {
      const ok = await nsUpdate('locale', { preference: lang.value || null });
      if (ok) {
        config.locale = lang.value || 'auto';
        await P.store.saveConfig(config);
        P.app.locale = config.locale === 'auto' ? P.platform.detectLocale() : config.locale;
        P.app.applyI18n();
      }
    });
    langSec.appendChild(lang);
    box.appendChild(langSec);

    // Appearance (official ui-theme ns)
    const themeSec = el('div', 'sSection');
    themeSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.appearance')));
    const theme = el('select', 'sInput sSelect');
    const themeNs = (await nsValue('ui-theme')) || {};
    [['system', 'SYSTEM'], ['dark', 'DARK'], ['light', 'LIGHT'], ['custom', 'CUSTOM']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if ((themeNs.preference || 'system') === v) o.selected = true;
      theme.appendChild(o);
    });
    theme.addEventListener('change', async () => {
      // ui-theme only accepts system/light/dark; PRTS keeps 'custom' in its
      // own config and stores the base appearance (dark) in the official ns.
      const nsPref = theme.value === 'custom' ? 'dark' : theme.value;
      const ok = await nsUpdate('ui-theme', { preference: nsPref });
      if (ok) {
        config.ui = config.ui || {};
        config.ui.theme = theme.value === 'system' ? 'dark' : theme.value;
        await P.store.saveConfig(config);
        P.app.applyTheme(config.ui.theme);
        if (P.app.applyAccent) P.app.applyAccent(config);
        renderGeneral(box);
      }
    });
    themeSec.appendChild(theme);
    box.appendChild(themeSec);

    // Composer enter (official ui-conversation ns)
    const enterSec = el('div', 'sSection');
    enterSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.enter')));
    const enter = el('select', 'sInput sSelect');
    const conv = (await nsValue('ui-conversation')) || {};
    [['queue', 'QUEUE'], ['steer', 'STEER']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if ((conv.busyEnter || 'queue') === v) o.selected = true;
      enter.appendChild(o);
    });
    enter.addEventListener('change', () => { nsUpdate('ui-conversation', { busyEnter: enter.value }); });
    enterSec.appendChild(enter);
    box.appendChild(enterSec);

    // —— 外观自定义颜色 (PRTS accent presets) ——
    const accSec = el('div', 'sSection');
    accSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.accent')));
    const a = currentAccent();
    const chips = el('div', 'skChips');
    for (const pr of ACCENT_PRESETS) {
      const c = el('button', 'skChip' + (a.preset === pr.id ? ' on' : ''), pr.name);
      c.type = 'button';
      c.addEventListener('click', async () => {
        a.preset = pr.id; a.primary = pr.primary; a.diamond = pr.diamond; a.square = pr.square;
        await saveAccent(); renderGeneral(box);
      });
      chips.appendChild(c);
    }
    accSec.appendChild(chips);
    const pickers = el('div', 'accPickers');
    [['primary', 'settings.general.accentPrimary'], ['diamond', 'settings.general.accentDiamond'], ['square', 'settings.general.accentSquare']].forEach(([k, labelKey]) => {
      const row = el('label', 'accPick');
      row.appendChild(el('span', 'fLabel', t(labelKey)));
      const c = document.createElement('input');
      c.type = 'color';
      c.value = a[k] || '#7aa2f7';
      c.addEventListener('input', async () => {
        a[k] = c.value; a.preset = 'custom';
        await saveAccent(); renderGeneral(box);
      });
      row.appendChild(c);
      pickers.appendChild(row);
    });
    accSec.appendChild(pickers);
    box.appendChild(accSec);

    // —— 自定义壁纸 (image / video, one-shot persistent) ——
    const wpSec = el('div', 'sSection');
    wpSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.wallpaper')));
    const w = currentWallpaper();
    const upRow = el('div', 'inlineForm');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.style.display = 'none';
    const pick = el('button', 'sBtn', t('settings.general.wallpaper.pick'));
    pick.type = 'button';
    pick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const m = /^data:([^;]+);base64,(.*)$/.exec(String(reader.result || ''));
        if (!m) return;
        const mime = m[1];
        const ext = mime.indexOf('video') === 0 ? 'mp4' : (mime === 'image/png' ? 'png' : 'jpg');
        const fileName = 'wall-' + Date.now().toString(36) + '.' + ext;
        const ok = await saveWallpaperBase64(fileName, mime, m[2]);
        if (!ok) { P.app.toast(t('settings.general.wallpaper.fail')); return; }
        w.file = fileName;
        w.type = mime.indexOf('video') === 0 ? 'video' : 'image';
        w.mime = mime;
        await P.store.saveConfig(config);
        if (P.app.applyWallpaper) P.app.applyWallpaper(config);
        renderGeneral(box);
      };
      reader.readAsDataURL(f);
    });
    upRow.appendChild(pick);
    const clearWp = el('button', 'sBtn', t('settings.general.wallpaper.clear'));
    clearWp.type = 'button';
    clearWp.disabled = !w.file;
    clearWp.addEventListener('click', async () => { await clearWallpaper(); renderGeneral(box); });
    upRow.appendChild(clearWp);
    wpSec.appendChild(upRow);
    if (w.file) {
      const nameRow = el('div', 'projectRow');
      nameRow.appendChild(el('span', 'pname', w.file));
      nameRow.appendChild(el('span', 'pmeta', String(w.type || 'image').toUpperCase()));
      wpSec.appendChild(nameRow);
      const fitRow = el('div', 'inlineForm');
      fitRow.appendChild(el('span', 'fLabel', t('settings.general.wallpaper.fit')));
      const fit = el('select', 'sInput sSelect');
      [['cover', 'COVER'], ['contain', 'CENTER'], ['fill', 'FILL']].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        if (w.fit === v) o.selected = true;
        fit.appendChild(o);
      });
      fit.addEventListener('change', async () => {
        w.fit = fit.value;
        await P.store.saveConfig(config);
        if (P.app.applyWallpaper) P.app.applyWallpaper(config);
      });
      fitRow.appendChild(fit);
      wpSec.appendChild(fitRow);
      const opRow = el('div', 'inlineForm');
      opRow.appendChild(el('span', 'fLabel', t('settings.general.wallpaper.opacity')));
      const op = document.createElement('input');
      op.type = 'range'; op.min = '0'; op.max = '1'; op.step = '0.01';
      op.value = String(w.opacity !== undefined ? w.opacity : 0.35);
      op.className = 'accRange';
      op.addEventListener('input', async () => {
        w.opacity = Number(op.value);
        await P.store.saveConfig(config);
        if (P.app.applyWallpaper) P.app.applyWallpaper(config);
      });
      opRow.appendChild(op);
      wpSec.appendChild(opRow);
      if (w.type === 'video') {
        const vRow = el('div', 'inlineForm');
        vRow.appendChild(el('span', 'fLabel', t('settings.general.wallpaper.speed')));
        const sp = document.createElement('input');
        sp.type = 'number'; sp.min = '0.25'; sp.max = '4'; sp.step = '0.25';
        sp.value = String(w.speed !== undefined ? w.speed : 1);
        sp.className = 'sInput accNum';
        sp.addEventListener('change', async () => {
          w.speed = Number(sp.value) || 1;
          await P.store.saveConfig(config);
          if (P.app.applyWallpaper) P.app.applyWallpaper(config);
        });
        vRow.appendChild(sp);
        const loopLabel = el('label', 'mCheck');
        const loopBox = document.createElement('input');
        loopBox.type = 'checkbox';
        loopBox.checked = w.loop !== false;
        loopBox.addEventListener('change', async () => {
          w.loop = loopBox.checked;
          await P.store.saveConfig(config);
          if (P.app.applyWallpaper) P.app.applyWallpaper(config);
        });
        loopLabel.appendChild(loopBox);
        loopLabel.appendChild(el('span', '', t('settings.general.wallpaper.loop')));
        vRow.appendChild(loopLabel);
        wpSec.appendChild(vRow);
      }
    }
    box.appendChild(wpSec);

    // —— 液态玻璃开关 ——
    const glassSec = el('div', 'sSection');
    glassSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.glass')));
    const glassRow = el('div', 'inlineForm');
    const glassLabel = el('label', 'mCheck');
    const glassBox = document.createElement('input');
    glassBox.type = 'checkbox';
    glassBox.checked = (config.ui && config.ui.glass) !== false;
    glassLabel.appendChild(glassBox);
    glassLabel.appendChild(el('span', '', t('settings.general.glass.on')));
    glassRow.appendChild(glassLabel);
    glassSec.appendChild(glassRow);
    glassBox.addEventListener('change', async () => {
      config.ui = config.ui || {};
      config.ui.glass = glassBox.checked;
      await P.store.saveConfig(config);
      if (P.app.applyGlass) P.app.applyGlass(config);
    });
    box.appendChild(glassSec);

    // —— 默认文本编辑器（自动检测） ——
    const edSec = el('div', 'sSection');
    edSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.editor')));
    edSec.appendChild(el('div', 'hint', t('settings.general.editor.hint')));
    const edSel = el('select', 'sInput sSelect');
    let editors = [];
    try { editors = await detectEditors(); } catch (e) { editors = []; }
    if (!editors.length) editors = [{ id: 'default', name: '系统默认' }];
    for (const e of editors) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.name || e.id;
      if ((config.ui && config.ui.editor) === e.id || (!config.ui || !config.ui.editor) && e.id === 'default') o.selected = true;
      edSel.appendChild(o);
    }
    edSel.addEventListener('change', async () => {
      config.ui = config.ui || {};
      config.ui.editor = edSel.value;
      await P.store.saveConfig(config);
    });
    edSec.appendChild(edSel);
    box.appendChild(edSec);

    // —— 左侧侧边栏按钮显隐 ——
    const sbSec = el('div', 'sSection');
    sbSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.sidebarButtons')));
    const sbChips = el('div', 'skChips');
    const ids = (P.app && P.app.SIDEBAR_BUTTONS) || ['themeBtn', 'gitBtn', 'skillBtn', 'marketBtn', 'detailsBtn', 'settingsBtn'];
    const cur = (config.ui && config.ui.sidebarButtons) || {};
    for (const id of ids) {
      const on = cur[id] !== false;
      const c = el('button', 'skChip' + (on ? ' on' : ''), t('sidebar.btn.' + id.replace('Btn', ''), { default: id }));
      c.type = 'button';
      c.addEventListener('click', async () => {
        config.ui = config.ui || {};
        config.ui.sidebarButtons = config.ui.sidebarButtons || {};
        config.ui.sidebarButtons[id] = cur[id] !== false ? false : true;
        await P.store.saveConfig(config);
        if (P.app.applySidebarButtons) P.app.applySidebarButtons(config);
        renderGeneral(box);
      });
      sbChips.appendChild(c);
    }
    sbSec.appendChild(sbChips);
    box.appendChild(sbSec);

    // Doctor name (PRTS persona)
    const nameSec = el('div', 'sSection');
    nameSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.general.doctorName')));
    nameSec.appendChild(el('div', 'hint', t('settings.general.doctorName.hint')));
    const nameForm = el('div', 'inlineForm');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sInput';
    nameInput.placeholder = t('settings.general.doctorName.placeholder');
    nameInput.value = (config.persona && config.persona.userName) || '';
    nameInput.spellcheck = false;
    const saveName = el('button', 'sBtn', t('common.save'));
    saveName.type = 'button';
    saveName.addEventListener('click', async () => {
      config.persona = config.persona || {};
      config.persona.userName = nameInput.value.trim();
      await P.store.saveConfig(config);
      P.app.toast(t('settings.general.doctorName.saved'));
    });
    nameForm.appendChild(nameInput); nameForm.appendChild(saveName);
    nameSec.appendChild(nameForm);
    box.appendChild(nameSec);

    // Version / update
    const vSec = el('div', 'sSection');
    vSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.version')));
    const vbox = el('div');
    let prtsVer = '?';
    try { prtsVer = (window.prts && window.prts.env && window.prts.env.prtsVersion) || '?'; } catch (e) { prtsVer = '?'; }
    let dshVer = '—';
    try { const h = await P.dshState.hostDescribe(); dshVer = (h && h.version) || '—'; } catch (e) { dshVer = '—'; }
    [['PRTS', prtsVer], ['dsh', dshVer]].forEach(([n, v]) => {
      const row = el('div', 'projectRow');
      row.appendChild(el('span', 'pname', n));
      row.appendChild(el('span', 'pmeta', v));
      vbox.appendChild(row);
    });
    vSec.appendChild(vbox);
    const updRow = el('div', 'sRow');
    updRow.style.marginTop = '8px';
    const updateBtn = el('button', 'sBtn', t('settings.update'));
    updateBtn.type = 'button';
    const updStatus = el('span', 'sStatus');
    updateBtn.addEventListener('click', async () => {
      updStatus.textContent = t('settings.updating');
      try {
        const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
        const r = b && b.update ? await b.update() : { ok: false, stderr: 'no bridge' };
        if (r && r.ok) { updStatus.textContent = t('settings.updated'); P.app.toast(t('settings.updated')); }
        else updStatus.textContent = t('settings.updateFail', { msg: (r && (r.stderr || r.error)) || 'error' });
      } catch (e) { updStatus.textContent = t('settings.updateFail', { msg: e.message }); }
    });
    updRow.appendChild(updateBtn); updRow.appendChild(updStatus);
    vSec.appendChild(updRow);
    box.appendChild(vSec);
  }

  // pi-ai provider registry helpers (settings llm-pi-ai.providers)
  async function piAiValue() {
    const v = await nsValue('llm-pi-ai');
    return (v && v.providers) || {};
  }
  async function savePiAi(providers) {
    return nsUpdate('llm-pi-ai', { providers });
  }
  function isPiAi(p) { return p && p.settingsNs === 'llm-pi-ai'; }

  /** Official-style Models page: one provider row per configured route, plus
   *  "添加提供方" (built-in configurable providers) and "添加自定义提供方". */
  async function renderModels(box) {
    box.textContent = '';
    await P.dshState.listProviders();
    await P.dshState.listModels();
    const creds = await loadCredentialState();
    const pi = await piAiValue();
    const providers = P.dshState.providers || [];
    const groups = P.dshState.models || [];
    const configuredRoutes = providers.filter((p) => p.active || p.declared || pi[p.provider] !== undefined);
    const candidates = providers.filter((p) => isPiAi(p) && !p.active && !p.declared && pi[p.provider] === undefined);
    // deepseek-official always shows even when the wire omits it
    const hasDs = configuredRoutes.some((p) => p.provider === 'deepseek-official');

    const sec = el('div', 'sSection');
    sec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.models.providers')));
    if (!hasDs) {
      const ds = el('div', 'hint', t('settings.models.deepseekBuiltin'));
      sec.appendChild(ds);
    }

    /** credential state dot for one provider */
    function stateOf(p) {
      if (!isPiAi(p)) {
        const ref = providerRef(p.provider);
        return !!(creds[p.provider] && creds[p.provider].configured) || !!(creds[ref] && creds[ref].configured);
      }
      const cfg = pi[p.provider] || {};
      return !!(cfg.apiKey && String(cfg.apiKey).length > 0);
    }

    /** one provider row card (collapsible editor) */
    function providerCard(p) {
      const card = el('div', 'pCard');
      const head = el('button', 'pCardHead');
      head.type = 'button';
      const identity = el('span', 'pName', p.displayName || p.provider);
      head.appendChild(identity);
      const routeTag = el('span', 'pState', p.provider);
      routeTag.dataset.state = isPiAi(p) ? 'none' : 'ok';
      head.appendChild(routeTag);
      const dot = el('span', 'credDot' + (stateOf(p) ? ' ok' : ''));
      head.appendChild(dot);
      const chev = el('span', 'chev');
      chev.innerHTML = P.icons.chev || '';
      head.appendChild(chev);
      card.appendChild(head);

      const body = el('div', 'pCardBody');
      body.style.display = 'none';

      if (isPiAi(p)) {
        const cfg = pi[p.provider] || {};
        // display name
        const dnForm = el('div', 'inlineForm');
        const dnLabel = el('span', 'fLabel', t('settings.models.displayName'));
        const dn = document.createElement('input');
        dn.type = 'text';
        dn.className = 'sInput';
        dn.value = cfg.displayName || '';
        dn.placeholder = p.provider;
        dn.spellcheck = false;
        const dnSave = el('button', 'sBtn', t('common.save'));
        dnSave.type = 'button';
        dnSave.addEventListener('click', async () => {
          const next = { ...pi, [p.provider]: { ...cfg, displayName: dn.value.trim() } };
          if (await savePiAi(next)) renderModels(box);
        });
        dnForm.appendChild(dnLabel); dnForm.appendChild(dn); dnForm.appendChild(dnSave);
        body.appendChild(dnForm);

        // API key (settings secret) + baseURL
        const keyForm = el('div', 'inlineForm');
        const keyLabel = el('span', 'fLabel', t('settings.provider.save'));
        const keyInput = document.createElement('input');
        keyInput.type = 'password';
        keyInput.className = 'sInput';
        keyInput.placeholder = 'API Key';
        keyInput.autocomplete = 'off';
        keyInput.spellcheck = false;
        const keySave = el('button', 'sBtn', t('common.save'));
        keySave.type = 'button';
        keySave.addEventListener('click', async () => {
          const v = keyInput.value.trim();
          if (!v) return;
          const next = { ...pi, [p.provider]: { ...cfg, apiKey: v } };
          if (await savePiAi(next)) { keyInput.value = ''; renderModels(box); }
        });
        keyForm.appendChild(keyLabel); keyForm.appendChild(keyInput); keyForm.appendChild(keySave);
        body.appendChild(keyForm);

        const urlForm = el('div', 'inlineForm');
        const urlLabel = el('span', 'fLabel', 'baseURL');
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'sInput';
        urlInput.value = cfg.baseURL || '';
        urlInput.placeholder = 'https://…';
        urlInput.spellcheck = false;
        const urlSave = el('button', 'sBtn', t('common.save'));
        urlSave.type = 'button';
        urlSave.addEventListener('click', async () => {
          const next = { ...pi, [p.provider]: { ...cfg, baseURL: urlInput.value.trim() } };
          if (await savePiAi(next)) renderModels(box);
        });
        urlForm.appendChild(urlLabel); urlForm.appendChild(urlInput); urlForm.appendChild(urlSave);
        body.appendChild(urlForm);

        // model catalog (editable)
        body.appendChild(modelCatalog(p, cfg.models || [], async (models) => {
          const next = { ...pi, [p.provider]: { ...cfg, models } };
          if (await savePiAi(next)) renderModels(box);
        }));

        // delete route
        const del = el('button', 'sBtn danger', t('settings.models.removeProvider'));
        del.type = 'button';
        del.addEventListener('click', async () => {
          const ok = await P.app.askConfirm(t('settings.models.removeProviderConfirm', { name: p.displayName || p.provider }));
          if (!ok) return;
          const next = { ...pi };
          delete next[p.provider];
          if (await savePiAi(next)) renderModels(box);
        });
        body.appendChild(del);
      } else {
        // deepseek-official: credential ref + read-only catalog
        const ref = providerRef(p.provider);
        const configured = !!(creds[p.provider] && creds[p.provider].configured) || !!(creds[ref] && creds[ref].configured);
        const keyForm = el('div', 'inlineForm');
        const keyLabel = el('span', 'fLabel', t('settings.provider.save'));
        const keyInput = document.createElement('input');
        keyInput.type = 'password';
        keyInput.className = 'sInput';
        keyInput.placeholder = ref;
        keyInput.autocomplete = 'off';
        keyInput.spellcheck = false;
        const keySave = el('button', 'sBtn', t('common.save'));
        keySave.type = 'button';
        keySave.addEventListener('click', async () => {
          const v = keyInput.value.trim();
          if (!v) return;
          try {
            await P.dshState.credentialsSet(ref, v);
            keyInput.value = '';
            P.app.toast(t('settings.provider.saved', { ref }));
            renderModels(box);
          } catch (e) { P.app.toast(e.message); }
        });
        keyForm.appendChild(keyLabel); keyForm.appendChild(keyInput); keyForm.appendChild(keySave);
        const keyUnset = el('button', 'sBtn', t('settings.provider.unsetBtn'));
        keyUnset.type = 'button';
        keyUnset.disabled = !configured;
        keyUnset.addEventListener('click', async () => {
          try { await P.dshState.credentialsUnset(ref); renderModels(box); } catch (e) { P.app.toast(e.message); }
        });
        keyForm.appendChild(keyUnset);
        body.appendChild(keyForm);
        const grp = groups.find((g) => g.id === p.provider) || {};
        const models = grp.models || [];
        body.appendChild(modelCatalog(p, models, null));
      }

      head.addEventListener('click', () => {
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : '';
      });
      card.appendChild(body);
      return card;
    }

    /** model catalog block: chips + add-model input for pi-ai, read-only list otherwise */
    function modelCatalog(p, models, onSave) {
      const cat = el('div', 'mCatalog');
      const title = el('div', 'mCatalogTitle', t('settings.models.catalog'));
      cat.appendChild(title);
      const list = el('div', 'skChips');
      if (!models || !models.length) list.appendChild(el('span', 'hint', t('model.none')));
      for (const m of models) {
        const chip = el('span', 'skChip on', (m && m.name) || (m && m.id) || m);
        if (onSave) {
          const rm = el('button', 'skChipX', '×');
          rm.type = 'button';
          rm.addEventListener('click', async () => {
            const next = models.filter((x) => x !== m);
            await onSave(next);
          });
          chip.appendChild(rm);
        }
        list.appendChild(chip);
      }
      cat.appendChild(list);
      if (onSave) {
        const form = el('div', 'inlineForm');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'sInput';
        input.placeholder = t('settings.models.addModel');
        input.spellcheck = false;
        const add = el('button', 'sBtn', '+ ' + t('settings.models.addModelBtn'));
        add.type = 'button';
        add.addEventListener('click', async () => {
          const id = input.value.trim();
          if (!id) return;
          const next = (models || []).concat([{ id, name: id }]);
          await onSave(next);
        });
        form.appendChild(input); form.appendChild(add);
        cat.appendChild(form);
      }
      return cat;
    }

    // rows
    const rows = el('div', 'sRows');
    for (const p of configuredRoutes) rows.appendChild(providerCard(p));
    sec.appendChild(rows);

    // 添加提供方 (built-in candidates)
    const addSec = el('div', 'sSection');
    const addBtn = el('button', 'sBtn', '+ ' + t('settings.models.addProvider'));
    addBtn.type = 'button';
    const candBox = el('div', 'sCollapse');
    candBox.style.display = 'none';
    addBtn.addEventListener('click', () => {
      const open = candBox.style.display !== 'none';
      candBox.style.display = open ? 'none' : '';
      if (!open && !candBox.hasChildNodes()) renderCandidates();
    });
    function renderCandidates() {
      candBox.textContent = '';
      if (!candidates.length) {
        candBox.appendChild(el('div', 'hint', t('settings.models.addProvider.none')));
        return;
      }
      for (const c of candidates) {
        const row = el('div', 'projectRow');
        row.appendChild(el('span', 'pname', c.displayName || c.provider));
        row.appendChild(el('span', 'pmeta', c.provider));
        const go = el('button', 'sBtn', t('settings.models.add'));
        go.type = 'button';
        go.addEventListener('click', async () => {
          const next = { ...pi, [c.provider]: {} };
          if (await savePiAi(next)) { P.app.toast(t('settings.models.added', { name: c.displayName || c.provider })); renderModels(box); }
        });
        row.appendChild(go);
        candBox.appendChild(row);
      }
    }
    addSec.appendChild(addBtn);
    addSec.appendChild(candBox);

    // 添加自定义提供方 (custom route)
    const customBtn = el('button', 'sBtn', '+ ' + t('settings.models.addCustom'));
    customBtn.type = 'button';
    const customBox = el('div', 'sCollapse');
    customBox.style.display = 'none';
    customBtn.addEventListener('click', () => {
      const open = customBox.style.display !== 'none';
      customBox.style.display = open ? 'none' : '';
      if (!open && !customBox.hasChildNodes()) renderCustom();
    });
    function renderCustom() {
      customBox.textContent = '';
      customBox.appendChild(el('div', 'hint', t('settings.models.addCustom.hint')));
      const f = el('div', 'sCustomForm');
      const route = document.createElement('input');
      route.type = 'text';
      route.className = 'sInput';
      route.placeholder = t('settings.models.customRoute');
      route.spellcheck = false;
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'sInput';
      name.placeholder = t('settings.models.customDisplayName');
      name.spellcheck = false;
      const key = document.createElement('input');
      key.type = 'password';
      key.className = 'sInput';
      key.placeholder = 'API Key';
      key.autocomplete = 'off';
      key.spellcheck = false;
      const base = document.createElement('input');
      base.type = 'text';
      base.className = 'sInput';
      base.placeholder = t('settings.models.customBaseUrl');
      base.spellcheck = false;
      const modelsInput = document.createElement('input');
      modelsInput.type = 'text';
      modelsInput.className = 'sInput';
      modelsInput.placeholder = t('settings.models.customModels');
      modelsInput.spellcheck = false;
      const err = el('div', 'hint');
      const create = el('button', 'sBtn primary', t('settings.models.customCreate'));
      create.type = 'button';
      create.addEventListener('click', async () => {
        const routeV = route.value.trim().replace(/[^A-Za-z0-9._-]/g, '');
        const baseV = base.value.trim();
        const modelList = modelsInput.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).map((id) => ({ id, name: id }));
        if (!routeV) { err.textContent = t('settings.models.customRouteInvalid'); return; }
        if (pi[routeV] !== undefined) { err.textContent = t('settings.models.customRouteTaken'); return; }
        if (!baseV) { err.textContent = t('settings.models.customNeedsBaseUrl'); return; }
        if (!modelList.length) { err.textContent = t('settings.models.customNeedsModels'); return; }
        const next = { ...pi, [routeV]: { displayName: name.value.trim(), apiKey: key.value.trim(), baseURL: baseV, models: modelList } };
        if (await savePiAi(next)) {
          P.app.toast(t('settings.models.added', { name: name.value.trim() || routeV }));
          renderModels(box);
        }
      });
      f.appendChild(route); f.appendChild(name); f.appendChild(key); f.appendChild(base); f.appendChild(modelsInput);
      f.appendChild(create);
      customBox.appendChild(f);
      customBox.appendChild(err);
    }
    addSec.appendChild(customBtn);
    addSec.appendChild(customBox);
    sec.appendChild(addSec);

    // 默认模型 (kept at the bottom, official Models page has no default row — PRTS extra)
    const defSec = el('div', 'sSection');
    defSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.models.default')));
    defSec.appendChild(el('div', 'hint', t('settings.models.default.hint')));
    const current = await readAgentDefaultModel();
    const form = el('div', 'inlineForm');
    const provSel = el('select', 'sInput sSelect');
    for (const g of groups) {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.name || g.id;
      if (current && current.provider === g.id) o.selected = true;
      provSel.appendChild(o);
    }
    const modelSel = el('select', 'sInput sSelect');
    const effortSel = el('select', 'sInput sSelect');
    function fillModels() {
      modelSel.textContent = '';
      const g = groups.find((x) => x.id === provSel.value) || {};
      for (const m of g.models || []) {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = m.name || m.id;
        if (current && current.model === m.id) o.selected = true;
        modelSel.appendChild(o);
      }
      fillEfforts();
    }
    function fillEfforts() {
      effortSel.textContent = '';
      const o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '—';
      effortSel.appendChild(o0);
      const g = groups.find((x) => x.id === provSel.value) || {};
      const m = (g.models || []).find((x) => x.id === modelSel.value);
      for (const e of (m && m.reasoning && m.reasoning.efforts) || []) {
        const o = document.createElement('option');
        o.value = e.id;
        o.textContent = e.name || e.id;
        if (current && current.reasoningEffort === e.id) o.selected = true;
        effortSel.appendChild(o);
      }
    }
    provSel.addEventListener('change', fillModels);
    modelSel.addEventListener('change', fillEfforts);
    fillModels();
    const saveDef = el('button', 'sBtn primary', t('common.save'));
    saveDef.type = 'button';
    saveDef.addEventListener('click', async () => {
      const ok = await writeAgentDefaultModel({ provider: provSel.value, model: modelSel.value, reasoningEffort: effortSel.value });
      if (ok) P.app.toast(t('settings.models.default.saved'));
    });
    form.appendChild(provSel); form.appendChild(modelSel); form.appendChild(effortSel); form.appendChild(saveDef);
    defSec.appendChild(form);
    sec.appendChild(defSec);

    box.appendChild(sec);
  }

  /* ---------- third-party plugin toggles (profile patch) ---------- */

  const PATCH_MARK = '# --- PRTS managed: third-party plugin toggles ---'
  const patchPath = () => P.platform.prtsProfileDir() + '/cordis.patch.yml'

  async function readPatchText() {
    try { return await P.io.readFile(patchPath()); } catch (e) { return '[]\n'; }
  }
  function patchApply(text, disabledList) {
    const idx = text.indexOf(PATCH_MARK)
    let base = idx >= 0 ? text.slice(0, idx) : text
    let block = PATCH_MARK + '\n# Written by PRTS settings — disabled rows apply after a dsh restart.\n'
    for (const id of disabledList) block += '  - id: ' + id + '\n    disabled: true\n'
    if (/\]\s*$/.test(base)) {
      base = base.replace(/\]\s*$/, '')
      return base + block + ']'
    }
    return base + block
  }
  async function writePluginToggles(disabledList) {
    const text = await readPatchText()
    const next = patchApply(text, disabledList)
    if (next !== text) {
      await P.io.writeFile(patchPath(), next)
      P.app.toast(t('settings.plugins.toggleSaved'))
    }
  }

  /** Official-style Plugins page: 插件配置 column (终端 / Agent循环 / 网页搜索)
   *  with the 第三方插件 button, and the searchable plugin inventory column
   *  on the right. */
  async function renderPlugins(box) {
    box.textContent = '';
    config.ui = config.ui || {};
    if (!Array.isArray(config.ui.pluginDisabled)) config.ui.pluginDisabled = [];
    const disabled = new Set(config.ui.pluginDisabled);

    const grid = el('div', 'sPluginsGrid');
    const left = el('div', 'sPluginsLeft');
    const right = el('div', 'sPluginsRight');
    grid.appendChild(left); grid.appendChild(right);

    /* —— 插件配置 column —— */
    left.appendChild(el('div', 'sSecTitle eyebrow', t('settings.plugins.config')));

    // generic settings-form card with reset
    async function cfgCard(titleKey, hintKey, ns, fields, schemaDefaults) {
      const card = el('div', 'pCard');
      const head = el('div', 'pCardHead');
      head.style.cursor = 'default';
      head.appendChild(el('span', 'pName', t(titleKey)));
      card.appendChild(head);
      const body = el('div', 'pCardBody');
      body.style.display = '';
      if (hintKey) body.appendChild(el('div', 'hint', t(hintKey)));
      const value = (await nsValue(ns)) || {};
      for (const f of fields) {
        const row = el('div', 'cfgField');
        row.appendChild(el('div', 'fLabel', t(f.labelKey)));
        const input = document.createElement('input');
        input.type = f.type || 'text';
        input.className = 'sInput';
        input.value = value[f.key] !== undefined ? String(value[f.key]) : '';
        if (f.type === 'password') input.autocomplete = 'off';
        if (f.type === 'number') input.step = '1';
        input.spellcheck = false;
        row.appendChild(input);
        const save = el('button', 'sBtn', t('common.save'));
        save.type = 'button';
        save.addEventListener('click', async () => {
          const patch = {};
          if (f.type === 'number') patch[f.key] = Number(input.value);
          else patch[f.key] = input.value;
          if (await nsUpdate(ns, patch)) P.app.toast(t('common.saved'));
        });
        row.appendChild(save);
        body.appendChild(row);
      }
      const reset = el('button', 'sBtn', t('settings.plugins.reset'));
      reset.type = 'button';
      reset.addEventListener('click', async () => {
        const patch = {};
        for (const f of fields) patch[f.key] = schemaDefaults && schemaDefaults[f.key] !== undefined ? schemaDefaults[f.key] : null;
        if (await nsUpdate(ns, patch)) renderPlugins(box);
      });
      body.appendChild(reset);
      card.appendChild(body);
      return card;
    }

    // schema defaults from the live describe (reset targets)
    const nsSchemaDefaults = {};
    try {
      const all = await describeAll();
      for (const n of all) {
        const d = {};
        const refs = (n.schema && n.schema.refs) || {};
        const rootT = refs[(n.schema && n.schema.uid)] || refs[String(n.schema && n.schema.uid)];
        if (rootT && rootT.dict) {
          for (const k of Object.keys(rootT.dict)) {
            const subUid = rootT.dict[k];
            const sub = refs[subUid] || refs[String(subUid)];
            if (sub && sub.meta && sub.meta.default !== undefined) d[k] = sub.meta.default;
          }
        }
        nsSchemaDefaults[n.ns] = d;
      }
    } catch (e) { /* defaults unavailable */ }

    left.appendChild(await cfgCard('settings.plugins.terminal', 'settings.plugins.terminal.hint', 'shell', [
      { key: 'timeoutMs', labelKey: 'settings.plugins.terminalTimeout', type: 'number' },
    ], nsSchemaDefaults.shell));
    left.appendChild(await cfgCard('settings.plugins.agentLoop', 'settings.plugins.agentLoop.hint', 'agent-loop', [
      { key: 'maxParallelToolCalls', labelKey: 'settings.plugins.agentLoopMax', type: 'number' },
    ], nsSchemaDefaults['agent-loop']));
    left.appendChild(await cfgCard('settings.plugins.webSearch', 'settings.plugins.webSearch.hint', 'web-search-deepseek', [
      { key: 'apiKey', labelKey: 'settings.plugins.webSearchKey', type: 'password' },
      { key: 'baseURL', labelKey: 'settings.plugins.webSearchUrl', type: 'text' },
      { key: 'model', labelKey: 'settings.plugins.webSearchModel', type: 'text' },
      { key: 'apiVersion', labelKey: 'settings.plugins.webSearchVersion', type: 'text' },
      { key: 'maxTokens', labelKey: 'settings.plugins.webSearchMaxTokens', type: 'number' },
      { key: 'maxUses', labelKey: 'settings.plugins.webSearchMaxUses', type: 'number' },
    ], nsSchemaDefaults['web-search-deepseek']));

    // 插件列表 button (the full 159-plugin inventory page)
    const invBtn = el('button', 'sBtn primary', t('settings.plugins.allList'));
    invBtn.type = 'button';
    invBtn.addEventListener('click', () => renderPluginInventory(box));
    left.appendChild(invBtn);
    // 第三方插件 button (below the config cards)
    const thirdBtn = el('button', 'sBtn', t('settings.plugins.thirdParty'));
    thirdBtn.type = 'button';
    thirdBtn.addEventListener('click', () => { rightTab = 'third'; renderRight(); });
    left.appendChild(thirdBtn);
    const marketBtn = el('button', 'sBtn', t('settings.plugins.openMarket'));
    marketBtn.type = 'button';
    marketBtn.addEventListener('click', () => { if (P.app && P.app.openWeb) P.app.openWeb(); });
    left.appendChild(marketBtn);

    /* —— 插件列表 column (searchable, core / third-party) —— */
    right.appendChild(el('div', 'sSecTitle eyebrow', t('settings.plugins.list')));
    const tabs = el('div', 'mTabs');
    const coreTab = el('button', 'mTab', t('settings.plugins.core'));
    coreTab.type = 'button';
    const thirdTab = el('button', 'mTab', t('settings.plugins.thirdPartyShort'));
    thirdTab.type = 'button';
    let rightTab = 'core';
    coreTab.addEventListener('click', () => { rightTab = 'core'; renderRight(); });
    thirdTab.addEventListener('click', () => { rightTab = 'third'; renderRight(); });
    tabs.appendChild(coreTab); tabs.appendChild(thirdTab);
    right.appendChild(tabs);

    const search = el('div', 'mSearch');
    search.innerHTML = P.icons.search || '';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = t('market.searchPlaceholder');
    searchInput.spellcheck = false;
    let query = '';
    searchInput.addEventListener('input', () => { query = searchInput.value; renderList(); });
    search.appendChild(searchInput);
    right.appendChild(search);

    let packages = [];
    try { packages = await P.dshState.pluginsList(); } catch (e) { packages = []; }
    const isThird = (name) => !String(name).startsWith('@deepseek-ai/') && name !== 'dsh-prts-ui';
    const listBox = el('div', 'sPluginList');
    right.appendChild(listBox);

    function renderRight() {
      coreTab.classList.toggle('on', rightTab === 'core');
      thirdTab.classList.toggle('on', rightTab === 'third');
      renderList();
    }
    async function togglePlugin(name) {
      if (disabled.has(name)) disabled.delete(name);
      else disabled.add(name);
      config.ui.pluginDisabled = [...disabled];
      await P.store.saveConfig(config);
      await writePluginToggles([...disabled]);
      renderList();
    }
    function renderList() {
      listBox.textContent = '';
      const q = query.trim().toLowerCase();
      const items = packages.filter((p) => {
        if (q && String(p.name || '').toLowerCase().indexOf(q) < 0) return false;
        return rightTab === 'third' ? isThird(p.name) : !isThird(p.name);
      });
      if (!items.length) {
        listBox.appendChild(el('div', 'hint', t('settings.plugins.listEmpty')));
        return;
      }
      for (const p of items) {
        const row = el('div', 'sPluginRow');
        const meta = el('div', 'sPluginMeta');
        meta.appendChild(el('span', 'pname', p.name));
        meta.appendChild(el('span', 'pmeta', (p.version || '') + (p.profile && p.profile !== 'prts' ? ' · ' + p.profile : '')));
        row.appendChild(meta);
        if (rightTab === 'third') {
          const on = !disabled.has(p.name);
          const sw = el('button', 'mSwitch' + (on ? ' on' : ''), on ? 'ON' : 'OFF');
          sw.type = 'button';
          sw.title = t(on ? 'settings.plugins.disable' : 'settings.plugins.enable');
          sw.addEventListener('click', () => togglePlugin(p.name));
          row.appendChild(sw);
        }
        listBox.appendChild(row);
      }
      if (rightTab === 'third') {
        const note = el('div', 'hint', t('settings.plugins.toggleHint'));
        listBox.appendChild(note);
      }
    }
    renderRight();
    box.appendChild(grid);
  }

  /** Full plugin inventory page — the same 159-entry list dsh web shows.
   *  Scrollable, searchable, every row toggles on/off (profile patch). */
  async function renderPluginInventory(box) {
    box.textContent = '';
    const host = el('div', 'sSection');
    const head = el('div', 'sSecRow');
    const back = el('button', 'sBtn', '← ' + t('settings.plugins.config'));
    back.type = 'button';
    back.addEventListener('click', () => renderPlugins(box));
    head.appendChild(back);
    head.appendChild(el('span', 'sSecTitle eyebrow', t('settings.plugins.allList')));
    host.appendChild(head);
    host.appendChild(el('div', 'hint', t('settings.plugins.allList.hint')));

    const search = el('div', 'mSearch');
    search.innerHTML = P.icons.search || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('market.searchPlaceholder');
    input.spellcheck = false;
    let query = '';
    input.addEventListener('input', () => { query = input.value; renderList(); });
    search.appendChild(input);
    host.appendChild(search);

    let entries = [];
    try { entries = await P.dshState.pluginInventoryList(); } catch (e) { entries = []; }
    const listBox = el('div', 'invList');
    host.appendChild(listBox);

    config.ui = config.ui || {};
    if (!Array.isArray(config.ui.pluginDisabled)) config.ui.pluginDisabled = [];
    const disabled = new Set(config.ui.pluginDisabled);

    async function toggleEntry(entryId) {
      if (disabled.has(entryId)) disabled.delete(entryId);
      else disabled.add(entryId);
      config.ui.pluginDisabled = [...disabled];
      await P.store.saveConfig(config);
      await writePluginToggles([...disabled]);
      renderList();
    }
    function renderList() {
      listBox.textContent = '';
      const q = query.trim().toLowerCase();
      const items = entries.filter((e) => !q || String(e.moduleName || '').toLowerCase().indexOf(q) >= 0 || String(e.entryId || '').toLowerCase().indexOf(q) >= 0);
      const count = el('div', 'pmeta', t('settings.plugins.allCount', { n: items.length }));
      listBox.appendChild(count);
      for (const e of items) {
        const row = el('div', 'sPluginRow');
        const meta = el('div', 'sPluginMeta');
        const nameLine = el('div', 'skNameLine');
        nameLine.appendChild(el('span', 'skItemName', e.moduleName || e.entryId));
        const phase = el('span', 'pState', e.fiberPhase === 'active' ? 'ACTIVE' : e.fiberPhase === 'ready' ? 'READY' : '—');
        phase.dataset.state = e.fiberPhase === 'active' ? 'ok' : 'none';
        nameLine.appendChild(phase);
        meta.appendChild(nameLine);
        meta.appendChild(el('div', 'pmeta', e.entryId || ''));
        row.appendChild(meta);
        const on = !disabled.has(e.entryId) && e.enabled !== false;
        const sw = el('button', 'mSwitch' + (on ? ' on' : ''), on ? 'ON' : 'OFF');
        sw.type = 'button';
        sw.title = t(on ? 'settings.plugins.disable' : 'settings.plugins.enable');
        sw.addEventListener('click', () => toggleEntry(e.entryId));
        row.appendChild(sw);
        listBox.appendChild(row);
      }
    }
    renderList();
    box.appendChild(host);
  }

  async function renderPresets(box) {
    box.textContent = '';
    const sec = el('div', 'sSection');
    sec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.presets')));
    sec.appendChild(el('div', 'hint', t('settings.presets.hint')));
    let presets = [];
    try { presets = await P.dshState.listPresets(); } catch (e) { presets = []; }
    if (!presets.length) sec.appendChild(el('div', 'hint', t('mode.none')));
    for (const p of presets) {
      const id = p.id || p.agentPreset;
      const row = el('div', 'sPresetRow' + (P.app.currentPreset === id ? ' current' : ''));
      const mark = el('span', 'skMark');
      mark.innerHTML = P.icons.diamond || '';
      row.appendChild(mark);
      const meta = el('div', 'skItemMeta');
      const nameLine = el('div', 'skNameLine');
      nameLine.appendChild(el('span', 'skItemName', p.name || id));
      const tag = el('span', 'pState', p.trust === 'system' ? 'SYSTEM' : 'USER');
      tag.dataset.state = p.trust === 'system' ? 'none' : 'ok';
      nameLine.appendChild(tag);
      if (p.isDefault) {
        const d = el('span', 'pState', 'DEFAULT');
        d.dataset.state = 'ok';
        nameLine.appendChild(d);
      }
      if (P.app.currentPreset === id) {
        const c = el('span', 'pState', t('settings.presets.current'));
        c.dataset.state = 'ok';
        nameLine.appendChild(c);
      }
      meta.appendChild(nameLine);
      const desc = el('div', 'skDesc', p.description || '');
      desc.title = p.description || '';
      meta.appendChild(desc);
      row.appendChild(meta);
      const useBtn = el('button', 'sBtn primary', t('settings.presets.use'));
      useBtn.type = 'button';
      useBtn.addEventListener('click', async () => {
        try {
          if (!P.dshState.currentSessionId || P.dshState.isSessionBlank(P.dshState.currentSessionId)) {
            if (P.dshState.currentSessionId) {
              await P.dshState.agentPresetSelect(P.dshState.currentSessionId, id);
              P.app.currentPreset = id;
              P.app.setModeLabel(P.app.presetLabel(id));
            } else {
              P.app.currentPreset = id;
              P.app.setModeLabel(P.app.presetLabel(id));
            }
            P.app.toast(t('settings.presets.used', { name: p.name || id }));
            renderPresets(box);
          } else {
            const ok = await P.app.askConfirm(t('mode.locked', { preset: p.name || id }));
            if (ok) {
              P.app.currentPreset = id;
              await P.app.newSession();
            }
          }
        } catch (e) { P.app.toast(e.message); }
      });
      row.appendChild(useBtn);
      sec.appendChild(row);
    }
    box.appendChild(sec);
  }

  /* ---------- shell ---------- */

  function navItem(id) {
    const spec = SECTIONS.find((s) => s.id === id);
    const b = el('button', 'sNavItem' + (current === id ? ' on' : ''));
    b.type = 'button';
    b.innerHTML = (P.icons[spec.id] || '') + '<span>' + t(spec.label) + '</span>';
    b.addEventListener('click', () => { current = id; render(); });
    return b;
  }

  async function render() {
    const nav = $id('settingsNav');
    const content = $id('settingsContent');
    if (!nav || !content) return;
    nav.textContent = '';
    for (const s of SECTIONS) nav.appendChild(navItem(s.id));
    content.textContent = '';
    content.appendChild(el('div', 'hint', t('settings.loading')));
    const box = el('div', 'sSectionHost');
    content.appendChild(box);
    if (current === 'general') await renderGeneral(box);
    else if (current === 'models') await renderModels(box);
    else if (current === 'plugins') await renderPlugins(box);
    else if (current === 'presets') await renderPresets(box);
    else if (current === 'balance') await P.balance.render(box, config);
    else if (current === 'git') await P.git.render(box, config);
    else if (current === 'skills') await P.skills.render(box, config);
  }

  async function open(cfg) {
    config = cfg;
    $id('settingsOverlay').classList.add('open');
    await render();
  }
  function close() { $id('settingsOverlay').classList.remove('open'); }

  ST.open = open;
  ST.close = close;
  ST.show = function (id) { current = id; render(); };
  ST.render = render;
  ST.SECTIONS = SECTIONS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
