/**
 * dsh-prts-ui/client — PRTS 皮肤层（v0.0.1 new，重做版）
 *
 * PRTS 不再是「重写整个界面」的插件，而是一套 **整合包 + 皮肤**。
 * 本文件是加载进 dsh-web 的客户端插件，严格只做五件事，其余全部走 dsh 原生：
 * 不改输入框位置、不替换 deepseek 图标、不动对话 / 设置等任何核心逻辑。
 *
 *   ① 左上角品牌标志 → 菱形 + PRTS（skin：CSS 覆盖 BrandWordmark）
 *   ② 首页 hero「探索未至之境」→「欢迎回归，博士」（skin：CSS/JS 覆盖文案与鱼标）
 *   ③ 侧栏脚部新增一个独立按钮，点击呼出 PRTS 系统面板（dsh slot：
 *      sidebar.footer.action；另开独立窗口，不改原版「点 logo 新建会话」）
 *   ④ 整体主题 → 黑白 + 粒子 + 发光菱形 + 背景图形层（theme.overrideTokens
 *      注入单色 token + CSS 叠加一层「壁纸之上、对话框之下」的画布图形层）
 *   ⑤ （入场动画改在 Electron 整合包 splash 层处理，本插件不做核心改动）
 *
 * dsh 提供两个注入服务：`slots`（slot 注册）与 `theme`（token 覆盖）。
 */
import React from 'react'

export const inject = ['slots', 'theme']

/** 「欢迎回归，博士」—— 博士名称可在 prts-ui 配置里改（persona.userName）。 */
function welcomeLine(name) {
  const n = String(name || '').trim()
  return n ? '欢迎回归，' + n : '欢迎回归，博士'
}

// ---------- 单色 token 覆盖（第④步的主体） ----------
const MONO_TOKENS = {
  '--dsw-alias-bg-base':         { dark: '#0A0A0B', light: '#FAFAFA' },
  '--dsw-alias-bg-layer-1':      { dark: '#101012', light: '#F4F4F5' },
  '--dsw-alias-bg-layer-2':      { dark: '#151517', light: '#ECECED' },
  '--dsw-alias-bg-overlay':      { dark: '#0C0C0D', light: '#FFFFFF' },
  '--dsw-alias-border-l1':       { dark: 'rgba(255,255,255,0.13)', light: 'rgba(10,10,11,0.13)' },
  '--dsw-alias-border-l2':       { dark: 'rgba(255,255,255,0.30)', light: 'rgba(10,10,11,0.30)' },
  '--dsw-alias-brand-primary':   { dark: '#FAFAFA', light: '#0A0A0B' },
  '--dsw-alias-label-primary':   { dark: '#FAFAFA', light: '#0A0A0B' },
  '--dsw-alias-label-secondary': { dark: '#A0A0A5', light: '#5C5C60' },
  '--dsw-alias-state-error-primary':   { dark: '#E8758B', light: '#C81E2A' },
  '--dsw-alias-state-success-primary': { dark: '#8FCB7B', light: '#1E7A35' },
  '--dsw-alias-state-warn-primary':    { dark: '#E0B15E', light: '#9A6700' },
  '--dsw-specific-sidebar-fill':       { dark: '#0D0D0E', light: '#FFFFFF' },
}

