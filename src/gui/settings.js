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
    [['system', 'SYSTEM'], ['dark', 'DARK'], ['light', 'LIGHT']].forEach(([v, label]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      if ((themeNs.preference || 'system') === v) o.selected = true;
      theme.appendChild(o);
    });
    theme.addEventListener('change', async () => {
      const ok = await nsUpdate('ui-theme', { preference: theme.value });
      if (ok) {
        config.ui = config.ui || {};
        config.ui.theme = theme.value === 'system' ? 'dark' : theme.value;
        await P.store.saveConfig(config);
        P.app.applyTheme(config.ui.theme);
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

  async function renderModels(box) {
    box.textContent = '';

    // Default model for new sessions (agent-default-model in ~/.dsh/settings.yaml)
    const defSec = el('div', 'sSection');
    defSec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.models.default')));
    defSec.appendChild(el('div', 'hint', t('settings.models.default.hint')));
    const groups = P.dshState.models || [];
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
      const ok = await writeAgentDefaultModel({
        provider: provSel.value,
        model: modelSel.value,
        reasoningEffort: effortSel.value,
      });
      if (ok) P.app.toast(t('settings.models.default.saved'));
    });
    form.appendChild(provSel); form.appendChild(modelSel); form.appendChild(effortSel); form.appendChild(saveDef);
    defSec.appendChild(form);
    box.appendChild(defSec);

    // Provider API keys (credentials) + catalog
    await P.dshState.listProviders();
    await P.dshState.listModels();
    const creds = await loadCredentialState();
    const providers = P.dshState.providers || [];
    const keySec = el('div', 'sSection');
    keySec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.providers')));
    keySec.appendChild(el('div', 'hint', t('settings.providers.hint')));
    if (!providers.length) keySec.appendChild(el('div', 'hint', t('settings.providers.empty')));
    for (const p of providers) {
      const ref = providerRef(p.provider);
      const configured = creds[p.provider] && creds[p.provider].configured;
      const card = el('div', 'pCard');
      const head = el('div', 'pCardHead');
      head.appendChild(el('span', 'pName', p.displayName || p.provider));
      const state = el('span', 'pState', configured ? t('settings.provider.set') : t('settings.provider.unset'));
      state.dataset.state = configured ? 'ok' : 'none';
      head.appendChild(state);
      card.appendChild(head);
      const body = el('div', 'pCardBody');
      const row = el('div', 'inlineForm');
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'sInput';
      input.placeholder = ref;
      input.autocomplete = 'off';
      input.spellcheck = false;
      const save = el('button', 'sBtn', t('settings.provider.save'));
      save.type = 'button';
      save.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;
        try {
          await P.dshState.credentialsSet(ref, value);
          input.value = '';
          P.app.toast(t('settings.provider.saved', { ref }));
          renderModels(box);
        } catch (e) { P.app.toast(e.message); }
      });
      const unset = el('button', 'sBtn', t('settings.provider.unsetBtn'));
      unset.type = 'button';
      unset.disabled = !configured;
      unset.addEventListener('click', async () => {
        try { await P.dshState.credentialsUnset(ref); renderModels(box); } catch (e) { P.app.toast(e.message); }
      });
      row.appendChild(input); row.appendChild(save); row.appendChild(unset);
      body.appendChild(row);
      const grp = (P.dshState.models || []).find((g) => g.id === p.provider);
      const models = (grp && grp.models) || [];
      body.appendChild(el('div', 'pModels', models.length ? models.map((m) => m.id).join(' · ') : t('model.none')));
      card.appendChild(body);
      keySec.appendChild(card);
    }
    box.appendChild(keySec);
  }

  async function renderPlugins(box) {
    box.textContent = '';
    const sec = el('div', 'sSection');
    sec.appendChild(el('div', 'sSecTitle eyebrow', t('settings.plugins')));
    sec.appendChild(el('div', 'hint', t('settings.plugins.hint')));
    let profiles = [];
    try { profiles = await P.dshState.profilesList(); } catch (e) { profiles = []; }
    const any = (profiles || []).some((p) => (p.packages || []).length);
    if (!any) sec.appendChild(el('div', 'hint', t('settings.plugins.empty')));
    for (const p of profiles || []) {
      const group = el('div', 'pGroup');
      const head = el('div', 'pGroupHead');
      head.appendChild(el('span', 'pname', 'PROFILE/' + p.profile));
      if (p.cli !== false && p.profile !== 'prts' && p.profile !== 'web') {
        const tag = el('span', 'pState', 'CLI');
        tag.dataset.state = 'ok';
        head.appendChild(tag);
        const run = el('button', 'sBtn', t('settings.plugins.runCli'));
        run.type = 'button';
        run.addEventListener('click', async () => {
          const args = await P.app.askPrompt(t('settings.plugins.runCliPrompt', { profile: p.profile }), (p.usage || '').split(' ')[0] || '');
          if (args === null) return;
          const r = await P.dshState.runCliPlugin(p.profile, args.trim() ? args.trim().split(/\s+/) : []);
          if (r && r.ok) P.app.toast(t('settings.plugins.runCliStarted', { profile: p.profile }));
          else P.app.toast(t('settings.plugins.runCliFail', { msg: (r && (r.error || r.stderr)) || 'error' }));
        });
        head.appendChild(run);
      }
      group.appendChild(head);
      for (const pkg of p.packages || []) {
        const row = el('div', 'projectRow');
        row.appendChild(el('span', 'pname', pkg.name));
        row.appendChild(el('span', 'pmeta', pkg.version || ''));
        group.appendChild(row);
      }
      sec.appendChild(group);
    }
    const mRow = el('div', 'sRow');
    mRow.style.marginTop = '10px';
    const openMarket = el('button', 'sBtn primary', t('settings.plugins.openMarket'));
    openMarket.type = 'button';
    openMarket.addEventListener('click', () => { if (P.market) P.market.open(); });
    mRow.appendChild(openMarket);
    sec.appendChild(mRow);
    box.appendChild(sec);
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
      const card = el('div', 'pCard');
      const head = el('div', 'pCardHead');
      head.appendChild(el('span', 'pName', p.name || id));
      const tags = el('span');
      const trust = el('span', 'pState', p.trust === 'system' ? 'SYSTEM' : 'USER');
      trust.dataset.state = p.trust === 'system' ? 'none' : 'ok';
      tags.appendChild(trust);
      if (p.isDefault) {
        const d = el('span', 'pState', 'DEFAULT');
        d.dataset.state = 'ok';
        tags.appendChild(d);
      }
      head.appendChild(tags);
      card.appendChild(head);
      const body = el('div', 'pCardBody');
      body.appendChild(el('div', 'pModels', p.description || ''));
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
          } else {
            const ok = await P.app.askConfirm(t('mode.locked', { preset: p.name || id }));
            if (ok) {
              P.app.currentPreset = id;
              await P.app.newSession();
            }
          }
        } catch (e) { P.app.toast(e.message); }
      });
      body.appendChild(useBtn);
      card.appendChild(body);
      sec.appendChild(card);
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
  ST.render = render;
  ST.SECTIONS = SECTIONS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
