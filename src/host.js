/**
 * dsh-prts-ui/host — PRTS host half for the dsh profile bundle.
 *
 * Serves the PRTS panel APIs the client plugin consumes (skills, wallpaper,
 * editors, profiles, logo, config) as /prts/api/* routes on the same dsh web
 * origin. Runs on every port the profile's dsh web listens on.
 */

import { join, dirname } from 'node:path'
import { homedir, networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { readdirSync, statSync, writeFileSync, readFileSync, mkdirSync, unlinkSync, rmSync, existsSync, openSync, writeSync, closeSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ASSETS_DIR = dirname(fileURLToPath(import.meta.url)) + '/../assets/'

export const name = 'prts-host'

/** The web route registry must exist before the PRTS routes register. */
export const inject = ['webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
// The profile this host half belongs to (the isolated PRTS profile; only
// overridden when PRTS_DSH_PROFILE points somewhere else).
const PRTS_PROFILE = process.env.PRTS_DSH_PROFILE || 'prts'

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  const json = (res, code, obj) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
  const safeName = (name) => String(name || '').replace(/[^A-Za-z0-9._-]/g, '')
  const skillsRoot = () => join(DSH_HOME, 'skills')
  const profileDir = () => join(DSH_HOME, 'profiles', PRTS_PROFILE)
  const cfgPath = () => join(profileDir(), 'prts-ui.json')
  const shell = ctx.get('shell')
  const runShell = async (cmd, timeout) => {
    if (shell === undefined) throw new Error('no shell service')
    let spec
    try { spec = shell.resolve({ command: cmd, timeoutMs: timeout }) } catch (e) { spec = { command: cmd } }
    const r = await shell.run(spec)
    // rc.6 shape: stdout is a CollectedOutput ({ text, truncated, ... }).
    const out = r && r.stdout
    const text = typeof out === 'object' && out !== null ? String(out.text || '') : String(out || '')
    if (!text && r && r.stderr && typeof r.stderr === 'object' && r.stderr.text) return 'ERR: ' + String(r.stderr.text).slice(0, 2000)
    return text
  }

  /* ---------- PRTS config (prts-ui.json) ---------- */
  const readConfig = async () => {
    try {
      const fs = ctx.get('fs')
      const target = await fs.resolve(cfgPath())
      return JSON.parse(await fs.readText(target))
    } catch (e) { return {} }
  }
  const writeConfig = async (cfg) => {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('no fs service')
    const target = await fs.resolve(cfgPath())
    await fs.writeText(target, JSON.stringify(cfg, null, 2))
    return true
  }
  const configHandler = async (req, res) => {
    try {
      if (req.method === 'GET') return json(res, 200, await readConfig())
      if (req.method === 'POST') {
        const patch = JSON.parse(await readBody(req) || '{}')
        const cur = await readConfig()
        const next = Object.assign({}, cur, patch, patch.ui ? { ui: Object.assign({}, cur.ui, patch.ui) } : {})
        await writeConfig(next)
        return json(res, 200, { ok: true })
      }
      json(res, 405, { ok: false })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  /* ---------- skills ---------- */
  const parseFrontmatter = (text) => {
    const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ''))
    const out = {}
    if (m) {
      for (const line of m[1].split('\n')) {
        const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
        if (kv) out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
      }
    }
    return out
  }
  const skillsHandler = async (req, res) => {
    try {
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('no fs service')
      const url = String(req.url || '')
      const qs = url.split('?')[1] || ''
      const params = {}
      for (const pair of qs.split('&')) {
        const i = pair.indexOf('=')
        if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
      }
      const root = skillsRoot()
      if (req.method === 'GET') {
        if (params.name) {
          const target = await fs.resolve(root + '/' + safeName(params.name) + '/SKILL.md')
          return json(res, 200, { content: await fs.readText(target) })
        }
        const entries = await fs.listDir(await fs.resolve(root)).catch(() => [])
        const out = []
        for (const e of entries) {
          if (e.type !== 'directory') continue
          let text = ''
          try { text = await fs.readText(await fs.resolve(root + '/' + e.name + '/SKILL.md')) } catch (err) { continue }
          const fm = parseFrontmatter(text)
          const name = fm.name || e.name
          out.push({
            name,
            description: fm.description || '',
            path: root + '/' + e.name,
            persona: /(^|[-_.])persona($|[-_.])/.test(name) || fm.category === 'persona' || fm.persona === 'true',
          })
        }
        return json(res, 200, out)
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}')
        const name = safeName(body.name)
        if (!name) return json(res, 400, { ok: false })
        const target = await fs.resolve(root + '/' + name + '/SKILL.md')
        await fs.writeText(target, String(body.content || ''))
        return json(res, 200, { ok: true })
      }
      json(res, 405, { ok: false })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  const skillInstallHandler = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const repo = String(body.repo || '')
      const subdir = body.subdir ? String(body.subdir) : ''
      const baseName = repo.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '')
      if (!/^[A-Za-z0-9._-]+$/.test(baseName) || !baseName) return json(res, 400, { ok: false })
      const root = skillsRoot()
      const tmp = '/tmp/prts-skill-' + Date.now().toString(36)
      await runShell('mkdir -p ' + JSON.stringify(root) + ' && git clone --depth 1 ' + JSON.stringify(repo) + ' ' + JSON.stringify(tmp), 300000)
      const script = 'root=' + JSON.stringify(root) + '\ntmp=' + JSON.stringify(tmp) + '\n' +
        (subdir
          ? 'if [ ! -f "$tmp/' + subdir + '/SKILL.md" ]; then echo "ERROR: no SKILL.md"; exit 1; fi\nn=$(basename ' + JSON.stringify(subdir) + ')\nrm -rf "$root/$n"\nmv "$tmp/' + subdir + '" "$root/$n"\necho "$n"'
          : 'found=0\nfor d in "$tmp"/*/ "$tmp"/*/*/; do\n  [ -f "$d/SKILL.md" ] || continue\n  n=$(basename "$d")\n  rm -rf "$root/$n"\n  mv "$d" "$root/$n"\n  echo "$n"\n  found=1\ndone\nif [ "$found" != "1" ]; then echo "ERROR: no SKILL.md"; exit 1; fi')
      const out = await runShell(script, 60000)
      await runShell('rm -rf ' + JSON.stringify(tmp), 30000).catch(() => {})
      if (out.indexOf('ERROR') >= 0) return json(res, 400, { ok: false, error: out.trim() })
      json(res, 200, { ok: true, stdout: out })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  const skillDeleteHandler = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const name = safeName(body.name)
      if (!name) return json(res, 400, { ok: false })
      await runShell('rm -rf ' + JSON.stringify(skillsRoot() + '/' + name), 60000)
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  /* ---------- wallpaper ---------- */
  // Uploads and reads go through plain fs (never shell): a single `echo`
  // argument is capped at 128 KB (MAX_ARG_STRLEN), so anything but tiny
  // images used to fail silently — the "uploaded but never shows" bug.
  const wmime = (file) => {
    const f = String(file || '').toLowerCase()
    if (/\.png$/.test(f)) return 'image/png'
    if (/\.webp$/.test(f)) return 'image/webp'
    if (/\.gif$/.test(f)) return 'image/gif'
    if (/\.(mp4|m4v)$/.test(f)) return 'video/mp4'
    if (/\.webm$/.test(f)) return 'video/webm'
    if (/\.mov$/.test(f)) return 'video/quicktime'
    if (/\.jpe?g$/.test(f)) return 'image/jpeg'
    return 'image/jpeg'
  }
  const wallpaperHandler = async (req, res) => {
    try {
      const dir = join(profileDir(), 'wallpaper')
      const url = String(req.url || '')
      const qs = url.split('?')[1] || ''
      const params = {}
      for (const pair of qs.split('&')) {
        const i = pair.indexOf('=')
        if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
      }
      if (req.method === 'GET' && /\/wallpapers$/.test(url.split('?')[0])) {
        // library listing: every uploaded file with size + mtime
        if (!existsSync(dir)) return json(res, 200, { items: [] })
        const items = readdirSync(dir)
          .filter((f) => safeName(f) === f)
          .map((f) => {
            try {
              const st = statSync(join(dir, f))
              return { file: f, mime: wmime(f), size: st.size, mtime: st.mtimeMs }
            } catch (e) { return null }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime)
        return json(res, 200, { items })
      }
      if (req.method === 'GET') {
        const file = safeName(params.file)
        if (!file) return json(res, 400, { ok: false })
        if (!existsSync(join(dir, file))) return json(res, 404, { ok: false })
        const b64 = readFileSync(join(dir, file)).toString('base64')
        return json(res, 200, { dataUrl: 'data:' + wmime(file) + ';base64,' + b64 })
      }
      if (req.method === 'DELETE') {
        const body = JSON.parse(await readBody(req) || '{}')
        const file = body.file ? safeName(body.file) : ''
        if (!file) {
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
          return json(res, 200, { ok: true })
        }
        if (existsSync(join(dir, file))) unlinkSync(join(dir, file))
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}')
        const file = safeName(body.file)
        if (!file) return json(res, 400, { ok: false })
        mkdirSync(dir, { recursive: true })
        const buf = Buffer.from(String(body.base64 || ''), 'base64')
        const offset = Number(body.offset) || 0
        if (offset <= 0) writeFileSync(join(dir, file), buf)
        else {
          // chunked upload: dsh's request channel caps bodies near ~96 KB
          // (E2BIG), so big images/videos arrive in offset-ordered slices
          const fd = openSync(join(dir, file), 'a')
          try { writeSync(fd, buf) } finally { closeSync(fd) }
        }
        return json(res, 200, { ok: true, file })
      }
      json(res, 405, { ok: false })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  /* ---------- message feedback sidecar ---------- */
  // dsh's own messageFeedback.* RPCs are not exposed on the HTTP proxy, so
  // PRTS keeps its own per-session sidecar (profileDir/feedback/<session>.json).
  const feedbackHandler = async (req, res) => {
    try {
      const url = String(req.url || '')
      const qs = url.split('?')[1] || ''
      const params = {}
      for (const pair of qs.split('&')) {
        const i = pair.indexOf('=')
        if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
      }
      const session = safeName(params.session) || ''
      if (!session) return json(res, 400, { ok: false, error: 'missing session' })
      const file = join(profileDir(), 'feedback', session + '.json')
      const load = () => {
        if (!existsSync(file)) return {}
        try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return {} }
      }
      if (req.method === 'GET') return json(res, 200, { ok: true, items: load() })
      const body = JSON.parse(await readBody(req) || '{}')
      if (req.method === 'PUT') {
        const messageId = safeName(body.messageId) || ''
        const rating = body.rating === 'good' ? 'good' : body.rating === 'bad' ? 'bad' : ''
        if (!messageId || !rating) return json(res, 400, { ok: false, error: 'bad payload' })
        const items = load()
        items[messageId] = { rating, ts: Date.now() }
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, JSON.stringify(items, null, 2))
        return json(res, 200, { ok: true })
      }
      if (req.method === 'DELETE') {
        const items = load()
        delete items[body.messageId || '']
        writeFileSync(file, JSON.stringify(items, null, 2))
        return json(res, 200, { ok: true })
      }
      json(res, 405, { ok: false })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  /* ---------- editors / open path / profiles ---------- */
  const EDITORS = [
    { id: 'default', name: '系统默认', cmd: null, terminal: false },
    { id: 'code', name: 'VS Code', cmd: 'code', terminal: false },
    { id: 'gedit', name: '文本编辑器 (gedit)', cmd: 'gedit', terminal: false },
    { id: 'kate', name: 'Kate', cmd: 'kate', terminal: false },
    { id: 'vim', name: 'vim (终端)', cmd: 'vim', terminal: true },
    { id: 'nvim', name: 'nvim (终端)', cmd: 'nvim', terminal: true },
    { id: 'nano', name: 'nano (终端)', cmd: 'nano', terminal: true },
  ]
  const openPathHandler = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const p = String(body.path || '')
      if (!p || p.indexOf('/') < 0) return json(res, 400, { ok: false })
      const ed = EDITORS.find((e) => e.id === body.editor) || EDITORS[0]
      let cmd
      if (ed.cmd && ed.terminal) cmd = 'nohup x-terminal-emulator -e ' + JSON.stringify(ed.cmd + ' ' + p) + ' >/dev/null 2>&1 &'
      else if (ed.cmd) cmd = 'nohup ' + ed.cmd + ' ' + JSON.stringify(p) + ' >/dev/null 2>&1 &'
      else cmd = 'xdg-open ' + JSON.stringify(p) + ' >/dev/null 2>&1 || open ' + JSON.stringify(p) + ' >/dev/null 2>&1 || true'
      await runShell(cmd, 30000)
      json(res, 200, { ok: true })
    } catch (e) {
      json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }
  const detectEditorsHandler = async (req, res) => {
    try {
      const out = [EDITORS[0]]
      for (const e of EDITORS.slice(1)) {
        const found = await runShell('command -v ' + JSON.stringify(e.cmd) + ' >/dev/null 2>&1 && echo yes || echo no', 10000)
        if (found.trim() === 'yes') out.push(e)
      }
      json(res, 200, out)
    } catch (e) { json(res, 200, [EDITORS[0]]) }
  }

  /* ---------- http proxy (balance / github, host whitelist) ---------- */
  const HTTP_HOSTS = ['api.deepseek.com', 'platform.deepseek.com', 'api.github.com', 'github.com']
  const httpProxyHandler = async (req, res) => {
    try {
      const body = JSON.parse(await readBody(req) || '{}')
      const url = String(body.url || '')
      const method = String(body.method || 'GET').toUpperCase()
      const m = /^https?:\/\/([^/]+)/.exec(url)
      // Wallpaper Engine's local JSON API is loopback-only (port 35585).
      const localWe = /^127\.0\.0\.1(:35585)?$|^localhost(:35585)?$|^\[::1\](:35585)?$/.test(m ? m[1] : '')
      if (!m || (HTTP_HOSTS.indexOf(m[1]) < 0 && !localWe)) return json(res, 403, { ok: false, error: 'host not allowed' })
      const headers = body.headers || {}
      const hdr = Object.keys(headers).map((k) => '-H ' + JSON.stringify(String(k) + ': ' + String(headers[k]))).join(' ')
      let cmd = 'curl -sS -w "\\n%{http_code}" -X ' + method + ' ' + hdr + ' ' + JSON.stringify(url)
      if (body.body) cmd += ' --data-binary ' + JSON.stringify(String(body.body))
      const out = await runShell(cmd, 120000)
      const lines = out.split('\n')
      const status = parseInt(lines[lines.length - 1], 10) || 502
      json(res, 200, { status, text: lines.slice(0, -1).join('\n') })
    } catch (e) {
      json(res, 502, { ok: false, error: String(e && e.message ? e.message : e) })
    }
  }

  /* ---------- mobile client (scan-to-connect phone UI) ---------- */
  const mobileToken = async (reset) => {
    const cfg = await readConfig()
    if (reset || !cfg.mobileToken) {
      const tok = 'm' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 10)
      await writeConfig(Object.assign({}, cfg, { mobileToken: tok }))
      return tok
    }
    return String(cfg.mobileToken)
  }
  const mobileHandler = async (req, res) => {
    try {
      const url = String(req.url || '')
      const qs = url.split('?')[1] || ''
      const params = {}
      for (const pair of qs.split('&')) {
        const i = pair.indexOf('=')
        if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
      }
      const token = await mobileToken(false)
      if (params.t !== token) {
        res.statusCode = 403
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>PRTS</title></head><body style="background:#0A0A0B;color:#FAFAFA;font-family:sans-serif;padding:40px;line-height:2">链接无效或已重置 —— 请在电脑的 PRTS 中重新打开「移动端」扫码。</body></html>')
        return
      }
      const { readFile } = await import('node:fs/promises')
      const html = await readFile(join(dirname(ASSETS_DIR), 'web', 'index.html'), 'utf8')
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(html)
    } catch (e) {
      json(res, 500, { ok: false, error: String((e && e.message) || e) })
    }
  }
  const lanAddress = () => {
    const list = networkInterfaces()
    const candidates = []
    for (const name of Object.keys(list)) {
      for (const it of list[name] || []) {
        if (it.family !== 'IPv4' && it.family !== 4) continue
        if (it.internal) continue
        candidates.push(it.address)
      }
    }
    const priv = candidates.find((a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a))
    return priv || candidates[0] || null
  }
  const mobileInfoHandler = async (req, res) => {
    try {
      const reset = req.method === 'POST'
      const token = await mobileToken(reset)
      const ip = lanAddress()
      const port = String((req.headers && req.headers.host) || '').split(':')[1] || '3081'
      if (!ip) return json(res, 200, { enabled: false })
      const url = 'http://' + ip + ':' + port + '/prts/m?t=' + token
      json(res, 200, { enabled: true, url, token })
    } catch (e) {
      json(res, 500, { ok: false, error: String((e && e.message) || e) })
    }
  }
  const mobileManifestHandler = async (req, res) => {
    try {
      const token = await mobileToken(false)
      res.statusCode = 200
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({
        name: 'PRTS', short_name: 'PRTS', display: 'standalone',
        start_url: '/prts/m?t=' + token, scope: '/prts/',
        background_color: '#0A0A0B', theme_color: '#0A0A0B',
        icons: [{ src: '/prts/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
      }))
    } catch (e) { json(res, 500, { ok: false }) }
  }
  const mobileSwHandler = async (req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/javascript; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end("self.addEventListener('install', function (e) { self.skipWaiting() });\nself.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()) });\nself.addEventListener('fetch', function (e) { e.respondWith(fetch(e.request).catch(function () { return caches.match(e.request) })) });\n")
  }
  const mobileIconHandler = async (req, res) => {
    try {
      const { readFile } = await import('node:fs/promises')
      const buf = await readFile(join(ASSETS_DIR, 'prts.png'))
      res.statusCode = 200
      res.setHeader('content-type', 'image/png')
      res.end(buf)
    } catch (e) { json(res, 404, { ok: false }) }
  }

  /* ---------- stable-channel updates (website release set only) ---------- */
  // In-process updater: the shell service runs sandboxed and cannot reach the
  // package files, so the stable-channel logic runs right here instead.
  const updateCheckHandler = async (req, res) => {
    try {
      const { check } = await import('../scripts/update-core.mjs')
      json(res, 200, await check())
    } catch (e) { json(res, 200, { current: '?', latest: '?', update: false, channel: 'stable', error: String((e && e.message) || e) }) }
  }
  const updateHandler = async (req, res) => {
    try {
      const { update } = await import('../scripts/update-core.mjs')
      json(res, 200, await update())
    } catch (e) { json(res, 500, { ok: false, error: String((e && e.message) || e) }) }
  }

  /* PRTS logo (favicon / brand img) */
  const logoHandler = async (req, res) => {
    try {
      const buf = await readFile(join(ASSETS_DIR, 'prts.png'))
      json(res, 200, { b64: buf.toString('base64') })
    } catch (e) {
      json(res, 404, { ok: false })
    }
  }

  // App-rendered flag: the client plugin POSTs here once the app is fully
  // rendered (document complete + composer on screen). The Electron splash
  // probes it so the particle effect keeps playing until the app is really
  // ready — dsh's own boot screen never flashes through. Freshness window
  // keeps a stale flag (app crashed / new load) from skipping the splash.
  let prtsReadyAt = 0
  const readyHandler = async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    if (req.method === 'POST') { prtsReadyAt = Date.now() }
    json(res, 200, { ok: true, ready: Date.now() - prtsReadyAt < 6000 })
  }

  const disposers = [
    webServer.register({ kind: 'prefix', path: '/prts/api/config', handler: configHandler }),
    webServer.register({ kind: 'prefix', path: '/prts/api/skills', handler: skillsHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/skill-install', handler: skillInstallHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/skill-delete', handler: skillDeleteHandler }),
    webServer.register({ kind: 'prefix', path: '/prts/api/wallpaper', handler: wallpaperHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/wallpapers', handler: wallpaperHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/feedback', handler: feedbackHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/open-path', handler: openPathHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/detect-editors', handler: detectEditorsHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/http', handler: httpProxyHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/logo', handler: logoHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/ready', handler: readyHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/update-check', handler: updateCheckHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/update', handler: updateHandler }),
    webServer.register({ kind: 'prefix', path: '/prts/m', handler: mobileHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/mobile-info', handler: mobileInfoHandler }),
    webServer.register({ kind: 'exact', path: '/prts/manifest.json', handler: mobileManifestHandler }),
    webServer.register({ kind: 'exact', path: '/prts/sw.js', handler: mobileSwHandler }),
    webServer.register({ kind: 'exact', path: '/prts/icon.png', handler: mobileIconHandler }),
  ]
  ctx.effect(() => () => { for (const d of disposers) d() })
}