// ---------- 皮肤 CSS：只做「视觉替换 / 叠加」，不搬动任何 dsh 布局 ----------
const SKIN_CSS = String.raw`
/* ① 左上角品牌：dsh 的鲸鱼 wordmark → 覆盖为 PRTS 菱形 + 斜体字（皮肤层，不换图标文件） */
[class*="logoRow"] [class*="brand"] svg {
  visibility: hidden;
  position: relative;
}
[class*="logoRow"] [class*="brand"] svg::after {
  visibility: visible;
  content: "◆  PRTS";
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  color: var(--dsw-alias-brand-primary);
  font-weight: 700; font-style: italic;
  letter-spacing: 0.18em; font-size: 16px; white-space: nowrap;
}

/* ② 首页 hero：fish + 「探索未至之境」→ 菱形 + 欢迎语（覆盖，不改核心渲染） */
[class*="headline"] { position: relative; }
[class*="headlineText"] { visibility: hidden; position: relative; min-height: 1em; }
[class*="headlineText"]::before {
  visibility: visible;
  content: "◆";
  margin-right: 10px; font-size: 15px;
}
[class*="headlineText"]::after {
  visibility: visible;
  content: attr(data-prts-welcome);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
[class*="fishHitbox"] { display: none !important; }

/* ④ 背景图形层：壁纸之上、对话框之下（菱形 + 方块 + 白色小圆点，由 JS canvas 绘制） */
#prts-scene-layer {
  position: fixed; inset: 0; z-index: 1;
  overflow: hidden; pointer-events: none;
}
#prts-scene-layer canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
body[data-prts-scene="off"] #prts-scene-layer { display: none; }

/* ③ 系统面板按钮（走进 sidebar.footer.action slot）—— 菱形 + 斜体 PRTS 风格 */
.prts-sys-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px; height: 32px; margin: 6px 10px; padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
  font-size: 12px; letter-spacing: 0.06em;
  transition: color .15s ease, border-color .15s ease, background .15s ease;
}
.prts-sys-btn:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
.prts-sys-btn .rhombus { display: inline-block; width: 8px; height: 8px; transform: rotate(45deg); border: 1.2px solid currentColor; }
.prts-sys-btn b { font-style: italic; font-weight: 700; letter-spacing: 0.1em; }
`

