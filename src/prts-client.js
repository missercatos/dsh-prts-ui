/**
 * dsh-prts-ui/client — the PRTS client plugin.
 *
 * PRTS runs AS a dsh-web client plugin in the isolated `prts` profile: the
 * shell is dsh-web itself, so the settings pages are the official ones
 * (identical to web), every plugin the market installs shows its own
 * buttons/panels exactly where dsh-web puts them, and performance is
 * dsh-web's own. The official `dsh web` profile never loads this plugin, so
 * `dsh web` stays the original DeepSeek Harness UI. PRTS contributes:
 *   - the PRTS skin (monochrome tokens + custom accent/wallpaper/glass),
 *   - the particle intro (welcome to PRTS → PRTS/DeepSeek Harness banner →
 *     the PRTS diamond mark),
 *   - sidebar actions (Git / SKILL市场 / 系统),
 *   - the PRTS settings sections (PRTS / 余额 / 动效) registered into the
 *     same settings.section slots dsh-web renders.
 *
 * Surface model: dsh-web's React UI stays alive on BOTH surfaces — in the
 * classic PRTS shell it is kept invisible (html[data-prts-shell] hides the
 * layout frame) and its centered settings modal is BORROWED as the shared
 * settings panel (the PRTS footer button opens it, the hover popup jumps
 * sections, Esc/mask close it). Skin mode (ui.shell = 'dsh-web') shows the
 * native UI with the PRTS overlay marks instead.
 *
 * Plain JavaScript: React.createElement only, no JSX/TS transform.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

const SILL = '__SKILL_CATALOG__'

/** Services this plugin waits for before applying: the slot registry (client
 *  runtime) and the theme registry (client theme). Both are provided by the
 *  stock dsh web boot, so the skin always lands on a ready shell. */
export const inject = ['slots', 'theme']

