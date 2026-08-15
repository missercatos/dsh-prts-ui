/**
 * PRTS UI preferences — only the window's own chrome (theme, locale). Agent
 * state (sessions, history, models, credentials) belongs to dsh and is never
 * stored here. The file lives with the prts profile under ~/.dsh.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const DEFAULTS = { locale: 'auto', ui: { theme: 'dark' } };

  function uiConfigPath() { return P.platform.prtsUiConfigPath(); }
  function legacyPath() { return P.platform.configDir() + '/config.json'; }

  const store = {
    async loadConfig() {
      let cfg = JSON.parse(JSON.stringify(DEFAULTS));
      const path = uiConfigPath();
      try {
        const raw = await P.io.readFile(path);
        const parsed = JSON.parse(raw);
        cfg = { ...cfg, ...parsed, ui: { ...cfg.ui, ...(parsed.ui || {}) } };
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
