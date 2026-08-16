/**
 * PRTS git panel — GitHub account seam for the PRTS frame.
 *
 *   - 连接 GitHub: first click opens github.com in an in-app window
 *     (Electron) or a new tab (browser); an already-logged-in session is
 *     reused, so returning shows "已连接" immediately;
 *   - token: best-effort capture from the token page; manual paste fallback;
 *   - 创建仓库 via the REST API;
 *   - 项目上传: pick a local directory, then git init/commit/push through the
 *     main-process shell bridge;
 *   - 贡献热力图: official contributions page parsed and drawn as an SVG
 *     diamond-point grid in the PRTS monochrome palette.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const GIT = P.git = {};

  const API = 'https://api.github.com';
  const SITE = 'https://github.com';
  const LOGIN_URL = SITE + '/login';
  const TOKEN_URL = SITE + '/settings/tokens/new?scopes=repo,workflow&description=PRTS+Agent';

  function bridge() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge) return window.prts.bridge;
    } catch (e) { /* no preload */ }
    return null;
  }
  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }
  function openExternal(url) {
    const b = bridge();
    if (b && typeof b.openExternal === 'function') { b.openExternal(url); return; }
    try { window.open(url, '_blank', 'noopener'); } catch (e) { /* noop */ }
  }

  async function api(token, method, path, body) {
    const res = await P.dshState.panelHttp(method, API + path, {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'PRTS',
      'X-GitHub-Api-Version': '2022-11-28',
    }, body ? JSON.stringify(body) : undefined);
    let data = null;
    try { data = JSON.parse(res.text); } catch (e) { data = null; }
    return { status: res.status, data };
  }

  async function userInfo(token) {
    const r = await api(token, 'GET', '/user');
    if (r.status !== 200) throw new Error('github: ' + r.status);
    return { login: r.data.login, name: r.data.name || '', avatar: r.data.avatar_url || '' };
  }

  async function listRepos(token) {
    const r = await api(token, 'GET', '/user/repos?per_page=50&sort=updated');
    if (r.status !== 200) return [];
    return (r.data || []).map((x) => ({ name: x.name, private: !!x.private, url: x.html_url }));
  }

  async function createRepo(token, opts) {
    const r = await api(token, 'POST', '/user/repos', {
      name: opts.name,
      description: opts.description || '',
      private: !!opts.isPrivate,
      auto_init: false,
    });
    if (r.status === 422 && r.data && r.data.errors) {
      throw new Error(t('git.repo.exists'));
    }
    if (r.status < 200 || r.status >= 300) {
      throw new Error((r.data && r.data.message) || ('github: ' + r.status));
    }
    return { url: r.data.html_url, cloneUrl: r.data.clone_url, sshUrl: r.data.ssh_url };
  }

  /* ---------- contribution heatmap ---------- */

  /** Fetch + parse the official contributions page → cells [{date, count, level}]. */
  async function heatmapCells(login) {
    const res = await P.dshState.panelHttp('GET', SITE + '/users/' + encodeURIComponent(login) + '/contributions', {});
    if (res.status !== 200) throw new Error('github: ' + res.status);
    const html = res.text;
    const cells = [];
    const tdRe = /<td[^>]*\bdata-date="([^"]+)"[^>]*\bdata-level="(\d)"[^>]*>([\s\S]*?)<\/td>/g;
    let m;
    while ((m = tdRe.exec(html)) !== null) {
      const inner = m[3];
      let count = 0;
      const c = /(\d+)\s+contributions?/.exec(inner);
      if (c) count = parseInt(c[1], 10);
      else if (/No\s+contributions/i.test(inner)) count = 0;
      cells.push({ date: m[1], level: parseInt(m[2], 10), count });
    }
    if (!cells.length) throw new Error('no contribution data');
    return cells;
  }

  /** Draw the heatmap as SVG in PRTS tokens. Returns the SVG markup. */
  function heatmapSvg(cells) {
    const ink = '#FAFAFA';
    const alpha = ['rgba(250,250,250,0.07)', 'rgba(250,250,250,0.22)', 'rgba(250,250,250,0.45)', 'rgba(250,250,250,0.72)', 'rgba(250,250,250,1)'];
    const cell = 10, gap = 3, weeks = Math.ceil(cells.length / 7);
    const w = weeks * (cell + gap) - gap;
    const h = 7 * (cell + gap) - gap;
    let body = '';
    cells.forEach((c, i) => {
      const col = Math.floor(i / 7), row = i % 7;
      const x = col * (cell + gap), y = row * (cell + gap);
      const fill = c.count > 0 ? alpha[Math.min(4, c.level)] : alpha[0];
      const diamond = c.count > 0
        ? '<path d="M' + (x + cell / 2) + ' ' + (y + 0.5) + ' L' + (x + cell - 0.5) + ' ' + (y + cell / 2) + ' L' + (x + cell / 2) + ' ' + (y + cell - 0.5) + ' L' + (x + 0.5) + ' ' + (y + cell / 2) + ' Z" fill="' + fill + '"/>'
        : '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + alpha[0] + '"/>';
      body += '<g><title>' + c.date + ' · ' + c.count + ' contributions</title>' + diamond + '</g>';
    });
    const total = cells.reduce((a, c) => a + c.count, 0);
    const meta = '<text x="0" y="' + (h + 12) + '" font-size="8" fill="' + ink + '" opacity="0.45" font-family="monospace" letter-spacing="1">' +
      total + ' CONTRIBUTIONS / ' + cells.length + 'D</text>';
    return '<svg viewBox="0 0 ' + Math.max(w, 120) + ' ' + (h + 14) + '" width="100%" height="auto" role="img" aria-label="contribution heatmap">' + body + meta + '</svg>';
  }

  /* ---------- actions ---------- */

  async function refresh(config) {
    const cfg = config.github || {};
    if (!cfg.token) return { status: 'none', user: null, repos: [], heatmap: null };
    try {
      const user = await userInfo(cfg.token);
      let repos = [];
      try { repos = await listRepos(cfg.token); } catch (e) { repos = []; }
      let heatmap = null;
      try { heatmap = heatmapSvg(await heatmapCells(user.login)); } catch (e) { heatmap = null; }
      return { status: 'ok', user, repos, heatmap };
    } catch (e) {
      return { status: 'bad', user: null, repos: [], heatmap: null, error: e.message };
    }
  }

  async function login(config) {
    const b = bridge();
    let token = '';
    if (b && typeof b.loginGithub === 'function') {
      try {
        const r = await b.loginGithub();
        if (r && r.ok && r.token) token = String(r.token);
      } catch (e) { /* fall through to manual */ }
    }
    if (!token) {
      openExternal(LOGIN_URL);
      const entered = await P.app.askPrompt(t('git.login.prompt'), 'ghp_…');
      if (!entered || !entered.trim()) return { ok: false, cancelled: true };
      token = entered.trim();
    }
    try {
      const user = await userInfo(token);
      config.github = config.github || {};
      config.github.token = token;
      config.github.login = user.login;
      config.github.loggedIn = true;
      await P.store.saveConfig(config);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function logout(config) {
    config.github = config.github || {};
    config.github.token = '';
    config.github.login = '';
    config.github.loggedIn = false;
    await P.store.saveConfig(config);
  }

  /** Create a repo (and optionally upload a folder right away). */
  async function newRepo(config, opts) {
    const cfg = config.github || {};
    if (!cfg.token) return { ok: false, error: t('git.needLogin') };
    const repo = await createRepo(cfg.token, opts);
    if (opts.dirPath) {
      const push = await uploadTo(cfg, repo, opts.dirPath);
      return { ok: true, repo, push };
    }
    return { ok: true, repo };
  }

  /** Upload a local directory: init/commit/push through the shell bridge. */
  async function uploadTo(config, repo, dirPath) {
    const b = bridge();
    if (!b || typeof b.shell !== 'function') {
      return { ok: false, error: t('git.uploadUnavailable') };
    }
    const cfg = config.github || {};
    const remote = 'https://' + encodeURIComponent(cfg.login) + ':' + encodeURIComponent(cfg.token) + '@github.com/' +
      encodeURIComponent(cfg.login) + '/' + encodeURIComponent(repo.name || repo) + '.git';
    const steps = [
      ['init', ['init', dirPath]],
      ['add', ['-C', dirPath, 'add', '-A']],
      ['commit', ['-C', dirPath, 'commit', '-m', 'Upload via PRTS']],
      ['remote', ['-C', dirPath, 'remote', 'add', 'origin', remote]],
      ['push', ['-C', dirPath, 'push', '-u', 'origin', 'HEAD', '--force']],
    ];
    const log = [];
    for (const [label, args] of steps) {
      try {
        const r = await b.shell('git', args);
        if (r && r.stdout) log.push('$ git ' + args.join(' ') + '\n' + r.stdout);
        if (r && r.stderr) log.push(r.stderr);
        if (r && r.ok === false) return { ok: false, error: label + ': ' + (r.stderr || 'failed'), log: log.join('\n') };
      } catch (e) {
        return { ok: false, error: label + ': ' + (e && e.message || e), log: log.join('\n') };
      }
    }
    return { ok: true, log: log.join('\n') };
  }

  async function uploadProject(config) {
    const cfg = config.github || {};
    if (!cfg.token) return { ok: false, error: t('git.needLogin') };
    const dirPath = await P.dshState.pickDirectory();
    if (!dirPath) return { ok: false, cancelled: true };
    let repos = [];
    try { repos = await listRepos(cfg.token); } catch (e) { /* repo list is advisory */ }
    const name = dirPath.split(/[\\/]/).filter(Boolean).pop() || 'project';
    const nameValue = await P.app.askPrompt(t('git.upload.repoName'), name);
    if (!nameValue || !nameValue.trim()) return { ok: false, cancelled: true };
    const finalName = nameValue.trim();
    const existing = repos.find((r) => r.name === finalName);
    let repo;
    if (existing) {
      repo = { name: finalName, cloneUrl: existing.url, sshUrl: '' };
    } else {
      const isPrivate = await P.app.askConfirm(t('git.upload.private'));
      repo = await createRepo(cfg.token, { name: finalName, description: '', isPrivate: !!isPrivate });
    }
    const push = await uploadTo(cfg, repo, dirPath);
    return { ok: push.ok, repo, push };
  }

  GIT.refresh = refresh;
  GIT.login = login;
  GIT.logout = logout;
  GIT.newRepo = newRepo;
  GIT.uploadProject = uploadProject;
  GIT.heatmapCells = heatmapCells;
  GIT.heatmapSvg = heatmapSvg;
  GIT.openSite = () => openExternal(SITE);
  GIT.openTokenPage = () => openExternal(TOKEN_URL);

  /* ---------- panel UI (sidebar overlay + settings section) ---------- */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  let busy = false;

  async function render(container, config) {
    container.textContent = '';
    const cfg = config.github || {};

    const status = el('div', 'sSection');
    const head = el('div', 'sSecRow');
    head.appendChild(el('span', 'sSecTitle eyebrow', t('git.title')));
    const loginBtn = el('button', 'sBtn ' + (cfg.loggedIn ? '' : 'primary'), cfg.loggedIn ? t('git.relogin') : t('git.connect'));
    loginBtn.type = 'button';
    loginBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      loginBtn.disabled = true;
      const r = await GIT.login(config);
      busy = false;
      loginBtn.disabled = false;
      if (r.ok) { P.app.toast(t('git.connected')); render(container, config); }
      else if (!r.cancelled) P.app.toast(t('git.loginFail', { msg: r.error || 'error' }));
      else render(container, config);
    });
    head.appendChild(loginBtn);
    status.appendChild(head);
    container.appendChild(status);

    if (!cfg.loggedIn) {
      const hint = el('div', 'hint', t('git.login.hint'));
      container.appendChild(hint);
      const openBtn = el('button', 'sBtn', t('git.openSite'));
      openBtn.type = 'button';
      openBtn.addEventListener('click', () => GIT.openSite());
      container.appendChild(openBtn);
      return;
    }

    // —— live state ——
    const state = await GIT.refresh(config);
    const who = el('div', 'ghUser');
    who.innerHTML = (P.icons.user || '') +
      '<span class="ghLogin">' + (state.user ? state.user.login : (cfg.login || '…')) + '</span>' +
      '<span class="pState" data-state="' + (state.status === 'ok' ? 'ok' : 'none') + '">' + t(state.status === 'ok' ? 'git.loggedIn' : 'git.tokenBad') + '</span>';
    container.appendChild(who);
    const out = el('button', 'sBtn', t('git.disconnect'));
    out.type = 'button';
    out.addEventListener('click', async () => { await GIT.logout(config); render(container, config); });
    container.appendChild(out);
    const tokenBtn = el('button', 'sBtn', t('git.openToken'));
    tokenBtn.type = 'button';
    tokenBtn.addEventListener('click', () => GIT.openTokenPage());
    container.appendChild(tokenBtn);

    // —— contribution heatmap (PRTS palette) ——
    const hmSec = el('div', 'sSection');
    hmSec.appendChild(el('div', 'sSecTitle eyebrow', t('git.heatmap')));
    if (state.heatmap) {
      const box = el('div', 'ghHeat');
      box.innerHTML = state.heatmap;
      hmSec.appendChild(box);
    } else {
      hmSec.appendChild(el('div', 'hint', t('git.heatmap.empty')));
    }
    container.appendChild(hmSec);

    // —— create repo ——
    const rSec = el('div', 'sSection');
    rSec.appendChild(el('div', 'sSecTitle eyebrow', t('git.newRepo')));
    const form = el('div', 'inlineForm');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sInput';
    nameInput.placeholder = t('git.repo.name');
    nameInput.spellcheck = false;
    const priv = el('label', 'mCheck');
    const privBox = document.createElement('input');
    privBox.type = 'checkbox';
    const privLabel = el('span', '', t('git.repo.private'));
    priv.appendChild(privBox); priv.appendChild(privLabel);
    const createBtn = el('button', 'sBtn primary', t('git.repo.create'));
    createBtn.type = 'button';
    createBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z0-9._-]+$/.test(name)) { P.app.toast(t('git.repo.nameBad')); return; }
      createBtn.disabled = true;
      try {
        const r = await GIT.newRepo(config, { name, description: '', isPrivate: privBox.checked });
        if (r.ok) {
          P.app.toast(t('git.repo.created', { name }));
          nameInput.value = '';
          render(container, config);
        } else P.app.toast(r.error || t('market.failed', { msg: '' }));
      } catch (e) { P.app.toast(e.message); }
      createBtn.disabled = false;
    });
    form.appendChild(nameInput); form.appendChild(priv); form.appendChild(createBtn);
    rSec.appendChild(form);
    container.appendChild(rSec);

    // —— upload project ——
    const uSec = el('div', 'sSection');
    uSec.appendChild(el('div', 'sSecTitle eyebrow', t('git.upload')));
    uSec.appendChild(el('div', 'hint', t('git.upload.hint')));
    const upBtn = el('button', 'sBtn', P.icons.upload ? '' : '', '');
    upBtn.type = 'button';
    if (P.icons.upload) { upBtn.innerHTML = P.icons.upload + ' ' + t('git.upload.go'); }
    else upBtn.textContent = t('git.upload.go');
    upBtn.addEventListener('click', async () => {
      upBtn.disabled = true;
      P.app.toast(t('git.upload.working'));
      try {
        const r = await GIT.uploadProject(config);
        if (r.ok) { P.app.toast(t('git.upload.done')); render(container, config); }
        else if (!r.cancelled) P.app.toast(r.error || t('git.upload.fail'));
      } catch (e) { P.app.toast(e.message); }
      upBtn.disabled = false;
    });
    uSec.appendChild(upBtn);
    container.appendChild(uSec);

    // —— repos ——
    const listSec = el('div', 'sSection');
    listSec.appendChild(el('div', 'sSecTitle eyebrow', t('git.repos')));
    if (!state.repos.length) listSec.appendChild(el('div', 'hint', t('git.repos.empty')));
    for (const r of state.repos) {
      const row = el('div', 'projectRow');
      row.appendChild(el('span', 'pname', r.name));
      row.appendChild(el('span', 'pmeta', r.private ? 'PRIVATE' : 'PUBLIC'));
      const a = el('a', 'mLink', '↗');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
      listSec.appendChild(row);
    }
    container.appendChild(listSec);
  }

  GIT.render = render;
})(typeof globalThis !== 'undefined' ? globalThis : this);
