// IPC 通道集中注册
// 对应设计文档 §6.2 / §6.3

import { BrowserWindow, dialog, ipcMain, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { libraryService } from '../services/libraryService'
import { collectionsRepo, toCollection } from '../db/repos/collectionsRepo'
import { getCoverUrl, saveCover, removeCover } from '../services/coverService'
import { computeShotSize } from '../services/captureShot'
import * as logger from '../services/logger'
import { booksRepo } from '../db/repos/booksRepo'
import { progressRepo } from '../db/repos/progressRepo'
import { settingsRepo } from '../db/repos/settingsRepo'
import { settingsService } from '../services/settingsService'
import { statsService } from '../services/statsService'
import { aiService } from '../services/aiService'
import { updaterService } from '../services/updaterService'
import { getBookFilesFilterName } from '../services/appLocale'
import fs from 'node:fs'
import {
  fail,
  ok,
  AI_PROTOCOLS,
  AI_TARGET_LANGS,
  LOCALE_PREFERENCES,
  type AiProviderConfig,
  type AiSettings,
  type AiTargetLang,
  type AiTranslatePayload,
  type AiTranslationInput,
  type AppError,
  type CaptureRegionRect,
  type Direction,
  type LibraryChangedPayload,
  type LibraryRemoveResult,
  type ReadingProgress,
  type Result,
  type Settings,
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

/** 阅读方向白名单：Direction 是字面量联合无运行期值，校验需本地数组 */
const VALID_DIRECTIONS: Direction[] = ['ltr', 'rtl', 'ttb']

/**
 * settings.ai 结构校验：先挡形状错误，再交给 settingsService 内的 normalizeAiSettings 归一。
 * 只校验形状与协议前缀，不做可达性探测（可达性由配置页「测试连接」负责）。
 */
function assertAiPartial(raw: unknown): void {
  const ai = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiSettings>
  if (typeof ai.enabled !== 'boolean') {
    throw { code: 'INVALID_PARAMS', message: 'ai.enabled 取值无效' } as AppError
  }
  if (!AI_TARGET_LANGS.includes(ai.targetLang as AiTargetLang)) {
    throw { code: 'INVALID_PARAMS', message: 'ai.targetLang 取值无效' } as AppError
  }
  if (!Array.isArray(ai.providers)) {
    throw { code: 'INVALID_PARAMS', message: 'ai.providers 取值无效' } as AppError
  }
  for (const item of ai.providers) {
    const p = (item && typeof item === 'object' ? item : {}) as Partial<AiProviderConfig>
    if (typeof p.baseUrl !== 'string' || !/^https?:\/\//.test(p.baseUrl)) {
      throw { code: 'INVALID_PARAMS', message: '配置地址必须以 http:// 或 https:// 开头' } as AppError
    }
    // 协议白名单：写入口严格拦截，读路径由 normalizeAiSettings 回退 openai
    if (!(AI_PROTOCOLS as readonly string[]).includes(p.protocol as string)) {
      throw { code: 'INVALID_PARAMS', message: '配置接口协议取值无效' } as AppError
    }
    if (typeof p.apiKey !== 'string') {
      throw { code: 'INVALID_PARAMS', message: '配置 API Key 必须是字符串' } as AppError
    }
    if (typeof p.model !== 'string') {
      throw { code: 'INVALID_PARAMS', message: '配置模型名必须是字符串' } as AppError
    }
    if (typeof p.name !== 'string') {
      throw { code: 'INVALID_PARAMS', message: '配置名称必须是字符串' } as AppError
    }
  }
}

export function registerIpcHandlers(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:pickBookFiles', async () => {
    const win = getWin()
    if (!win) return ok(null)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: getBookFilesFilterName(), extensions: ['pdf', 'epub', 'zip', 'cbz', 'mobi'] }],
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
    wrapAsync(async (payload: { paths: string[]; collectionId?: number | null }) => {
      const result = await libraryService.importPaths(payload.paths, payload.collectionId ?? null)
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
    return toCollection(collectionsRepo.create(trimmed, Date.now()))
  }))

  ipcMain.handle('collection:list', wrap(() => collectionsRepo.list().map(toCollection)))

  ipcMain.handle(
    'collection:remove',
    wrap(({ id }: { id: number }) => {
      collectionsRepo.remove(id) // 成员书事务内移回未分组
    })
  )

  ipcMain.handle(
    'collection:rename',
    wrap(({ id, title }: { id: number; title: string }) => {
      const trimmed = String(title ?? '').trim()
      if (!trimmed) throw { code: 'INVALID_PARAMS', message: '合集名不能为空' }
      const updated = collectionsRepo.rename(id, trimmed)
      // 合集可能已被别处解散：命中 0 行时明确报错，避免前端静默当成成功
      if (!updated) throw { code: 'INVALID_PARAMS', message: '合集不存在' }
      return toCollection(updated)
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
    'library:removeMany',
    wrap(({ bookIds, deleteFile }: { bookIds: number[]; deleteFile?: boolean }) => {
      // 校验与文件处置在 service，handler 只编排与广播；零变化不打扰其他视图 refresh
      const removed = libraryService.removeMany(Array.isArray(bookIds) ? bookIds : [], Boolean(deleteFile))
      if (removed.length) {
        for (const id of removed) removeCover(id)
        notifyLibraryChanged(getWin(), { type: 'removed', bookIds: removed })
      }
      return { removed } satisfies LibraryRemoveResult
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
      // 单本封面为三态（true / false / null = 跟随全局），非布尔的脏值写库后无法还原语义
      const coverSinglePage = progress?.coverSinglePage
      if (
        coverSinglePage !== undefined &&
        coverSinglePage !== null &&
        typeof coverSinglePage !== 'boolean'
      ) {
        throw { code: 'INVALID_PARAMS', message: 'coverSinglePage 取值无效' } as AppError
      }
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
    wrap((partial: Partial<Settings>) => {
      // locale 白名单校验：阻止持久化脏值导致渲染层词典查找失败
      if (partial.locale !== undefined && !LOCALE_PREFERENCES.includes(partial.locale)) {
        throw { code: 'INVALID_PARAMS', message: 'locale 取值无效' } as AppError
      }
      // 方向白名单：EPUB 侧会把非法方向静默归一成 ltr，写库前拦掉更可控
      if (
        partial.defaultDirection !== undefined &&
        !VALID_DIRECTIONS.includes(partial.defaultDirection)
      ) {
        throw { code: 'INVALID_PARAMS', message: 'defaultDirection 取值无效' } as AppError
      }
      // AI 配置：形状非法直接拒收，合法则归一化（activeProviderId 悬空会回退为 null）
      if (partial.ai !== undefined) assertAiPartial(partial.ai)
      // 方向变更的零进度书同步在 service 内与设置写入同事务完成
      return settingsService.patch(partial)
    })
  )

  // AI 框选翻译：translate / test 会外发请求（仅由用户动作触发），其余只读写本地库
  ipcMain.handle('ai:translate', wrapAsync((payload: AiTranslatePayload) => aiService.translate(payload)))

  ipcMain.handle(
    'ai:test',
    wrapAsync(({ provider }: { provider: AiProviderConfig }) => aiService.test(provider))
  )

  ipcMain.handle('ai:list', wrap(({ bookId }: { bookId: number }) => aiService.list(bookId)))

  ipcMain.handle('ai:save', wrap((input: AiTranslationInput) => aiService.save(input)))

  ipcMain.handle('ai:remove', wrap(({ id }: { id: number }) => aiService.remove(id)))

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
      // 大面积截图（全屏/高 DPI 窗口）先降采样再编码：PNG 编码 + IPC 传输 + 渲染层解码
      // 是 EPUB 全屏翻页动画超出启动预算的主因；快照在卷曲中会被归一化拉伸回目标尺寸
      // DPR 取显示器实际缩放因子而非 NativeImage.getScaleFactors()：
      // capturePage 返回的 NativeImage 不可假定携带与屏幕一致的缩放标记，用它换算会低估物理像素面积
      const size = image.getSize()
      const dpr = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1
      const target = computeShotSize(size.width, size.height, dpr)
      const shot = target
        ? image.resize({ width: target.width, height: target.height, quality: 'best' })
        : image
      // 极端内存紧张时 resize 可能返回空图：回退原图，不阻断翻页
      return (shot.isEmpty() ? image : shot).toPNG()
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
