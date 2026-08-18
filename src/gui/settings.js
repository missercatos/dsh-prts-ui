/**
 * PRTS settings shell — the shared settings panel IS dsh-web's own settings
 * modal (identical content on both surfaces): the footer button opens it,
 * the hover popup jumps sections, Esc/mask/close button dismiss it.
 *
 * This module only bridges to that modal (open / close / jump-to-section)
 * plus the ui-theme mirror that keeps the borrowed modal in the PRTS theme.
 * The classic overlay survives as a rare boot-race fallback only.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const ST = P.settingsPanel = {};

  function $id(id) { return document.getElementById(id); }

  /* ---------- settings namespaces (official data) ---------- */

  async function describeAll() {
    try {
      const r = await P.dshState.settingsGet(undefined);
      return (r && r.namespaces) || [];
    } catch (e) { return []; }
  }
  async function nsUpdate(ns, patch) {
    try {
      await P.dshState.settingsUpdate(ns, patch);
      return true;
    } catch (e) {
      if (P.app && P.app.toast) P.app.toast(e.message || String(e));
      return false;
    }
  }

  /* ---------- dsh-web settings modal bridge ---------- */

  const trigger = () => document.querySelector('.VOzbGW_trigger');
  const modalOpen = () => {
    const ov = document.querySelector('.VOzbGW_overlay');
    return !!ov && ov.getBoundingClientRect().width > 0;
  };
  const zhLabels = { general: '通用设置', models: '模型', plugins: '插件', 'agent-presets': 'Agent 预设', 'prts': 'PRTS', 'prts-balance': '余额', 'prts-motion': '动效', 'dshmarket': '插件市场' };

  async function open(cfg) {
    // Mirror the PRTS theme into the ui-theme namespace so the borrowed
    // modal resolves dsh-web's own light/dark tokens to match the surface.
    try {
      const theme = (document.documentElement.dataset.theme || 'dark') === 'light' ? 'light' : 'dark';
      await nsUpdate('ui-theme', { preference: theme });
    } catch (e) { /* noop */ }
    const trig = trigger();
    if (trig) { trig.click(); return; }
    // Fallback (only before dsh-web's UI rendered): the classic overlay.
    const ov = $id('settingsOverlay');
    if (ov) ov.classList.add('open');
  }

  function close() {
    // The modal's own document-level Escape listener is the close path.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const ov = $id('settingsOverlay');
    if (ov) ov.classList.remove('open');
  }

  function show(id) {
    if (!modalOpen()) {
      const trig = trigger();
      if (trig) trig.click();
      else { open(); return; }
    }
    const label = zhLabels[id] || id;
    setTimeout(() => {
      const cells = [...document.querySelectorAll('.VOzbGW_navCell')];
      const cell = cells.find((c) => ((c.querySelector('.VOzbGW_navLabel') || c).textContent || '').trim() === label) || cells[0];
      if (cell) cell.click();
    }, 320);
  }

  ST.open = open;
  ST.close = close;
  ST.show = show;
  ST.render = function () { /* fallback surface renders nothing */ };
})(typeof globalThis !== 'undefined' ? globalThis : this);