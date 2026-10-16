// IPC 通道集中注册
// 对应设计文档 §6.2 / §6.3

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { libraryService } from '../services/libraryService'
import { collectionsRepo } from '../db/repos/collectionsRepo'
import { getCoverUrl, saveCover, removeCover } from '../services/coverService'
import * as logger from '../services/logger'
import { booksRepo } from '../db/repos/booksRepo'
import { progressRepo } from '../db/repos/progressRepo'
import { settingsRepo } from '../db/repos/settingsRepo'
import { statsService } from '../services/statsService'
import { updaterService } from '../services/updaterService'
import fs from 'node:fs'
import {
  fail,
  ok,
  type AppError,
  type CaptureRegionRect,
  type LibraryChangedPayload,
  type ReadingProgress,
  type Result,
} from '../../shared/types'

/** 统一包裹 handler：抹掉 IpcMainInvokeEvent 首参，捕获异常并转换为 Result<T> */
function wrap<Args extends unknown[], T>(
  fn: (...args: Args) => T
): (event: IpcMainInvokeEvent, ...args: Args) => Result<T> {
  return (_event: IpcMainInvokeEvent, ...args: Args) => {
    try {
      return ok(fn(...args))
    } catch (e) {
      const err = e as AppError & Error
      if (err && typeof (err as AppError).code === 'string') {
        return fail((err as AppError).code, err.message)
      }
      return fail('UNKNOWN', err?.message ?? String(e))
    }
  }
}