export function apply(ctx) {
  const slots = ctx.get('slots')
  const theme = ctx.get('theme')

  // ---- 注入皮肤样式 ----
  let styleEl = document.getElementById('dsh-prts-skin-css')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'dsh-prts-skin-css'
    styleEl.textContent = SKIN_CSS
    document.head.appendChild(styleEl)
  }

  // ---- ④ 黑白主题 ----
  if (theme && typeof theme.overrideTokens === 'function') {
    try { theme.overrideTokens('prts-mono', MONO_TOKENS) } catch (e) { /* noop */ }
  }

  // ---- 读取配置（欢迎语人名）----
  let welcomeName = ''
  try {
    const cfg = window.__PRTS_CONFIG__ || {}
    welcomeName = (cfg.persona && cfg.persona.userName) || ''
  } catch (e) { /* noop */ }
  const welcome = welcomeLine(welcomeName)
  document.documentElement.style.setProperty('--prts-welcome', JSON.stringify(welcome))

  // ---- ③ 侧栏脚部：系统面板独立按钮 ----
  if (slots && typeof slots.register === 'function') {
    try {
      slots.register({
        name: 'sidebar.footer.action',
        id: 'dsh-prts-system-panel',
        order: 1000,
      }, function SystemPanelAction(props) {
        return React.createElement(
          'button',
          {
            type: 'button',
            className: 'prts-sys-btn',
            title: 'PRTS 系统面板',
            onClick: function () {
              const bridge = typeof window !== 'undefined' && window.prts && window.prts.bridge
              if (bridge && typeof bridge.openSystemPanel === 'function') {
                bridge.openSystemPanel()
              } else {
                try { window.location.href = '/prts/system' } catch (e) { /* noop */ }
              }
            },
          },
          React.createElement('span', { className: 'rhombus' }),
          props && props.wide ? React.createElement('b', null, 'SYSTEM') : null,
        )
      })
    } catch (e) { /* slot 未就绪则跳过，皮肤其余效果照常 */ }
  }

  // ---- ② hero 欢迎语写入（data-prts-welcome 供 CSS 读取）----
  function applyWelcome() {
    const els = document.querySelectorAll('[class*="headlineText"]')
    for (const el of els) {
      if (el.getAttribute('data-prts-welcome') === welcome) continue
      el.setAttribute('data-prts-welcome', welcome)
      el.setAttribute('title', welcome)
    }
  }
  function watch() {
    const MO = window.MutationObserver
    if (!MO) return
    const obs = new MO(() => applyWelcome())
    obs.observe(document.body || document.documentElement, { childList: true, subtree: true })
    applyWelcome()
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') watch()
  else document.addEventListener('DOMContentLoaded', watch)

  // ---- ④ 背景图形层：菱形 + 方块 + 白色小圆点（漂浮，同步背景/明暗）----
  function startScene() {
    if (document.getElementById('prts-scene-layer')) return
    const layer = document.createElement('div')
    layer.id = 'prts-scene-layer'
    layer.setAttribute('aria-hidden', 'true')
    document.body.appendChild(layer)
    const canvas = document.createElement('canvas')
    layer.appendChild(canvas)
    const cctx = canvas.getContext('2d')
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    let W = 0, H = 0, raf = 0, t0 = performance.now()
    let shapes = null

    function getInk(rgb = 'primary') {
      try {
        const s = getComputedStyle(document.documentElement)
        const token = rgb === 'primary'
          ? '--dsw-alias-brand-primary'
          : rgb === 'dim' ? '--dsw-alias-label-secondary' : '--dsw-alias-label-primary'
        return s.getPropertyValue(token).trim() || '#FAFAFA'
      } catch (e) { return '#FAFAFA' }
    }
    function resize() {
      W = window.innerWidth; H = window.innerHeight
      canvas.width = W * dpr; canvas.height = H * dpr
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    function spawn() {
      const count = Math.round(Math.min(90, 34 + (W * H) / 26000))
      shapes = []
      for (let i = 0; i < count; i++) {
        const kind = Math.random()
        const s = 3 + Math.random() * 9
        shapes.push({
          kind: kind < 0.34 ? 'diamond' : kind < 0.58 ? 'square' : 'dot',
          x: Math.random() * W, y: Math.random() * H,
          size: s, spd: 0.05 + Math.random() * 0.16,
          rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.02,
          a: 0.10 + Math.random() * 0.35,
        })
      }
    }
    function frame() {
      if (document.body.getAttribute('data-prts-scene') === 'off') { raf = 0; return }
      cctx.clearRect(0, 0, W, H)
      const dt = (performance.now() - t0) / 1000
      const glow = getInk('primary')
      const ink = getInk('dim')
      for (const s of shapes) {
        s.y -= s.spd * 22 * dt
        s.x += Math.sin(dt * 0.5 + s.rot) * 0.15
        s.rot += s.vrot * dt
        if (s.y < -20) { s.y = H + 20; s.x = Math.random() * W }
        cctx.globalAlpha = s.a
        if (s.kind === 'diamond') {
          cctx.save(); cctx.translate(s.x, s.y); cctx.rotate(s.rot)
          cctx.strokeStyle = glow; cctx.lineWidth = 1.1
          cctx.strokeRect(-s.size / 2, -s.size / 2, s.size, s.size)
          cctx.restore()
        } else if (s.kind === 'square') {
          cctx.fillStyle = ink
          cctx.save(); cctx.translate(s.x, s.y); cctx.rotate(s.rot)
          cctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size)
          cctx.restore()
        } else {
          cctx.fillStyle = '#FAFAFA' // 白色小圆点
          cctx.beginPath(); cctx.arc(s.x, s.y, s.size * 0.35, 0, Math.PI * 2); cctx.fill()
        }
      }
      cctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    function start() { resize(); if (!shapes) spawn(); t0 = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame) }
    window.addEventListener('resize', resize)
    start()
  }
  startScene()

  // 主题明暗切换 → 背景层随主题同步（overrideTokens 已自动按明暗自适应，此处仅兜底触发重绘颜色）
  if (ctx && typeof ctx.on === 'function') {
    try { ctx.on('theme/change', () => { /* tokens already auto-adapt; canvas reads live CSS */ }) } catch (e) { /* noop */ }
  }

  // 暴露给 host 更新欢迎语
  if (typeof window !== 'undefined') {
    const g = window.__PRTS__ || (window.__PRTS__ = {})
    g.setWelcomeName = (n) => {
      document.documentElement.style.setProperty('--prts-welcome', JSON.stringify(welcomeLine(n)))
      applyWelcome()
    }
  }
}

// 模块契约（bundle-gui.mjs 通过字符串替换装配到 dsh-web 的 ModuleLoader）
export default { apply }
