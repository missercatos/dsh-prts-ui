/**
 * PRTS preload: exposes the io bridge (fs + http with chunk streaming) and
 * the abort channel to the isolated renderer via contextBridge.
 */
const { contextBridge, ipcRenderer } = require('electron')

const pending = new Map()

const dshUrl = process.argv.find((a) => a.startsWith('--dsh-url='))?.slice('--dsh-url='.length) || 'http://127.0.0.1:3085'

contextBridge.exposeInMainWorld('prts', {
  env: {
    platform: process.platform,
    home: process.env.HOME || process.env.USERPROFILE || '',
    dshHome: process.env.DSH_HOME || (process.env.HOME || process.env.USERPROFILE || '') + '/.dsh',
    xdgConfigHome: process.env.XDG_CONFIG_HOME || '',
    xdgDesktopDir: process.env.XDG_DESKTOP_DIR || '',
    appData: process.env.APPDATA || '',
    dshUrl,
  },
  bridge: {
    readFile: (p) => ipcRenderer.invoke('prts:readFile', p),
    writeFile: (p, d) => ipcRenderer.invoke('prts:writeFile', p, d),
    appendFile: (p, d) => ipcRenderer.invoke('prts:appendFile', p, d),
    deleteFile: (p) => ipcRenderer.invoke('prts:deleteFile', p),
    exists: (p) => ipcRenderer.invoke('prts:exists', p),
    mkdir: (p) => ipcRenderer.invoke('prts:mkdir', p),
    listDir: (p) => ipcRenderer.invoke('prts:listDir', p),
    systemInfo: () => ipcRenderer.invoke('prts:systemInfo'),
    dsh: {
      request: (method, payload) => ipcRenderer.invoke('prts:dshRequest', method, payload),
      send: (msg) => ipcRenderer.invoke('prts:dshSend', msg),
      onFrame: (cb) => ipcRenderer.on('prts:dshFrame', (_e, data) => cb(data)),
    },
    http(req) {
      const token = req.token || ('h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
      pending.set(token, req)
      ipcRenderer.invoke('prts:http', { method: req.method, url: req.url, headers: req.headers, body: req.body, token })
        .then((res) => { pending.delete(token); if (req.onEnd) req.onEnd(res) })
        .catch((err) => { pending.delete(token); if (req.onEnd) req.onEnd({ status: 0, message: String(err && err.message || err) }) })
      return Promise.resolve({ status: 0 })
    },
    abort: (token) => ipcRenderer.invoke('prts:abort', token),
  },
})

ipcRenderer.on('prts:chunk', (_e, token, text) => {
  const r = pending.get(token)
  if (r && r.onChunk) r.onChunk(text)
})
ipcRenderer.on('prts:end', (_e, token, result) => {
  const r = pending.get(token)
  if (!r) return
  pending.delete(token)
  if (r.onEnd) r.onEnd(result)
})
