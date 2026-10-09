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
import fs from 'node:fs'
import {
  fail,
  ok,
  type AppError,
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

function notifyLibraryChanged(win: BrowserWindow | null, payload: LibraryChangedPayload) {
  win?.webContents.send('library:changed', payload)
}

export function registerIpcHandlers(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:pickPdfFiles', async () => {
    const win = getWin()
    if (!win) return ok(null)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
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
        pdfUrl: `ireader://pdf/${bookId}`,
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
    'shell:showInFolder',
    wrap(({ path }: { path: string }) => {
      shell.showItemInFolder(path)
    })
  )
}
