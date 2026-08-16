/**
 * PRTS cost meter — ported from the dsh-cost-meter community plugin's pricing
 * math (official DeepSeek prices, peak/off-peak tiers). PRTS counts tokens
 * from dsh session events and prices them here, so no separate plugin process
 * is needed. Costs are USD internally; display is USD.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};

  const DEFAULT_PRICE_TABLE = {
    models: {
      'deepseek-v4-flash': {
        cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28,
        offPeak: { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 },
        peak: { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 },
      },
      'deepseek-v4-pro': {
        cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87,
        offPeak: { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 },
        peak: { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 },
      },
      'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.1, legacy: true },
      'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19, legacy: true },
    },
    default: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  };

  const PEAK = {
    enabled: true,
    effectiveAtMs: Date.parse('2026-08-16T16:00:00Z'),
    windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
  };

  function priceEntryFor(modelId) {
    const models = DEFAULT_PRICE_TABLE.models;
    if (typeof modelId === 'string' && models[modelId]) return models[modelId];
    return DEFAULT_PRICE_TABLE.default;
  }

  function isPeakHour(atMs) {
    if (!PEAK.enabled || !Number.isFinite(PEAK.effectiveAtMs) || atMs < PEAK.effectiveAtMs) return false;
    const hour = new Date(atMs).getUTCHours();
    return PEAK.windows.some((w) => hour >= w.start && hour < w.end);
  }

  function tierFor(entry, atMs) {
    const base = entry || DEFAULT_PRICE_TABLE.default;
    if (!PEAK.enabled) return { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output };
    if (isPeakHour(atMs)) {
      const p = base.peak;
      return p ? { cacheHit: p.cacheHit, cacheMiss: p.cacheMiss, output: p.output } : { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output };
    }
    const off = base.offPeak;
    return off ? { cacheHit: off.cacheHit, cacheMiss: off.cacheMiss, output: off.output } : { cacheHit: base.cacheHit, cacheMiss: base.cacheMiss, output: base.output };
  }

  function costOf(tokens, entry, atMs) {
    const tier = tierFor(entry, atMs);
    const input = Math.max(0, Number(tokens.input) || 0);
    const output = Math.max(0, Number(tokens.output) || 0);
    const cacheRead = Math.max(0, Number(tokens.cacheRead) || 0);
    const cacheWrite = Math.max(0, Number(tokens.cacheWrite) || 0);
    return Math.max(0, (input * tier.cacheMiss + output * tier.output + (cacheRead + cacheWrite) * tier.cacheHit) / 1e6);
  }

  function formatMoney(usd) {
    const value = usd;
    let decimals = 4;
    if (value > 0 && value < 1e-4) decimals = 6;
    let fixed = value.toFixed(decimals);
    fixed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
    return '$' + fixed;
  }

  function fmtTokens(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // Per-message usage ledger, keyed by message id so stream updates never
  // double-count. The session total is recomputed from this map.
  const byId = new Map();
  const session = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, calls: 0 };

  function recompute() {
    session.input = 0; session.output = 0; session.cacheRead = 0; session.cacheWrite = 0; session.usd = 0;
    for (const m of byId.values()) {
      session.input += m.input;
      session.output += m.output;
      session.cacheRead += m.cacheRead;
      session.cacheWrite += m.cacheWrite;
      session.usd += m.usd;
    }
    session.calls = byId.size;
  }

  function reset() { byId.clear(); recompute(); }

  function addUsage(msg) {
    const u = msg && msg.usage;
    if (!u) return;
    const id = msg.id || ('m' + (msg._seq || byId.size));
    const input = u.prompt_tokens || u.input_tokens || 0;
    const output = u.completion_tokens || u.output_tokens || 0;
    const cacheRead = u.prompt_cache_hit_tokens || u.cacheRead || 0;
    const cacheWrite = u.prompt_cache_write_tokens || u.cacheWrite || 0;
    const entry = priceEntryFor(msg.model || 'deepseek-chat');
    const usd = costOf({ input, output, cacheRead, cacheWrite }, entry, Date.now());
    byId.set(id, { model: msg.model || '?', input, output, cacheRead, cacheWrite, usd });
    recompute();
  }

  P.cost = {
    session,
    reset,
    addUsage,
    formatMoney,
    fmtTokens,
    priceEntryFor,
    costOf,
    tierFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
