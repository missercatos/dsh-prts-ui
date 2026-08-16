return {
  apply(ctx) {
    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    const GUI_PATH = '/home/a/dsh-prts-ui/web/index.html'
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

    const disposers = [
      webServer.register({ kind: 'exact', path: '/prts', handler }),
      webServer.register({ kind: 'exact', path: '/prts/', handler }),
    ]
    ctx.effect(() => () => { for (const d of disposers) d() })

    harness.handle('prts-version', () => ({ version: '0.2.0', path: GUI_PATH }))
  },
}
