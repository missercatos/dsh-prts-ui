/**
 * dsh-prts-ui/client — the PRTS client plugin.
 *
 * PRTS now runs AS a dsh-web client plugin: the shell is dsh-web itself, so
 * the settings pages are the official ones (identical to web), every plugin
 * the market installs shows its own buttons/panels exactly where dsh-web
 * puts them, and performance is dsh-web's own. PRTS contributes:
 *   - the PRTS skin (monochrome tokens + custom accent/wallpaper/glass),
 *   - sidebar actions (Git / SKILL市场 / 系统),
 *   - a "PRTS" settings section (balance, git, SKILL市场, wallpaper, colors,
 *     sidebar buttons),
 *   - the first-run API-key onboarding (any port).
 *
 * Plain JavaScript: React.createElement only, no JSX/TS transform.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

const SILL = '__SKILL_CATALOG__'

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
  const PRTS_TOKENS = {
    dark: {
      '--dsw-alias-bg-base': '#0A0A0B',
      '--dsw-alias-bg-layer-1': '#111112',
      '--dsw-alias-bg-layer-2': '#161618',
      '--dsw-alias-bg-overlay': '#0D0D0E',
      '--dsw-alias-border-l1': 'rgba(250,250,250,0.14)',
      '--dsw-alias-border-l2': 'rgba(250,250,250,0.3)',
      '--dsw-alias-brand-primary': '#FAFAFA',
      '--dsw-alias-label-primary': '#FAFAFA',
      '--dsw-alias-label-secondary': '#9C9CA1',
      '--dsw-alias-state-error-primary': '#f7768e',
      '--dsw-alias-state-success-primary': '#9ece6a',
      '--dsw-alias-state-warn-primary': '#e0af68',
      '--dsw-specific-sidebar-fill': '#0D0D0E',
    },
    light: {
      '--dsw-alias-bg-base': '#FAFAFA',
      '--dsw-alias-bg-layer-1': '#F3F3F3',
      '--dsw-alias-bg-layer-2': '#EBEBEB',
      '--dsw-alias-bg-overlay': '#FFFFFF',
      '--dsw-alias-border-l1': 'rgba(10,10,11,0.14)',
      '--dsw-alias-border-l2': 'rgba(10,10,11,0.3)',
      '--dsw-alias-brand-primary': '#0A0A0B',
      '--dsw-alias-label-primary': '#0A0A0B',
      '--dsw-alias-label-secondary': '#5C5C60',
      '--dsw-alias-state-error-primary': '#d93025',
      '--dsw-alias-state-success-primary': '#188038',
      '--dsw-alias-state-warn-primary': '#b06000',
      '--dsw-specific-sidebar-fill': '#FFFFFF',
    },
  }

  let appliedAccent = null
  async function applySkin(cfg) {
    // monochrome base tokens (light + dark)
    if (theme) { try { theme.overrideTokens('prts', PRTS_TOKENS) } catch (e) { /* token API may reject */ } }
    // custom accent (buttons/brand) + wallpaper + glass as CSS variables
    const ui = (cfg && cfg.ui) || {}
    const accent = ui.accent || {}
    const custom = ui.theme === 'custom'
    const root = document.documentElement
    const setVar = (k, v) => {
      if (v) root.style.setProperty(k, v)
      else root.style.removeProperty(k)
    }
    setVar('--prts-accent', custom && accent.primary ? accent.primary : '')
    setVar('--prts-diamond', custom && accent.diamond ? accent.diamond : '')
    setVar('--prts-square', custom && accent.square ? accent.square : '')
    if (custom) {
      // the brand token follows the custom primary
      if (theme) { try { theme.overrideTokens('prts-accent', { dark: { '--dsw-alias-brand-primary': accent.primary || '#7aa2f7' }, light: { '--dsw-alias-brand-primary': accent.primary || '#7aa2f7' } }) } catch (e) { /* noop */ } }
    }
    appliedAccent = custom
    // glass master switch
    document.body.dataset.glass = ui.glass === false ? 'off' : 'on'
    applyWallpaper(cfg)
  }

  async function applyWallpaper(cfg) {
    const w = cfg && cfg.ui && cfg.ui.wallpaper
    let layer = document.getElementById('prtsWallpaperLayer')
    if (!w || !w.file) {
      if (layer) layer.remove()
      return
    }
    if (!layer) {
      layer = document.createElement('div')
      layer.id = 'prtsWallpaperLayer'
      layer.setAttribute('aria-hidden', 'true')
      document.body.appendChild(layer)
    }
    layer.style.cssText = 'position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--dsw-alias-bg-base);opacity:' + (w.opacity !== undefined ? w.opacity : 0.35) + ';'
    try {
      const data = await api('GET', '/prts/api/wallpaper?file=' + encodeURIComponent(w.file))
      if (!data || !data.dataUrl) return
      layer.innerHTML = ''
      let media
      if (w.type === 'video') {
        media = document.createElement('video')
        media.src = data.dataUrl
        media.autoplay = true
        media.muted = true
        media.playsInline = true
        media.loop = w.loop !== false
        try { media.playbackRate = Number(w.speed) || 1 } catch (e) { /* noop */ }
      } else {
        media = document.createElement('img')
        media.src = data.dataUrl
      }
      media.style.cssText = 'width:100%;height:100%;object-fit:' + (w.fit || 'cover') + ';'
      layer.appendChild(media)
    } catch (e) { /* wallpaper unavailable */ }
  }

  const PRTS_CSS = `
  #prtsWallpaperLayer { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
  body[data-glass='off'] * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  /* PRTS liquid glass on dsh-web surfaces */
  .prts-glass { background: color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
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
  .prtsBtn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; cursor: pointer; }
  .prtsBtn.primary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); border-color: transparent; }
  .prtsBtn:disabled { opacity: 0.4; cursor: default; }
  .prtsChip { height: 24px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 11px; cursor: pointer; }
  .prtsChip.on { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
  .prtsRow { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
  .prtsLabel { flex: 1; font-size: 12px; color: var(--dsw-alias-label-secondary); }
  .prtsInput { height: 30px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; outline: none; }
  .prtsOnboard { position: fixed; inset: 0; z-index: 400; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.62); }
  .prtsOnboardCard { width: min(480px, calc(100vw - 40px)); padding: 26px 28px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-overlay); display: flex; flex-direction: column; gap: 12px; }
  .prtsOnboardTitle { font-size: 16px; color: var(--dsw-alias-label-primary); letter-spacing: 0.06em; }
  .prtsOnboardBody { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
  .prtsDiamond { display: inline-block; width: 9px; height: 9px; transform: rotate(45deg); border: 1.2px solid var(--dsw-alias-brand-primary); }
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

  getConfig().then(applySkin).catch(() => {})

  /* ---------- helpers ---------- */
  function t(key) { return key }

  function h(tag, props, ...kids) {
    return R.createElement(tag, props || null, ...(kids || []))
  }

  const CATALOG = typeof SILL === 'string' && SILL !== '__SKILL_CATALOG__' ? JSON.parse(SILL) : []

  /* ---------- SKILL 市场 panel (fixed size, sticky search, scroll) ---------- */
  function SkillMarket({ height }) {
    const [query, setQuery] = useState('')
    const [cat, setCat] = useState('all')
    const [skills, setSkills] = useState([])
    const [installed, setInstalled] = useState(null)
    const [repo, setRepo] = useState('')
    const [busy, setBusy] = useState(false)

    const refresh = useCallback(async () => {
      try { setInstalled((await api('GET', '/prts/api/skills')).map((s) => s.name)) } catch (e) { setInstalled([]) }
    }, [])
    useEffect(() => {
      setSkills(CATALOG)
      refresh()
    }, [refresh])

    const installRepo = async (r, subdir) => {
      setBusy(true)
      try {
        const res = await api('POST', '/prts/api/skill-install', { repo: r, subdir })
        if (res && res.ok) { setRepo(''); refresh() } else alert((res && res.error) || 'install failed')
      } catch (e) { alert(String(e && e.message || e)) }
      setBusy(false)
    }

    const cats = [['all', '全部'], ['design', '图形设计'], ['ui', 'UI设计'], ['fx', '特效设计'], ['text', '文本设计'], ['tool', '工具'], ['persona', '人格'], ['other', '其他']]
    const q = query.trim().toLowerCase()
    const items = skills.filter((s) =>
      (cat === 'all' || s.category === cat) &&
      (!q || String((s.displayName || s.name) + ' ' + (s.description || '')).toLowerCase().indexOf(q) >= 0))

    return h('div', { className: 'prtsCard', style: { width: 'min(760px, calc(100vw - 40px))', height: height || 'min(640px, calc(100vh - 60px))' } },
      h('div', { className: 'prtsCardHead' },
        h('span', { className: 'prtsDiamond' }),
        h('span', { className: 'prtsTitle' }, 'SKILL 市场'),
      ),
      h('div', { className: 'prtsBody' },
        h('div', { className: 'prtsSearch' },
          h('input', { value: query, placeholder: '搜索…', onChange: (e) => setQuery(e.target.value) }),
        ),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 } },
          cats.map(([id, label]) => h('button', { key: id, className: 'prtsChip' + (cat === id ? ' on' : ''), onClick: () => setCat(id) }, label)),
        ),
        h('div', { className: 'prtsRow' },
          h('span', { className: 'prtsLabel' }, 'GitHub 安装：'),
          h('input', { className: 'prtsInput', style: { flex: 2 }, value: repo, placeholder: 'https://github.com/owner/skill-repo', onChange: (e) => setRepo(e.target.value) }),
          h('button', { className: 'prtsBtn primary', disabled: busy || !/^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(repo), onClick: () => installRepo(repo.trim()) }, busy ? '安装中…' : '安装'),
        ),
        h('div', { className: 'prtsGrid' },
          items.map((s) => {
            const done = installed && installed.indexOf(s.name) >= 0
            return h('div', { key: s.name, className: 'prtsItem' },
              h('div', { className: 'prtsItemName' }, s.displayName || s.name),
              h('div', { className: 'prtsItemDesc' }, s.description || ''),
              h('button', { className: 'prtsBtn' + (done ? '' : ' primary'), disabled: done || s.builtin || !s.repo || s.repo === 'local', onClick: () => installRepo(s.repo, s.subdir) }, done ? '已安装' : '安装'),
            )
          }),
        ),
        items.length === 0 ? h('div', { className: 'prtsItemDesc', style: { padding: 20, textAlign: 'center' } }, '没有匹配的 skill') : null,
      ),
    )
  }

  /* ---------- wallpaper / colors / glass / sidebar settings ---------- */
  function PrtsSettings() {
    const [cfg, setCfg] = useState({ ui: {} })
    const [editors, setEditors] = useState([])
    useEffect(() => {
      getConfig().then((c) => setCfg(c || { ui: {} }))
      api('GET', '/prts/api/detect-editors').then(setEditors).catch(() => {})
    }, [])
    const save = async (patch) => {
      const next = { ...cfg, ...patch, ui: { ...(cfg.ui || {}), ...((patch && patch.ui) || {}) } }
      setCfg(next)
      await setConfig(next)
      await applySkin(next)
    }
    const ui = cfg.ui || {}
    const accent = ui.accent || {}
    const PRESETS = [
      ['tokyonight', 'Tokyo Night', '#7aa2f7', '#7dcfff', '#bb9af7'],
      ['nord', 'Nord', '#88c0d0', '#8fbcbb', '#b48ead'],
      ['dracula', 'Dracula', '#bd93f9', '#8be9fd', '#ff79c6'],
      ['rose-pine', 'Rosé Pine', '#ebbcba', '#9ccfd8', '#c4a7e7'],
      ['catppuccin', 'Catppuccin', '#89b4fa', '#89dceb', '#cba6f7'],
      ['gruvbox', 'Gruvbox', '#83a598', '#8ec07c', '#d3869b'],
    ]
    const uploadWall = (file) => {
      const reader = new FileReader()
      reader.onload = async () => {
        const m = /^data:([^;]+);base64,(.*)$/.exec(String(reader.result || ''))
        if (!m) return
        const mime = m[1]
        const ext = mime.indexOf('video') === 0 ? 'mp4' : (mime === 'image/png' ? 'png' : 'jpg')
        const name = 'wall-' + Date.now().toString(36) + '.' + ext
        await api('POST', '/prts/api/wallpaper', { file: name, mime, base64: m[2] })
        await save({ ui: { ...ui, wallpaper: { ...(ui.wallpaper || {}), file: name, type: mime.indexOf('video') === 0 ? 'video' : 'image', mime, fit: (ui.wallpaper && ui.wallpaper.fit) || 'cover', opacity: (ui.wallpaper && ui.wallpaper.opacity) !== undefined ? ui.wallpaper.opacity : 0.35, speed: 1, loop: true } } })
      }
      reader.readAsDataURL(file)
    }
    const w = ui.wallpaper || {}
    return h('div', {},
      h('div', { className: 'prtsTitle', style: { margin: '10px 0 6px' } }, '壁纸'),
      h('div', { className: 'prtsRow' },
        h('label', { className: 'prtsBtn', style: { cursor: 'pointer' } },
          '上传图片 / 视频',
          h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onChange: (e) => { const f = e.target.files && e.target.files[0]; if (f) uploadWall(f) } }),
        ),
        h('button', { className: 'prtsBtn', onClick: async () => { await api('DELETE', '/prts/api/wallpaper').catch(() => {}); await save({ ui: { ...ui, wallpaper: { ...w, file: '' } } }) } }, '清除'),
      ),
      w.file ? h('div', {},
        h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '填充方式'),
          h('select', { className: 'prtsInput', value: w.fit || 'cover', onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, fit: e.target.value } } }) },
            h('option', { value: 'cover' }, '覆盖'), h('option', { value: 'contain' }, '居中'), h('option', { value: 'fill' }, '填充')),
        ),
        h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '透明度'),
          h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: String(w.opacity !== undefined ? w.opacity : 0.35), style: { flex: 2 }, onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, opacity: Number(e.target.value) } } }) }),
        ),
        w.type === 'video' ? h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '速度'),
          h('input', { type: 'number', className: 'prtsInput', min: 0.25, max: 4, step: 0.25, value: String(w.speed || 1), onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, speed: Number(e.target.value) || 1 } } }) }),
          h('label', { style: { display: 'inline-flex', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            h('input', { type: 'checkbox', checked: w.loop !== false, onChange: (e) => save({ ui: { ...ui, wallpaper: { ...w, loop: e.target.checked } } }) }),
            '循环'),
        ) : null,
      ) : null,
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '颜色'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        PRESETS.map(([id, name, p, d, s]) => h('button', { key: id, className: 'prtsChip' + (accent.preset === id ? ' on' : ''), onClick: () => save({ ui: { ...ui, theme: 'custom', accent: { preset: id, primary: p, diamond: d, square: s } } }) }, name)),
        h('button', { className: 'prtsChip' + ((ui.theme !== 'custom') ? ' on' : ''), onClick: () => save({ ui: { ...ui, theme: 'dark' } }) }, 'PRTS 黑白'),
      ),
      h('div', { className: 'prtsRow' },
        ['primary', 'diamond', 'square'].map((k) => h('label', { key: k, style: { display: 'inline-flex', gap: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
          { primary: '主色', diamond: '菱形', square: '正方形' }[k],
          h('input', { type: 'color', value: accent[k] || '#7aa2f7', onChange: (e) => save({ ui: { ...ui, theme: 'custom', accent: { ...accent, [k]: e.target.value, preset: 'custom' } } }) }),
        )),
      ),
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '液态玻璃'),
      h('label', { style: { display: 'inline-flex', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
        h('input', { type: 'checkbox', checked: ui.glass !== false, onChange: (e) => save({ ui: { ...ui, glass: e.target.checked } }) }),
        '开启背景模糊'),
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '左侧侧边栏按钮'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
        [['web', 'WEB'], ['git', 'Git'], ['skill', 'SKILL市场'], ['sys', '系统']].map(([id, label]) => {
          const on = ((ui.sidebarButtons || {})[id] !== false) && id !== 'web' ? (ui.sidebarButtons || {})[id] !== false : true
          return h('button', { key: id, className: 'prtsChip' + (on ? ' on' : ''), onClick: () => save({ ui: { ...ui, sidebarButtons: { ...(ui.sidebarButtons || {}), [id]: !on } } }) }, label)
        }),
      ),
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '默认文本编辑器'),
      h('select', { className: 'prtsInput', value: ui.editor || 'default', onChange: (e) => save({ ui: { ...ui, editor: e.target.value } }) },
        editors.map((e) => h('option', { key: e.id, value: e.id }, e.name)),
      ),
    )
  }

  /* ---------- Git panel ---------- */
  function GitPanel() {
    const [cfg, setCfg] = useState({ github: {} })
    const [user, setUser] = useState(null)
    const [token, setToken] = useState('')
    const [repos, setRepos] = useState([])
    const [repoName, setRepoName] = useState('')
    useEffect(() => { getConfig().then((c) => setCfg(c || { github: {} })) }, [])
    const gh = cfg.github || {}
    const refresh = useCallback(async () => {
      if (!gh.token) return
      try {
        const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.github.com/user', headers: { Authorization: 'token ' + gh.token, 'User-Agent': 'PRTS', Accept: 'application/vnd.github+json' } })
        const d = JSON.parse((res && res.text) || '{}')
        setUser(d && d.login ? d : null)
        const rr = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.github.com/user/repos?per_page=50&sort=updated', headers: { Authorization: 'token ' + gh.token, 'User-Agent': 'PRTS', Accept: 'application/vnd.github+json' } })
        setRepos(JSON.parse((rr && rr.text) || '[]') || [])
      } catch (e) { setUser(null) }
    }, [gh.token])
    useEffect(() => { refresh() }, [refresh])
    const saveGh = async (patch) => {
      const next = { ...cfg, github: { ...gh, ...patch } }
      setCfg(next)
      await setConfig(next)
    }
    return h('div', {},
      gh.token && user ? h('div', { className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, '已连接：' + user), h('button', { className: 'prtsBtn', onClick: () => saveGh({ token: '', login: '', loggedIn: false }) }, '断开')) : null,
      h('div', { className: 'prtsRow' },
        h('input', { className: 'prtsInput', style: { flex: 2 }, type: 'password', value: token, placeholder: 'GitHub Token (ghp_…)', onChange: (e) => setToken(e.target.value) }),
        h('button', { className: 'prtsBtn primary', onClick: async () => {
          const t2 = token.trim()
          if (!t2) return
          const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.github.com/user', headers: { Authorization: 'token ' + t2, 'User-Agent': 'PRTS', Accept: 'application/vnd.github+json' } })
          const d = JSON.parse((res && res.text) || '{}')
          if (d && d.login) { await saveGh({ token: t2, login: d.login, loggedIn: true }); setToken('') }
          else alert('Token 无效')
        } }, '连接 GitHub'),
      ),
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '创建仓库'),
      h('div', { className: 'prtsRow' },
        h('input', { className: 'prtsInput', style: { flex: 2 }, value: repoName, placeholder: '仓库名', onChange: (e) => setRepoName(e.target.value) }),
        h('button', { className: 'prtsBtn', disabled: !gh.token, onClick: async () => {
          await api('POST', '/prts/api/http', { method: 'POST', url: 'https://api.github.com/user/repos', headers: { Authorization: 'token ' + gh.token, 'User-Agent': 'PRTS', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: repoName.trim(), private: false }) })
          setRepoName(''); refresh()
        } }, '创建'),
      ),
      h('div', { className: 'prtsTitle', style: { margin: '12px 0 6px' } }, '仓库'),
      repos.slice(0, 30).map((r) => h('div', { key: r.name, className: 'prtsRow' }, h('span', { className: 'prtsLabel' }, r.name + (r.private ? ' · PRIVATE' : '')))),
    )
  }

  /* ---------- balance panel ---------- */
  function BalancePanel() {
    const [cfg, setCfg] = useState({ deepseek: {} })
    const [bal, setBal] = useState(null)
    const [key, setKey] = useState('')
    const [err, setErr] = useState('')
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
    }
    return h('div', {},
      bal !== null ? h('div', { className: 'prtsItemName', style: { fontSize: 22, fontFamily: 'monospace' } }, '¥ ' + bal.toLocaleString('zh-CN', { minimumFractionDigits: 2 })) : h('div', { className: 'prtsItemDesc' }, ds.apiKey ? (err || '读取中…') : '尚未登录 / 未配置 API Key'),
      h('div', { className: 'prtsRow' },
        h('input', { className: 'prtsInput', style: { flex: 2 }, type: 'password', value: key, placeholder: 'DeepSeek API Key (sk-…)', onChange: (e) => setKey(e.target.value) }),
        h('button', { className: 'prtsBtn primary', onClick: async () => {
          const k = key.trim()
          if (!k) return
          const res = await api('POST', '/prts/api/http', { method: 'GET', url: 'https://api.deepseek.com/user/balance', headers: { Authorization: 'Bearer ' + k } })
          if (res && res.status === 200) { await saveDs({ apiKey: k, loggedIn: true }); setKey('') }
          else alert('API Key 无效')
        } }, '保存'),
      ),
      h('div', { className: 'prtsRow' },
        h('button', { className: 'prtsBtn', onClick: () => window.open('https://platform.deepseek.com/top_up', '_blank') }, '充值'),
        h('button', { className: 'prtsBtn', onClick: () => window.open('https://platform.deepseek.com/api_keys', '_blank') }, 'API Keys'),
        h('button', { className: 'prtsBtn', onClick: () => saveDs({ apiKey: '', loggedIn: false }) }, '登出'),
      ),
    )
  }

  /* ---------- PRTS panel overlay (sidebar buttons) ---------- */
  function PrtsPanel({ initialTab, onClose }) {
    const [tab, setTab] = useState(initialTab || 'skill')
    return h('div', { className: 'prtsOverlay', onClick: (e) => { if (e.target === e.currentTarget && onClose) onClose() } },
      h('div', { className: 'prtsCard' },
        h('div', { className: 'prtsCardHead' },
          h('span', { className: 'prtsDiamond' }),
          h('span', { className: 'prtsTitle' }, 'PRTS'),
          [['skill', 'SKILL市场'], ['git', 'Git'], ['balance', '余额']].map(([id, label]) =>
            h('button', { key: id, className: 'prtsChip' + (tab === id ? ' on' : ''), onClick: () => setTab(id) }, label)),
          h('div', { style: { flex: 1 } }),
          h('button', { className: 'prtsBtn', onClick: onClose }, '关闭'),
        ),
        tab === 'skill' ? h(SkillMarket, {}) : tab === 'git' ? h(GitPanel, {}) : h(BalancePanel, {}),
      ),
    )
  }

  /* ---------- first-run API-key onboarding ---------- */
  function Onboarding({ onDone }) {
    const [cfg, setCfg] = useState(null)
    useEffect(() => { getConfig().then((c) => setCfg(c || {})) }, [])
    const finish = async (cfg2) => {
      await setConfig({ ...cfg2, ui: { ...(cfg2 && cfg2.ui), onboardedApiKey: true } })
      if (onDone) onDone()
    }
    if (cfg === null) return null
    return h('div', { className: 'prtsOnboard' },
      h('div', { className: 'prtsOnboardCard' },
        h('div', { className: 'prtsOnboardTitle' }, '配置 DeepSeek API Key'),
        h('div', { className: 'prtsOnboardBody' }, '尚未检测到 DeepSeek API Key。前往设置配置，或跳转官网现场注册（注册后在 API Keys 页创建）。仅首次启动提示。'),
        h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 } },
          h('button', { className: 'prtsBtn primary', onClick: () => { if (onDone) onDone() } }, '前往设置配置'),
          h('button', { className: 'prtsBtn', onClick: () => { window.open('https://platform.deepseek.com/sign_in', '_blank'); finish(cfg) } }, '去官网注册'),
          h('button', { className: 'prtsBtn', onClick: () => finish(cfg) }, '稍后'),
        ),
      ),
    )
  }

  /* ---------- registrations ---------- */
  let openPanel = null
  let overlayKey = 0

  // slot registrations are best-effort: the skin layer above runs regardless
  if (slots === undefined) return

  // sidebar actions
  const sidebarEntries = [
    ['prts-git', 'Git', 'git', 'git'],
    ['prts-skill', 'SKILL市场', 'skill', 'skill'],
    ['prts-sys', '系统', 'sys', 'balance'],
  ]
  for (const [id, label, cfgKey, tab] of sidebarEntries) {
    slots.inject('sidebar.footer.action', () => {
      return slots.register({ name: 'sidebar.footer.action', id, order: 30, label }, () => {
        const [show, setShow] = useState(false)
        const [cfg, setCfg] = useState(null)
        useEffect(() => { getConfig().then((c) => setCfg(c || {})) }, [])
        const on = !cfg || ((cfg.ui || {}).sidebarButtons || {})[cfgKey] !== false
        if (!on) return null
        return R.createElement(R.Fragment, null,
          h('button', { className: 'prtsBtn', style: { height: 28, padding: '0 10px', fontSize: 11, letterSpacing: '0.08em' }, title: label, onClick: () => setShow(true) },
            h('span', { className: 'prtsDiamond' }), ' ' + label),
          show ? h(PrtsPanel, { initialTab: tab, onClose: () => setShow(false) }) : null,
        )
      })
    })
  }

  // settings section
  slots.inject('settings.section', () => {
    return slots.register({ name: 'settings.section', id: 'prts', order: 90, label: 'PRTS' }, (props) => {
      return h('div', { className: 'prtsBody', style: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } },
        h(PrtsSettings, {}),
      )
    })
  })

  // onboarding (first run, any port)
  let onboardingShown = false
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
  }).catch(() => {})

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
  .prtsBrand .rhombus { width: 13px; height: 13px; border: 1.5px solid var(--prts-diamond, var(--dsw-alias-brand-primary)); transform: rotate(45deg); box-shadow: 0 0 8px var(--prts-diamond, var(--dsw-alias-brand-primary)); }
  .prtsBrand .rhombus::after { content: ''; position: absolute; inset: 3px; background: var(--prts-diamond, var(--dsw-alias-brand-primary)); }
  /* hero: diamond + italic PRTS + 欢迎回归，博士 */
  .prtsHero { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 40px 0; color: var(--dsw-alias-label-primary); }
  .prtsHero .big { width: 42px; height: 42px; border: 1.5px solid var(--prts-diamond, var(--dsw-alias-brand-primary)); transform: rotate(45deg); box-shadow: 0 0 26px var(--prts-diamond, var(--dsw-alias-brand-primary)); }
  .prtsHero .word { font-style: italic; font-weight: 600; letter-spacing: 0.3em; font-size: 30px; }
  .prtsHero .tag { font-size: 13px; letter-spacing: 0.2em; color: var(--dsw-alias-label-secondary); }
  /* background diamond & square (behind the conversation) */
  .prtsBgMarks { position: fixed; left: 50%; top: 50%; z-index: 0; pointer-events: none; }
  .prtsBgMarks .d { position: absolute; width: 240px; height: 240px; border: 1px solid var(--prts-diamond, var(--dsw-alias-brand-primary)); transform: translate(-50%, -50%) rotate(45deg); opacity: 0.16; background: color-mix(in srgb, var(--prts-diamond, var(--dsw-alias-brand-primary)) 5%, transparent); box-shadow: 0 0 60px color-mix(in srgb, var(--prts-diamond, var(--dsw-alias-brand-primary)) 10%, transparent); }
  .prtsBgMarks .s { position: absolute; width: 112px; height: 112px; border: 1px solid var(--prts-square, var(--dsw-alias-brand-primary)); transform: translate(-50%, -50%); opacity: 0.14; background: color-mix(in srgb, var(--prts-square, var(--dsw-alias-brand-primary)) 5%, transparent); }
  .prtsBgMarks.vib .d { animation: prtsVib 0.16s linear infinite; }
  .prtsBgMarks.vib .s { animation: prtsVibS 0.16s linear infinite; }
  @keyframes prtsVib { 0% { transform: translate(-50%,-50%) rotate(45deg) scale(1); } 50% { transform: translate(-50%,-50%) rotate(45deg) scale(1.05); } }
  @keyframes prtsVibS { 0% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-50%,-50%) scale(1.07); } }
  /* composer expand button (PRTS diamond, hue-flow) */
  .prtsExpand { position: absolute; right: 10px; top: -34px; width: 30px; height: 30px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-overlay); color: var(--prts-accent, var(--dsw-alias-brand-primary)); cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 40; }
  .prtsExpand .arrow { font-size: 15px; line-height: 1; animation: prtsHueFlow 6s linear infinite; }
  @keyframes prtsHueFlow { from { filter: hue-rotate(0deg) brightness(1.2); } to { filter: hue-rotate(360deg) brightness(1.2); } }
  /* particle intro */
  .prtsIntro { position: fixed; inset: 0; z-index: 1000; background: var(--dsw-alias-bg-base); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: opacity 0.6s ease; }
  .prtsIntro.done { opacity: 0; pointer-events: none; }
  .prtsIntro canvas { position: absolute; inset: 0; }
  .prtsIntro .txt { position: relative; z-index: 2; color: var(--dsw-alias-label-primary); font-style: italic; letter-spacing: 0.24em; font-size: 30px; opacity: 0; transition: opacity 0.5s ease; }
  .prtsIntro .txt.show { opacity: 1; }
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

  /** Particle intro (canvas dot-cloud, two acts, click to skip). */
  function particleIntro(onDone) {
    const box = document.createElement('div')
    box.className = 'prtsIntro'
    const cv = document.createElement('canvas')
    const txt = document.createElement('div')
    txt.className = 'txt'
    box.appendChild(cv)
    box.appendChild(txt)
    document.body.appendChild(box)
    const ctx = cv.getContext('2d')
    const N = 2600
    const pts = []
    const targets = []
    const W = () => { cv.width = window.innerWidth; cv.height = window.innerHeight }
    W()
    window.addEventListener('resize', W)
    for (let i = 0; i < N; i++) {
      pts.push({ x: Math.random() * cv.width, y: Math.random() * cv.height, tx: Math.random() * cv.width, ty: Math.random() * cv.height, s: 0.6 + Math.random() * 1.2 })
      targets.push(null)
    }
    function textPoints(text, fontPx) {
      ctx.font = 'italic ' + fontPx + 'px sans-serif'
      const w = ctx.measureText(text).width
      const off = document.createElement('canvas')
      off.width = Math.ceil(w) + 40
      off.height = fontPx * 2
      const o = off.getContext('2d')
      o.font = 'italic ' + fontPx + 'px sans-serif'
      o.fillStyle = '#fff'
      o.fillText(text, 20, fontPx)
      const img = o.getImageData(0, 0, off.width, off.height).data
      const out = []
      const gap = Math.max(2, Math.floor(N / 6000))
      for (let y = 0; y < off.height; y += gap) {
        for (let x = 0; x < off.width; x += gap) {
          if (img[(y * off.width + x) * 4 + 3] > 128) out.push({ x: x + (cv.width - off.width) / 2, y: y + (cv.height - off.height) / 2 })
        }
      }
      return out
    }
    const acts = [['欢迎使用PRTS', 50], ['PRTS · DEEPSEEK', 36], ['◆', 120]]
    let act = 0
    const play = () => {
      const [text, font] = acts[act]
      txt.textContent = text
      txt.classList.add('show')
      const tp = textPoints(text, font)
      for (let i = 0; i < N; i++) {
        const t = tp[i % tp.length]
        targets[i] = t ? { x: t.x + (Math.random() - 0.5) * 2, y: t.y + (Math.random() - 0.5) * 2 } : null
      }
    }
    let raf = 0
    const frame = () => {
      ctx.clearRect(0, 0, cv.width, cv.height)
      ctx.fillStyle = '#FAFAFA'
      for (let i = 0; i < N; i++) {
        const p = pts[i]
        const t = targets[i]
        if (t) { p.x += (t.x - p.x) * 0.08; p.y += (t.y - p.y) * 0.08 }
        ctx.globalAlpha = 0.7
        ctx.fillRect(p.x, p.y, p.s, p.s)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    play()
    const next = setInterval(() => {
      act++
      if (act >= acts.length) { clearInterval(next); finish() }
      else play()
    }, 1900)
    let done = false
    function finish() {
      if (done) return
      done = true
      clearInterval(next)
      cancelAnimationFrame(raf)
      box.classList.add('done')
      setTimeout(() => { box.remove(); if (onDone) onDone() }, 700)
    }
    box.addEventListener('click', finish)
    setTimeout(finish, 4600)
    return finish
  }

  /** Replace the DeepSeek whale brand with PRTS. */
  function swapBrand() {
    const walk = () => {
      // sidebar top area: find svg-like brand marks and text "DeepSeek"
      const tree = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const textNodes = []
      let n
      while ((n = tree.nextNode())) {
        if (/deepseek|dsh/i.test((n.textContent || '').trim()) && n.textContent.trim().length < 30) textNodes.push(n)
      }
      for (const node of textNodes.slice(0, 4)) {
        const parent = node.parentElement
        if (!parent || parent.querySelector('.prtsBrand')) continue
        const el = document.createElement('span')
        el.className = 'prtsBrand'
        el.innerHTML = '<span class="rhombus" style="position:relative;display:inline-block"></span>PRTS'
        node.replaceWith(el)
      }
    }
    walk()
    setTimeout(walk, 1500)
  }

  /** Hero (blank conversation): diamond + italic PRTS + 欢迎回归，博士. */
  function swapHero() {
    const walk = () => {
      const cands = [...document.querySelectorAll('div')].filter((d) => /deepseek/i.test((d.textContent || '').slice(0, 120)) && d.children.length <= 3 && d.clientHeight > 80)
      const target = cands[cands.length - 1]
      if (!target || target.querySelector('.prtsHero')) return
      target.innerHTML = ''
      const hero = document.createElement('div')
      hero.className = 'prtsHero'
      hero.innerHTML = '<span class="big"></span><span class="word">PRTS</span><span class="tag">欢迎回归，博士</span>'
      target.appendChild(hero)
    }
    walk()
    setTimeout(walk, 1500)
    setTimeout(walk, 3500)
  }

  /** Composer expand button above the input area. */
  function composerExpand() {
    const walk = () => {
      const ta = document.querySelector('textarea')
      if (!ta || document.querySelector('.prtsExpand')) return
      let host = ta.parentElement
      for (let i = 0; i < 6 && host; i++) {
        if (getComputedStyle(host).position === 'relative' || getComputedStyle(host).position === 'absolute') break
        host = host.parentElement
      }
      const wrap = ta.closest('form') || ta.parentElement.parentElement
      if (!wrap) return
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'prtsExpand'
      btn.title = '展开输入框'
      btn.innerHTML = '<span class="arrow">▲</span>'
      let open = false
      btn.addEventListener('click', () => {
        open = !open
        ta.style.minHeight = open ? '180px' : ''
        btn.innerHTML = '<span class="arrow">' + (open ? '▼' : '▲') + '</span>'
      })
      ;(host || wrap).style.position = (host || wrap).style.position || 'relative'
      ;(host || wrap).appendChild(btn)
    }
    walk()
    setTimeout(walk, 2000)
  }

  /** Background diamond + square (vibrates while voice is on). */
  function backgroundMarks() {
    if (document.getElementById('prtsBgMarks')) return
    const marks = document.createElement('div')
    marks.id = 'prtsBgMarks'
    marks.className = 'prtsBgMarks'
    marks.innerHTML = '<span class="d"></span><span class="s"></span>'
    document.body.appendChild(marks)
    return marks
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

  /* ---------- mount the skin ---------- */
  ensureSkinCss()
  backgroundMarks()
  const closeIntro = particleIntro(() => {})
  swapBrand()
  swapHero()
  composerExpand()
  voiceButton()
  ctx.effect(() => {
    const int = ctx.get('timer') ? ctx.get('timer').interval(() => {
      swapBrand(); swapHero(); composerExpand(); voiceButton()
    }, 6000) : null
    return () => { if (int) int() }
  })

  ctx.effect(() => () => { if (styleEl) { styleEl.remove(); styleEl = null } })
}

export default { apply }
