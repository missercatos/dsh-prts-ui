/**
 * dsh-prts-ui/host — PRTS host half for the dsh profile bundle.
 *
 * Serves the PRTS panel APIs the client plugin consumes (skills, wallpaper,
 * editors, profiles, logo, config) as /prts/api/* routes on the same dsh web
 * origin. Runs on every port the profile's dsh web listens on.
 */

import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ASSETS_DIR = dirname(fileURLToPath(import.meta.url)) + '/../assets/'

export const name = 'prts-host'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

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
  const profileDir = () => join(DSH_HOME, 'profiles', 'web')
  const cfgPath = () => join(profileDir(), 'prts-ui.json')
  const shell = ctx.get('shell')
  const runShell = async (cmd, timeout) => {
    if (shell === undefined) throw new Error('no shell service')
    let spec
    try { spec = shell.resolve({ command: cmd, timeout }) } catch (e) { spec = { command: cmd } }
    const r = await shell.run(spec)
    return String((r && r.stdout) || '')
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
      if (req.method === 'GET') {
        const file = safeName(params.file)
        if (!file) return json(res, 400, { ok: false })
        const b64 = await runShell('base64 -w0 ' + JSON.stringify(dir + '/' + file), 60000)
        const mime = /\.png$/.test(file) ? 'image/png' : /\.mp4$/.test(file) ? 'video/mp4' : 'image/jpeg'
        return json(res, 200, { dataUrl: 'data:' + mime + ';base64,' + b64.trim() })
      }
      if (req.method === 'DELETE') {
        await runShell('rm -f ' + JSON.stringify(dir) + '/*', 30000).catch(() => {})
        return json(res, 200, { ok: true })
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}')
        const file = safeName(body.file)
        if (!file) return json(res, 400, { ok: false })
        await runShell('mkdir -p ' + JSON.stringify(dir), 30000)
        await runShell('echo ' + JSON.stringify(String(body.base64 || '')) + ' | base64 -d > ' + JSON.stringify(dir + '/' + file), 120000)
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
      const m = /^https:\/\/([^/]+)/.exec(url)
      if (!m || HTTP_HOSTS.indexOf(m[1]) < 0) return json(res, 403, { ok: false, error: 'host not allowed' })
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

  /* PRTS logo (favicon / brand img) */
  const logoHandler = async (req, res) => {
    try {
      const buf = await readFile(join(ASSETS_DIR, 'prts.png'))
      json(res, 200, { b64: buf.toString('base64') })
    } catch (e) {
      json(res, 404, { ok: false })
    }
  }

  const disposers = [
    webServer.register({ kind: 'prefix', path: '/prts/api/config', handler: configHandler }),
    webServer.register({ kind: 'prefix', path: '/prts/api/skills', handler: skillsHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/skill-install', handler: skillInstallHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/skill-delete', handler: skillDeleteHandler }),
    webServer.register({ kind: 'prefix', path: '/prts/api/wallpaper', handler: wallpaperHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/open-path', handler: openPathHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/detect-editors', handler: detectEditorsHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/http', handler: httpProxyHandler }),
    webServer.register({ kind: 'exact', path: '/prts/api/logo', handler: logoHandler }),
  ]
  ctx.effect(() => () => { for (const d of disposers) d() })
}
