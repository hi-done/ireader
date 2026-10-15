import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { initDatabase, closeDatabase } from './db/database'
import { initCoverService } from './services/coverService'
import { registerProtocolHandler, registerProtocolScheme } from './services/protocol'
import { registerIpcHandlers } from './ipc/handlers'
import { initLogger, attachProcessErrorHandlers, info, error } from './services/logger'
import { initUpdaterService } from './services/updaterService'

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
    // 窗口标题附带版本号（app.getVersion() 读取 package.json 的 version，开发与打包模式一致）
    title: `IReader v${app.getVersion()}`,
    // 窗口标题栏左上角与任务栏图标（开发模式同样生效；打包后 exe 图标由 electron-builder win.icon 内嵌）
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    // macOS 隐藏原生标题栏（内容延伸到窗口顶，保留红绿灯）；Windows 保留默认标题栏以提供窗口控制按钮
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 页面的 <title> 更新会覆盖窗口标题，阻止它以保证标题始终为「IReader v版本号」
  win.on('page-title-updated', (e) => e.preventDefault())

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
  // 应用内更新服务：订阅式初始化（挂事件监听与日志，无失败路径），网络仅由用户手动触发
  initUpdaterService(() => win)
  // 移除 Electron 默认菜单（File/Edit/View/Window/Help）：Windows/Linux 上它占掉窗口顶部一条栏
  // macOS 保留默认菜单：其菜单在屏幕顶部系统栏、不占窗口空间，且移除会导致 Cmd+C/V 等系统快捷键失效
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }
  createWindow()
  info('app ready')
})
