/**
 * PRTS plugin registry — the extension seam for community dsh plugins.
 *
 * PRTS is the UI shell of the dsh harness, so the webui keeps the same
 * extensibility: community plugins can register toolbar buttons / menu items
 * into the PRTS frame. Nothing is rendered unless a plugin registers, so a
 * stock install shows no extra buttons.
 *
 * A plugin registers through the shared namespace, e.g.:
 *
 *   PRTS.plugins.register({
 *     id: 'my-community-plugin',
 *     area: 'composer',           // 'composer' | 'header'
 *     order: 20,                  // sort key (default 100)
 *     icon: '<svg ...>',          // inline svg, uses currentColor
 *     label: 'Vision',            // tooltip / aria label
 *     enabled: true,
 *     onClick(ctx) { ... },       // ctx = { app, config, store, chat }
 *   })
 *
 * Hosts may also pre-seed plugins by setting `window.PRTS_PLUGINS` to an array
 * of plugin descriptors before the app boots; each entry is registered on boot.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const plugins = new Map();
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) {
      try { fn(); } catch (e) { /* listener errors must not break the shell */ }
    }
  }

  P.plugins = {
    register(plugin) {
      if (!plugin || !plugin.id) return null;
      const prev = plugins.get(plugin.id) || {};
      plugins.set(plugin.id, Object.assign({}, prev, plugin));
      notify();
      return plugin.id;
    },
    unregister(id) {
      if (plugins.delete(id)) notify();
    },
    /** List plugins, optionally filtered by render area. */
    list(area) {
      return [...plugins.values()]
        .filter((p) => p.enabled !== false && (!area || p.area === area))
        .sort((a, b) => (a.order === undefined ? 100 : a.order) - (b.order === undefined ? 100 : b.order));
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Adopt descriptors the host pre-seeded on window.PRTS_PLUGINS. */
    adoptSeeded() {
      const seeded = G.PRTS_PLUGINS;
      if (Array.isArray(seeded)) {
        for (const p of seeded) P.plugins.register(p);
      }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
