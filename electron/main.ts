import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDatabase, closeDatabase } from './db/database'
import { initCoverService } from './services/coverService'
import { registerProtocolHandler, registerProtocolScheme } from './services/protocol'
import { registerIpcHandlers } from './ipc/handlers'
import { initLogger, attachProcessErrorHandlers, info, error } from './services/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null

// 必须在 app.whenReady() 之前声明 ireader:// 为特权协议
registerProtocolScheme()

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    // macOS 隐藏原生标题栏（内容延伸到窗口顶，保留红绿灯）；Windows 保留默认标题栏以提供窗口控制按钮
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  info('app quit')
  closeDatabase()
})

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  initLogger(userDataDir)
  attachProcessErrorHandlers()
  try {
    initDatabase(userDataDir)
    initCoverService(userDataDir)
  } catch (e) {
    error(`init failed: ${(e as Error).stack ?? String(e)}`)
    throw e
  }
  registerProtocolHandler()
  registerIpcHandlers(() => win)
  // 移除 Electron 默认菜单（File/Edit/View/Window/Help）：Windows/Linux 上它占掉窗口顶部一条栏
  // macOS 保留默认菜单：其菜单在屏幕顶部系统栏、不占窗口空间，且移除会导致 Cmd+C/V 等系统快捷键失效
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
  createWindow()
  info('app ready')
})
