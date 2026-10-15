// 主进程应用内更新服务：封装 electron-updater 的状态机、防呆校验与进度广播
// 对应设计文档《软件更新功能设计方案》§6.1
// 网络边界红线：checkForUpdates / downloadUpdate 均只由渲染层用户点击触发，无任何后台轮询

import { app, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type { AppUpdater } from 'electron-updater'
import * as logger from './logger'
import type { UpdateCheckResult, UpdateProgress, UpdateStatus } from '../../shared/types'

// electron-updater 是 CJS 包且 autoUpdater 为 Object.defineProperty getter 导出（见其 out/main.js 末尾），
// cjs-module-lexer 无法静态分析该形式，ESM 具名导入会失败；
// 用 createRequire 走 Node 原生 require 加载（与 better-sqlite3 的 external 模式配套）
const nodeRequire = createRequire(import.meta.url)
const { autoUpdater } = nodeRequire('electron-updater') as { autoUpdater: AppUpdater }

const RELEASES_BASE = 'https://github.com/hi-done/ireader/releases'

// 当前平台是否支持「下载并自动安装」：
// macOS 构建未签名，Squirrel.Mac 自动更新通道强制要求代码签名，只能检查后跳转浏览器手动下载
const autoUpdateSupported = process.platform === 'win32'

type UpdaterState = UpdateStatus['state']

let getWin: () => BrowserWindow | null = () => null
let state: UpdaterState = 'idle'
let newVersion: string | null = null
let lastProgress: UpdateProgress | null = null
// dev 调试链是否可用（非打包模式且项目根存在 dev-app-update.yml 时置位）
let devConfigAvailable = false

/** releaseNotes 可能是字符串或分段数组（GitHub provider 返回形式），统一拍平为字符串；分段 note 可能为 null */
function flattenReleaseNotes(notes: string | Array<{ note: string | null }> | null | undefined): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  return notes.map((n) => n.note).join('\n\n')
}

export function initUpdaterService(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow

  // 仅用户手动触发下载；退出应用时不自动安装（安装只由「重启并安装」按钮显式触发）
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  // 更新器日志接入项目本地日志（{userData}/logs/ireader.log），排障用
  autoUpdater.logger = {
    info: (message) => logger.info(`[updater] ${String(message)}`),
    warn: (message) => logger.warn(`[updater] ${String(message)}`),
    error: (message) => logger.error(`[updater] ${String(message)}`),
  }

  // dev 调试链：非打包模式下若项目根存在 dev-app-update.yml（electron-updater 官方机制），
  // 允许开发态完整走更新流程（指向本地静态服务，配置已 gitignore）；不存在时 dev 下更新功能不可用
  if (!app.isPackaged) {
    const devConfig = path.join(app.getAppPath(), 'dev-app-update.yml')
    if (fs.existsSync(devConfig)) {
      autoUpdater.forceDevUpdateConfig = true
      devConfigAvailable = true
    }
  }

  // 下载进度广播：invoke 是单次往返无法携带连续进度，走主→渲染事件
  autoUpdater.on('download-progress', (info) => {
    lastProgress = {
      percent: info.percent,
      transferred: info.transferred,
      total: info.total,
      bytesPerSecond: info.bytesPerSecond,
    }
    getWin()?.webContents.send('updater:progress', lastProgress)
  })

  // 兜底同步状态：下载完成的确认主流程在 downloadUpdate 的 Promise 上，
  // 事件保证渲染层不在线（用户离开设置页）时状态机也不丢失 ready 态
  autoUpdater.on('update-downloaded', () => {
    state = 'ready'
  })

  // 原始错误只落日志便于排障；对外状态回退由各动作的 catch 统一处理，避免双重恢复
  autoUpdater.on('error', (err) => {
    logger.error(`[updater] ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  })

  logger.info(
    `[updater] init (platform=${process.platform}, autoUpdateSupported=${autoUpdateSupported}, devConfig=${devConfigAvailable})`
  )
}

export function getStatus(): UpdateStatus {
  return {
    currentVersion: app.getVersion(),
    autoUpdateSupported,
    state,
    newVersion,
    progress: lastProgress,
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (!app.isPackaged && !devConfigAvailable) {
    throw { code: 'UPDATER_UNAVAILABLE', message: '开发模式不支持检查更新' }
  }
  if (state === 'checking' || state === 'downloading') {
    throw {
      code: 'INVALID_PARAMS',
      message: state === 'checking' ? '正在检查更新，请稍候' : '正在下载更新，请稍候',
    }
  }

  const prevState = state
  state = 'checking'
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.isUpdateAvailable) {
      state = 'notAvailable'
      newVersion = null
      return {
        currentVersion,
        isUpdateAvailable: false,
        newVersion: null,
        releaseNotes: null,
        releaseUrl: `${RELEASES_BASE}/latest`,
        autoUpdateSupported,
      }
    }
    const version = result.updateInfo.version
    newVersion = version
    state = 'available'
    return {
      currentVersion,
      isUpdateAvailable: true,
      newVersion: version,
      releaseNotes: flattenReleaseNotes(result.updateInfo.releaseNotes),
      releaseUrl: `${RELEASES_BASE}/tag/v${version}`,
      autoUpdateSupported,
    }
  } catch (e) {
    // 失败回退到检查前的稳定态，保证「重试」可用
    state = prevState
    logger.error(`[updater] check failed: ${e instanceof Error ? e.message : String(e)}`)
    throw { code: 'UPDATER_FAILED', message: '检查更新失败，请检查网络后重试' }
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!autoUpdateSupported) {
    throw { code: 'UPDATER_UNAVAILABLE', message: '当前平台不支持自动更新，请前往发布页手动下载' }
  }
  if (state === 'downloading') {
    throw { code: 'INVALID_PARAMS', message: '正在下载更新，请稍候' }
  }
  if (state !== 'available') {
    throw { code: 'INVALID_PARAMS', message: '请先检查更新' }
  }

  state = 'downloading'
  lastProgress = null
  try {
    await autoUpdater.downloadUpdate()
    state = 'ready'
  } catch (e) {
    // 失败回 available：保留「下载更新」按钮供重试（差量失败回退全量由 electron-updater 内置处理）
    state = 'available'
    logger.error(`[updater] download failed: ${e instanceof Error ? e.message : String(e)}`)
    throw { code: 'UPDATER_FAILED', message: '下载更新失败，请检查网络后重试' }
  }
}

export function quitAndInstall(): void {
  if (state !== 'ready') {
    throw { code: 'INVALID_PARAMS', message: '更新尚未下载完成' }
  }
  logger.info(`[updater] quit and install v${newVersion ?? ''}`)
  // 静默安装到原目录并自动重启；如需展示 NSIS 安装向导改为无参调用（设计文档 §13）
  autoUpdater.quitAndInstall(true, true)
}

// 单例对象导出：与 libraryService / statsService 的服务形态保持一致，handler 只做编排
export const updaterService = {
  init: initUpdaterService,
  getStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
}
