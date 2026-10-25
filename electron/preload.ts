import { contextBridge, ipcRenderer } from 'electron'
import type {
  Book,
  CaptureRegionRect,
  Collection,
  LibraryChangedPayload,
  LibraryImportResult,
  LibraryRemoveResult,
  ReaderOpenResult,
  ReadingProgress,
  ReadingStatsSummary,
  Result,
  Settings,
  UpdateCheckResult,
  UpdateProgress,
  UpdateStatus,
} from '../shared/types'

/** 渲染进程通过 window.ireader 访问的类型安全 API，对应设计文档 §6.2/§6.3 */
const ireaderApi = {
  /** 宿主平台（darwin/win32…）：渲染层据此为无标题栏窗口做红绿灯避让 */
  platform: process.platform,
  dialog: {
    pickBookFiles: (): Promise<Result<string[] | null>> =>
      ipcRenderer.invoke('dialog:pickBookFiles'),
    pickFolder: (): Promise<Result<string | null>> => ipcRenderer.invoke('dialog:pickFolder'),
  },
  library: {
    import: (
      paths: string[],
      collectionId?: number | null
    ): Promise<Result<LibraryImportResult>> =>
      ipcRenderer.invoke('library:import', { paths, collectionId }),
    list: (): Promise<Result<Book[]>> => ipcRenderer.invoke('library:list'),
    remove: (bookId: number, deleteFile?: boolean): Promise<Result<void>> =>
      ipcRenderer.invoke('library:remove', { bookId, deleteFile }),
    removeMany: (bookIds: number[], deleteFile?: boolean): Promise<Result<LibraryRemoveResult>> =>
      ipcRenderer.invoke('library:removeMany', { bookIds, deleteFile }),
    relink: (bookId: number, newPath: string): Promise<Result<Book>> =>
      ipcRenderer.invoke('library:relink', { bookId, newPath }),
    rename: (bookId: number, title: string): Promise<Result<Book>> =>
      ipcRenderer.invoke('library:rename', { bookId, title }),
    moveToCollection: (
      bookIds: number[],
      collectionId: number | null
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('library:moveToCollection', { bookIds, collectionId }),
    onChanged: (listener: (payload: LibraryChangedPayload) => void) => {
      const handler = (_event: unknown, payload: LibraryChangedPayload) => listener(payload)
      ipcRenderer.on('library:changed', handler)
      return () => ipcRenderer.off('library:changed', handler)
    },
  },
  reader: {
    open: (bookId: number): Promise<Result<ReaderOpenResult>> =>
      ipcRenderer.invoke('reader:open', { bookId }),
    saveProgress: (bookId: number, progress: ReadingProgress): Promise<Result<void>> =>
      ipcRenderer.invoke('reader:saveProgress', { bookId, progress }),
  },
  collection: {
    create: (title: string): Promise<Result<Collection>> =>
      ipcRenderer.invoke('collection:create', title),
    list: (): Promise<Result<Collection[]>> => ipcRenderer.invoke('collection:list'),
    remove: (id: number): Promise<Result<void>> => ipcRenderer.invoke('collection:remove', { id }),
  },
  cover: {
    submit: (bookId: number, image: ArrayBuffer, numPages: number): Promise<Result<void>> =>
      ipcRenderer.invoke('cover:submit', { bookId, image, numPages }),
  },
  settings: {
    all: (): Promise<Result<Settings>> => ipcRenderer.invoke('settings:all'),
    patch: (partial: Partial<Settings>): Promise<Result<Settings>> =>
      ipcRenderer.invoke('settings:patch', partial),
  },
  stats: {
    /** 阅读时长心跳累加（fire-and-forget 场景由调用方静默失败） */
    addTime: (bookId: number, day: string, deltaMs: number): Promise<Result<void>> =>
      ipcRenderer.invoke('stats:addTime', { bookId, day, deltaMs }),
    summary: (days: number): Promise<Result<ReadingStatsSummary>> =>
      ipcRenderer.invoke('stats:summary', { days }),
  },
  updater: {
    /** 更新器状态（纯本地，设置页进入时恢复 UI 用） */
    status: (): Promise<Result<UpdateStatus>> => ipcRenderer.invoke('updater:status'),
    /** 手动检查更新（用户点击触发，唯一网络入口之一） */
    check: (): Promise<Result<UpdateCheckResult>> => ipcRenderer.invoke('updater:check'),
    /** 触发下载；resolve 即下载完成（进度经 onProgress 事件推送） */
    download: (): Promise<Result<void>> => ipcRenderer.invoke('updater:download'),
    /** 退出并静默安装重启；调用后应用随即退出，返回值无消费方 */
    install: (): Promise<Result<void>> => ipcRenderer.invoke('updater:install'),
    /** 订阅下载进度广播（返回取消函数，仿 library.onChanged） */
    onProgress: (listener: (payload: UpdateProgress) => void) => {
      const handler = (_event: unknown, payload: UpdateProgress) => listener(payload)
      ipcRenderer.on('updater:progress', handler)
      return () => ipcRenderer.off('updater:progress', handler)
    },
  },
  log: {
    write: (level: 'info' | 'warn' | 'error', message: string): Promise<Result<void>> =>
      ipcRenderer.invoke('log:write', { level, message }),
  },
  window: {
    setFullscreen: (fullscreen: boolean): Promise<Result<void>> =>
      ipcRenderer.invoke('window:setFullscreen', { fullscreen }),
    /** 截取窗口内容区指定矩形（含 iframe 合成输出）；EPUB 翻页冻结帧用，纯本地能力 */
    captureRegion: (rect: CaptureRegionRect): Promise<Result<Uint8Array>> =>
      ipcRenderer.invoke('window:captureRegion', rect),
  },
  shell: {
    showInFolder: (path: string): Promise<Result<void>> =>
      ipcRenderer.invoke('shell:showInFolder', { path }),
    /** 在系统浏览器打开链接（主进程仅放行本项目 GitHub Releases 页白名单） */
    openExternal: (url: string): Promise<Result<void>> =>
      ipcRenderer.invoke('shell:openExternal', { url }),
  },
}

contextBridge.exposeInMainWorld('ireader', ireaderApi)

export type IreaderApi = typeof ireaderApi
