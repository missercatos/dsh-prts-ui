/**
 * PRTS UI preferences — only the window's own chrome (theme, locale). Agent
 * state (sessions, history, models, credentials) belongs to dsh and is never
 * stored here. The file lives with the prts profile under ~/.dsh.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const DEFAULTS = {
    locale: 'auto',
    ui: { theme: 'dark' },
    // 博士称呼: empty = 默认「博士」; set = 「博士.<name>」/「Dr.<name>」
    persona: { userName: '' },
    // DeepSeek 官方平台账户: 首次登录后 loggedIn=true, apiKey 同时写入 dsh 凭证
    deepseek: { loggedIn: false, apiKey: '' },
    // GitHub 账户: token 只存本机 PRTS 配置
    github: { loggedIn: false, token: '', login: '' },
    // skill 组: groups = [{ id, name, skills: [skillName], persona? }]; 人格 skill 全局单选
    skills: { activeGroup: '', persona: 'prts-persona', groups: [] },
  };

  function uiConfigPath() { return P.platform.prtsUiConfigPath(); }
  function legacyPath() { return P.platform.configDir() + '/config.json'; }

  function deepMerge(base, extra) {
    const out = { ...base };
    for (const k of Object.keys(extra || {})) {
      const v = extra[k];
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && base[k] !== null && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  const store = {
    async loadConfig() {
      let cfg = JSON.parse(JSON.stringify(DEFAULTS));
      const path = uiConfigPath();
      try {
        const raw = await P.io.readFile(path);
        const parsed = JSON.parse(raw);
        cfg = deepMerge(cfg, parsed);
      } catch (e) {
        // First run in the new location: migrate theme/locale from the legacy
        // config (pre ~/.dsh move) if present.
        try {
          const raw = await P.io.readFile(legacyPath());
          const parsed = JSON.parse(raw);
          if (parsed.locale) cfg.locale = parsed.locale;
          if (parsed.ui && parsed.ui.theme) cfg.ui.theme = parsed.ui.theme;
        } catch (e2) { /* nothing to migrate */ }
      }
      return cfg;
    },
    async saveConfig(cfg) {
      await P.io.mkdir(P.platform.prtsProfileDir());
      await P.io.writeFile(uiConfigPath(), JSON.stringify(cfg, null, 2));
    },
  };

  P.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
