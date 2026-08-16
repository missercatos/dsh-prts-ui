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
    ctx.effect(() => () => { for (const d of disposers) d() })

    harness.handle('prts-version', () => ({ version: '0.2.1', path: GUI_PATH }))
  },
}
