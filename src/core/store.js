/**
 * PRTS store: config, projects, and per-project message history.
 * All paths live under the platform config dir; reads/writes go through PRTS.io.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const DEFAULTS = {
    locale: 'auto',
    api: {
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      model: 'deepseek-chat',
      strength: 'medium',
    },
    project: 'default',
  };

  /** Thinking-budget presets (reasoning tokens). */
  const STRENGTH_BUDGET = { off: 0, low: 1024, medium: 4096, high: 32768 };

  const MODELS = ['deepseek-chat', 'deepseek-reasoner'];

  function dirs() {
    return { base: P.platform.configDir(), projects: P.platform.configDir() + '/projects' };
  }
  function configPath() { return dirs().base + '/config.json'; }
  function projDir(id) { return dirs().projects + '/' + id; }
  function metaPath(id) { return projDir(id) + '/meta.json'; }
  function historyPath(id) { return projDir(id) + '/history.jsonl'; }

  function slugify(name) {
    const s = String(name || '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'project-' + Date.now().toString(36);
  }

  const store = {
    dirs, STRENGTH_BUDGET, MODELS, slugify,

    async loadConfig() {
      let cfg = JSON.parse(JSON.stringify(DEFAULTS));
      try {
        const raw = await P.io.readFile(configPath());
        const parsed = JSON.parse(raw);
        cfg = { ...cfg, ...parsed, api: { ...cfg.api, ...(parsed.api || {}) } };
      } catch (e) { /* first run */ }
      if (!cfg.project || !(await store.projectExists(cfg.project))) cfg.project = 'default';
      return cfg;
    },

    async saveConfig(cfg) {
      await P.io.mkdir(dirs().base);
      await P.io.writeFile(configPath(), JSON.stringify(cfg, null, 2));
    },

    async listProjects() {
      try {
        const names = await P.io.listDir(dirs().projects);
        const out = [];
        for (const id of names) {
          try {
            const meta = JSON.parse(await P.io.readFile(metaPath(id)));
            out.push(meta);
          } catch (e) { /* stray dir */ }
        }
        out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return out;
      } catch (e) {
        return [];
      }
    },

    async projectExists(id) { return P.io.exists(metaPath(id)); },

    async ensureProject(id) {
      if (await store.projectExists(id)) return;
      await P.io.mkdir(projDir(id));
      await P.io.writeFile(metaPath(id), JSON.stringify({
        id, name: id === 'default' ? 'Default' : id,
        createdAt: Date.now(), updatedAt: Date.now(),
      }, null, 2));
    },

    async createProject(name) {
      const id = slugify(name);
      await store.ensureProject(id);
      return id;
    },

    async renameProject(id, name) {
      const meta = JSON.parse(await P.io.readFile(metaPath(id)));
      meta.name = String(name || id).trim() || id;
      meta.updatedAt = Date.now();
      await P.io.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
    },

    async deleteProject(id) {
      if (id === 'default') return;
      await P.io.deleteFile(metaPath(id));
      await P.io.deleteFile(historyPath(id));
    },

    async readHistory(id) {
      try {
        const raw = await P.io.readFile(historyPath(id));
        return raw.split('\n').filter((l) => l.trim() !== '').map((l) => {
          try { return JSON.parse(l); } catch (e) { return null; }
        }).filter(Boolean);
      } catch (e) { return []; }
    },

    async appendHistory(id, entry) {
      await P.io.mkdir(projDir(id));
      await P.io.appendFile(historyPath(id), JSON.stringify(entry) + '\n');
    },

    async touchProject(id) {
      try {
        const meta = JSON.parse(await P.io.readFile(metaPath(id)));
        meta.updatedAt = Date.now();
        await P.io.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
      } catch (e) { /* ignore */ }
    },

    async openProject(id) {
      await store.ensureProject(id);
      const cfg = await store.loadConfig();
      cfg.project = id;
      await store.saveConfig(cfg);
    },
  };

  P.store = store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
