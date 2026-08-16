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
        const subdir = body.subdir ? String(body.subdir) : ''
        const baseName = repo.replace(/\/+$/, '').split('/').pop().replace(/\.git$/, '')
        if (!/^[A-Za-z0-9._-]+$/.test(baseName) || !baseName) return json(res, 400, { ok: false, error: 'bad repo name' })
        const root = await skillsRoot()
        const tmp = '/tmp/prts-skill-' + Date.now().toString(36)
        await runShell('git clone --depth 1 ' + JSON.stringify(repo) + ' ' + JSON.stringify(tmp), 300000)
        const script = 'root=' + JSON.stringify(root) + '\ntmp=' + JSON.stringify(tmp) + '\n' +
          (subdir
            ? 'if [ ! -f "$tmp/' + subdir + '/SKILL.md" ]; then echo "ERROR: no SKILL.md at ' + subdir + '"; exit 1; fi\nn=$(basename ' + JSON.stringify(subdir) + ')\nrm -rf "$root/$n"\nmv "$tmp/' + subdir + '" "$root/$n"\necho "$n"'
            : 'found=0\nfor d in "$tmp"/*/ "$tmp"/*/*/; do\n  [ -f "$d/SKILL.md" ] || continue\n  n=$(basename "$d")\n  rm -rf "$root/$n"\n  mv "$d" "$root/$n"\n  echo "$n"\n  found=1\ndone\nif [ -f "$tmp/SKILL.md" ]; then\n  n=$(basename "$tmp")\n  rm -rf "$root/$n"\n  mv "$tmp" "$root/$n"\n  echo "$n"\n  found=1\nfi\nif [ "$found" != "1" ]; then echo "ERROR: no SKILL.md found"; exit 1; fi')
        const out = await runShell(script, 60000)
        await runShell('rm -rf ' + JSON.stringify(tmp), 30000).catch(() => {})
        if (out.indexOf('ERROR') >= 0) return json(res, 400, { ok: false, error: out.trim() })
        json(res, 200, { ok: true, stdout: out })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // wallpaper store (browser form): POST base64 → file, GET → data URL, DELETE → clear
    const wallpaperHandler = async (req, res) => {
      try {
        const dir = (await homeDir()) + '/.dsh/profiles/prts/wallpaper'
        const url = String(req.url || '')
        const qs = url.split('?')[1] || ''
        const params = {}
        for (const pair of qs.split('&')) {
          const i = pair.indexOf('=')
          if (i > 0) params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1))
        }
        if (req.method === 'GET') {
          const file = safeName(params.file)
          if (!file) return json(res, 400, { ok: false, error: 'bad file name' })
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
          if (!file) return json(res, 400, { ok: false, error: 'bad file name' })
          await runShell('mkdir -p ' + JSON.stringify(dir), 30000)
          await runShell('echo ' + JSON.stringify(String(body.base64 || '')) + ' | base64 -d > ' + JSON.stringify(dir + '/' + file), 120000)
          return json(res, 200, { ok: true })
        }
        json(res, 405, { ok: false, error: 'method' })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // PRTS logo (browser form): serves assets/prts.png as base64
    const logoHandler = async (req, res) => {
      try {
        const fsService = ctx.get('fs')
        const target = await fsService.resolve(GUI_PATH.replace(/web[\/]index\.html$/, 'assets/prts.png'))
        const bytes = await fsService.readBytes(target, undefined, 8 * 1024 * 1024)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        json(res, 200, { b64: btoa(bin) })
      } catch (e) {
        json(res, 404, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    const EDITORS = [
      { id: 'default', name: '系统默认', cmd: null, terminal: false },
      { id: 'code', name: 'VS Code', cmd: 'code', terminal: false },
      { id: 'gedit', name: '文本编辑器 (gedit)', cmd: 'gedit', terminal: false },
      { id: 'kate', name: 'Kate', cmd: 'kate', terminal: false },
      { id: 'vim', name: 'vim (终端)', cmd: 'vim', terminal: true },
      { id: 'nvim', name: 'nvim (终端)', cmd: 'nvim', terminal: true },
      { id: 'nano', name: 'nano (终端)', cmd: 'nano', terminal: true },
      { id: 'notepad', name: '记事本', cmd: 'notepad', terminal: false },
    ]

    // open a file in the configured editor (browser form)
    const openPathHandler = async (req, res) => {
      try {
        const body = JSON.parse(await readBody(req) || '{}')
        const p = String(body.path || '')
        if (!p || p.indexOf('/') < 0) return json(res, 400, { ok: false, error: 'bad path' })
        const ed = EDITORS.find((e) => e.id === body.editor) || EDITORS[0]
        let cmd
        if (ed.cmd && ed.terminal) {
          cmd = 'nohup x-terminal-emulator -e ' + JSON.stringify(ed.cmd + ' ' + p) + ' >/dev/null 2>&1 &'
        } else if (ed.cmd) {
          cmd = 'nohup ' + ed.cmd + ' ' + JSON.stringify(p) + ' >/dev/null 2>&1 &'
        } else {
          cmd = 'xdg-open ' + JSON.stringify(p) + ' >/dev/null 2>&1 || open ' + JSON.stringify(p) + ' >/dev/null 2>&1 || true'
        }
        await runShell(cmd, 30000)
        json(res, 200, { ok: true })
      } catch (e) {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) })
      }
    }

    // detect available editors (browser form)
    const detectEditorsHandler = async (req, res) => {
      try {
        const out = [EDITORS[0]]
        for (const e of EDITORS.slice(1)) {
          const found = await runShell('command -v ' + JSON.stringify(e.cmd) + ' >/dev/null 2>&1 && echo yes || echo no', 10000)
          if (found.trim() === 'yes') out.push(e)
        }
        json(res, 200, out)
      } catch (e) {
        json(res, 200, [EDITORS[0]])
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
      webServer.register({ kind: 'prefix', path: '/prts/api/wallpaper', handler: wallpaperHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/open-path', handler: openPathHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/detect-editors', handler: detectEditorsHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/logo', handler: logoHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/profiles', handler: profilesHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/http', handler: httpProxyHandler }),
      webServer.register({ kind: 'exact', path: '/prts/api/run-cli', handler: runCliHandler }),
    )
    ctx.effect(() => () => { for (const d of disposers) d() })

    harness.handle('prts-version', () => ({ version: '0.6.1', path: GUI_PATH }))
  },
}
