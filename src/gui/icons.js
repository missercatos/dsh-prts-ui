/**
 * PRTS inline icons (B/W, stroke-only, 1.2-1.4px hairlines).
 */
(function (G) {
  'use strict';
  const P = G.PRTS = G.PRTS || {};
  const S = (d) => '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' + d + '</svg>';
  P.icons = {
    'send': '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h11.2l-3.6-3.6a.8.8 0 1 1 1.1-1.1l4.8 4.8a.8.8 0 0 1 0 1.1l-4.8 4.8a.8.8 0 1 1-1.1-1.1l3.6-3.6H2a.8.8 0 0 1 0-1.5Z" fill="currentColor"/></svg>',
    'ma.copy': S('<rect x="4.2" y="4.2" width="6.6" height="6.6" stroke="currentColor" stroke-width="1.2"/><path d="M4.4 2.8h6.4v6.4" stroke="currentColor" stroke-width="1.2"/>'),
    'ma.like': S('<path d="M7 12.2s-4.8-2.9-4.8-6.1A2.6 2.6 0 0 1 7 4.4a2.6 2.6 0 0 1 4.8 1.7c0 3.2-4.8 6.1-4.8 6.1Z" stroke="currentColor" stroke-width="1.2"/>'),
    'ma.dislike': S('<path d="M7 1.8s4.8 2.9 4.8 6.1a2.6 2.6 0 0 1-4.8 1.7 2.6 2.6 0 0 1-4.8-1.7c0-3.2 4.8-6.1 4.8-6.1Z" stroke="currentColor" stroke-width="1.2"/>'),
    'ma.branch': S('<path d="M4 2v7a2 2 0 0 0 2 2h4" stroke="currentColor" stroke-width="1.2"/><path d="M5.2 1.2 7 3 5.2 4.8M8.8 9.2 10 11l-1.2 1.8" stroke="currentColor" stroke-width="1.2" fill="none"/>'),
    'ma.trash': S('<path d="M2.5 4h9M5 4V2.8h4V4M4 4l.6 7.2h4.8L10 4" stroke="currentColor" stroke-width="1.2"/>'),
    'ma.clear': S('<path d="M2.5 4h9M5.5 4V2.8h3V4" stroke="currentColor" stroke-width="1.2"/><path d="M4 4l.6 7.2h4.8L10 4" stroke="currentColor" stroke-width="1.2"/>'),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
