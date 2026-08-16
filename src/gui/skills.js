/**
 * PRTS skill module — the Doctor's skill dock.
 *
 * Skills live in the dsh user root (`~/.dsh/skills`, one directory per skill
 * with a SKILL.md); the dsh agent discovers them there, so what PRTS manages
 * here is exactly what the model can load. This module handles:
 *   - discovery (Electron bridge list, host /prts/api/skills in the browser);
 *   - skill groups — multi-select sets persisted in the PRTS config;
 *   - the persona slot — exactly ONE persona-type skill may be active;
 *   - installing skills from GitHub (clone into the skills root);
 *   - raw SKILL.md editing (settings → skill config files).
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const SK = P.skills = {};

  function bridge() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge) return window.prts.bridge;
    } catch (e) { /* no preload */ }
    return null;
  }
  function origin() {
    try { return (typeof window !== 'undefined' && window.location && window.location.origin) || ''; } catch (e) { return ''; }
  }

  /** Is this skill the persona kind (AI 人格记忆)? Persona skills are
   *  single-select: only one may be active at a time. */
  function isPersona(name, meta) {
    if (meta && (meta.category === 'persona' || meta.persona === true)) return true;
    return /(^|[-_.])persona($|[-_.])/.test(String(name || '')) || String(name || '') === 'prts-persona';
  }

  /** List skills: [{ name, description, path, persona, hasFile }]. */
  async function list() {
    const b = bridge();
    if (b && typeof b.listSkills === 'function') {
      try { return await b.listSkills(); } catch (e) { /* fall through */ }
    }
    try {
      const res = await fetch(origin() + '/prts/api/skills');
      if (res.ok) return await res.json();
    } catch (e) { /* no host route */ }
    return [];
  }

  /** Raw SKILL.md text of one skill. */
  async function read(name) {
    const b = bridge();
    if (b && typeof b.readSkill === 'function') {
      try { return await b.readSkill(name); } catch (e) { /* fall through */ }
    }
    const res = await fetch(origin() + '/prts/api/skills?name=' + encodeURIComponent(name));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.content;
  }

  /** Overwrite one SKILL.md. */
  async function write(name, content) {
    const b = bridge();
    if (b && typeof b.writeSkill === 'function') {
      try { await b.writeSkill(name, content); return; } catch (e) { /* fall through */ }
    }
    const res = await fetch(origin() + '/prts/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  }

  /** Clone a GitHub skill repo into the dsh skills root. */
  async function install(repo) {
    const b = bridge();
    if (b && typeof b.skillInstall === 'function') {
      return await b.skillInstall(repo);
    }
    const res = await fetch(origin() + '/prts/api/skill-install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo }),
    });
    return await res.json();
  }

  /** Remove one skill directory. */
  async function remove(name) {
    const b = bridge();
    if (b && typeof b.deleteSkill === 'function') {
      try { await b.deleteSkill(name); return { ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }
    const res = await fetch(origin() + '/prts/api/skill-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return await res.json();
  }

  /* ---------- groups (persisted in PRTS config) ---------- */

  function groupsOf(config) {
    config.skills = config.skills || {};
    if (!Array.isArray(config.skills.groups)) config.skills.groups = [];
    return config.skills.groups;
  }

  async function saveConfig(config) { await P.store.saveConfig(config); }

  async function createGroup(config, name) {
    const groups = groupsOf(config);
    const id = 'g' + Date.now().toString(36);
    groups.push({ id, name: name || ('GROUP ' + (groups.length + 1)), skills: [] });
    if (!config.skills.activeGroup) config.skills.activeGroup = id;
    await saveConfig(config);
    return groups[groups.length - 1];
  }

  async function setGroupSkills(config, groupId, skillNames) {
    const g = groupsOf(config).find((x) => x.id === groupId);
    if (!g) return;
    g.skills = skillNames.slice();
    await saveConfig(config);
  }

  async function removeGroup(config, groupId) {
    const groups = groupsOf(config);
    const i = groups.findIndex((x) => x.id === groupId);
    if (i >= 0) groups.splice(i, 1);
    if (config.skills.activeGroup === groupId) config.skills.activeGroup = groups.length ? groups[0].id : '';
    await saveConfig(config);
  }

  async function setActiveGroup(config, groupId) {
    config.skills.activeGroup = groupId;
    await saveConfig(config);
  }

  /** The persona slot: exactly one persona skill. Persists the choice and
   *  returns the chosen name ('' clears it). */
  async function setPersona(config, name) {
    config.skills = config.skills || {};
    config.skills.persona = name || '';
    await saveConfig(config);
  }

  SK.list = list;
  SK.read = read;
  SK.write = write;
  SK.install = install;
  SK.remove = remove;
  SK.isPersona = isPersona;
  SK.groupsOf = groupsOf;
  SK.createGroup = createGroup;
  SK.setGroupSkills = setGroupSkills;
  SK.removeGroup = removeGroup;
  SK.setActiveGroup = setActiveGroup;
  SK.setPersona = setPersona;

  /* ---------- dock UI (sidebar overlay + settings section share this) ---------- */

  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  let editing = null; // skill name currently opened in the editor

  async function renderEditor(container, config, name) {
    container.textContent = '';
    editing = name;
    const back = el('button', 'sBtn', '← ' + t('skills.back'));
    back.type = 'button';
    back.addEventListener('click', () => render(container, config));
    container.appendChild(back);
    const head = el('div', 'sSecRow');
    head.appendChild(el('span', 'sSecTitle eyebrow', name));
    const save = el('button', 'sBtn primary', t('common.save'));
    save.type = 'button';
    head.appendChild(save);
    container.appendChild(head);
    const ta = document.createElement('textarea');
    ta.className = 'sTextarea';
    ta.spellcheck = false;
    ta.rows = 18;
    container.appendChild(ta);
    let content = '';
    try { content = await SK.read(name); } catch (e) { content = '# ' + name + '\n\n' + e.message; }
    ta.value = content;
    save.addEventListener('click', async () => {
      try {
        await SK.write(name, ta.value);
        P.app.toast(t('skills.saved', { name }));
      } catch (e) { P.app.toast(e.message); }
    });
  }

  async function render(container, config) {
    container.textContent = '';
    config.skills = config.skills || {};
    let skills = [];
    try { skills = await SK.list(); } catch (e) { skills = []; }
    const personaSkills = skills.filter((s) => s.persona);
    const normalSkills = skills.filter((s) => !s.persona);

    // —— persona slot (single select) ——
    const pSec = el('div', 'sSection');
    pSec.appendChild(el('div', 'sSecTitle eyebrow', t('skills.persona')));
    pSec.appendChild(el('div', 'hint', t('skills.persona.hint')));
    const pRow = el('div', 'skPersona');
    const noneBtn = el('button', 'skChip' + (!config.skills.persona ? ' on' : ''), t('skills.persona.none'));
    noneBtn.type = 'button';
    noneBtn.addEventListener('click', async () => { await SK.setPersona(config, ''); render(container, config); });
    pRow.appendChild(noneBtn);
    for (const s of personaSkills) {
      const b = el('button', 'skChip' + (config.skills.persona === s.name ? ' on' : ''), s.name);
      b.type = 'button';
      b.title = s.description || '';
      b.addEventListener('click', async () => { await SK.setPersona(config, s.name); render(container, config); });
      pRow.appendChild(b);
    }
    pSec.appendChild(pRow);
    container.appendChild(pSec);

    // —— groups ——
    const gSec = el('div', 'sSection');
    const gHead = el('div', 'sSecRow');
    gHead.appendChild(el('span', 'sSecTitle eyebrow', t('skills.groups')));
    const addBtn = el('button', 'sBtn', '+ ' + t('skills.group.new'));
    addBtn.type = 'button';
    addBtn.addEventListener('click', async () => {
      const name = await P.app.askPrompt(t('skills.group.name'), 'GROUP ' + (SK.groupsOf(config).length + 1));
      if (!name || !name.trim()) return;
      await SK.createGroup(config, name.trim());
      render(container, config);
    });
    gHead.appendChild(addBtn);
    gSec.appendChild(gHead);
    const groups = SK.groupsOf(config);
    if (!groups.length) {
      gSec.appendChild(el('div', 'hint', t('skills.groups.empty')));
    }
    for (const g of groups) {
      const row = el('div', 'skGroup' + (config.skills.activeGroup === g.id ? ' active' : ''));
      const nameBtn = el('button', 'skGroupName', g.name);
      nameBtn.type = 'button';
      nameBtn.addEventListener('click', async () => { await SK.setActiveGroup(config, g.id); render(container, config); });
      row.appendChild(nameBtn);
      const count = el('span', 'skGroupCount', String(g.skills.length));
      row.appendChild(count);
      const del = el('button', 'rowBtn', P.icons['trash2'] || '×');
      del.type = 'button';
      del.addEventListener('click', async () => { await SK.removeGroup(config, g.id); render(container, config); });
      row.appendChild(del);
      gSec.appendChild(row);
      // multi-select chips for the active group
      if (config.skills.activeGroup === g.id) {
        const chips = el('div', 'skChips');
        const all = normalSkills;
        if (!all.length) chips.appendChild(el('span', 'hint', t('skills.none')));
        for (const s of all) {
          const on = g.skills.indexOf(s.name) >= 0;
          const c = el('button', 'skChip' + (on ? ' on' : ''), s.name);
          c.type = 'button';
          c.title = s.description || '';
          c.addEventListener('click', async () => {
            const set = new Set(g.skills);
            if (set.has(s.name)) set.delete(s.name); else set.add(s.name);
            await SK.setGroupSkills(config, g.id, [...set]);
            render(container, config);
          });
          chips.appendChild(c);
        }
        gSec.appendChild(chips);
      }
    }
    container.appendChild(gSec);

    // —— installed skills ——
    const lSec = el('div', 'sSection');
    lSec.appendChild(el('div', 'sSecTitle eyebrow', t('skills.installed')));
    if (!skills.length) lSec.appendChild(el('div', 'hint', t('skills.none')));
    for (const s of skills) {
      const row = el('div', 'skItem');
      const meta = el('div', 'skItemMeta');
      meta.appendChild(el('span', 'skItemName', s.name));
      if (s.persona) {
        const tag = el('span', 'pState', t('skills.personaTag'));
        tag.dataset.state = 'ok';
        meta.appendChild(tag);
      }
      meta.appendChild(el('div', 'pModels', s.description || ''));
      row.appendChild(meta);
      const edit = el('button', 'sBtn', t('skills.edit'));
      edit.type = 'button';
      edit.addEventListener('click', () => renderEditor(container, config, s.name));
      row.appendChild(edit);
      const rm = el('button', 'rowBtn', P.icons['trash2'] || '×');
      rm.type = 'button';
      rm.addEventListener('click', async () => {
        const ok = await P.app.askConfirm(t('skills.confirmRemove', { name: s.name }));
        if (!ok) return;
        const r = await SK.remove(s.name);
        if (r && r.ok) { P.app.toast(t('skills.removed', { name: s.name })); render(container, config); }
        else P.app.toast(t('skills.removeFail', { msg: (r && r.error) || 'error' }));
      });
      row.appendChild(rm);
      lSec.appendChild(row);
    }
    // GitHub install row
    const gh = el('div', 'mGh');
    gh.appendChild(el('span', 'mGhLabel', t('skills.ghInstall')));
    const url = document.createElement('input');
    url.type = 'text';
    url.className = 'sInput';
    url.placeholder = 'https://github.com/owner/skill-repo';
    url.spellcheck = false;
    const go = el('button', 'sBtn primary', t('market.install'));
    go.type = 'button';
    go.addEventListener('click', async () => {
      const repo = url.value.trim();
      if (!/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repo)) { P.app.toast(t('skills.repoBad')); return; }
      go.disabled = true;
      try {
        const r = await SK.install(repo);
        if (r && r.ok) { P.app.toast(t('market.skillInstalled', { name: repo })); url.value = ''; render(container, config); }
        else P.app.toast(t('market.failed', { msg: (r && (r.error || r.stderr)) || 'error' }));
      } catch (e) { P.app.toast(e.message); }
      go.disabled = false;
    });
    gh.appendChild(url); gh.appendChild(go);
    lSec.appendChild(gh);
    container.appendChild(lSec);
  }

  SK.render = render;
  SK.renderEditor = renderEditor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
