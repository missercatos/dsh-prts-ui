/**
 * PRTS UI preferences — only the window's own chrome (theme, locale). Agent
 * state (sessions, history, models, credentials) belongs to dsh and is never
 * stored here.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const DEFAULTS = { locale: 'auto', ui: { theme: 'dark' } };

  function configPath() { return P.platform.configDir() + '/config.json'; }

  const store = {
    async loadConfig() {
      let cfg = JSON.parse(JSON.stringify(DEFAULTS));
      try {
        const raw = await P.io.readFile(configPath());
        const parsed = JSON.parse(raw);
        cfg = { ...cfg, ...parsed, ui: { ...cfg.ui, ...(parsed.ui || {}) } };
      } catch (e) { /* first run */ }
      return cfg;
    },
    async saveConfig(cfg) {
      await P.io.mkdir(P.platform.configDir());
      await P.io.writeFile(configPath(), JSON.stringify(cfg, null, 2));
    },
  };

  P.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
