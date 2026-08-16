/**
 * PRTS balance panel — the DeepSeek official platform account seam.
 *
 * Flow (mirrors the user's spec):
 *   - first use: 登录 → opens the official platform (in-app window in
 *     Electron, new tab in the browser); the platform's own login session is
 *     reused — if already logged in there, no password is needed and PRTS
 *     comes straight back as "已登录";
 *   - the platform's API key is imported into the dsh credential store
 *     (ref DEEPSEEK_OFFICIAL_API_KEY) so the agent itself runs on it;
 *   - balance is fetched from the official endpoint and displayed in CNY;
 *   - 充值 opens the official top-up page.
 *
 * All network calls ride P.dshState.panelHttp (Electron main-process bridge
 * or the host plugin's /prts/api/http proxy), so there is no CORS wall.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const D = P.balance = {};

  const BALANCE_URL = 'https://api.deepseek.com/user/balance';
  const PLATFORM_URL = 'https://platform.deepseek.com';
  const API_KEYS_URL = 'https://platform.deepseek.com/api_keys';
  const TOPUP_URL = 'https://platform.deepseek.com/top_up';
  const CREDENTIAL_REF = 'DEEPSEEK_OFFICIAL_API_KEY';

  function bridge() {
    try {
      if (typeof window !== 'undefined' && window.prts && window.prts.bridge) return window.prts.bridge;
    } catch (e) { /* no preload */ }
    return null;
  }
  function app() { return P.app; }

  function openExternal(url) {
    const b = bridge();
    if (b && typeof b.openExternal === 'function') { b.openExternal(url); return true; }
    try { window.open(url, '_blank', 'noopener'); return true; } catch (e) { return false; }
  }

  /** Official balance endpoint. Resolves the parsed body; throws on failure. */
  async function rawBalance(key) {
    const res = await P.dshState.panelHttp('GET', BALANCE_URL, { Authorization: 'Bearer ' + key });
    if (res.status === 401) {
      const err = new Error('401');
      err.code = 'unauthorized';
      throw err;
    }
    if (res.status !== 200) {
      const err = new Error('HTTP ' + res.status);
      err.code = 'http';
      throw err;
    }
    let body;
    try { body = JSON.parse(res.text); } catch (e) { throw new Error('bad response'); }
    return body;
  }

  /** Normalize balance info → { currency, total, granted, toppedUp, available }. */
  function pickBalance(body) {
    const infos = (body && body.balance_infos) || [];
    const cny = infos.find((i) => i.currency === 'CNY') || infos[0] || {};
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      currency: cny.currency || 'CNY',
      total: num(cny.total_balance),
      granted: num(cny.granted_balance),
      toppedUp: num(cny.topped_up_balance),
      available: !!(body && body.is_available),
    };
  }

  /** Current state for the UI: { status: 'none'|'ok'|'bad', loggedIn, balance, message }. */
  async function refresh(config) {
    const cfg = config.deepseek || {};
    if (!cfg.apiKey) return { status: 'none', loggedIn: !!cfg.loggedIn, balance: null, message: 'no-key' };
    try {
      const body = await rawBalance(cfg.apiKey);
      return { status: 'ok', loggedIn: true, balance: pickBalance(body), message: null };
    } catch (e) {
      if (e.code === 'unauthorized') {
        return { status: 'bad', loggedIn: false, balance: null, message: 'unauthorized' };
      }
      return { status: 'bad', loggedIn: !!cfg.loggedIn, balance: null, message: e.message };
    }
  }

  /** Persist the key: PRTS config + the dsh credential store (what the agent uses). */
  async function persistKey(config, key) {
    config.deepseek = config.deepseek || {};
    config.deepseek.apiKey = key;
    config.deepseek.loggedIn = true;
    await P.store.saveConfig(config);
    try { await P.dshState.credentialsSet(CREDENTIAL_REF, key); } catch (e) { /* credential store may reject; config still holds it */ }
    try { if (app() && app().loadCredentialState) await app().loadCredentialState(); } catch (e) { /* noop */ }
  }

  /**
   * The login flow. Electron: the main process opens an in-app window on the
   * real platform — existing login sessions are reused automatically and the
   * platform's API key is scraped once (best effort). Browser: open the site
   * in a new tab, then ask the Doctor for the key. In every mode the key is
   * verified against the official balance endpoint before it is kept.
   */
  async function login(config) {
    const b = bridge();
    let key = '';
    let reason = '';
    if (b && typeof b.loginDeepseek === 'function') {
      try {
        const r = await b.loginDeepseek();
        if (r && r.ok && r.apiKey) key = String(r.apiKey);
        reason = (r && r.reason) || '';
      } catch (e) { reason = String(e && e.message || e); }
    }
    if (!key) {
      // Web mode (or failed scrape): open the official site, then ask.
      openExternal(PLATFORM_URL);
      const t = P.app ? P.app.t : (k) => k;
      const entered = await P.app.askPrompt(
        t('balance.login.prompt'),
        'sk-…'
      );
      if (!entered || !entered.trim()) return { ok: false, cancelled: true };
      key = entered.trim();
    }
    try {
      await rawBalance(key);
      await persistKey(config, key);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || String(e), reason };
    }
  }

  /** Forget the login + key (both stores). */
  async function logout(config) {
    config.deepseek = config.deepseek || {};
    config.deepseek.loggedIn = false;
    config.deepseek.apiKey = '';
    await P.store.saveConfig(config);
    try { await P.dshState.credentialsUnset(CREDENTIAL_REF); } catch (e) { /* noop */ }
    try { if (app() && app().loadCredentialState) await app().loadCredentialState(); } catch (e) { /* noop */ }
  }

  function openPlatform() { return openExternal(PLATFORM_URL); }
  function openApiKeys() { return openExternal(API_KEYS_URL); }
  function recharge() { return openExternal(TOPUP_URL); }

  D.refresh = refresh;
  D.login = login;
  D.logout = logout;
  D.openPlatform = openPlatform;
  D.openApiKeys = openApiKeys;
  D.recharge = recharge;
  D.CREDENTIAL_REF = CREDENTIAL_REF;
  D.BALANCE_URL = BALANCE_URL;
  D.TOPUP_URL = TOPUP_URL;

  /* ---------- settings-section UI ---------- */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function t(key, params) { return P.app && P.app.t ? P.app.t(key, params) : key; }

  function fmtCny(n) {
    return '¥ ' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function render(container, config) {
    container.textContent = '';
    const cfg = config.deepseek || {};
    const sec = el('div', 'sSection');
    sec.appendChild(el('div', 'sSecTitle eyebrow', t('balance.title')));

    const state = cfg.apiKey ? await D.refresh(config) : { status: 'none', balance: null };

    const statusRow = el('div', 'sSecRow');
    const badge = el('span', 'pState', cfg.loggedIn ? t('balance.loggedIn') : t('balance.loggedOut'));
    badge.dataset.state = cfg.loggedIn ? 'ok' : 'none';
    statusRow.appendChild(badge);
    const loginBtn = el('button', 'sBtn ' + (cfg.loggedIn ? '' : 'primary'), cfg.loggedIn ? t('balance.relogin') : t('balance.login'));
    loginBtn.type = 'button';
    loginBtn.addEventListener('click', async () => {
      loginBtn.disabled = true;
      const r = await D.login(config);
      loginBtn.disabled = false;
      if (r.ok) { P.app.toast(t('balance.loggedInToast')); render(container, config); }
      else if (!r.cancelled) P.app.toast(t('balance.loginFail', { msg: r.error || 'error' }));
      else render(container, config);
    });
    statusRow.appendChild(loginBtn);
    sec.appendChild(statusRow);
    sec.appendChild(el('div', 'hint', t('balance.login.hint')));

    // balance readout (CNY)
    if (state.status === 'ok' && state.balance) {
      const card = el('div', 'balCard');
      const big = el('div', 'balBig', fmtCny(state.balance.total));
      big.title = t('balance.total');
      card.appendChild(big);
      const sub = el('div', 'balSub');
      const row = el('div', 'projectRow');
      row.appendChild(el('span', 'pname', t('balance.toppedUp')));
      row.appendChild(el('span', 'pmeta', fmtCny(state.balance.toppedUp)));
      sub.appendChild(row);
      const row2 = el('div', 'projectRow');
      row2.appendChild(el('span', 'pname', t('balance.granted')));
      row2.appendChild(el('span', 'pmeta', fmtCny(state.balance.granted)));
      sub.appendChild(row2);
      card.appendChild(sub);
      sec.appendChild(card);
    } else if (state.status === 'none') {
      sec.appendChild(el('div', 'hint', t('balance.none')));
    } else {
      sec.appendChild(el('div', 'hint', t(state.message === 'unauthorized' ? 'balance.badKey' : 'balance.fetchFail', { msg: state.message || '' })));
    }

    // actions
    const actions = el('div', 'sRow');
    actions.style.marginTop = '10px';
    const syncBtn = el('button', 'sBtn', t('balance.refresh'));
    syncBtn.type = 'button';
    syncBtn.disabled = !cfg.apiKey;
    syncBtn.addEventListener('click', async () => { await render(container, config); });
    actions.appendChild(syncBtn);
    const rechargeBtn = el('button', 'sBtn primary', t('balance.recharge'));
    rechargeBtn.type = 'button';
    rechargeBtn.addEventListener('click', () => D.recharge());
    actions.appendChild(rechargeBtn);
    const keysBtn = el('button', 'sBtn', t('balance.openKeys'));
    keysBtn.type = 'button';
    keysBtn.addEventListener('click', () => D.openApiKeys());
    actions.appendChild(keysBtn);
    sec.appendChild(actions);

    if (cfg.apiKey) {
      const keyRow = el('div', 'sSection');
      keyRow.appendChild(el('div', 'sSecTitle eyebrow', t('balance.key')));
      const row = el('div', 'projectRow');
      const masked = 'sk-' + String(cfg.apiKey).slice(3, 7) + '••••••' + String(cfg.apiKey).slice(-4);
      row.appendChild(el('span', 'pname', masked));
      row.appendChild(el('span', 'pmeta', D.CREDENTIAL_REF));
      keyRow.appendChild(row);
      const forget = el('button', 'sBtn', t('balance.forget'));
      forget.type = 'button';
      forget.addEventListener('click', async () => { await D.logout(config); render(container, config); });
      keyRow.appendChild(forget);
      sec.appendChild(keyRow);
    }

    container.appendChild(sec);
  }

  D.render = render;
})(typeof globalThis !== 'undefined' ? globalThis : this);
