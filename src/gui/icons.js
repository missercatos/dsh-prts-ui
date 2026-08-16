/**
 * PRTS icon set — Hypergryph / Arknights design language, adapted to the
 * monochrome PRTS frame: hairline strokes (1.15–1.3px), sharp vertices,
 * the diamond (rotated square) as the recurring motif, segmented circles,
 * chevrons and angular brackets. Every mark stays abstract and geometric.
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = (inner, size) =>
    '<svg width="' + (size || 14) + '" height="' + (size || 14) + '" viewBox="0 0 14 14" fill="none" aria-hidden="true">' + inner + '</svg>';
  const D = 'M7 1.6 12.4 7 7 12.4 1.6 7Z'; // diamond (PRTS mark)

  P.icons = {
    // —— identity / marks ——
    'diamond': S('<path d="' + D + '" stroke="currentColor" stroke-width="1.2"/>'),
    'diamond.fill': S('<path d="' + D + '" fill="currentColor"/>'),
    'prts.mark': S('<path d="' + D + '" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 5.2h3.6v3.6H5.2Z" fill="currentColor"/>'),

    // —— composer ——
    'send': '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11.2l-3.6-3.6a.8.8 0 1 1 1.1-1.1l4.8 4.8a.8.8 0 0 1 0 1.1l-4.8 4.8a.8.8 0 1 1-1.1-1.1l3.6-3.6H2a.8.8 0 0 1 0-1.5Z" fill="currentColor"/></svg>',
    'attach': S('<path d="M7 9.6V1.8M3.6 5.2 7 1.8l3.4 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 7.6v2.4a1 1 0 0 0 1 1h6.6a1 1 0 0 0 1-1V7.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    'mic': S('<path d="M6.5 1.2a2 2 0 0 0-2 2v3.1a2 2 0 0 0 4 0V3.2a2 2 0 0 0-2-2Z" stroke="currentColor" stroke-width="1.2"/><path d="M2.6 6a3.9 3.9 0 0 0 7.8 0M6.5 9.9v1.9M4.6 11.8h3.8" stroke="currentColor" stroke-width="1.2"/>'),

    // —— message actions ——
    'ma.copy': S('<path d="M4.4 2.8h6.2v6.2" stroke="currentColor" stroke-width="1.2"/><path d="M3.4 4.8h6.2a1 1 0 0 1 1 1v5.2a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.2"/>'),
    'ma.like': S('<path d="M7 12.4 2.2 7.6a3.4 3.4 0 0 1 4.8-4.8L7 2.6l.2-.2a3.4 3.4 0 0 1 4.8 4.8L7 12.4Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
    'ma.dislike': S('<path d="M7 1.6l4.8 4.8a3.4 3.4 0 0 1-4.8 4.8L7 11.4l-.2.2a3.4 3.4 0 0 1-4.8-4.8L7 1.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
    'ma.branch': S('<circle cx="3.2" cy="2.4" r="1" stroke="currentColor" stroke-width="1.1"/><circle cx="3.2" cy="11.6" r="1" stroke="currentColor" stroke-width="1.1"/><circle cx="10.8" cy="7" r="1" stroke="currentColor" stroke-width="1.1"/><path d="M3.2 3.4v4.2a2 2 0 0 0 2 2h3.6M3.2 10.6V8.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    'ma.trash': S('<path d="M2.5 4h9M5 4V2.6h4V4M4 4l.6 7.4h4.8L10 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'ma.clear': S('<path d="M3 2.2 5.4 4 3 5.8M9.2 2.2 6.8 4l2.4 1.8M3 8.4 5.4 10.2 3 12M9.2 8.4 6.8 10.2l2.4 1.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),
    // Edit / Think / Read marks — abstract PRTS glyphs for message actions
    'ma.think': S('<path d="' + D + '" stroke="currentColor" stroke-width="1.15"/><circle cx="5.6" cy="7" r="0.9" fill="currentColor"/><circle cx="8.4" cy="7" r="0.9" fill="currentColor"/><circle cx="7" cy="4.2" r="0.9" fill="currentColor"/>'),
    'ma.tool': S('<path d="M4.4 9.6 8 6l2.6 2.6-3.6 3.6a2.4 2.4 0 0 1-3.4-3.4L5 7.4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.8 5.2l1.6-1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    'ma.edit': S('<path d="M8.4 2.2 11.8 5.6 5.2 12.2 1.8 12.2l.2-3.4Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M7.4 3.2 10.8 6.6" stroke="currentColor" stroke-width="1.15"/>'),
    'ma.read': S('<path d="M7 2.4c-1.8 0-3.5.7-4.8 1.8L7 8.6l4.8-4.4A6.8 6.8 0 0 0 7 2.4Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M2.2 8v2.6c0 .6.5 1 1 1h7.6a1 1 0 0 0 1-1V8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),

    // —— chrome ——
    'settings': S('<path d="M7 9.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" stroke-width="1.15"/><path d="M13.2 7v.9l-1.7.3a4 4 0 0 1-.5 1.2l1 1.4-.9.9-1.4-1a4 4 0 0 1-1.2.5L8 12.9h-.9L6.8 11.2a4 4 0 0 1-1.2-.5l-1.4 1-.9-.9 1-1.4a4 4 0 0 1-.5-1.2L2.1 6.9V6l1.7-.3a4 4 0 0 1 .5-1.2l-1-1.4.9-.9 1.4 1a4 4 0 0 1 1.2-.5L7.1 1.1H8l.3 1.7a4 4 0 0 1 1.2.5l1.4-1 .9.9-1 1.4a4 4 0 0 1 .5 1.2l1.7.3Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'),
    'close': S('<path d="M2.5 2.5l9 9M11.5 2.5l-9 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
    'chev': S('<path d="M2.7 4.2a.6.6 0 0 1 .9 0L6 6.7l2.4-2.5a.6.6 0 1 1 .9.9l-2.9 3a.6.6 0 0 1-.9 0l-2.9-3a.6.6 0 0 1 0-.9Z" fill="currentColor"/>', 12),
    'search': S('<circle cx="5.4" cy="5.4" r="3.8" stroke="currentColor" stroke-width="1.15"/><path d="m8.2 8.2 3.4 3.4M9.2 3.4 9.6 3M3.4 9.2 3 9.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>', 12),
    'plus': S('<path d="M6.5 1.2v10.6M1.2 6.5h10.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>', 13),
    'plus.diamond': S('<path d="' + D + '" stroke="currentColor" stroke-width="1.15"/><path d="M7 3.6v6.8M3.6 7h6.8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'check': S('<path d="M1.8 7.2 5 10.4 12.2 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>', 13),
    'arrow.left': S('<path d="M8.6 2.6 3.2 7l5.4 5.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>', 12),
    'external': S('<path d="M5.6 2.8H2.8v8.4h8.4V8.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8.6 2.2h3.2v3.2M11.4 2.6 6.8 7.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>', 13),

    // —— sidebar (PRTS-style abstract marks) ——
    'git': S('<circle cx="3" cy="3.4" r="1.15" stroke="currentColor" stroke-width="1.15"/><circle cx="11" cy="3.4" r="1.15" stroke="currentColor" stroke-width="1.15"/><circle cx="7" cy="10.8" r="1.15" stroke="currentColor" stroke-width="1.15"/><path d="M4 3.9a3 3 0 0 0 2.5 6M10 3.9a3 3 0 0 1-2.5 6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'skill': S('<path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M4.9 4.9 7 7l2.1-2.1M7 7l2.1 2.1M4.9 9.1 7 7" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'balance': S('<path d="' + D + '" stroke="currentColor" stroke-width="1.15"/><path d="M4.6 5.4h4.8M7 4.4v5.2M4.4 8.4 5.7 9.6l2.6-2.4M7 4.4 5.4 4.8M7 4.4l1.6.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>'),
    'market': S('<path d="M4.5 2.5 6.5 4.5 4.5 6.5 2.5 4.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M11.5 2.5 13.5 4.5 11.5 6.5 9.5 4.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M4.5 9.5 6.5 11.5 4.5 13.5 2.5 11.5Z" fill="currentColor"/><path d="M11.5 9.5 13.5 11.5 11.5 13.5 9.5 11.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>', 15),
    'details': S('<path d="M3 2.2h8a1 1 0 0 1 1 1v7.6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.15"/><path d="M5.4 2.2v9.6M8.4 2.2v9.6" stroke="currentColor" stroke-width="1.15"/>'),
    'user': S('<path d="M7 2.2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" stroke="currentColor" stroke-width="1.15"/><path d="M2.4 11.6a4.6 4.6 0 0 1 9.2 0" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'folder': S('<path d="M5.2 2H2.2a.9.9 0 0 0-.9.9v7.3a.9.9 0 0 0 .9.9h9.6a.9.9 0 0 0 .9-.9V4.3a.9.9 0 0 0-.9-.9H6l-.8-1.4Z" fill="currentColor"/>', 12),
    'sun': S('<circle cx="7.5" cy="7.5" r="3" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 1.2v1.4M7.5 12.4v1.4M1.2 7.5h1.4M12.4 7.5h1.4M3 3l1 1M11 11l1 1M12 3l-1 1M4 11l-1 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>', 15),
    'moon': S('<path d="M12.6 9.6A5.4 5.4 0 0 1 5.4 2.4 5.6 5.6 0 1 0 12.6 9.6Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>', 15),

    // —— feedback (non-heart), modes, permission shields ——
    'ma.good': S('<path d="M7 2.2 12.4 7 7 11.8 1.6 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M7 9.2V4.8M4.6 7.2 7 4.8l2.4 2.4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>'),
    'ma.bad': S('<path d="M7 2.2 12.4 7 7 11.8 1.6 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M7 4.8v4.4M4.6 6.8 7 9.2l2.4-2.4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>'),
    'mode.standard': S('<path d="M7 1.8 12.2 7 7 12.2 1.8 7Z" stroke="currentColor" stroke-width="1.2"/>'),
    'mode.code': S('<path d="M7 1.8 12.2 7 7 12.2 1.8 7Z" stroke="currentColor" stroke-width="1.2"/><path d="M4.8 8.6 6 7 4.8 5.4M7.4 5.4l1.2 1.6-1.2 1.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>'),
    'mode.minimal': S('<path d="M7 3.2 10.8 7 7 10.8 3.2 7Z" stroke="currentColor" stroke-width="1.2"/>'),
    'mode.cordis': S('<path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M7 3.8 10.2 7 7 10.2 3.8 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M7 5.6 8.4 7 7 8.4 5.6 7Z" fill="currentColor"/>'),
    'perm.readonly': S('<path d="M7 1.4 12.2 3.6v3.6c0 3-2.2 4.9-5.2 6-3-1.1-5.2-3-5.2-6V3.6Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><circle cx="7" cy="7.4" r="1.7" stroke="currentColor" stroke-width="1.15"/>'),
    'perm.workspacewrite': S('<path d="M7 1.4 12.2 3.6v3.6c0 3-2.2 4.9-5.2 6-3-1.1-5.2-3-5.2-6V3.6Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M7 3.4 9.6 7 7 10.6 4.4 7Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>'),
    'perm.danger': S('<path d="M7 1.4 12.2 3.6v3.6c0 3-2.2 4.9-5.2 6-3-1.1-5.2-3-5.2-6V3.6Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M7 3.2 9.8 7 7 10.8 4.2 7Z" fill="currentColor"/>'),

    // —— settings nav (small marks, PRTS abstract) ——
    'general': S('<path d="M3.2 6.4a4.2 4.2 0 0 1 7.6 0" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/><path d="M2.2 7.6h9.6M2.2 9.8h9.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'models': S('<path d="M2.8 4.2h2.4v5.6H2.8zM6 4.2h2.4v5.6H6zM9.2 4.2h2v5.6h-2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M3.6 4.2V2.6M7.2 4.2V2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),
    'plugins': S('<path d="M4.4 4.4h5.2v5.2H4.4zM7 4.4V2.4M7 9.6v2" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M2.4 7h2M9.6 7h2" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'presets': S('<path d="M7 2.2 12.2 7 7 11.8 1.8 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M7 5.2 8.8 7 7 8.8 5.2 7Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M3.6 9.8 1.8 7M10.4 9.8l1.8-2.8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'skills': S('<path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" stroke="currentColor" stroke-width="1.15"/><path d="M4.9 4.9 7 7l2.1-2.1M7 7l2.1 2.1M4.9 9.1 7 7" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'wall': S('<rect x="2.2" y="2.2" width="9.6" height="9.6" stroke="currentColor" stroke-width="1.15"/><path d="M2.2 7.2 5.6 4.4l2.4 2.2 3.8-3.4M2.2 11 6.4 7.4l1.6 1.4" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><circle cx="9.6" cy="4.6" r="0.9" fill="currentColor"/>'),
    'palette': S('<path d="M7 2.2a4.8 4.8 0 1 0 0 9.6h1.2a1.2 1.2 0 0 0 1.1-1.7 1.1 1.1 0 0 1 1-1.7H11a1.8 1.8 0 0 0 0-3.6 5.6 5.6 0 0 0-4-2.6Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M4.2 5.2h.6M5.8 3.8h.6M8.6 3.2h.6M9.8 5.4h.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),

    // —— deepseek / balance panel ——
    'login': S('<path d="M2.6 11.4V8.6a4.4 4.4 0 0 1 8.8 0v2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4.6 10.6h4.8M5.2 8.2l1.8 2.4 1.8-2.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'sync': S('<path d="M2.6 7A4.4 4.4 0 0 1 10 4l1.4 1.4M4 4l1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.4 7A4.4 4.4 0 0 1 4 10L2.6 8.6M10 10 8.6 8.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'recharge': S('<path d="M7 12.2V6.6M3.4 8.6 7 4.4l3.6 4.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 12.4h9.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    'key': S('<circle cx="5.2" cy="8.8" r="2" stroke="currentColor" stroke-width="1.15"/><path d="M6.6 7.4 11 3M8.6 3h2.6v2.6M8.4 5.2l1.8 1.8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),

    // —— git panel ——
    'repo': S('<path d="M2.8 3.6v6.8a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1V4.6l-2.2-2.2H3.8a1 1 0 0 0-1 1.2Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M9 2.6v2.2h2.2M5 7.4h4M5 9.4h4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'upload': S('<path d="M7 10.4V2.2M3.4 4.6 7 1l3.6 3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 11.4h9.6M2.2 13h9.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'grid': S('<path d="M4.6 2.6 9.4 2.6 11.4 4.6 11.4 9.4 9.4 11.4 4.6 11.4 2.6 9.4 2.6 4.6Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M4.6 2.6 7 7l2.4-4.4M11.4 4.6 7 7l-2.4 4.4M4.6 11.4 7 7l2.4-4.4" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'),
    'terminal': S('<path d="M2.4 3.4h9.2a.8.8 0 0 1 .8.8v5.6a.8.8 0 0 1-.8.8H2.4a.8.8 0 0 1-.8-.8V4.2a.8.8 0 0 1 .8-.8Z" stroke="currentColor" stroke-width="1.15"/><path d="M4.2 5.6 6 7l-1.8 1.4M7 8.4h3" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>'),

    // —— skill panel ——
    'stack': S('<path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" stroke="currentColor" stroke-width="1.1"/><path d="M7 4 9.8 7 7 10 4.2 7Z" stroke="currentColor" stroke-width="1.1"/><path d="M4.4 9.6 1.6 7M9.6 9.6l2.8-2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>'),
    'pen': S('<path d="M8.4 2.2 11.8 5.6 5.2 12.2 1.8 12.2l.2-3.4Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M7.4 3.2 10.8 6.6" stroke="currentColor" stroke-width="1.15"/>'),
    'trash2': S('<path d="M2.5 4h9M5 4V2.6h4V4M4 4l.6 7.4h4.8L10 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'download': S('<path d="M7 2.2v8.2M3.4 7.2 7 10.8l3.6-3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 12.4h9.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    'refresh': S('<path d="M11.4 4.6V1.8H8.6M2.6 9.4v2.8h2.8" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.2 7A4.2 4.2 0 0 0 3.2 4.6M2.8 7A4.2 4.2 0 0 0 10.8 9.4" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
    'link': S('<path d="M5.2 8.8 8.8 5.2M4 7.6 2.9 8.7a2.4 2.4 0 0 0 3.4 3.4l1.1-1.1M10 6.4l1.1-1.1a2.4 2.4 0 0 0-3.4-3.4L6.6 3" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>'),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