export function apply(ctx) {
  const slots = ctx.get('slots')
  const theme = ctx.get('theme')

  const R = React
  const { useState, useEffect, useRef, useCallback } = React

  const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
  const api = async (method, path, body) => {
    const res = await fetch(origin() + path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }
  const getConfig = () => api('GET', '/prts/api/config').catch(() => ({}))
  const setConfig = (patch) => api('POST', '/prts/api/config', patch).catch(() => ({ ok: false }))

  /* ---------- PRTS skin ---------- */
  // overrideTokens() takes token -> { light, dark } pairs (one value per
  // color scheme) — the inverted shape silently no-ops at runtime.
  const PRTS_TOKENS = {
    '--dsw-alias-bg-base': { dark: '#0A0A0B', light: '#FAFAFA' },
    '--dsw-alias-bg-layer-1': { dark: '#111112', light: '#F3F3F3' },
    '--dsw-alias-bg-layer-2': { dark: '#161618', light: '#EBEBEB' },
    '--dsw-alias-bg-overlay': { dark: '#0D0D0E', light: '#FFFFFF' },
    '--dsw-alias-border-l1': { dark: 'rgba(250,250,250,0.14)', light: 'rgba(10,10,11,0.14)' },
    '--dsw-alias-border-l2': { dark: 'rgba(250,250,250,0.3)', light: 'rgba(10,10,11,0.3)' },
    '--dsw-alias-brand-primary': { dark: '#FAFAFA', light: '#0A0A0B' },
    '--dsw-alias-label-primary': { dark: '#FAFAFA', light: '#0A0A0B' },
    '--dsw-alias-label-secondary': { dark: '#9C9CA1', light: '#5C5C60' },
    '--dsw-alias-state-error-primary': { dark: '#f7768e', light: '#d93025' },
    '--dsw-alias-state-success-primary': { dark: '#9ece6a', light: '#188038' },
    '--dsw-alias-state-warn-primary': { dark: '#e0af68', light: '#b06000' },
    '--dsw-specific-sidebar-fill': { dark: '#0D0D0E', light: '#FFFFFF' },
  }

  let appliedAccent = null
  /** Mix two #rrggbb colors; t = share of b (0..1). */
  function mixHex(a, b, t) {
    try {
      const r = ((parseInt(String(a).slice(1, 3), 16) * (1 - t) + parseInt(String(b).slice(1, 3), 16) * t) | 0)
      const g = ((parseInt(String(a).slice(3, 5), 16) * (1 - t) + parseInt(String(b).slice(3, 5), 16) * t) | 0)
      const bl = ((parseInt(String(a).slice(5, 7), 16) * (1 - t) + parseInt(String(b).slice(5, 7), 16) * t) | 0)
      return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')
    } catch (e) { return b }
  }
  async function applySkin(cfg) {
    const ui = (cfg && cfg.ui) || {}
    let skinChanged = false
    // monochrome base tokens (light + dark). overrideTokens PUBLISHES a
    // theme change, so re-entering here with identical tokens would loop
    // forever — apply them only when the affecting inputs actually changed
    // (the tokens themselves are { dark, light } dual-mode, so the theme
    // service re-resolves them per mode automatically).
    if (theme) {
      try {
        const key = JSON.stringify([PRTS_TOKENS, ui.theme || '', ui.blur === undefined ? null : ui.blur])
        skinChanged = key !== skinTokensKey
        if (skinChanged) {
          skinTokensKey = key
          theme.overrideTokens('prts', PRTS_TOKENS)
        }
      } catch (e) { /* token API may reject */ }
    }
    const root = document.documentElement
    const setVar = (k, v) => {
      if (v) root.style.setProperty(k, v)
      else root.style.removeProperty(k)
    }
    // Fixed monochrome ink for the background marks and the hero mark: they
    // follow only light/dark (and 跟随系统), never a preset.
    let activeId = 'dark'
    try {
      const snap = theme && theme.getTheme ? theme.getTheme() : null
      // snapshot shape: { preference, active: { id, ... }, ... }
      activeId = (snap && snap.active && snap.active.id) || (snap && snap.preference) || (snap && snap.id) || 'dark'
    } catch (e) { /* noop */ }
    setVar('--prts-ink', activeId === 'light' ? '#0A0A0B' : '#FAFAFA')
    document.documentElement.dataset.prtsTheme = activeId
    // Glass blur amount (background blur slider).
    setVar('--prts-blur', (ui.blur !== undefined ? ui.blur : 12) + 'px')
    // Theme = PRESETS ONLY (or '' for the system default). The preset hue
    // colors text/buttons/borders and tints the background when no
    // wallpaper is set; the preset adapts to light/dark automatically.
    const preset = THEME_PRESETS.find(([id]) => id === ui.theme)
    const p = preset ? preset[2] : null
    setVar('--prts-accent', p || '')
    if (p) {
      const darkTint = {
        '--dsw-alias-brand-primary': p,
        '--dsw-alias-border-l2': mixHex('#FAFAFA', p, 0.55),
        '--dsw-alias-label-secondary': mixHex('#9C9CA1', p, 0.3),
        '--dsw-alias-bg-base': mixHex('#0A0A0B', p, 0.08),
        '--dsw-alias-bg-layer-1': mixHex('#111112', p, 0.07),
        '--dsw-alias-bg-overlay': mixHex('#0D0D0E', p, 0.06),
      }
      const lightTint = {
        '--dsw-alias-brand-primary': p,
        '--dsw-alias-border-l2': mixHex('#0A0A0B', p, 0.5),
        '--dsw-alias-label-secondary': mixHex('#5C5C60', p, 0.3),
        '--dsw-alias-bg-base': mixHex('#FAFAFA', p, 0.05),
        '--dsw-alias-bg-layer-1': mixHex('#F3F3F3', p, 0.04),
        '--dsw-alias-bg-overlay': mixHex('#FFFFFF', p, 0.04),
      }
      const toTokenModes = (darkMap, lightMap) => {
        const out = {}
        for (const k of Object.keys(darkMap)) out[k] = { dark: darkMap[k], light: lightMap[k] }
        return out
      }
      if (theme && skinChanged) { try { theme.overrideTokens('prts-accent', toTokenModes(darkTint, lightTint)) } catch (e) { /* noop */ } }
    }
    appliedAccent = !!p
    // glass master switch
    document.body.dataset.glass = ui.glass === false ? 'off' : 'on'
    // drawer motion config
    setVar('--prts-drawer-ms', (ui.drawerMs || 380) + 'ms')
    document.documentElement.dataset.prtsDrawerOff = ui.drawer === false ? '1' : ''
    applyWallpaper(cfg)
  }

  async function applyWallpaper(cfg) {
    const w = cfg && cfg.ui && cfg.ui.wallpaper
    let layer = document.getElementById('prtsWallpaperLayer')
    if (!w || (!w.file && !w.url)) {
      if (layer) layer.remove()
      return
    }
    if (!layer) {
      layer = document.createElement('div')
      layer.id = 'prtsWallpaperLayer'
      layer.setAttribute('aria-hidden', 'true')
      document.body.appendChild(layer)
    }
    layer.style.cssText = 'position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--dsw-alias-bg-base);opacity:' + (w.opacity !== undefined ? w.opacity : 1) + ';'
    // fit: 覆盖 cover / 填充 fill / 自由 free (natural size) / 居中 contain
    const fitMap = { cover: 'cover', fill: 'fill', free: 'none', contain: 'contain' }
    try {
      let src = w.url || ''
      if (!src) {
        const data = await api('GET', '/prts/api/wallpaper?file=' + encodeURIComponent(w.file))
        if (!data || !data.dataUrl) return
        src = data.dataUrl
      }
      layer.innerHTML = ''
      let media
      if (w.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(String(src))) {
        media = document.createElement('video')
        media.src = src
        media.autoplay = true
        media.muted = true
        media.playsInline = true
        media.loop = w.loop !== false
        try { media.playbackRate = Number(w.speed) || 1 } catch (e) { /* noop */ }
      } else {
        media = document.createElement('img')
        media.src = src
      }
      media.style.cssText = 'width:100%;height:100%;object-fit:' + (fitMap[w.fit] || 'cover') + ';'
      layer.appendChild(media)
    } catch (e) { /* wallpaper unavailable */ }
  }

  const PRTS_CSS = `
  #prtsWallpaperLayer { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  body[data-glass='off'] * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  /* PRTS liquid glass on dsh-web surfaces (composer card + conversation) */
  .prts-glass { background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
  .prtsGlassCard { background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 72%, transparent) !important; backdrop-filter: blur(var(--prts-blur, 12px)); -webkit-backdrop-filter: blur(var(--prts-blur, 12px)); border-radius: 12px; }
  /* composer pinned to the bottom of the column (empty state included) */
  .prtsComposerPin { position: absolute !important; left: 0; right: 0; bottom: 0; padding: 8px 16px 14px !important; background: linear-gradient(to top, var(--dsw-alias-bg-base) 62%, transparent) !important; }
  .prtsComposerPin textarea { min-height: 60px !important; padding: 12px 14px !important; }
  body[data-glass='off'] .prtsGlassCard { background: var(--dsw-alias-bg-overlay) !important; }
  /* PRTS panel overlay */
  .prtsOverlay { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); }
  .prtsCard { width: min(760px, calc(100vw - 40px)); height: min(640px, calc(100vh - 60px)); display: flex; flex-direction: column; background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 88%, transparent); backdrop-filter: blur(20px); border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; overflow: hidden; }
  .prtsCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
  .prtsTitle { font-size: 12px; letter-spacing: 0.22em; color: var(--dsw-alias-label-primary); }
  .prtsBody { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }
  .prtsSearch { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 10px; margin-bottom: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-overlay); }
  .prtsSearch input { flex: 1; border: none; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; }
  .prtsGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .prtsItem { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; background: var(--dsw-alias-bg-layer-1); }
  .prtsItemName { font-size: 13px; color: var(--dsw-alias-label-primary); }
  .prtsItemDesc { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
  .prtsBtn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12.5px; cursor: pointer; }
  .prtsBtn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l2); }
  .prtsBtn.primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
  .prtsBtn:disabled { opacity: 0.4; cursor: default; }
  .prtsChip { height: 32px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11.5px; cursor: pointer; transition: background .14s ease, border-color .14s ease, color .14s ease; }
  .prtsChip:hover { background: var(--dsw-alias-bg-layer-1); }
  .prtsChip.on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
  .prtsRow { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .prtsLabel { flex: 1; font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .prtsInput { height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
  .prtsOnboard { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.62); }
  .prtsOnboardCard { width: min(480px, calc(100vw - 40px)); padding: 26px 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-overlay); display: flex; flex-direction: column; gap: 12px; }
  .prtsOnboardTitle { font-size: 16px; color: var(--dsw-alias-label-primary); letter-spacing: 0.06em; }
  .prtsOnboardBody { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
  .prtsDiamond { display: inline-block; width: 9px; height: 9px; transform: rotate(45deg); border: 1.2px solid var(--dsw-alias-brand-primary); }
  /* PRTS settings groups (dsh-settings-like cards) */
  .prtsGroup { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; margin: 10px 0; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
  .prtsGroupHead { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: none; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
  .prtsGroupHead:hover { background: var(--dsw-alias-bg-layer-2); }
  .prtsGroupChev { font-size: 10px; color: var(--dsw-alias-label-secondary); flex: none; transition: transform .28s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)); }
  .prtsGroup.open .prtsGroupChev { transform: rotate(180deg); }
  .prtsGroupTitle { font-size: 13px; font-weight: 600; letter-spacing: .04em; }
  .prtsGroupSub { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
  /* the body always stays mounted — max-height animation slides the content
     out/in so everything below the group moves in sync */
  .prtsGroupBody { max-height: 0; opacity: 0; overflow: hidden; padding: 0 16px; transition: max-height .32s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)), padding .32s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)), opacity .26s ease; }
  .prtsGroup.open .prtsGroupBody { max-height: 1000px; opacity: 1; padding: 2px 16px 14px; }
  /* hover popup above the settings button: dsh-web style card */
  .prtsHoverPop {
    display: flex; flex-direction: column; gap: 2px; padding: 6px;
    background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    min-width: 148px;
    animation: prtsPopUp .18s var(--prts-ease-out, ease-out);
    transform-origin: bottom center;
  }
  .prtsHoverPop button {
    height: 32px; border: none; border-radius: 7px; background: transparent;
    color: var(--dsw-alias-label-secondary); cursor: pointer;
    display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px;
    transition: background .14s var(--prts-ease, ease), color .14s var(--prts-ease, ease);
  }
  .prtsHoverPop button svg { flex: none; opacity: .85; }
  .prtsHoverPop button span { letter-spacing: .02em; white-space: nowrap; }
  .prtsHoverPop button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
  @keyframes prtsPopUp { from { opacity: 0; transform: translateY(calc(-100% + 10px)); } to { opacity: 1; transform: translateY(-100%); } }
  `

  let styleEl = null
  function ensureCss() {
    if (styleEl) return
    styleEl = document.createElement('style')
    styleEl.id = 'prts-client-css'
    styleEl.textContent = PRTS_CSS
    document.head.appendChild(styleEl)
  }
  ensureCss()

  let lastSkinCfg = null
  let skinTokensKey = ''
  getConfig().then((cfg) => { lastSkinCfg = cfg; return applySkin(cfg) }).catch(() => { })
  // The light/dark switch (logo row + 通用设置) must adapt the fixed ink
  // instantly — but re-running applySkin here would call overrideTokens,
  // which PUBLISHES a theme change, which fires theme/change again:
  // infinite recursion (RangeError: Maximum call stack size exceeded).
  // The PRTS tokens are already { dark, light } dual-mode, so the theme
  // service re-resolves them per mode by itself; the handler only updates
  // the DOM-level ink + dataset (no publish, no loop).
  if (ctx && typeof ctx.on === 'function') {
    ctx.on('theme/change', () => {
      try {
        let id = 'dark'
        const snap = theme && theme.getTheme ? theme.getTheme() : null
        id = (snap && snap.active && snap.active.id) || id
        document.documentElement.dataset.prtsTheme = id
        document.documentElement.style.setProperty('--prts-ink', id === 'light' ? '#0A0A0B' : '#FAFAFA')
      } catch (e) { /* noop */ }
    })
  }

  /* ---------- helpers ---------- */
  function t(key) { return key }

  function h(tag, props, ...kids) {
    return R.createElement(tag, props || null, ...(kids || []))
  }

  const CATALOG = typeof SILL === 'string' && SILL !== '__SKILL_CATALOG__' ? JSON.parse(SILL) : []

  /* ---------- collapsible settings group (expand animates: the body slides
   * down in sync via max-height + the content below is pushed smoothly) ---------- */
  function Group({ title, sub, children, startOpen = true }) {
    const [open, setOpen] = useState(startOpen)
    return h('div', { className: 'prtsGroup' + (open ? ' open' : '') },
      h('button', { className: 'prtsGroupHead', type: 'button', 'aria-expanded': String(open), onClick: () => setOpen(!open) },
        h('span', { className: 'prtsGroupChev' }, '▾'),
        h('span', { className: 'prtsGroupTitle' }, title),
        sub ? h('span', { className: 'prtsGroupSub' }, sub) : null,
      ),
      h('div', { className: 'prtsGroupBody' }, children),
    )
  }

  /* ---------- 动效 (motion plugin) settings ---------- */
  function MotionSettings() {
    const [cfg, setCfg] = useState({ ui: {} })
    useEffect(() => { getConfig().then((c) => setCfg(c || { ui: {} })) }, [])
    const save = async (patch) => {
      const next = { ...cfg, ...patch, ui: { ...(cfg.ui || {}), ...((patch && patch.ui) || {}) } }
      setCfg(next)
      await setConfig(next)
      applySkin(next)
    }
    const ui = cfg.ui || {}
    return h('div', { className: 'prtsBody' },
      h(Group, { title: '侧边栏抽屉' },
        h('div', { className: 'prtsRow' },
          h('span', { className: 'prtsLabel' }, '抽屉动效'),
          h('input', { type: 'checkbox', checked: ui.drawer !== false, onChange: (e) => save({ ui: { ...ui, drawer: e.target.checked } }) }),
        ),
        ui.drawer !== false ? h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '速度'),
          h('input', { type: 'range', min: 200, max: 800, step: 20, value: String(ui.drawerMs || 380), style: { flex: 2 }, onChange: (e) => save({ ui: { ...ui, drawerMs: Number(e.target.value) } }) }),
        ) : null,
        h('div', { className: 'prtsItemDesc', style: { marginTop: 6 } }, '侧边栏与聊天、输入框、背景不在同一图层 —— 收放像拉抽屉一样，不影响其他任何部件；将来新加入的侧栏类插件也能直接套用这套动效。'),
      ),
      h(Group, { title: '律动' },
        h('div', { className: 'prtsRow' },
          h('button', {
            className: 'prtsBtn' + (ui.beat ? ' on' : ''), onClick: async () => {
              if (ui.beat) { stopBeat(); await save({ ui: { ...ui, beat: false } }); return }
              const ok = await startBeat()
              if (ok) await save({ ui: { ...ui, beat: true } })
              else alert('无法捕获系统声音 —— 请在弹窗中选择「整个屏幕」并勾选系统音频。')
            }
          }, ui.beat ? '关闭律动' : '开启系统声音律动'),
          h('span', { className: 'prtsItemDesc' }, '背景菱形与方块随电脑正在播放的声音振动'),
        ),
      ),
    )
  }

  /* ---------- PRTS settings section (wallpaper / theme / sound / updates) ---------- */
  const THEME_PRESETS = [
    ['tokyonight', 'Tokyo Night', '#7aa2f7'],
    ['nord', 'Nord', '#88c0d0'],
    ['dracula', 'Dracula', '#bd93f9'],
    ['rose-pine', 'Rosé Pine', '#ebbcba'],
    ['catppuccin', 'Catppuccin', '#89b4fa'],
    ['gruvbox', 'Gruvbox', '#83a598'],
  ]
  const ACCENT_PRESETS = [
    { id: 'tokyonight', name: 'Tokyo Night', primary: '#7aa2f7', diamond: '#7dcfff', square: '#bb9af7' },
    { id: 'tokyonight-storm', name: 'Tokyo Night Storm', primary: '#7aa2f7', diamond: '#2ac3de', square: '#bb9af7' },
    { id: 'nord', name: 'Nord', primary: '#88c0d0', diamond: '#8fbcbb', square: '#b48ead' },
    { id: 'dracula', name: 'Dracula', primary: '#bd93f9', diamond: '#8be9fd', square: '#ff79c6' },
    { id: 'rose-pine', name: 'Rosé Pine', primary: '#ebbcba', diamond: '#9ccfd8', square: '#c4a7e7' },
    { id: 'catppuccin', name: 'Catppuccin', primary: '#89b4fa', diamond: '#89dceb', square: '#cba6f7' },
    { id: 'gruvbox', name: 'Gruvbox', primary: '#83a598', diamond: '#8ec07c', square: '#d3869b' },
    { id: 'mono', name: 'PRTS Mono', primary: '', diamond: '', square: '' },
  ]
  const SIDEBAR_BUTTON_IDS = ['themeBtn', 'webBtn', 'gitBtn', 'skillBtn', 'marketBtn', 'detailsBtn']
  const SIDEBAR_BUTTON_NAMES = { themeBtn: '主题', webBtn: '网页', gitBtn: 'Git', skillBtn: 'SKILL', marketBtn: '插件市场', detailsBtn: '详情' }
  function PrtsSettings() {
    const [cfg, setCfg] = useState({ ui: {} })
    const [editors, setEditors] = useState(null)
    const [name, setName] = useState('')
    useEffect(() => {
      getConfig().then((c) => {
        setCfg(c || { ui: {} })
        const p = (c && c.persona && c.persona.userName) || ''
        setName(p)
      })
      api('GET', '/prts/api/detect-editors').then((list) => {
        setEditors(Array.isArray(list) && list.length ? list : null)
      }).catch(() => setEditors(null))
    }, [])
    const save = async (patch) => {
      const next = { ...cfg, ...patch, ui: { ...(cfg.ui || {}), ...((patch && patch.ui) || {}) } }
      setCfg(next)
      await setConfig(next)
      await applySkin(next)
    }
    const applyAccent = async (a) => {
      const next = { ...cfg, ui: { ...ui, accent: a } }
      setCfg(next)
      await setConfig(next)
      await applySkin(next)
      const g = (typeof window !== 'undefined' && window.PRTS) || null
      if (g && g.app) {
        if (g.app.applyTheme) g.app.applyTheme((next.ui && next.ui.theme) || 'dark')
        if (g.app.applyAccent) g.app.applyAccent(next)
      }
    }
    const ui = cfg.ui || {}
    const w = ui.wallpaper || {}
    const preset = ui.theme || ''

    /* ---- wallpaper engine (detect / list / pick) ---- */
    const [weState, setWeState] = useState(null)
    const detectWe = async () => {
      setWeState({ busy: true })
      try {
        const r = await api('POST', '/prts/api/http', { method: 'GET', url: 'http://127.0.0.1:35585/v2/wallpapers' })
        let j = null
        try { j = JSON.parse((r && r.text) || '') } catch (e) { /* shape unknown */ }
        const list = (j && (j.wallpapers || j.items || (Array.isArray(j) ? j : null))) || []
        setWeState({ busy: false, list: list.map((it) => ({ id: it.id, title: it.title || it.name || String(it.id) })) })
      } catch (e) { setWeState({ busy: false, error: String((e && e.message) || e) }) }
    }
    const uploadWall = (file) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const m = /^data:([^;]+);base64,(.*)$/.exec(String(reader.result || ''))
        if (!m) return
        const mime = m[1]
        const ext = mime.indexOf('video') === 0 ? 'mp4' : (mime === 'image/png' ? 'png' : 'jpg')
        const name = 'wall-' + Date.now().toString(36) + '.' + ext
        await api('POST', '/prts/api/wallpaper', { file: name, mime, base64: m[2] })
        await save({ ui: { ...ui, wallpaper: { ...w, file: name, url: '', type: mime.indexOf('video') === 0 ? 'video' : 'image', mime, fit: w.fit || 'cover', opacity: w.opacity !== undefined ? w.opacity : 1 } } })
      }
      reader.readAsDataURL(file)
    }

    return h('div', { className: 'prtsBody' },
      /* ================= surface ================= */
      h(Group, { title: '界面' },
        h('div', { className: 'prtsRow' },
          h('select', {
            className: 'prtsInput', style: { flex: 2 }, value: (ui.shell || 'prts') === 'dsh-web' ? 'dsh-web' : 'prts',
            onChange: async (e) => {
              await setConfig({ ui: { ...ui, shell: e.target.value } })
              window.location.reload()
            },
          },
            h('option', { value: 'prts' }, 'PRTS 经典界面'),
            h('option', { value: 'dsh-web' }, 'dsh-web 原生界面（皮肤模式）'),
          ),
        ),
        h('div', { className: 'prtsItemDesc', style: { marginTop: 6 } }, '经典界面完全沿用旧版 PRTS；切换后自动重载。'),
      ),

      /* ================= wallpaper ================= */
      h(Group, { title: '壁纸', sub: w.file || w.url ? '已设置' : '未设置' },
        h('div', { className: 'prtsRow' },
            h('label', { className: 'prtsBtn', style: { cursor: 'pointer' } },
              '上传图片 / 视频',
              h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) uploadWall(f) } }),
            ),
            h('button', { className: 'prtsBtn', disabled: !!(weState && weState.busy), onClick: detectWe }, weState && weState.busy ? '检测中…' : '连接 Wallpaper Engine'),
            (w.file || w.url) ? h('button', { className: 'prtsBtn', onClick: async () => { await api('DELETE', '/prts/api/wallpaper').catch(() => { }); await save({ ui: { ...ui, wallpaper: { ...w, file: '', url: '' } } }) } }, '清除') : null,
          ),
          weState && weState.error ? h('div', { className: 'prtsItemDesc', style: { marginTop: 6 } }, '未检测到 Wallpaper Engine（需在其设置中开启 HTTP API）') : null,
          weState && weState.list && weState.list.length ? h('div', { className: 'prtsRow' },
            h('select', {
              className: 'prtsInput', style: { flex: 2 }, defaultValue: '', onChange: (e) => {
                const id = e.target.value
                if (id) save({ ui: { ...ui, wallpaper: { ...w, url: 'http://127.0.0.1:35585/v2/stream/' + encodeURIComponent(id), fit: w.fit || 'cover', type: 'video' } } })
              }
            },
              h('option', { value: '' }, '选择一张 Wallpaper Engine 壁纸'),
              weState.list.map((it) => h('option', { key: it.id, value: it.id }, it.title)),
            ),
          ) : null,
          (w.file || w.url) ? h('div', {},
            h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '填充方式'),
              h('select', { className: 'prtsInput', value: w.fit || 'cover', onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, fit: e.target.value } } }) },
                h('option', { value: 'cover' }, '覆盖'), h('option', { value: 'fill' }, '填充'), h('option', { value: 'free' }, '自由'), h('option', { value: 'contain' }, '居中')),
            ),
            h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '透明度'),
              h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: String(w.opacity !== undefined ? w.opacity : 1), style: { flex: 2 }, onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, opacity: Number(e.target.value) } } }) }),
            ),
          ) : null,
          h('div', { className: 'prtsRow' },
            h('span', { className: 'prtsLabel' }, '背景模糊'),
            h('input', { type: 'checkbox', checked: ui.glass !== false, onChange: (e) => save({ ui: { ...ui, glass: e.target.checked } }) }),
          ),
          ui.glass !== false ? h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '模糊程度'),
            h('input', { type: 'range', min: 0, max: 24, step: 1, value: String(ui.blur !== undefined ? ui.blur : 12), style: { flex: 2 }, onChange: (e) => save({ ui: { ...ui, blur: Number(e.target.value) } }) }),
          ) : null,
      ),

      /* ================= theme (presets only) ================= */
      h(Group, { title: '主题' },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          h('button', { key: 'default', className: 'prtsChip' + (!preset ? ' on' : ''), onClick: () => save({ ui: { ...ui, theme: '' } }) }, '系统默认'),
          THEME_PRESETS.map(([id, name]) => h('button', { key: id, className: 'prtsChip' + (preset === id ? ' on' : ''), onClick: () => save({ ui: { ...ui, theme: id } }) }, name)),
        ),
        h('div', { className: 'prtsItemDesc', style: { marginTop: 8 } }, '预设只着色文字、按钮、描边与背景色调；与通用设置里的白天 / 黑夜 / 跟随系统互不冲突，切换后预设自动适配明暗。'),
      ),

      /* ================= sound beat ================= */
      h(Group, { title: '声音律动' },
        h('div', { className: 'prtsRow' },
          h('button', {
            className: 'prtsBtn' + (ui.beat ? ' on' : ''), onClick: async () => {
              if (ui.beat) { stopBeat(); await save({ ui: { ...ui, beat: false } }); return }
              const ok = await startBeat()
              if (ok) await save({ ui: { ...ui, beat: true } })
              else alert('无法捕获系统声音 —— 请在弹窗中选择「整个屏幕」并勾选系统音频。')
            }
          }, ui.beat ? '关闭律动' : '开启系统声音律动'),
          h('span', { className: 'prtsItemDesc' }, '背景菱形与方块随电脑正在播放的声音振动'),
        ),
      ),

      /* ================= accent (presets + custom pickers) ================= */
      h(Group, { title: '外观' },
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            ACCENT_PRESETS.map((pr) => h('button', {
              key: pr.id, className: 'prtsChip' + ((ui.accent && (ui.accent.preset || 'tokyonight') === pr.id) ? ' on' : ''),
              onClick: () => applyAccent({ preset: pr.id, primary: pr.primary, diamond: pr.diamond, square: pr.square }),
            }, pr.name)),
          ),
          h('div', { className: 'prtsRow', style: { marginTop: 8 } },
            [['primary', '主色'], ['diamond', '菱形'], ['square', '方块']].map(([k, label]) =>
              h('label', { key: k, className: 'prtsLabel', style: { display: 'flex', alignItems: 'center', gap: 4 } },
                label,
                h('input', {
                  type: 'color',
                  style: { width: 30, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' },
                  value: (ui.accent && ui.accent[k]) || (k === 'primary' ? '#7aa2f7' : k === 'diamond' ? '#7dcfff' : '#bb9af7'),
                  onChange: (e) => applyAccent({ ...(ui.accent || {}), preset: 'custom', [k]: e.target.value }),
                }),
              ),
            ),
          ),
      ),

      /* ================= default text editor ================= */
      h(Group, { title: '默认文本编辑器' },
        h('div', { className: 'prtsRow' },
          h('select', {
            className: 'prtsInput', style: { flex: 2 }, value: ui.editor || '',
            onChange: (e) => save({ ui: { ...ui, editor: e.target.value } }),
          },
            h('option', { value: '' }, '系统默认'),
            (editors || []).map((ed) => h('option', { key: ed.id, value: ed.id }, ed.name || ed.id)),
          ),
        ),
      ),

      /* ================= doctor name (persona) ================= */
      h(Group, { title: '配置名称' },
        h('div', { className: 'prtsRow' },
          h('input', { className: 'prtsInput', style: { flex: 2 }, value: name, placeholder: '默认', onChange: (e) => setName(e.target.value) }),
          h('button', {
            className: 'prtsBtn', onClick: async () => {
              const next = { ...cfg, persona: { ...(cfg.persona || {}), userName: name.trim() } }
              setCfg(next)
              await setConfig(next)
              const g = (typeof window !== 'undefined' && window.PRTS) || null
              if (g && g.app && g.app.toast) g.app.toast('已保存')
            },
          }, '保存'),
        ),
      ),

      /* ================= updates ================= */
      h('div', { className: 'prtsGroup' },
        h(UpdateRow, {}),
      ),
    )
  }
  /* ---------- stable-channel updates ---------- */
  function UpdateRow() {
    const [info, setInfo] = useState(null)   // { current, latest, update, channel }
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState('')
    const refresh = useCallback(async () => {
      try { setInfo(await api('GET', '/prts/api/update-check')) } catch (e) { setInfo({ current: '?', latest: '?', update: false }) }
    }, [])
    useEffect(() => { refresh() }, [refresh])
    const doUpdate = async () => {
      setBusy(true); setMsg('更新中…')
      try {
        const r = await api('POST', '/prts/api/update')
        if (r && r.ok && r.updated) { setMsg('已更新到 v' + r.version + ' — 重启 PRTS 生效'); setInfo({ ...info, current: r.version, update: false }) }
        else if (r && r.ok && !r.updated) setMsg('已是最新版本')
        else setMsg((r && r.error) || '更新失败')
      } catch (e) { setMsg(String((e && e.message) || e)) }
      setBusy(false)
    }
    const has = !!(info && info.update)
    return h('div', {},
      h('div', { className: 'prtsTitle', style: { margin: '14px 0 6px' } }, '更新'),
      h('div', { className: 'prtsRow' },
        h('span', { className: 'prtsLabel' },
          info === null ? '检查中…'
            : has ? '发现稳定版 v' + info.latest + '（当前 v' + info.current + '）'
              : '已是最新稳定版 v' + (info.current || '?')),
        has ? h('button', { className: 'prtsBtn primary', disabled: busy, onClick: doUpdate }, busy ? '更新中…' : '立即更新') : null,
        !has && info !== null ? h('button', { className: 'prtsBtn', disabled: busy, onClick: () => { setInfo(null); refresh() } }, '检查更新') : null,
      ),
      msg ? h('div', { className: 'prtsItemDesc', style: { marginTop: 4 } }, msg) : null,
      h('div', { className: 'prtsItemDesc', style: { marginTop: 2 } }, '仅跟随稳定版发布（网站下载同源）；git 现行版不会推送。'),
    )
  }

  /* ---------- balance panel ---------- */
  function BalancePanel() {
    const [cfg, setCfg] = useState({ deepseek: {} })
    const [bal, setBal] = useState(null)
    const [key, setKey] = useState('')
    const [err, setErr] = useState('')
    const [logging, setLogging] = useState(false)
    useEffect(() => { getConfig().then((c) => setCfg(c || { deepseek: {} })) }, [])
    const ds = cfg.deepseek || {}
    const refresh = useCallback(async () => {
      if (!ds.apiKey) { setBal(null); return }
      try {
        const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.deepseek.com/user/balance', headers: { Authorization: 'Bearer ' + ds.apiKey } })
        const d = JSON.parse((res && res.text) || '{}')
        const infos = d.balance_infos || []
        const cny = infos.find((i) => i.currency === 'CNY') || infos[0]
        setBal(cny ? Number(cny.total_balance || 0) : null)
        setErr('')
      } catch (e) { setErr(String(e && e.message || e)) }
    }, [ds.apiKey])
    useEffect(() => { refresh() }, [refresh])
    const saveDs = async (patch) => {
      const next = { ...cfg, deepseek: { ...ds, ...patch } }
      setCfg(next)
      await setConfig(next)
      refresh()
    }
    const loginDeepseek = async () => {
      setLogging(true)
      try {
        const bridge = window.prts && window.prts.bridge
        // Exactly ONE window: the native Electron login window when the
        // bridge exists, or a single browser tab otherwise — never both.
        if (bridge && typeof bridge.loginDeepseek === 'function') {
          const r = await bridge.loginDeepseek()
          if (r && r.apiKey) { await saveDs({ apiKey: r.apiKey, loggedIn: true }); setLogging(false); return }
          setLogging(false)
          return
        }
        window.open('https://platform.deepseek.com/sign_in', '_blank')
      } catch (e) { /* manual input stays available */ }
      setLogging(false)
    }
    return h('div', {},
      bal !== null ? h('div', { className: 'prtsItemName', style: { fontSize: 24, fontFamily: 'monospace' } }, '¥ ' + bal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })) : h('div', { className: 'prtsItemDesc' }, ds.apiKey ? (err || '读取中…') : '登录 DeepSeek 开发者账号后显示人民币余额'),
      !ds.apiKey ? h('div', { className: 'prtsRow' },
        h('button', { className: 'prtsBtn primary', disabled: logging, onClick: loginDeepseek }, logging ? '等待网页登录…' : '登录 DeepSeek 开发者账号'),
      ) : null,
      h('div', { className: 'prtsRow' },
        h('input', { className: 'prtsInput', style: { flex: 2 }, type: 'password', value: key, placeholder: 'DeepSeek API Key (sk-…)', onChange: (e) => setKey(e.target.value) }),
        h('button', {
          className: 'prtsBtn primary', onClick: async () => {
            const k = key.trim()
            if (!k) return
            const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.deepseek.com/user/balance', headers: { Authorization: 'Bearer ' + k } })
            if (res && res.status === 200) { await saveDs({ apiKey: k, loggedIn: true }); setKey('') }
            else alert('API Key 无效')
          }
        }, '保存'),
      ),
      h('div', { className: 'prtsRow' },
        h('button', { className: 'prtsBtn', onClick: () => window.open('https://platform.deepseek.com/top_up', '_blank') }, '充值'),
        h('button', { className: 'prtsBtn', onClick: () => window.open('https://platform.deepseek.com/api_keys', '_blank') }, 'API Keys'),
        h('button', { className: 'prtsBtn', onClick: () => saveDs({ apiKey: '', loggedIn: false }) }, '登出'),
      ),
    )
  }

  /* ---------- first-run API-key onboarding ---------- */
  function Onboarding({ onDone }) {
    const [cfg, setCfg] = useState(null)
    const [key, setKey] = useState('')
    const [busy, setBusy] = useState(false)
    useEffect(() => { getConfig().then((c) => setCfg(c || {})) }, [])
    const finish = async (cfg2) => {
      await setConfig({ ...cfg2, ui: { ...(cfg2 && cfg2.ui), onboardedApiKey: true } })
      if (onDone) onDone()
    }
    if (cfg === null) return null
    const createAccount = async () => {
      setBusy(true)
      try {
        const bridge = window.prts && window.prts.bridge
        // Exactly ONE window: native Electron login when the bridge exists,
        // otherwise a single browser tab — never both at once.
        if (bridge && typeof bridge.loginDeepseek === 'function') {
          const r = await bridge.loginDeepseek()
          if (r && r.apiKey) {
            await setConfig({ ...cfg, deepseek: { ...(cfg.deepseek || {}), apiKey: r.apiKey, loggedIn: true } })
            await finish(cfg)
            setBusy(false)
            return
          }
          setBusy(false)
          return
        }
        window.open('https://platform.deepseek.com/sign_in', '_blank')
        await finish(cfg)
      } catch (e) { /* manual path */ }
      setBusy(false)
    }
    const saveKey = async () => {
      const k = key.trim()
      if (!k) return
      setBusy(true)
      try {
        const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.deepseek.com/user/balance', headers: { Authorization: 'Bearer ' + k } })
        if (res && res.status === 200) {
          await setConfig({ ...cfg, deepseek: { ...(cfg.deepseek || {}), apiKey: k, loggedIn: true } })
          await finish(cfg)
        } else alert('API Key 无效')
      } catch (e) { alert(String((e && e.message) || e)) }
      setBusy(false)
    }
    return h('div', { className: 'prtsOnboard' },
      h('div', { className: 'prtsOnboardCard' },
        h('div', { className: 'prtsOnboardTitle' }, '欢迎，博士'),
        h('div', { className: 'prtsOnboardBody' }, '在使用 PRTS 之前 —— 请问你有 DeepSeek API Key 吗？'),
        h('div', { className: 'prtsRow' },
          h('input', { className: 'prtsInput', style: { flex: 2 }, type: 'password', value: key, placeholder: '有 —— 粘贴 API Key (sk-…)', onChange: (e) => setKey(e.target.value) }),
          h('button', { className: 'prtsBtn primary', disabled: busy || !key.trim(), onClick: saveKey }, '保存'),
        ),
        h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 } },
          h('button', { className: 'prtsBtn', disabled: busy, onClick: createAccount }, busy ? '等待网页登录…' : '没有 —— 去 DeepSeek 官网创建'),
          h('button', { className: 'prtsBtn', disabled: busy, onClick: () => finish(cfg) }, '稍后'),
        ),
      ),
    )
  }

  /* ---------- registrations ---------- */
  // The slot registrations need the client slot registry; both surfaces
  // register the PRTS sections into settings.section so dsh-web's own
  // settings panel (the shared settings UI) shows them.
  const registerSettingsSections = () => {
    if (slots === undefined) return
    // PRTS settings section (wallpaper / theme / sound / updates)
    slots.inject('settings.section', () => {
      return slots.register({ name: 'settings.section', id: 'prts', order: 90, label: 'PRTS' }, (props) => {
        return h('div', { className: 'prtsBody', style: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } },
          h(PrtsSettings, {}),
        )
      })
    })
    // 动效 — the motion plugin's own settings page (drawer / spring / beat)
    slots.inject('settings.section', () => {
      return slots.register({ name: 'settings.section', id: 'prts-motion', order: 92, label: '动效' }, (props) => {
        return h('div', { className: 'prtsBody', style: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } },
          h(MotionSettings, {}),
        )
      })
    })
    // Balance is its own settings page (a "plugin" section) — 余额
    slots.inject('settings.section', () => {
      return slots.register({ name: 'settings.section', id: 'prts-balance', order: 91, label: '余额' }, (props) => {
        return h('div', { className: 'prtsBody', style: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } },
          h(BalancePanel, {}),
        )
      })
    })
  }

  /** Hover popup above a settings button: the pages the settings panel
   *  actually has (通用设置/模型/插件/Agent预设/插件市场/PRTS/余额/动效 +
   *  whatever later plugins add) pop UP in a vertical stack aligned with the
   *  button. Fixed overlay — it never shifts the layout.
   *  @param anchor - explicit trigger element (PRTS footer button in shell
   *  mode); when omitted the native dsh-web settings trigger is auto-found
   *  (skin mode). */
  function settingsHoverPopup(anchor) {
    let pop = null
    const findTrigger = () => {
      if (anchor && anchor.isConnected) return anchor
      const own = document.querySelector('.VOzbGW_trigger')
      if (own) return own
      const btns = [...document.querySelectorAll('button')]
      return btns.find((b) => /trigger/i.test(String(b.className || ''))) || null
    }
    // every settings page dsh-web offers — its own plus every plugin-added
    // section (PRTS 动效/余额 included): the nav cells ARE the source of
    // truth, so the popup auto-imports all of them.
    const sectionRows = () => {
      const rows = []
      const seen = new Set()
      const push = (id, label) => { if (!seen.has(label)) { seen.add(label); rows.push({ id, label }) } }
      for (const cell of [...document.querySelectorAll('.VOzbGW_navCell')]) {
        const label = ((cell.querySelector('.VOzbGW_navLabel') || cell).textContent || '').trim()
        if (label) push(label, label)
      }
      if (!rows.length) {
        push('general', '通用设置'); push('models', '模型'); push('plugins', '插件'); push('agent-presets', 'Agent 预设'); push('dshmarket', '插件市场'); push('prts', 'PRTS'); push('prts-motion', '动效'); push('prts-balance', '余额')
      }
      return rows
    }
    // open the settings panel (if closed) and jump to the chosen section
    const jumpToSection = (label) => {
      const trig = document.querySelector('.VOzbGW_trigger')
      const panel = document.querySelector('.VOzbGW_panel')
      const panelOpen = () => !!panel && getComputedStyle(panel).display !== 'none' && panel.getBoundingClientRect().width > 0
      const clickCell = () => {
        const cells = [...document.querySelectorAll('.VOzbGW_navCell')]
        const cell = cells.find((c) => ((c.querySelector('.VOzbGW_navLabel') || c).textContent || '').trim() === label) || cells[0]
        if (cell) cell.click()
      }
      if (panelOpen()) clickCell()
      else { if (trig) trig.click(); setTimeout(clickCell, 320) }
    }
    // icon per settings section — custom minimal glyphs, no labels
    const sectionIcon = (id) => {
      const ic = (inner) => '<svg width="15" height="15" viewBox="0 0 15 15" fill="none">' + inner + '</svg>'
      if (id === 'general') return ic('<path d="M2 4.5h11M2 7.5h11M2 10.5h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="7.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="10.5" r="1.5" fill="currentColor" stroke="none"/>')
      if (id === 'models') return ic('<path d="M7.5 2 13 5l-5.5 3L2 5l5.5-3Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M2 8.2 7.5 11l5.5-2.8M2 11l5.5 2.8L13 11" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>')
      if (id === 'plugins' || /plugin/.test(id)) return ic('<path d="M6.2 8.8 8.8 6.2a2 2 0 0 0 2.9-2.7l-1.6 1.6-2.1-.3-.3-2.1 1.6-1.6A2 2 0 0 0 6.2 4L3.6 6.6a1 1 0 0 1-1.3.2L2 7l1.2 1.2 1.6-1.6a1 1 0 0 1 1.4 0l1 1 .9.9Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>')
      if (id === 'agent-presets') return ic('<rect x="4" y="6.5" width="7" height="5" rx="1.6" stroke="currentColor" stroke-width="1.1"/><path d="M7.5 6.5V4.6M5.6 4.6h3.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><circle cx="6.1" cy="9" r=".7" fill="currentColor"/><circle cx="8.9" cy="9" r=".7" fill="currentColor"/>')
      if (id === 'prts') return ic('<path d="M7.5 1.8 13.2 7.5 7.5 13.2 1.8 7.5Z" stroke="currentColor" stroke-width="1.2"/><rect x="5.9" y="5.9" width="3.2" height="3.2" fill="currentColor"/>')
      if (id === 'prts-motion') return ic('<path d="M2 8.5c2-4 4.5-4 6.5 0s4.5 4 6.5 0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" fill="none"/>')
      if (id === 'prts-balance') return ic('<circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M7.5 4.2v6.6M5.4 6h4.2M5.4 9h4.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>')
      return ic('<rect x="2.5" y="2.5" width="10" height="10" rx="1.8" stroke="currentColor" stroke-width="1.1"/><path d="M7.5 2.5v3l3-3" stroke="currentColor" stroke-width="1.1" fill="none"/>')
    }
    const show = () => {
      const trig = findTrigger()
      if (!trig) return
      if (pop) return
      const r = trig.getBoundingClientRect()
      const ic = trig.querySelector('svg')
      const icx = ic ? ic.getBoundingClientRect().left + ic.getBoundingClientRect().width / 2 : r.left + r.width / 2
      pop = document.createElement('div')
      pop.className = 'prtsHoverPop'
      pop.style.position = 'fixed'
      pop.style.left = Math.max(4, Math.round(icx - 17.5)) + 'px'
      pop.style.top = (r.top - 6) + 'px'
      pop.style.transform = 'translateY(-100%)'
      const rows = sectionRows()
      for (const sec of rows) {
        const b = document.createElement('button')
        b.type = 'button'
        b.title = sec.label
        b.innerHTML = sectionIcon(sec.id) + '<span>' + sec.label + '</span>'
        b.addEventListener('click', () => { hide(); jumpToSection(sec.label, sec.id) })
        pop.appendChild(b)
      }
      if (!rows.length) { pop.remove(); pop = null; return }
      document.body.appendChild(pop)
      const onKey = (e) => { if (e.key === 'Escape') { hide(); document.removeEventListener('keydown', onKey) } }
      document.addEventListener('keydown', onKey)
      pop.addEventListener('mouseenter', show)
      pop.addEventListener('mouseleave', hide)
    }
    const hide = () => { if (pop) { pop.remove(); pop = null } }
    document.addEventListener('mousemove', (e) => {
      const trig = findTrigger()
      if (!trig) { hide(); return }
      const r = trig.getBoundingClientRect()
      const pad = 24
      const inTrig = e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad
      if (inTrig) { show(); return }
      // Once open, the popup hides ONLY when the cursor leaves the small
      // buttons themselves (a tiny margin covers the gap to the trigger so
      // travelling from the button up into the popup never flickers) — NOT
      // when it leaves the settings button's range.
      if (pop) {
        const pr = pop.getBoundingClientRect()
        const m = 12
        const inPop = e.clientX >= pr.left - m && e.clientX <= pr.right + m && e.clientY >= pr.top - m && e.clientY <= pr.bottom + m
        if (!inPop) hide()
      }
    })
    // re-bind direct hover as dsh-web re-renders replace the trigger
    setInterval(() => {
      const trig = findTrigger()
      if (!trig || trig.dataset.prtsHover) return
      trig.dataset.prtsHover = '1'
      trig.addEventListener('mouseenter', show)
      trig.addEventListener('mouseleave', hide)
    }, 1500)
  }

  // onboarding (first run, any port)  // onboarding (first run) — only AFTER the intro has fully played out and
  // the app has formally entered; never during the animation.
  let onboardingShown = false
  function showOnboarding() {
    getConfig().then(async (cfg) => {
      if (onboardingShown) return
      onboardingShown = true
      const ui = (cfg && cfg.ui) || {}
      if (ui.onboardedApiKey) return
      // check whether a key is already configured (PRTS copy)
      const ds = cfg && cfg.deepseek
      if (ds && ds.apiKey) {
        await setConfig({ ...cfg, ui: { ...ui, onboardedApiKey: true } })
        return
      }
      // render the onboarding overlay once
      const mount = document.createElement('div')
      mount.id = 'prts-onboard-mount'
      document.body.appendChild(mount)
      const root = createRoot ? createRoot(mount) : null
      const finish = async () => {
        if (root && root.unmount) root.unmount()
        mount.remove()
      }
      const el = h(Onboarding, { onDone: finish })
      if (root && root.render) root.render(el)
    }).catch(() => { })
  }

  /* ============================================================
     PRTS skin layer — everything visual that makes dsh-web look
     like PRTS: brand swap (no whale), hero, particle intro,
     composer expand button, background diamond/square, voice,
     PRTS-styled controls and the sidebar widget dock.
     ============================================================ */

  const SKIN_CSS = `
  /* PRTS-styled controls on dsh-web — every plugin button lands here */
  button, [role='button'], [class*='btn'], [class*='button'], [class*='Button'] {
    border-radius: 8px !important;
    border-color: var(--dsw-alias-border-l2) !important;
  }
  button:hover, [role='button']:hover { filter: brightness(1.12); }
  textarea { border-radius: 10px !important; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: var(--dsw-alias-border-l2); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-label-secondary); }
  /* PRTS brand (no whale) */
  .prtsBrand { display: inline-flex; align-items: center; gap: 8px; font-style: italic; letter-spacing: 0.22em; font-weight: 600; font-size: 15px; color: var(--dsw-alias-label-primary); }
  .prtsBrand .rhombus { width: 13px; height: 13px; border: 1.5px solid var(--prts-diamond, var(--dsw-alias-brand-primary)); transform: rotate(45deg); }
  .prtsBrand .rhombus::after { content: ''; position: absolute; inset: 3px; background: var(--prts-diamond, var(--dsw-alias-brand-primary)); }
  /* hero: sits exactly at the centre of the permanent background square */
  .prtsHero { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--prts-ink, #FAFAFA); pointer-events: none; }
  .prtsHero .row { display: flex; align-items: center; gap: 14px; }
  .prtsHeroMark { position: relative; display: inline-block; width: 64px; height: 64px; border: 1.5px solid var(--prts-ink, #FAFAFA); transform: rotate(45deg); }
  .prtsHeroMark .sq { position: absolute; inset: 30%; background: var(--prts-ink, #FAFAFA); transform: rotate(-45deg); }
  .prtsHero .word { font-style: italic; font-weight: 600; letter-spacing: 0.3em; font-size: 40px; }
  .prtsHero .tag { font-size: 14px; letter-spacing: 0.2em; color: var(--dsw-alias-label-secondary); }
  /* background diamond & square — between the wallpaper blur and the text */
  .prtsBgMarks { position: fixed; left: 50%; top: 50%; z-index: 1; pointer-events: none; }
  .prtsBgMarks .d { position: absolute; width: 460px; height: 460px; border: 1px solid var(--prts-ink, #FAFAFA); transform: translate(-50%, -50%) rotate(45deg); opacity: 0.16; background: color-mix(in srgb, var(--prts-ink, #FAFAFA) 5%, transparent); }
  .prtsBgMarks .s { position: absolute; width: 216px; height: 216px; border: 1px solid var(--prts-ink, #FAFAFA); transform: translate(-50%, -50%); opacity: 0.14; background: color-mix(in srgb, var(--prts-ink, #FAFAFA) 5%, transparent); }
  .prtsBgMarks.vib .d { animation: prtsVib 0.16s linear infinite; }
  .prtsBgMarks.vib .s { animation: prtsVibS 0.16s linear infinite; }
  @keyframes prtsVib { 0% { transform: translate(-50%,-50%) rotate(45deg) scale(1); } 50% { transform: translate(-50%,-50%) rotate(45deg) scale(1.05); } }
  @keyframes prtsVibS { 0% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-50%,-50%) scale(1.07); } }
  /* audio-beat mode (system sound): JS drives --prts-beat, CSS applies it */
  .prtsBgMarks.beat .d { transform: translate(-50%,-50%) rotate(45deg) scale(calc(1 + var(--prts-beat, 0) * 0.12)); }
  .prtsBgMarks.beat .s { transform: translate(-50%,-50%) scale(calc(1 + var(--prts-beat, 0) * 0.16)); }
  #prtsBrandRow.beat .prtsBrandMark { transform: rotate(45deg) scale(calc(1 + var(--prts-beat, 0) * 0.22)); }
  /* composer expand handle: notched arrow + pulsing dots, drag-to-expand */
  .prtsExpand { position: absolute; right: 12px; top: -30px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 3px 2px 2px; border: none; background: transparent; color: var(--prts-accent, var(--dsw-alias-brand-primary)); cursor: ns-resize; z-index: 40; touch-action: none; }
  .prtsExpand svg.arrow { display: block; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--prts-accent, var(--dsw-alias-brand-primary)) 60%, transparent)); animation: prtsArrowGlow 2.4s ease-in-out infinite; }
  @keyframes prtsArrowGlow { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
  .prtsExpand .dots { display: flex; gap: 3px; }
  .prtsExpand .dots i { width: 2.5px; height: 2.5px; border-radius: 50%; background: var(--prts-accent, var(--dsw-alias-brand-primary)); animation: prtsDot 1.6s ease-in-out infinite; }
  .prtsExpand .dots i:nth-child(2) { animation-delay: .2s; }
  .prtsExpand .dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes prtsDot { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(1.5px); } }
  /* particle intro */
  .prtsIntro { position: fixed; inset: 0; z-index: 1000; background: var(--dsw-alias-bg-base); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: opacity 0.6s ease; }
  .prtsIntro.done { opacity: 0; pointer-events: none; }
  .prtsIntro canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .prtsIntro .txt { position: relative; z-index: 2; color: var(--dsw-alias-label-primary); font-style: italic; letter-spacing: 0.24em; font-size: 30px; opacity: 0; transition: opacity 0.5s ease; }
  .prtsIntro .txt.show { opacity: 1; }
  /* quick settings popup (pops UP above the sidebar settings button) */
  .prtsQuickWrap { position: relative; }
  .prtsQuick { position: absolute; bottom: calc(100% + 10px); right: 0; min-width: 176px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 92%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 10px 34px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 3px; z-index: 60; }
  .prtsQuick button { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; text-align: left; }
  .prtsQuick button:hover { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
  .prtsQuick .sep { height: 1px; background: var(--dsw-alias-border-l1); margin: 3px 4px; }
  /* custom window bar: full black, three circles, ALWAYS visible (browser-like);
   * the app frame is shifted down so the bar never covers the logo/buttons */
  .prtsTitlebar { position: fixed; top: 0; left: 0; right: 0; height: 34px; z-index: 5000; display: flex; align-items: center; justify-content: flex-end; padding: 0 10px; background: #0A0A0B; border-bottom: 1px solid var(--dsw-alias-border-l1); -webkit-app-region: drag; }
  .prtsTitlebar .winBtn { -webkit-app-region: no-drag; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; line-height: 1; cursor: pointer; margin-left: 8px; padding: 0; }
  .prtsTitlebar .winBtn:hover { background: var(--dsw-alias-bg-layer-2); box-shadow: 0 0 10px rgba(250,250,250,.15); }
  .prtsTitlebar .winBtn.close:hover { background: #f7768e; color: #0A0A0B; border-color: transparent; }
  /* PRTS settings groups (dsh-settings-like cards) */
  .prtsGroup { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; margin: 10px 0; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
  .prtsGroupHead { width: 100%; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border: none; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
  .prtsGroupHead:hover { background: var(--dsw-alias-bg-layer-2); }
  .prtsGroupChev { font-size: 10px; color: var(--dsw-alias-label-secondary); flex: none; transition: transform .28s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)); }
  .prtsGroup.open .prtsGroupChev { transform: rotate(180deg); }
  .prtsGroupTitle { font-size: 13px; font-weight: 600; letter-spacing: .04em; }
  .prtsGroupSub { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
  /* the body always stays mounted — max-height animation slides the content
     out/in so everything below the group moves in sync */
  .prtsGroupBody { max-height: 0; opacity: 0; overflow: hidden; padding: 0 16px; transition: max-height .32s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)), padding .32s var(--prts-ease-out, cubic-bezier(.2,.8,.25,1)), opacity .26s ease; }
  .prtsGroup.open .prtsGroupBody { max-height: 1000px; opacity: 1; padding: 2px 16px 14px; }
  /* hover popup above the settings button: dsh-web style card — panel
   * background, border, radius, shadow, blur — icon+label rows that expand
   * upward (prtsPopUp slides the whole card up on open). */
  .prtsHoverPop {
    display: flex; flex-direction: column; gap: 2px; padding: 6px;
    background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent);
    border: 1px solid var(--dsw-alias-border-l1);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    min-width: 148px;
    animation: prtsPopUp .18s var(--prts-ease-out, ease-out);
    transform-origin: bottom center;
  }
  .prtsHoverPop button {
    height: 32px; border: none; border-radius: 7px; background: transparent;
    color: var(--dsw-alias-label-secondary); cursor: pointer;
    display: flex; align-items: center; gap: 8px; padding: 0 10px; font-size: 12px;
    transition: background .14s var(--prts-ease, ease), color .14s var(--prts-ease, ease);
  }
  .prtsHoverPop button svg { flex: none; opacity: .85; }
  .prtsHoverPop button span { letter-spacing: .02em; white-space: nowrap; }
  .prtsHoverPop button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
  @keyframes prtsPopUp { from { opacity: 0; transform: translateY(calc(-100% + 10px)); } to { opacity: 1; transform: translateY(-100%); } }
  /* drawer-like collapse for dsh-web's own sidebar toggle: only the grid
     column animates — the frame itself is NEVER translated, so the
     background / composer / conversation stay exactly where they are */
  .prtsSmoothSb { transition: grid-template-columns var(--prts-drawer-ms, 380ms) cubic-bezier(.2,.8,.25,1) !important; }
  /* beat bars beside the PRTS logo (equalizer) */
  .prtsBeat { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; margin: 0 8px; }
  .prtsBeat i { width: 2.5px; height: 100%; border-radius: 1px; background: var(--dsw-alias-brand-primary); transform-origin: bottom; animation: prtsBeatIdle 1.4s ease-in-out infinite; transform: scaleY(calc(.3 + var(--prts-beat, 0) * .7)); }
  .prtsBeat i:nth-child(2) { animation-delay: .15s; }
  .prtsBeat i:nth-child(3) { animation-delay: .3s; }
  .prtsBeat i:nth-child(4) { animation-delay: .45s; }
  @keyframes prtsBeatIdle { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
  /* day/night toggle beside the logo (custom minimal glyphs) */
  .prtsThemeToggle { width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  .prtsThemeToggle:hover { border-color: var(--prts-accent, var(--dsw-alias-brand-primary)); }
  .prtsThemeToggle svg { display: none; }
  .prtsBrandMark { display: inline-block; width: 13px; height: 13px; border: 1.5px solid var(--dsw-alias-brand-primary); transform: rotate(45deg); margin-right: 8px; position: relative; flex: none; }
  .prtsBrandMark::after { content: ''; position: absolute; inset: 3px; background: var(--dsw-alias-brand-primary); }
  .prtsBrandName { font-style: italic; font-weight: 700; font-size: 15px; letter-spacing: 0.22em; color: var(--dsw-alias-label-primary); }
  /* brand overlays (appended to <body>; dsh-web's React tree is never
     touched): expanded row over the hidden native brand, rail mark over the
     native restore button */
  .prtsBrandRow { position: fixed; display: none; align-items: center; gap: 4px; z-index: 60; pointer-events: auto; }
  .prtsBrandRow .prtsBeat { margin: 0; pointer-events: none; }
  .prtsRailMark { position: fixed; display: none; align-items: center; justify-content: center; z-index: 60; background: transparent; border: none; cursor: pointer; padding: 0; }
  .prtsRailMark .prtsBrandMark { width: 16px; height: 16px; margin-right: 0; }
  /* the native DeepSeek wordmark is hidden on the main page only (the
     settings panel keeps DeepSeek); visibility keeps its layout box so the
     overlay row can sit exactly on top */
  body:not(.prtsInSettings) .hHd-Xa_brand { visibility: hidden !important; }
  /* the built-in whale wordmark is never shown on the main page (settings keep it) */
  body:not(.prtsInSettings) svg:has([id*="whale"]) { display: none !important; }
  body:not(.prtsInSettings) [class*="railFish"], body:not(.prtsInSettings) [class*="fishHitbox"] { display: none !important; }
  [data-prts-theme='dark'] .prtsThemeToggle svg.sun, [data-prts-theme='light'] .prtsThemeToggle svg.moon { display: block; }
  /* PRTS sidebar widget buttons */
  .prtsWbtn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
  .prtsWbtn:hover { color: var(--dsw-alias-label-primary); border-color: var(--prts-accent, var(--dsw-alias-brand-primary)); box-shadow: 0 0 10px color-mix(in srgb, var(--prts-accent, var(--dsw-alias-brand-primary)) 35%, transparent); }
  `
  function ensureSkinCss() {
    if (document.getElementById('prts-skin-css')) return
    const s = document.createElement('style')
    s.id = 'prts-skin-css'
    s.textContent = SKIN_CSS
    document.head.appendChild(s)
  }

  /** Particle intro: three acts — "welcome to PRTS" → the PRTS / rule /
   *  DeepSeek Harness banner → the PRTS diamond mark (prts.png). Every act
   *  SCATTERS first, then the particles AGGREGATE into the shape. The loop
   *  keeps playing while dsh loads in the background; once the page is fully
   *  rendered it plays through the current act and enters. */
  /** The single particle EFFECT (three.js, ported 1:1 from the reference):
   *  two models — "welcome to PRTS" and the PRTS mark (prts.png) — morph in
   *  place; the cursor scatters the particles. It keeps running until the
   *  app is FULLY loaded (complete + composer rendered + settled), then
   *  fades. A click enters immediately. */
  function particleIntro(onDone) {
    const box = document.createElement('div')
    box.className = 'prtsIntro'
    const cv = document.createElement('canvas')
    box.appendChild(cv)
    document.body.appendChild(box)
    const status = document.createElement('div')
    status.style.cssText = 'position:fixed;bottom:22px;left:0;right:0;text-align:center;color:#9C9CA1;font-size:12px;letter-spacing:0.18em;z-index:3;pointer-events:none;'
    status.textContent = 'LOADING'
    box.appendChild(status)
    let engine = null
    try { engine = window.PRTS_INTRO ? window.PRTS_INTRO.create(cv, { particleNum: 10000, speedRange: [20, 30] }) : null } catch (e) { engine = null }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearInterval(cycle)
      box.classList.add('done')
      setTimeout(() => { if (engine) engine.stop(); box.remove(); if (onDone) onDone() }, 700)
    }
    if (!engine) { setTimeout(finish, 300); return finish }
    let act = Number(new URLSearchParams(window.location.search).get('prtsAct') || 0) % 2
    const show = (a) => { if (a === 0) engine.showText('welcome to PRTS', 96); else engine.showMark(1.05) }
    show(act)
    const cycle = setInterval(() => { if (!done) { act = (act + 1) % 2; show(act) } }, 6400)
    cv.addEventListener('pointermove', (e) => engine.onPointerMove(e))
    cv.addEventListener('pointerleave', () => engine.onPointerLeave())
    cv.addEventListener('touchmove', (e) => engine.onPointerMove(e))
    box.addEventListener('click', finish)
    // full readiness: document complete + the composer actually rendered +
    // a settle delay — the effect keeps running until everything is in place
    const waitReady = async () => {
      const t0 = Date.now()
      // The composer exists in BOTH surfaces: dsh-web renders a <textarea>,
      // the classic PRTS shell its own #composerInput. Accept either.
      const hasComposer = () => !!document.querySelector('textarea') || !!document.getElementById('composerInput')
      while (Date.now() - t0 < 30000) {
        if (document.readyState === 'complete' && hasComposer()) {
          await new Promise((r) => setTimeout(r, 900))
          if (hasComposer()) break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      // the app is fully rendered now — tell the Electron splash so it can
      // hand over (the particle effect never stops mid-load)
      try { fetch(origin() + '/prts/api/ready', { method: 'POST' }) } catch (e) { /* noop */ }
      status.textContent = 'READY'
      finish()
    }
    waitReady()
    return finish
  }

  function composerExpand() {
    const walk = () => {
      const ta = document.querySelector('textarea')
      if (!ta) return
      // While no conversation exists, pin the composer to the bottom of the
      // conversation column (fixed, so no ancestor clipping) and enlarge it
      // so the workspace picker row never overflows into it. Once a chat
      // starts, dsh-web's own layout takes over and the pin is removed.
      const empty = !!document.querySelector('.prtsHero')
      // Chat mode: centre dsh-web's own bottom composer stack as well.
      if (!empty) {
        const stack = ta.closest('[class*="composerStack"], [class*="composer"]')
        if (stack && stack !== document.body) {
          const w = Math.min(760, window.innerWidth - 48)
          stack.style.setProperty('left', Math.round((window.innerWidth - w) / 2) + 'px', 'important')
          stack.style.setProperty('right', 'auto', 'important')
          stack.style.setProperty('width', Math.round(w) + 'px', 'important')
        }
      }
      // In the empty state dsh-web centres the whole hero block (and with it
      // the composer) vertically. Un-centre it: the hero root becomes a
      // bottom-anchored column, so the workspace-picker chips AND the whole
      // composer card sink to the bottom of the conversation column. The
      // PRTS hero itself is fixed-centred and stays in the middle.
      const heroRoot = ta.closest('[class*="hero"]')
      const card = ta.closest('[class*="card"]') || heroRoot
      const center = document.querySelector('[class*="centerCol"]')
      // The empty-state composer SEAT (the block holding the chips + the
      // whole composer) is pinned to the bottom of the conversation column.
      // The PRTS hero itself is fixed-centred and unaffected.
      const seat = ta.closest('[class*="Seat"]') || ta.closest('[class*="seat"]') || heroRoot
      if (empty && seat && center) {
        // centred at the very bottom of the window (buttons ride along)
        const r = center.getBoundingClientRect()
        const w = Math.min(760, r.width - 24)
        seat.dataset.prtsPinned = '1'
        seat.style.setProperty('position', 'fixed', 'important')
        // no transform here — a transform would become the containing block
        // for position:fixed children (the PRTS hero) and break centring
        seat.style.setProperty('left', Math.round((window.innerWidth - w) / 2) + 'px', 'important')
        seat.style.setProperty('transform', 'none', 'important')
        seat.style.setProperty('width', Math.round(w) + 'px', 'important')
        seat.style.setProperty('bottom', '0', 'important')
        seat.style.setProperty('z-index', '10', 'important')
        seat.style.setProperty('padding', '0 0 10px', 'important')
        if (card) card.classList.add('prtsGlassCard')
      } else if (!empty) {
        for (const t of [...document.querySelectorAll('[data-prts-pinned]')]) {
          delete t.dataset.prtsPinned
          for (const k of ['position', 'left', 'right', 'transform', 'width', 'bottom', 'z-index', 'padding']) t.style.removeProperty(k)
        }
      }
      if (document.querySelector('.prtsExpand')) return
      let host = ta.parentElement
      for (let i = 0; i < 6 && host; i++) {
        if (getComputedStyle(host).position === 'relative' || getComputedStyle(host).position === 'absolute') break
        host = host.parentElement
      }
      const wrap = ta.closest('form') || ta.parentElement.parentElement
      if (!wrap) return
    }
    walk()
    setTimeout(walk, 2000)
    setTimeout(walk, 5000)
  }

  /** Background diamond + square (vibrates while voice is on / beat mode). */
  /** True while the dsh-web settings overlay is open — the settings keep
   *  DeepSeek branding, so every PRTS brand swap skips it. */
  function inSettings() {
    const ov = document.querySelector('.VOzbGW_overlay')
    if (!ov) return false
    const cs = getComputedStyle(ov)
    return cs.display !== 'none' && ov.getBoundingClientRect().width > 0
  }

  /** Replace the DeepSeek brand with PRTS on the main page only:
   *  - logo row: diamond mark + italic PRTS + beat bars + day/night toggle
   *  - any other brand button (top-right etc.): mark + italic PRTS
   *  - the whale/fish mascots are removed
   *  The settings panel keeps DeepSeek (guarded by inSettings). */
  function swapBrand() {
    document.title = 'PRTS'
    // favicon → PRTS mark (served by the host plugin)
    if (!document.getElementById('prts-favicon')) {
      fetch(origin() + '/prts/api/logo').then((r) => r.json()).then((d) => {
        if (!d || !d.b64) return
        const link = document.createElement('link')
        link.id = 'prts-favicon'
        link.rel = 'icon'
        link.type = 'image/png'
        link.href = 'data:image/png;base64,' + d.b64
        document.head.appendChild(link)
      }).catch(() => { })
    }
    // Overlay approach: dsh-web's logo row is React-managed — mutating its
    // children (innerHTML swaps, insertBefore) breaks React reconciliation
    // and crashes the whole sidebar slot on the next re-render. So the
    // native brand is hidden with CSS only (it keeps its layout box) and
    // OUR brand row / rail mark are FIXED overlays appended to <body>:
    //  - expanded:  mark + italic PRTS + beat bars + day/night toggle,
    //               aligned exactly over the hidden native brand
    //  - collapsed: ONLY the PRTS mark over the native restore button;
    //               clicking it forwards to that button (native behaviour)
    const themeRow = () => {
      let row = document.getElementById('prtsBrandRow')
      if (row) return row
      row = document.createElement('div')
      row.id = 'prtsBrandRow'
      row.className = 'prtsBrandRow'
      row.innerHTML = '<span class="prtsBrandMark"></span><span class="prtsBrandName">PRTS</span><span class="prtsBeat"><i></i><i></i><i></i><i></i></span>'
      const tgl = document.createElement('button')
      tgl.type = 'button'
      tgl.className = 'prtsThemeToggle'
      tgl.title = '切换日 / 夜主题'
      tgl.innerHTML = '<svg class="sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
      tgl.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          let id = document.documentElement.dataset.prtsTheme || 'dark'
          const snap = theme && theme.getTheme ? theme.getTheme() : null
          id = (snap && snap.active && snap.active.id) || id
          const next = id === 'light' ? 'dark' : 'light'
          if (theme && theme.setTheme) theme.setTheme(next)
          document.documentElement.dataset.prtsTheme = next
          document.documentElement.style.setProperty('--prts-ink', next === 'light' ? '#0A0A0B' : '#FAFAFA')
        } catch (err) { /* noop */ }
      })
      row.appendChild(tgl)
      document.body.appendChild(row)
      return row
    }
    const railMark = () => {
      let mark = document.getElementById('prtsRailMark')
      if (mark) return mark
      mark = document.createElement('button')
      mark.id = 'prtsRailMark'
      mark.type = 'button'
      mark.className = 'prtsRailMark'
      mark.title = '还原侧边栏'
      mark.innerHTML = '<span class="prtsBrandMark"></span>'
      mark.addEventListener('click', () => {
        const native = document.querySelector('.hHd-Xa_toggle')
        if (native) native.click()
      })
      document.body.appendChild(mark)
      return mark
    }
    const walk = () => {
      document.body.classList.toggle('prtsInSettings', inSettings())
      const row = themeRow()
      const mark = railMark()
      if (inSettings()) { row.style.display = 'none'; mark.style.display = 'none'; return }
      const logoRow = document.querySelector('.hHd-Xa_logoRow')
      const brand = document.querySelector('.hHd-Xa_brand')
      if (logoRow && brand) {
        // expanded: overlay the (CSS-hidden) native brand exactly
        const br = brand.getBoundingClientRect()
        row.style.display = 'flex'
        row.style.left = Math.round(br.left) + 'px'
        row.style.top = Math.round(br.top) + 'px'
        row.style.width = Math.round(br.width) + 'px'
        row.style.height = Math.round(br.height) + 'px'
        mark.style.display = 'none'
      } else if (logoRow) {
        // collapsed rail: overlay ONLY the native restore button
        row.style.display = 'none'
        const t = document.querySelector('.hHd-Xa_toggle')
        if (t) {
          const tr = t.getBoundingClientRect()
          mark.style.display = 'flex'
          mark.style.left = Math.round(tr.left) + 'px'
          mark.style.top = Math.round(tr.top) + 'px'
          mark.style.width = Math.round(tr.width) + 'px'
          mark.style.height = Math.round(tr.height) + 'px'
        } else {
          mark.style.display = 'none'
        }
      } else {
        row.style.display = 'none'
        mark.style.display = 'none'
      }
      // whale / fish mascots disappear on the main page (CSS hides the
      // native brand + rail fish; this catches any stragglers)
      for (const el of [...document.querySelectorAll('[class*="fishHitbox"], [class*="railFish"], [id*="whale"]')]) {
        if (el.closest('.VOzbGW_overlay')) continue
        try { el.style.display = 'none' } catch (e) { /* noop */ }
      }
    }
    walk()
    setTimeout(walk, 700)
    setTimeout(walk, 2000)
    setTimeout(walk, 5000)
  }

  /** The PRTS hero (blank conversation): the diamond mark with its
   *  counter-rotated inner square, italic PRTS and the welcome line —
   *  centred on the background diamond. It replaces dsh-web's own
   *  empty-state headline (fish + tagline + 预览版 badge) while the
   *  workspace row and the composer stay untouched; once a chat starts
   *  dsh-web's layout takes over and the hero is removed. */
  function swapHero() {
    const walk = () => {
      const emptyState = document.querySelector('.wSkVaW_composerHero')
      const existing = document.querySelector('.prtsHero')
      if (!emptyState || !emptyState.querySelector('.pXSMma_root')) {
        if (existing) existing.remove()
        return
      }
      // hide dsh-web's own empty-state headline + glow (no React nodes are
      // destroyed — display only — so dsh-web never fights us for them)
      const head = emptyState.querySelector('.pXSMma_root')
      if (head) head.style.display = 'none'
      const glow = emptyState.querySelector(':scope > svg')
      if (glow) glow.style.display = 'none'
      if (existing) { recenterMarks(); return }
      const hero = document.createElement('div')
      hero.className = 'prtsHero'
      hero.innerHTML = '<div class="row"><span class="prtsHeroMark"><span class="sq"></span></span><span class="word">PRTS</span></div><span class="tag">欢迎回归博士 · Welcome back, Doctor</span>'
      document.body.appendChild(hero)
      recenterMarks()
    }
    walk()
    setTimeout(walk, 1500)
    setTimeout(walk, 3500)
  }

  function backgroundMarks() {
    if (document.getElementById('prtsBgMarks')) return document.getElementById('prtsBgMarks')
    const marks = document.createElement('div')
    marks.id = 'prtsBgMarks'
    marks.className = 'prtsBgMarks'
    marks.innerHTML = '<span class="d"></span><span class="s"></span>'
    document.body.appendChild(marks)
    return marks
  }

  /** System-sound beat: captures OS audio (display media) and drives the
   *  background diamond/square with an analyser. */
  let beatCtx = null, beatStream = null, beatRaf = 0
  function stopBeat() {
    cancelAnimationFrame(beatRaf)
    beatRaf = 0
    if (beatCtx) { try { beatCtx.close() } catch (e) { /* noop */ } beatCtx = null }
    if (beatStream) { try { beatStream.getTracks().forEach((t) => t.stop()) } catch (e) { /* noop */ } beatStream = null }
    const marks = document.getElementById('prtsBgMarks')
    if (marks) { marks.classList.remove('beat') }
    const brand = document.getElementById('brandBtn') || document.getElementById('prtsBrandRow')
    if (brand) { brand.classList.remove('beat') }
    document.documentElement.style.setProperty('--prts-beat', '0')
  }
  async function startBeat() {
    // Shell mode already draws its own background marks — only the brand
    // rhombus pulses there (the skin CSS is not applied in shell mode).
    const marks = guiMounted ? null : backgroundMarks()
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('unsupported')
      beatStream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true })
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) throw new Error('no AudioContext')
      beatCtx = new AC()
      const src = beatCtx.createMediaStreamSource(beatStream)
      const an = beatCtx.createAnalyser()
      an.fftSize = 512
      src.connect(an)
      const data = new Uint8Array(an.frequencyBinCount)
      marks && marks.classList.add('beat')
      const brand = document.getElementById('brandBtn') || document.getElementById('prtsBrandRow')
      if (brand) brand.classList.add('beat')
      const loop = () => {
        an.getByteFrequencyData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i]
        const avg = sum / data.length / 255
        document.documentElement.style.setProperty('--prts-beat', Math.min(1, avg * 2.4).toFixed(3))
        beatRaf = requestAnimationFrame(loop)
      }
      loop()
      return true
    } catch (e) {
      stopBeat()
      return false
    }
  }

  /** Voice button: inserted beside the composer controls; vibrates the marks. */
  function voiceButton() {
    const walk = () => {
      const ta = document.querySelector('textarea')
      if (!ta || document.querySelector('.prtsVoice')) return
      const row = ta.parentElement
      if (!row) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'prtsWbtn prtsVoice'
      btn.title = '语音输入'
      btn.innerHTML = '<span>🎙</span> VOICE'
      let on = false
      btn.addEventListener('click', () => {
        on = !on
        const marks = backgroundMarks()
        marks.classList.toggle('vib', on)
        btn.style.color = on ? 'var(--prts-accent, var(--dsw-alias-brand-primary))' : ''
      })
      row.appendChild(btn)
    }
    walk()
    setTimeout(walk, 2500)
  }

  /** Keep the background diamond/square and the hero centred on the
   *  CONVERSATION column (not the raw viewport): the sidebar shifts the
   *  visual centre, so both track the column's centre instead. */
  function recenterMarks() {
    const center = document.querySelector('[class*="centerCol"]')
    const marks = document.getElementById('prtsBgMarks')
    const hero = document.querySelector('.prtsHero')
    const cx = center ? center.getBoundingClientRect() : null
    const x = cx ? Math.round(cx.left + cx.width / 2) : Math.round(window.innerWidth / 2)
    const y = Math.round(window.innerHeight / 2)
    if (marks) { marks.style.left = x + 'px'; marks.style.top = y + 'px' }
    if (hero) { hero.style.left = x + 'px'; hero.style.top = y + 'px' }
  }

  /** Sidebar collapse = dsh-web's ORIGINAL behaviour (its own toggle), with
   *  a drawer-like grid-column transition. NOTHING else is touched: the
   *  frame is never translated, the background marks / hero / composer stay
   *  put and stay centred. This replaces the old buggy drawer that slid the
   *  whole frame (background, input and text included). */
  function sidebarRescue() {
    const frame = document.querySelector('#root [class*="frame"], #root [class$="frame"]')
    if (!frame) return
    // undo anything a previous buggy build hid
    for (const b of [...document.querySelectorAll('button')]) {
      if (b.dataset && b.dataset.prtsOwn === '1' && !b.classList.contains('prtsThemeToggle')) {
        delete b.dataset.prtsOwn
        b.style.display = ''
      }
    }
    if (!frame.classList.contains('prtsSmoothSb')) {
      frame.classList.add('prtsSmoothSb')
    }
    // dsh-web's own collapse toggle: only the grid column animates, so
    // re-centre the marks/hero/composer once the transition settles
    const tgl = document.querySelector('.hHd-Xa_toggle')
    if (tgl && !tgl.dataset.prtsToggleWired) {
      tgl.dataset.prtsToggleWired = '1'
      tgl.addEventListener('click', () => {
        setTimeout(() => { swapBrand(); swapHero(); recenterMarks(); composerExpand() }, Math.round((Number(document.documentElement.style.getPropertyValue('--prts-drawer-ms').replace('ms', '')) || 380)) + 60)
      })
    }
  }

  /** The 动效 (motion) plugin: one reusable motion service every surface
   *  (sidebar drawers, bottom/top bars, future plugins, even GitHub
   *  plugins' sidebars) can call for drawer / spring / vibration effects. */
  window.PRTS_MOTION = {
    /** Drawer: slide an element in/out like a drawer (translateX). */
    drawer(el, open, ms) {
      if (!el) return
      const t = ms || 380
      el.style.transition = 'transform ' + (t / 1000) + 's cubic-bezier(.2,.8,.25,1)'
      el.style.transform = open ? 'translateX(0)' : 'translateX(calc(-100% + 30px))'
    },
    /** Spring: pop an element with a springy scale pulse. */
    spring(el, opts) {
      if (!el) return
      const o = opts || {}
      el.style.transition = 'transform .18s cubic-bezier(.34,1.56,.64,1)'
      el.style.transform = 'scale(' + (o.to || 1.06) + ')'
      setTimeout(() => { el.style.transform = 'scale(1)' }, 180)
    },
    /** Vibrate: shake/vibrate an element for a moment. */
    vibrate(el, opts) {
      if (!el) return
      const o = opts || {}
      const key = 'prtsVib' + Date.now()
      const style = document.getElementById('prts-motion-style') || (() => { const st = document.createElement('style'); st.id = 'prts-motion-style'; document.head.appendChild(st); return st })()
      style.textContent += '@keyframes ' + key + '{0%,100%{transform:translate(0,0)}25%{transform:translate(' + (o.dx || 2) + 'px,' + (o.dy || 0) + 'px)}75%{transform:translate(-' + (o.dx || 2) + 'px,0)}}'
      el.style.animation = key + ' ' + (o.ms || 120) + 'ms linear ' + (o.times || 4)
      setTimeout(() => { el.style.animation = '' }, (o.ms || 120) * (o.times || 4) + 50)
    },
    /** Wrap ANY sidebar-like element (even other plugins') in the drawer. */
    animateSidebar(el, opts) {
      if (!el) return
      const o = opts || {}
      const w = el.getBoundingClientRect().width || 272
      el.style.position = 'fixed'
      el.style.left = '0'
      el.style.top = o.top || '0'
      el.style.bottom = o.bottom || '0'
      el.style.zIndex = o.zIndex || 40
      el.style.width = w + 'px'
      el.style.transition = 'transform .38s cubic-bezier(.2,.8,.25,1)'
      el.style.transform = 'translateX(calc(-100% + 30px))'
      el.dataset.prtsDrawer = '1'
      el.dataset.prtsDrawerOpen = ''
      return {
        toggle() {
          const open = el.dataset.prtsDrawerOpen !== '1'
          el.dataset.prtsDrawerOpen = open ? '1' : ''
          el.style.transform = open ? 'translateX(0)' : 'translateX(calc(-100% + 30px))'
          return open
        },
      }
    },
  }

  /** Custom window bar: full-black strip, three circles (− □ ×), revealed
   *  when the cursor nears the top edge. Window controls ride the preload
   *  bridge; in a plain browser tab the bar simply hides itself. */
  function titlebar() {
    if (document.getElementById('prtsTitlebar')) return
    const bar = document.createElement('div')
    bar.id = 'prtsTitlebar'
    bar.className = 'prtsTitlebar'
    const mk = (cls, glyph, act) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'winBtn ' + cls
      b.innerHTML = glyph
      b.title = act.title
      b.addEventListener('click', (e) => { e.stopPropagation(); act.fn() })
      return b
    }
    const bridge = window.prts && window.prts.bridge
    const win = bridge && bridge.win
    if (win && typeof win.minimize === 'function') {
      bar.appendChild(mk('min', '<span style="transform:translateY(-3px)">−</span>', { title: '隐藏', fn: () => win.minimize() }))
      bar.appendChild(mk('max', '<span style="font-size:9px">◻</span>', { title: '放大', fn: () => win.toggleMaximize() }))
      bar.appendChild(mk('close', '<span>×</span>', { title: '退出', fn: () => win.close() }))
    } else {
      bar.appendChild(mk('close', '<span>×</span>', { title: '退出', fn: () => { try { window.close() } catch (e) { /* noop */ } } }))
    }
    document.body.appendChild(bar)
    // Shift the dsh-web frame below the bar (browser-like chrome): nothing
    // under the circles is covered — the logo row, header buttons and the
    // composer all keep their own space.
    const shiftFrame = () => {
      const frame = document.querySelector('#root [class$="frame"], #root [class*="frame"]')
      if (!frame) return
      const barH = 34
      frame.style.marginTop = barH + 'px'
      frame.style.height = 'calc(100% - ' + barH + 'px)'
    }
    shiftFrame()
    setTimeout(shiftFrame, 1200)
    setTimeout(shiftFrame, 3500)
  }

  /** Remove the "预览版" preview badge and any stray brand marks above the
   *  composer (the empty-state extras). */
  function cleanHeaderExtras() {
    for (const el of [...document.querySelectorAll('[class*="previewBadge"]')]) {
      try { el.remove() } catch (e) { /* noop */ }
    }
  }

  /** Only ONE API-key prompt may exist: PRTS owns it, so dsh-web's own
   *  onboarding dialog is dismissed wherever it appears. */
  function dismissNativeOnboarding() {
    // hide first (no flash while the particle intro plays), then dismiss
    const btns = [...document.querySelectorAll('button')]
    for (const b of btns) {
      const t = (b.textContent || '').trim()
      if (!/^(稍后配置|稍后|skip|later)$/i.test(t)) continue
      if (b.closest && b.closest('.prtsOnboard')) continue   // ours — keep it
      let overlay = b
      while (overlay && overlay !== document.body) {
        const cs = getComputedStyle(overlay)
        if ((cs.position === 'fixed' || cs.position === 'absolute') && overlay.getBoundingClientRect().width > window.innerWidth * 0.5) break
        overlay = overlay.parentElement
      }
      if (overlay && overlay !== document.body) { overlay.style.display = 'none'; overlay.dataset.prtsHidden = '1' }
      try { b.click() } catch (e) { /* noop */ }
      return
    }
  }

  /* ---------- skin mode (dsh-web native UI + PRTS overlay) ---------- */
  // One continuous particle EFFECT: the splash hands the act over via
  // ?prtsAct=, this overlay keeps it running until the app is fully loaded
  // (no dsh boot animation ever flashes through), then it fades and only
  // then do the skin walks and the API-key prompt start.
  let skinEntered = false
  const skinWalk = () => {
    if (!skinEntered) return
    swapBrand(); swapHero(); //composerExpand(); sidebarRescue(); cleanHeaderExtras(); recenterMarks(); dismissNativeOnboarding()
  }
  function runSkinMode() {
    ensureSkinCss()
    backgroundMarks()
    titlebar()
    swapBrand()
    recenterMarks()
    dismissNativeOnboarding()
    registerSettingsSections()
    settingsHoverPopup()
    // dsh-web skin: PRTS-style settings gear pinned bottom-left (the native
    // UI has no settings button of its own there) — same shared modal flow.
    if (!document.getElementById('prts-skin-settings')) {
      const sb = document.createElement('button')
      sb.id = 'prts-skin-settings'
      sb.type = 'button'
      sb.title = '设置'
      sb.innerHTML = '<svg width="17" height="17" viewBox="0 0 15 15" fill="none"><path d="M7.5 9.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z" stroke="currentColor" stroke-width="1.15"/><path d="M13.2 7v.9l-1.7.3a4 4 0 0 1-.5 1.2l1 1.4-.9.9-1.4-1a4 4 0 0 1-1.2.5L8 12.9h-.9L6.8 11.2a4 4 0 0 1-1.2-.5l-1.4 1-.9-.9 1-1.4a4 4 0 0 1-.5-1.2L2.1 6.9V6l1.7-.3a4 4 0 0 1 .5-1.2l-1-1.4.9-.9 1.4 1a4 4 0 0 1 1.2-.5L7.1 1.1H8l.3 1.7a4 4 0 0 1 1.2.5l1.4-1 .9.9-1 1.4a4 4 0 0 1 .5 1.2l1.7.3Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>'
      sb.style.cssText = 'position: fixed; left: 14px; bottom: 14px; z-index: 1200; width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 80%, transparent); color: var(--dsw-alias-label-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 6px 18px rgba(0,0,0,.25); transition: color .14s ease, background .14s ease;'
      sb.addEventListener('mouseenter', () => { sb.style.color = 'var(--dsw-alias-label-primary)'; sb.style.background = 'var(--dsw-alias-bg-layer-2)' })
      sb.addEventListener('mouseleave', () => { sb.style.color = ''; sb.style.background = '' })
      document.body.appendChild(sb)
      settingsHoverPopup(sb)
    }
    const closeIntro = particleIntro(() => {
      skinEntered = true
      skinWalk()
      showOnboarding()
    })
    window.addEventListener('resize', () => { if (skinEntered) { recenterMarks(); composerExpand() } })
    // keep the app-ready flag fresh while the app is alive (a later splash
    // launch probes it instead of waiting on the dsh backend only)
    setInterval(() => {
      if (skinEntered && document.querySelector('textarea')) {
        try { fetch(origin() + '/prts/api/ready', { method: 'POST' }) } catch (e) { /* noop */ }
      }
    }, 3000)
    ctx.effect(() => {
      const int = ctx.get('timer') ? ctx.get('timer').interval(skinWalk, 6000) : null
      return () => { if (int) int() }
    })
  }

  /* ============================================================
     PRTS SHELL (default surface) — the classic PRTS GUI runs as the
     only visible UI while dsh-web's runtime stays alive underneath.
     ============================================================ */
  // dsh-web's own React UI stays ALIVE on both surfaces: the classic shell
  // hides it (html[data-prts-shell] → .pI_x6G_frame visibility:hidden) and
  // borrows its settings modal as the shared settings panel; skin mode
  // (ui.shell = 'dsh-web') shows it with the PRTS overlay marks.
  const PRTS_GUI_BUNDLE = (typeof window !== 'undefined' && window.PRTS_GUI) || null
  let guiMounted = false
  let guiCleanups = []
  const portRoots = new Map()

  /** Run one <script> in the live document (evaluates immediately in order).
   *  The GUI bundle ends with `boot()` — document is complete at injection,
   *  so the classic PRTS GUI starts right away. */
  function evalGuiScript(code) {
    const scr = document.createElement('script')
    scr.textContent = code
    document.body.appendChild(scr)
    return scr
  }

  /** Inject the classic PRTS GUI (markup + css + js) into this document and
   *  wire it to the host: config through /prts/api/config, community plugin
   *  contributions through the React ports. Idempotent. */
  function mountPrtsGui() {
    if (guiMounted || !PRTS_GUI_BUNDLE) return
    guiMounted = true
    const host = document.createElement('div')
    host.id = 'prts-gui-host'
    document.body.appendChild(host)
    guiCleanups.push(() => { host.remove() })
    // CSS — appended last so PRTS rules beat dsh-web's global styles.
    if (!document.getElementById('prts-gui-css')) {
      const s = document.createElement('style')
      s.id = 'prts-gui-css'
      s.textContent = PRTS_GUI_BUNDLE.css
      document.head.appendChild(s)
    }
    if (!document.getElementById('prts-gui-shell-css')) {
      const s = document.createElement('style')
      s.id = 'prts-gui-shell-css'
      s.textContent = [
        '#prts-gui-host { position: fixed; inset: 0; z-index: 10; overflow: hidden; }',
        '#prts-plugin-dock { display: flex; flex-direction: column; gap: 2px; padding: 2px 0; }',
        '#prts-plugin-dock .prtsPort { width: 100%; }',
        '#prts-plugin-dock .prtsPort > * { width: 100%; }',
        '#prts-overlay-port { position: fixed; inset: 0; z-index: 60; pointer-events: none; }',
        '#prts-overlay-port > * { pointer-events: auto; }',
        '.prtsPortHost { margin-top: 6px; }',
        '.prtsPortCard { border: 1px solid var(--prts-hairline); border-radius: 8px; padding: 10px 12px; margin: 8px 0; background: color-mix(in srgb, var(--prts-surface) 60%, transparent); }',
        '.prtsPortCardTitle { font-size: 11px; letter-spacing: 0.14em; color: var(--prts-ink-faint); margin-bottom: 6px; text-transform: uppercase; }',
      ].join('\n')
      document.head.appendChild(s)
    }
    // Markup.
    host.innerHTML = PRTS_GUI_BUNDLE.html
    // Scripts — plain eval: the settings UI is dsh-web's own settings modal
    // (borrowed), so no GUI source hooking is needed anymore.
    evalGuiScript(PRTS_GUI_BUNDLE.js)
    const P = (typeof window !== 'undefined' && window.PRTS) || null
    if (P) {
      // Config storage through the host (/prts/api/config — the same
      // prts-ui.json the host plugin reads/writes).
      if (P.store) {
        const fallbackLoad = P.store.loadConfig
        P.store.loadConfig = async () => {
          try {
            const c = await api('GET', '/prts/api/config')
            if (c && typeof c === 'object' && Object.keys(c).length) return c
          } catch (e) { /* fall through to the fs bridge */ }
          return fallbackLoad ? fallbackLoad() : {}
        }
        P.store.saveConfig = async (cfg) => { await setConfig(cfg || {}) }
      }
    }
    // Ports once the classic GUI DOM is up.
    queueMicrotask(() => {
      // Drawer motion config (the GUI boot applies theme/wallpaper/glass
      // itself — only the drawer speed/switch lives here).
      getConfig().then((c) => {
        const ui = (c && c.ui) || {}
        document.documentElement.style.setProperty('--prts-drawer-ms', (ui.drawerMs || 380) + 'ms')
        document.documentElement.dataset.prtsDrawerOff = ui.drawer === false ? '1' : ''
      }).catch(() => { /* noop */ })
      installSidebarDock()
      installOverlayPort()
      refreshPorts()
    })
  }

  /** Tear the classic GUI down (skin mode takes over). */
  function unmountPrtsGui() {
    for (const c of guiCleanups) { try { c() } catch (e) { /* noop */ } }
    guiCleanups = []
    guiMounted = false
    for (const id of ['prts-gui-css', 'prts-gui-shell-css']) {
      const s = document.getElementById(id)
      if (s) s.remove()
    }
    for (const root of portRoots.values()) { try { root.unmount() } catch (e) { /* noop */ } }
    portRoots.clear()
  }

  /** React port: render registered slot entries (community plugin components)
   *  into a vanilla container with the entry's composed inject props. */
  function mountReactPort(container, entries, props) {
    if (!container || !entries || !entries.length) return
    let root = portRoots.get(container)
    if (!root) { root = createRoot(container); portRoots.set(container, root) }
    const kids = entries.map((e) => {
      const key = String(e.options && (e.options.id || e.options.key) || 'entry')
      let composed = {}
      if (typeof e.inject === 'function') { try { composed = e.inject() || {} } catch (err) { composed = {} } }
      return R.createElement('div', { key, className: 'prtsPort' },
        R.createElement(e.component, Object.assign({}, composed, props || {})),
      )
    })
    root.render(R.createElement('div', { className: 'prtsPorts' }, kids))
  }

  function installSidebarDock() {
    if (document.getElementById('prts-plugin-dock')) return
    const foot = document.querySelector('.sbFoot')
    if (!foot) return
    const dock = document.createElement('div')
    dock.id = 'prts-plugin-dock'
    foot.appendChild(dock)
  }

  function installOverlayPort() {
    if (document.getElementById('prts-overlay-port')) return
    const ov = document.createElement('div')
    ov.id = 'prts-overlay-port'
    document.body.appendChild(ov)
  }

  function refreshPorts() {
    if (!guiMounted || slots === undefined) return
    const dock = document.getElementById('prts-plugin-dock')
    if (dock) mountReactPort(dock, slots.entries('sidebar.footer.action'), { wide: true })
    const ov = document.getElementById('prts-overlay-port')
    if (ov) mountReactPort(ov, slots.entries('shell.overlay'), {})
  }

  /* ---------- surface dispatch ---------- */
  // Shell mode is the default surface: dsh-web's own React UI stays alive
  // (its settings modal is borrowed as the shared settings panel) but is
  // kept invisible behind the PRTS GUI overlay (html[data-prts-shell]).
  // Skin mode (ui.shell = 'dsh-web') shows the native UI instead.
  // The shell attr + hide rules go in SYNCHRONOUSLY at apply — before
  // dsh-web's first paint — so the native UI never flashes through.
  if (!document.getElementById('prts-shell-css')) {
    const s = document.createElement('style')
    s.id = 'prts-shell-css'
    s.textContent = [
      // The layout frame stays alive under the PRTS overlay but is never
      // painted (pointer-events die with visibility). The settings modal is
      // borrowed as the shared settings panel: it re-shows itself above
      // everything and slides to the right edge.
      'html[data-prts-shell] .pI_x6G_frame { position: relative; z-index: 100; visibility: hidden; }',
      'html[data-prts-shell] .VOzbGW_overlay { visibility: visible !important; }',
      'html[data-prts-shell] #prts-gui-host { position: fixed; inset: 0; z-index: 10; overflow: hidden; background: var(--prts-bg, #0A0A0B); }',
    ].join('\n')
    document.head.appendChild(s)
  }
  document.documentElement.dataset.prtsShell = '1'
  if (ctx && typeof ctx.on === 'function') {
    // Community plugins (un)installed at runtime: refresh the ports.
    ctx.on('slots/changed', (key) => {
      if (key === 'sidebar.footer.action' || key === 'shell.overlay') refreshPorts()
    })
  }
  getConfig().then((cfg) => {
    const useSkin = (cfg && cfg.ui && cfg.ui.shell === 'dsh-web') || !PRTS_GUI_BUNDLE
    if (useSkin) {
      delete document.documentElement.dataset.prtsShell
      unmountPrtsGui()
      runSkinMode()
    } else {
      mountPrtsGui()
      registerSettingsSections()
      settingsHoverPopup(document.getElementById('settingsBtn'))
    }
  }).catch(() => {
    delete document.documentElement.dataset.prtsShell
    unmountPrtsGui()
    runSkinMode()
  })

  ctx.effect(() => () => { if (styleEl) { styleEl.remove(); styleEl = null } })
}

export default { apply }