/** 同 wrap，但业务函数为异步（updater 等网络业务）；错误转换逻辑与 wrap 保持一致 */
function wrapAsync<Args extends unknown[], T>(
  fn: (...args: Args) => Promise<T>
): (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result<T>> {
  return async (_event: IpcMainInvokeEvent, ...args: Args) => {
    try {
      return ok(await fn(...args))
    } catch (e) {
      const err = e as AppError & Error
      if (err && typeof (err as AppError).code === 'string') {
        return fail((err as AppError).code, err.message)
      }
      return fail('UNKNOWN', err?.message ?? String(e))
    }
  }
}

function notifyLibraryChanged(win: BrowserWindow | null, payload: LibraryChangedPayload) {
  win?.webContents.send('library:changed', payload)
}

export function registerIpcHandlers(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:pickBookFiles', async () => {
    const win = getWin()
    if (!win) return ok(null)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '电子书', extensions: ['pdf', 'epub'] }],
    })
    return ok(canceled ? null : filePaths)
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    const win = getWin()
    if (!win) return ok(null)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    })
    return ok(canceled ? null : filePaths[0] ?? null)
  })

  ipcMain.handle(
    'library:import',
    wrap((payload: { paths: string[]; collectionId?: number | null }) => {
      const result = libraryService.importPaths(payload.paths, payload.collectionId ?? null)
      if (result.added.length) {
        notifyLibraryChanged(
          getWin(),
          { type: 'added', bookIds: result.added.map((b) => b.id) }
        )
      }
      return result
    })
  )

  ipcMain.handle('library:list', wrap(() => libraryService.list()))

  ipcMain.handle('collection:create', wrap((title: string) => {
    const trimmed = title.trim()
    if (!trimmed) throw { code: 'INVALID_PARAMS', message: '合集名不能为空' }
    return collectionsRepo.create(trimmed, Date.now())
  }))

  ipcMain.handle('collection:list', wrap(() => collectionsRepo.list()))

  ipcMain.handle(
    'collection:remove',
    wrap(({ id }: { id: number }) => {
      collectionsRepo.remove(id) // 成员书事务内移回未分组
    })
  )

  ipcMain.handle(
    'library:moveToCollection',
    wrap(({ bookIds, collectionId }: { bookIds: number[]; collectionId: number | null }) => {
      libraryService.moveToCollection(bookIds, collectionId)
    })
  )

  ipcMain.handle(
    'library:remove',
    wrap(({ bookId, deleteFile }: { bookId: number; deleteFile?: boolean }) => {
      libraryService.remove(bookId, Boolean(deleteFile))
      removeCover(bookId)
      notifyLibraryChanged(getWin(), { type: 'removed', bookIds: [bookId] })
    })
  )

  ipcMain.handle(
    'library:relink',
    wrap(({ bookId, newPath }: { bookId: number; newPath: string }) => {
      const book = libraryService.relink(bookId, newPath)
      if (!book) throw { code: 'FILE_NOT_FOUND', message: 'book not found' } as AppError
      return book
    })
  )

  ipcMain.handle(
    'library:rename',
    wrap(({ bookId, title }: { bookId: number; title: string }) => {
      const book = libraryService.rename(bookId, title)
      if (!book) throw { code: 'FILE_NOT_FOUND', message: 'book not found' } as AppError
      return book
    })
  )

  ipcMain.handle(
    'reader:open',
    wrap(({ bookId }: { bookId: number }) => {
      const book = libraryService.getById(bookId)
      if (!book) throw { code: 'FILE_NOT_FOUND', message: 'book not found' } as AppError
      if (!fs.existsSync(book.filePath)) {
        throw { code: 'FILE_NOT_FOUND', message: 'file missing on disk' } as AppError
      }
      libraryService.markOpened(bookId)
      return {
        format: book.format,
        fileUrl: `ireader://${book.format}/${bookId}`,
        numPages: book.totalPages,
        progress: book.progress,
      }
    })
  )

  ipcMain.handle(
    'reader:saveProgress',
    wrap(({ bookId, progress }: { bookId: number; progress: ReadingProgress }) => {
      progressRepo.upsert(bookId, progress)
    })
  )

  ipcMain.handle(
    'cover:submit',
    wrap(
      ({
        bookId,
        image,
        numPages,
      }: {
        bookId: number
        image: ArrayBuffer
        numPages: number
      }) => {
        const book = libraryService.getById(bookId)
        if (!book) throw { code: 'FILE_NOT_FOUND', message: 'book not found' } as AppError
        saveCover(bookId, Buffer.from(image))
        booksRepo.updateCover(bookId, getCoverUrl(bookId), numPages)
        notifyLibraryChanged(getWin(), { type: 'coverReady', bookIds: [bookId] })
      }
    )
  )

  ipcMain.handle('settings:all', wrap(() => settingsRepo.getAll()))

  ipcMain.handle(
    'settings:patch',
    wrap((partial: Parameters<typeof settingsRepo.patch>[0]) => settingsRepo.patch(partial))
  )

  ipcMain.handle(
    'stats:addTime',
    wrap((payload: { bookId: number; day: string; deltaMs: number }) => {
      statsService.addTime(payload)
    })
  )

  ipcMain.handle('stats:summary', wrap(({ days }: { days: number }) => statsService.summary(days)))

  // 应用内更新（仅由用户在设置页点击触发，网络边界见《软件更新功能设计方案》§3.2）
  ipcMain.handle('updater:status', wrap(() => updaterService.getStatus()))

  ipcMain.handle('updater:check', wrapAsync(() => updaterService.checkForUpdates()))

  ipcMain.handle('updater:download', wrapAsync(() => updaterService.downloadUpdate()))

  ipcMain.handle('updater:install', wrap(() => updaterService.quitAndInstall()))

  ipcMain.handle(
    'log:write',
    wrap(({ level, message }: { level: 'info' | 'warn' | 'error'; message: string }) => {
      // 渲染层日志：限长防刷屏
      const truncated = message.length > 2000 ? `${message.slice(0, 2000)}…` : message
      if (level === 'error') logger.error(`[renderer] ${truncated}`)
      else if (level === 'warn') logger.warn(`[renderer] ${truncated}`)
      else logger.info(`[renderer] ${truncated}`)
    })
  )

  ipcMain.handle(
    'window:setFullscreen',
    wrap(({ fullscreen }: { fullscreen: boolean }) => {
      getWin()?.setFullScreen(fullscreen)
    })
  )

  ipcMain.handle(
    'window:captureRegion',
    wrapAsync(async (rect: CaptureRegionRect) => {
      const win = getWin()
      if (!win || win.webContents.isDestroyed()) {
        throw { code: 'UNKNOWN', message: '窗口不可用，无法截图' }
      }
      if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => !Number.isFinite(n))) {
        throw { code: 'INVALID_PARAMS', message: '截图区域参数无效' }
      }
      // capturePage 捕获合成输出（含 iframe 内容），rect 为 DIP 像素相对内容区左上角，
      // 与渲染层 getBoundingClientRect 同坐标系；越界会返回空图，先钳制到内容区
      const [cw, ch] = win.getContentSize()
      const x = Math.max(0, Math.min(Math.round(rect.x), cw - 1))
      const y = Math.max(0, Math.min(Math.round(rect.y), ch - 1))
      const width = Math.max(1, Math.min(Math.round(rect.width), cw - x))
      const height = Math.max(1, Math.min(Math.round(rect.height), ch - y))
      const image = await win.webContents.capturePage({ x, y, width, height })
      if (image.isEmpty()) {
        throw { code: 'UNKNOWN', message: '截图失败：未取到画面' }
      }
      return image.toPNG()
    })
  )

  ipcMain.handle(
    'shell:showInFolder',
    wrap(({ path }: { path: string }) => {
      shell.showItemInFolder(path)
    })
  )

  ipcMain.handle(
    'shell:openExternal',
    wrap(({ url }: { url: string }) => {
      // 白名单：只放行本项目 GitHub Releases 页，防渲染层被注入后借通道打开任意 URL
      if (!url.startsWith('https://github.com/hi-done/ireader/releases')) {
        throw { code: 'INVALID_PARAMS', message: '不允许打开该链接' }
      }
      shell.openExternal(url)
    })
  )
}
