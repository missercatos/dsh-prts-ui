/**
 * PRTS SKILL 市场 — the self-hosted skill catalog (独立于 dsh 插件市场).
 *
 * The dsh plugin market now lives in dsh-web itself (installed via the
 * installer / the WEB panel), so this panel is skills only: curated GitHub
 * skills (design / ui / fx / text / persona / tool categories), search, and a
 * manual GitHub repo installer. Installed skills land in ~/.dsh/skills.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const M = P.market = {};

  let state = { query: '', category: 'all', skills: [], installedSkills: null };

  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function catalog() {
    let scanned = { skills: [] };
    try {
      if (window.PRTS_MARKET) scanned = { skills: window.PRTS_MARKET.skills || [] };
    } catch (e) { scanned = { skills: [] }; }
    const sMap = new Map();
    for (const s of (scanned.skills || [])) {
      if (!s.name || sMap.has(s.name)) continue;
      sMap.set(s.name, Object.assign({}, s, { category: s.category || 'tool' }));
    }
    return { skills: [...sMap.values()] };
  }

  async function refresh() {
    const cat = catalog();
    state.skills = cat.skills;
    let skillNames = [];
    try { skillNames = (await P.skills.list()).map((s) => s.name); } catch (e) { skillNames = []; }
    state.installedSkills = new Set(skillNames);
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

  function card(item) {
    const isInstalled = state.installedSkills && state.installedSkills.has(item.name);
    const card = el('div', 'pCard');
    const head = el('div', 'pCardHead');
    head.style.cursor = 'default';
    const name = el('span', 'pName', item.displayName || item.name);
    const catBadge = el('span', 'pState', t('market.cat.' + (item.category || 'tool')));
    const badge = el('span', 'pState', 'SKILL');
    badge.dataset.state = 'ok';
    head.appendChild(name); head.appendChild(catBadge); head.appendChild(badge);
    const body = el('div', 'pCardBody');
    body.style.display = '';
    body.appendChild(el('div', 'pModels', item.description || ''));
    if (item.repo && item.repo !== 'local') {
      const link = el('a', 'mLink', item.repo.replace(/^https?:\/\/(www\.)?github\.com\//, 'github.com/'));
      link.href = item.repo;
      link.target = '_blank';
      link.rel = 'noopener';
      body.appendChild(link);
    }
    const action = el('button', 'sBtn' + (isInstalled ? '' : ' primary'));
    action.type = 'button';
    action.textContent = isInstalled ? t('market.installed') : t('market.install');
    action.disabled = isInstalled || (!item.repo || item.repo === 'local' || item.builtin);
    if (!action.disabled) action.addEventListener('click', () => installSkill(item, action));
    body.appendChild(action);
    card.appendChild(head); card.appendChild(body);
    return card;
  }

  const CATS = {
    all: 'market.cat.all', design: 'market.cat.design', ui: 'market.cat.ui',
    fx: 'market.cat.fx', text: 'market.cat.text', tool: 'market.cat.tool',
    persona: 'market.cat.persona', other: 'market.cat.other',
  };
  const SKILL_CATS = ['all', 'design', 'ui', 'fx', 'text', 'tool', 'persona', 'other'];

  function render() {
    const box = document.getElementById('marketList');
    if (!box) return;
    box.textContent = '';
    const search = el('div', 'mSearch');
    search.innerHTML = P.icons.search || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('market.searchPlaceholder');
    input.value = state.query;
    input.spellcheck = false;
    input.addEventListener('input', () => { state.query = input.value; render(); });
    search.appendChild(input);
    box.appendChild(search);
    const chips = el('div', 'mCats');
    for (const key of SKILL_CATS) {
      const c = el('button', 'mCat' + (state.category === key ? ' on' : ''), t(CATS[key]));
      c.type = 'button';
      c.dataset.cat = key;
      c.addEventListener('click', () => { state.category = key; render(); });
      chips.appendChild(c);
    }
    box.appendChild(chips);
    const gh = el('div', 'mGh');
    gh.appendChild(el('span', 'mGhLabel', t('market.skillGh')));
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
    gh.appendChild(url); gh.appendChild(go);
    box.appendChild(gh);
    const grid = el('div', 'mGrid');
    const q = state.query.trim().toLowerCase();
    const items = state.skills.filter((s) => {
      if (state.category !== 'all' && s.category !== state.category) return false;
      return !q || String((s.displayName || s.name || '') + ' ' + (s.description || '')).toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) grid.appendChild(el('div', 'hint', t('market.empty')));
    else for (const item of items) grid.appendChild(card(item));
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
