/**
 * PRTS plugin market — redone around categories, search, and the separation
 * the Doctor asked for: dsh 插件 (npm/GitHub plugins for the harness) and
 * skill (skills installed into ~/.dsh/skills) live in two distinct tabs.
 * The card chrome mirrors dsh web's settings panels, restyled in PRTS.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const M = P.market = {};

  const PLUGIN_FALLBACK = [
    { pkg: '@liustack/modlens', displayName: 'ModLens', source: 'npm', category: 'visual', description: () => 'market.modlens' },
    { pkg: 'dsh-cost-meter', displayName: 'Cost Meter', source: 'npm', category: 'tool', description: () => 'market.costMeter' },
    { pkg: 'dsh-better-sidebar', displayName: 'Better Sidebar', source: 'npm', category: 'visual', description: () => 'market.betterSidebar' },
  ];

  let state = { tab: 'plugins', query: '', category: 'all', plugins: [], skills: [], installed: [] };

  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

  function catalog() {
    let scanned = { plugins: [], skills: [] };
    try {
      if (window.PRTS_MARKET) scanned = { plugins: window.PRTS_MARKET.plugins || [], skills: window.PRTS_MARKET.skills || [] };
    } catch (e) { scanned = { plugins: [], skills: [] }; }
    const pMap = new Map();
    for (const p of PLUGIN_FALLBACK.concat(scanned.plugins || [])) {
      const key = p.pkg || p.repo || p.name;
      if (!key || pMap.has(key)) continue;
      pMap.set(key, Object.assign({}, p, { source: p.source || 'npm', category: p.category || 'other' }));
    }
    const sMap = new Map();
    for (const s of (scanned.skills || [])) {
      if (!s.name || sMap.has(s.name)) continue;
      sMap.set(s.name, Object.assign({}, s, { category: s.category || 'tool' }));
    }
    return { plugins: [...pMap.values()], skills: [...sMap.values()] };
  }

  async function refresh() {
    const cat = catalog();
    state.plugins = cat.plugins;
    state.skills = cat.skills;
    let installed = [];
    try { installed = (await P.dshState.pluginsList()).map((p) => p.name); } catch (e) { installed = []; }
    state.installed = installed;
    let skillNames = [];
    try { skillNames = (await P.skills.list()).map((s) => s.name); } catch (e) { skillNames = []; }
    state.installedSkills = new Set(skillNames);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function match(text) {
    const q = state.query.trim().toLowerCase();
    return !q || String(text || '').toLowerCase().indexOf(q) >= 0;
  }

  function visiblePlugins() {
    return state.plugins.filter((p) => {
      if (state.category !== 'all' && p.category !== state.category) return false;
      return match((p.displayName || p.name || p.pkg || '') + ' ' + (typeof p.description === 'function' ? p.description() : (p.description || '')));
    });
  }
  function visibleSkills() {
    return state.skills.filter((s) => {
      if (state.category !== 'all' && s.category !== state.category) return false;
      return match((s.displayName || s.name || '') + ' ' + (s.description || ''));
    });
  }

  async function installPlugin(item, action) {
    action.disabled = true;
    action.textContent = t('market.installing');
    try {
      const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
      let r;
      if (item.source === 'github' && item.repo) r = b && b.pluginClone ? await b.pluginClone(item.repo) : { ok: false, stderr: 'no bridge' };
      else r = b && b.pluginAdd ? await b.pluginAdd(item.pkg || item.repo) : { ok: false, stderr: 'no bridge' };
      if (r && r.ok) {
        P.app.toast(t('market.installed', { pkg: item.pkg || item.repo }));
        await refresh();
        render();
      } else {
        P.app.toast(t('market.failed', { msg: (r && (r.stderr || r.stdout || r.error)) || 'error' }));
        action.disabled = false;
        action.textContent = t('market.install');
      }
    } catch (e) {
      P.app.toast(e.message);
      action.disabled = false;
      action.textContent = t('market.install');
    }
  }

  async function installSkill(item, action) {
    if (!item.repo || item.repo === 'local' || item.builtin) return;
    action.disabled = true;
    action.textContent = t('market.installing');
    try {
      const r = await P.skills.install(item.repo, item.subdir);
      if (r && r.ok) {
        P.app.toast(t('market.skillInstalled', { name: item.displayName || item.name }));
        await refresh();
        render();
      } else {
        P.app.toast(t('market.failed', { msg: (r && (r.error || r.stderr)) || 'error' }));
        action.disabled = false;
        action.textContent = t('market.install');
      }
    } catch (e) {
      P.app.toast(e.message);
      action.disabled = false;
      action.textContent = t('market.install');
    }
  }

  function card(item, kind) {
    const isInstalled = kind === 'plugins'
      ? state.installed.includes(item.pkg) || (item.pkg && state.installed.includes(item.pkg.replace(/^@[^/]+\//, '')))
      : (state.installedSkills && state.installedSkills.has(item.name));
    const card = el('div', 'pCard');
    const head = el('div', 'pCardHead');
    head.style.cursor = 'default';
    const name = el('span', 'pName', item.displayName || item.name || item.pkg || item.repo);
    const badge = el('span', 'pState');
    badge.textContent = kind === 'plugins' ? (item.source === 'github' ? 'GITHUB' : 'NPM') : 'SKILL';
    badge.dataset.state = 'ok';
    const catBadge = el('span', 'pState');
    catBadge.textContent = t('market.cat.' + (item.category || 'other'));
    head.appendChild(name); head.appendChild(catBadge); head.appendChild(badge);
    const body = el('div', 'pCardBody');
    body.style.display = '';
    const desc = el('div', 'pModels', typeof item.description === 'function' ? item.description() : (item.description || ''));
    body.appendChild(desc);
    if (kind === 'skills' && item.repo && item.repo !== 'local') {
      const link = el('a', 'mLink', item.repo.replace(/^https?:\/\/(www\.)?github\.com\//, 'github.com/'));
      link.href = item.repo;
      link.target = '_blank';
      link.rel = 'noopener';
      body.appendChild(link);
    }
    const action = el('button', 'sBtn' + (isInstalled ? '' : ' primary'));
    action.type = 'button';
    action.textContent = isInstalled ? t('market.installed') : t('market.install');
    action.disabled = isInstalled || (kind === 'skills' && (!item.repo || item.repo === 'local' || item.builtin));
    if (!action.disabled) {
      action.addEventListener('click', () => (kind === 'plugins' ? installPlugin(item, action) : installSkill(item, action)));
    }
    body.appendChild(action);
    card.appendChild(head); card.appendChild(body);
    return card;
  }

  const CATS = {
    all: 'market.cat.all',
    visual: 'market.cat.visual',
    tool: 'market.cat.tool',
    other: 'market.cat.other',
    persona: 'market.cat.persona',
    design: 'market.cat.design',
    ui: 'market.cat.ui',
    fx: 'market.cat.fx',
    text: 'market.cat.text',
  };
  const SKILL_CATS = ['all', 'design', 'ui', 'fx', 'text', 'tool', 'persona', 'other'];
  const PLUGIN_CATS = ['all', 'visual', 'tool', 'other'];

  function render() {
    const box = document.getElementById('marketList');
    if (!box) return;
    box.textContent = '';

    // —— controls: search + tabs + category chips ——
    const controls = el('div', 'mControls');
    const search = el('div', 'mSearch');
    search.innerHTML = P.icons.search || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('market.searchPlaceholder');
    input.value = state.query;
    input.spellcheck = false;
    input.addEventListener('input', () => { state.query = input.value; render(); });
    search.appendChild(input);
    controls.appendChild(search);

    const tabs = el('div', 'mTabs');
    const pluginTab = el('button', 'mTab' + (state.tab === 'plugins' ? ' on' : ''), t('market.tab.plugins'));
    pluginTab.type = 'button';
    pluginTab.addEventListener('click', () => { state.tab = 'plugins'; state.category = 'all'; render(); });
    const skillTab = el('button', 'mTab' + (state.tab === 'skills' ? ' on' : ''), t('market.tab.skills'));
    skillTab.type = 'button';
    skillTab.addEventListener('click', () => { state.tab = 'skills'; state.category = 'all'; render(); });
    tabs.appendChild(pluginTab); tabs.appendChild(skillTab);
    controls.appendChild(tabs);
    box.appendChild(controls);

    const chips = el('div', 'mCats');
    const catKeys = state.tab === 'skills' ? SKILL_CATS : PLUGIN_CATS;
    for (const key of catKeys) {
      const c = el('button', 'mCat' + (state.category === key ? ' on' : ''), t(CATS[key]));
      c.type = 'button';
      c.dataset.cat = key;
      c.addEventListener('click', () => { state.category = key; render(); });
      chips.appendChild(c);
    }
    box.appendChild(chips);

    // —— GitHub install rows (plugins and skills both accept a repo URL) ——
    if (state.tab === 'skills') {
      const gh = el('div', 'mGh');
      const hint = el('span', 'mGhLabel', t('market.skillGh'));
      const url = document.createElement('input');
      url.type = 'text';
      url.className = 'sInput';
      url.placeholder = 'https://github.com/owner/skill-repo';
      url.spellcheck = false;
      const go = el('button', 'sBtn primary', t('market.install'));
      go.type = 'button';
      go.addEventListener('click', async () => {
        const repo = url.value.trim();
        if (!/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repo)) { P.app.toast(t('market.skillRepoBad')); return; }
        go.disabled = true;
        try {
          const r = await P.skills.install(repo);
          if (r && r.ok) { P.app.toast(t('market.skillInstalled', { name: repo })); url.value = ''; await refresh(); render(); }
          else P.app.toast(t('market.failed', { msg: (r && (r.error || r.stderr)) || 'error' }));
        } catch (e) { P.app.toast(e.message); }
        go.disabled = false;
      });
      gh.appendChild(hint); gh.appendChild(url); gh.appendChild(go);
      box.appendChild(gh);
    } else {
      const gh = el('div', 'mGh');
      const hint = el('span', 'mGhLabel', t('market.pluginGh'));
      const url = document.createElement('input');
      url.type = 'text';
      url.className = 'sInput';
      url.placeholder = 'https://github.com/owner/plugin-repo';
      url.spellcheck = false;
      const go = el('button', 'sBtn primary', t('market.install'));
      go.type = 'button';
      go.addEventListener('click', async () => {
        const repo = url.value.trim();
        if (!/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repo)) { P.app.toast(t('market.skillRepoBad')); return; }
        go.disabled = true;
        try {
          const b = (typeof window !== 'undefined' && window.prts && window.prts.bridge) || null;
          const r = b && b.pluginClone ? await b.pluginClone(repo) : { ok: false, stderr: 'no bridge' };
          if (r && r.ok) { P.app.toast(t('market.installed', { pkg: repo })); url.value = ''; await refresh(); render(); }
          else P.app.toast(t('market.failed', { msg: (r && (r.stderr || r.stdout || r.error)) || 'error' }));
        } catch (e) { P.app.toast(e.message); }
        go.disabled = false;
      });
      gh.appendChild(hint); gh.appendChild(url); gh.appendChild(go);
      box.appendChild(gh);
    }

    // —— cards ——
    const grid = el('div', 'mGrid');
    const items = state.tab === 'plugins' ? visiblePlugins() : visibleSkills();
    if (!items.length) {
      grid.appendChild(el('div', 'hint', t('market.empty')));
    } else {
      for (const item of items) grid.appendChild(card(item, state.tab));
    }
    box.appendChild(grid);
  }

  async function open() {
    await refresh();
    render();
  }

  M.open = open;
  M.render = render;
  M.refresh = refresh;
})(typeof globalThis !== 'undefined' ? globalThis : this);
