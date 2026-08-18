/**
 * PRTS installer wizard window — a real desktop GUI window (frameless,
 * PRTS-dark) hosting the wizard page, not a browser tab.
 */
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const url = process.argv.find((a) => /^https?:\/\//.test(a)) || 'http://127.0.0.1:3000/'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 760,
    height: 900,
    minWidth: 640,
    minHeight: 720,
    backgroundColor: '#0A0A0B',
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(__dirname, '..', 'assets', 'prts.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  win.removeMenu()
  win.loadURL(url)
  ipcMain.on('wiz-close', () => win.close())
  ipcMain.on('wiz-minimize', () => win.minimize())
})

app.on('window-all-closed', () => app.quit())
