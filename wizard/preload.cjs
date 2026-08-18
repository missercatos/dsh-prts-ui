const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('wiz', {
  close: () => ipcRenderer.send('wiz-close'),
  minimize: () => ipcRenderer.send('wiz-minimize'),
})
