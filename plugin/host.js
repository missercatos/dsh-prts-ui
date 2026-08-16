return {
  apply(ctx) {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    const GUI_PATH = '/home/a/dsh-prts-ui/web/index.html'
    const STT_SCRIPT = '/home/a/dsh-prts-ui/scripts/stt-cache.mjs'
    let cache = null

    async function loadGui() {
      if (cache !== null) return cache
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('no fs service')
      const target = await fs.resolve(GUI_PATH)
      const html = await fs.readText(target)
      cache = html
      return html
    }

    async function runShell(cmd, timeoutMs) {
      const shell = ctx.get('shell')
      if (shell === undefined) throw new Error('no shell service')
      let spec
      try { spec = shell.resolve({ command: cmd, timeout: timeoutMs }) }
      catch (e) { spec = { command: cmd } }
      const result = await shell.run(spec)
      const stdout = String(result && result.stdout !== undefined ? result.stdout : '')
      const filePath = stdout.trim().split('\n').pop()
      if (!filePath || filePath.indexOf('/') < 0) {
        throw new Error('stt cache miss: ' + String(result && result.stderr ? result.stderr : ''))
      }
      return filePath
    }

    async function serveFile(req, res, filePath, contentType, isBinary) {
      const fs = ctx.get('fs')
      if (fs === undefined) throw new Error('no fs service')
      const target = await fs.resolve(filePath)
      res.statusCode = 200
      res.setHeader('content-type', contentType)
      res.setHeader('cache-control', 'public, max-age=86400')
      if (isBinary) {
        res.end(await fs.readBytes(target, undefined, 128 * 1024 * 1024))
      } else {
        res.end(await fs.readText(target))
      }
    }

    const handler = async (req, res) => {
      try {
        const html = await loadGui()
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(html)
      } catch (e) {
        res.statusCode = 503
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('PRTS GUI bundle is not readable from the host filesystem: ' + String(e && e.message ? e.message : e))
      }
    }

    // Speech-engine files: cached by scripts/stt-cache.mjs (npmmirror with
    // npmjs fallback). The Electron build serves the same files over a
    // registered prts-stt:// protocol instead of these routes.
    const sttHandler = (file, contentType, isBinary) => async (req, res) => {
      try {
        const filePath = await runShell('node ' + STT_SCRIPT + ' ensure ' + file, 180000)
        await serveFile(req, res, filePath, contentType, isBinary)
      } catch (e) {
        res.statusCode = 503
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('PRTS stt file unavailable: ' + String(e && e.message ? e.message : e))
      }
    }

    // Whisper-tiny model files: first request downloads the whole model set
    // from hf-mirror (huggingface.co fallback) into the shared cache.
    const modelHandler = async (req, res) => {
      const file = String(req.url || '').split('/').filter(Boolean).pop() || ''
      try {
        const filePath = await runShell('node ' + STT_SCRIPT + ' model-file ' + file, 600000)
        const ct = file.endsWith('.onnx') ? 'application/octet-stream'
          : file.endsWith('.json') ? 'application/json; charset=utf-8'
          : 'text/plain; charset=utf-8'
        await serveFile(req, res, filePath, ct, file.endsWith('.onnx'))
      } catch (e) {
        res.statusCode = 503
        res.setHeader('content-type', 'text/plain; charset=utf-8')
        res.end('PRTS model file unavailable: ' + String(e && e.message ? e.message : e))
      }
    }

    const disposers = [
      webServer.register({ kind: 'exact', path: '/prts', handler }),
      webServer.register({ kind: 'exact', path: '/prts/', handler }),
      webServer.register({ kind: 'exact', path: '/prts/stt/transformers.min.js', handler: sttHandler('transformers.min.js', 'text/javascript; charset=utf-8', false) }),
      webServer.register({ kind: 'exact', path: '/prts/stt/assets/ort-wasm-simd-threaded.jsep.wasm', handler: sttHandler('ort-wasm-simd-threaded.jsep.wasm', 'application/wasm', true) }),
      webServer.register({ kind: 'exact', path: '/prts/stt/assets/ort-wasm-simd-threaded.jsep.mjs', handler: sttHandler('ort-wasm-simd-threaded.jsep.mjs', 'text/javascript; charset=utf-8', false) }),
      webServer.register({ kind: 'prefix', path: '/prts/stt/model', handler: modelHandler }),
      // The renderer resolves the model as a relative path ("whisper-tiny/…")
      // against the page origin — serve the same handler at the page root too.
      webServer.register({ kind: 'prefix', path: '/whisper-tiny', handler: modelHandler }),
    ]

    /* ---------- panel APIs for the browser form of PRTS ---------- */

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

    let HOME = ''
    async function homeDir() {
      if (HOME) return HOME
      try {
        const out = await runShell('echo $HOME', 10000)
        HOME = out.trim() || '/root'
      } catch (e) { HOME = '/root' }
      return HOME
    }
    async function skillsRoot() { return (await homeDir()) + '/.dsh/skills' }
    function safeName(name) { return String(name || '').replace(/[^A-Za-z0-9._-]/g, '') }

    // skills: list / read / write / delete / install (the dsh user root)
    const skillsHandler = async (req, res) => {
      try {
        const fsService = ctx.get('fs')
        const url = String(req.url || '')
        const qs = url.split('?')[1] || ''
        const params = {}
        for (const pair of qs.split('&')) {
          const i = pair.indexOf('=')
          if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
        }
        const root = await skillsRoot()
        if (req.method === 'GET') {
          if (params.name) {
            const target = await fsService.resolve(root + '/' + safeName(params.name) + '/SKILL.md')
            const content = await fsService.readText(target)
            return json(res, 200, { content })
          }
          const entries = await fsService.listDir(await fsService.resolve(root)).catch(() => [])
          const out = []
          for (const e of entries) {
            if (e.type !== 'directory') continue
            const name = e.name
            let text = ''
            try {
              text = await fsService.readText(await fsService.resolve(root + '/' + name + '/SKILL.md'))
            } catch (err) { continue }
            const fm = {}
            const m = /^---\n([\s\S]*?)\n---/.exec(text)
            if (m) {
              for (const line of m[1].split('\n')) {
                const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
                if (kv) fm[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
              }
            }
            const skillName = fm.name || name
            out.push({
              name: skillName,
              description: fm.description || '',
              path: root + '/' + name,
              persona: /(^|[-_.])persona($|[-_.])/.test(skillName) || fm.category === 'persona' || fm.persona === 'true',
            })
          }
          return json(res, 200, out)
        }
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}')
          const name = safeName(body.name)
          if (!name) return json(res, 400, { ok: false, error: 'bad skill name' })
          const target = await fsService.resolve(root + '/' + name + '/SKILL.md')
          await fsService.writeText(target, String(body.content || ''))
          return json(res, 200, { ok: true })
        }
        json(res, 405, { ok: false, error: 'method' })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    const skillDeleteHandler = async (req, res) => {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        const name = safeName(body.name)
        if (!name) return json(res, 400, { ok: false, error: 'bad skill name' })
        await runShell('rm -rf ' + JSON.stringify((await skillsRoot()) + '/' + name), 60000)
        json(res, 200, { ok: true })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    const skillInstallHandler = async (req, res) => {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        const repo = String(body.repo || '')
        const name = repo.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '')
        if (!/^[A-Za-z0-9._-]+$/.test(name) || !name) return json(res, 400, { ok: false, error: 'bad repo name' })
        const dest = (await skillsRoot()) + '/' + name
        const out = await runShell('git clone --depth 1 ' + JSON.stringify(repo) + ' ' + JSON.stringify(dest), 300000)
        json(res, 200, { ok: true, stdout: out, name })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // profiles: the same inventory the Electron bridge reads (givemyflag etc.)
    const profilesHandler = async (req, res) => {
      try {
        const fsService = ctx.get('fs')
        const home = await homeDir()
        const entries = await fsService.listDir(await fsService.resolve(home + '/.dsh/profiles')).catch(() => [])
        const out = []
        for (const e of entries) {
          if (e.type !== 'directory') continue
          let m = null
          try {
            m = JSON.parse(await fsService.readText(await fsService.resolve(home + '/.dsh/profiles/' + e.name + '/package.json')))
          } catch (err) { continue }
          const deps = Object.assign({}, m.dependencies, m.devDependencies)
          const packages = []
          let cli = false
          let description = ''
          let usage = ''
          for (const name of Object.keys(deps)) {
            packages.push({ name, version: String(deps[name]).replace(/^file:/, '') })
            if (name.indexOf('@deepseek-ai/') === 0) continue
            let pm = null
            try {
              pm = JSON.parse(await fsService.readText(await fsService.resolve(home + '/.dsh/profiles/' + e.name + '/node_modules/' + name + '/package.json')))
            } catch (err) { pm = null }
            if (pm && pm.bin) {
              cli = true
              description = pm.description || description
              if (/URL/i.test(String(pm.description || ''))) usage = '<URL>'
            }
          }
          out.push({ profile: e.name, packages, cli, description, usage })
        }
        json(res, 200, out)
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // http proxy for balance / github calls (no CORS in the browser form)
    const HTTP_HOSTS = ['api.deepseek.com', 'platform.deepseek.com', 'api.github.com', 'github.com']
    const httpProxyHandler = async (req, res) => {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        const url = String(body.url || '')
        const method = String(body.method || 'GET').toUpperCase()
        if (!/^https:\/\/([^/]+)/.test(url) || HTTP_HOSTS.indexOf(RegExp.$1) < 0) {
          return json(res, 403, { ok: false, error: 'host not allowed: ' + url })
        }
        const headers = body.headers || {}
        const hdr = Object.keys(headers).map((k) => '-H ' + JSON.stringify(String(k) + ': ' + String(headers[k]))).join(' ')
        let cmd = 'curl -sS -w "\\n%{http_code}" -X ' + method + ' ' + hdr + ' ' + JSON.stringify(url)
        if (body.body) cmd += ' --data-binary ' + JSON.stringify(String(body.body))
        const out = await runShell(cmd, 120000)
        const lines = out.split('\n')
        const status = parseInt(lines[lines.length - 1], 10) || 502
        const text = lines.slice(0, -1).join('\n')
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status, text }))
      } catch (e) {
        json(res, 502, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // run a CLI profile plugin in the background (browser form)
    const runCliHandler = async (req, res) => {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        const profile = safeName(body.profile)
        if (!profile) return json(res, 400, { ok: false, error: 'bad profile' })
        const args = (Array.isArray(body.args) ? body.args : []).map((a) => JSON.stringify(String(a))).join(' ')
        await runShell('nohup dsh --profile ' + profile + (args ? ' ' + args : '') + ' > /tmp/prts-cli-' + profile + '.log 2>&1 &', 10000)
        json(res, 200, { ok: true, log: '/tmp/prts-cli-' + profile + '.log' })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    disposers.push(
      webServer.register({ kind: 'prefix', path: '/prts/api/skills', handler: skillsHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/skill-delete', handler: skillDeleteHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/skill-install', handler: skillInstallHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/profiles', handler: profilesHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/http', handler: httpProxyHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/run-cli', handler: runCliHandler }),
    )
    ctx.effect(() => () => { for (const d of disposers) d() })

    harness.handle('prts-version', () => ({ version: '0.3.0', path: GUI_PATH }))
  },
}
