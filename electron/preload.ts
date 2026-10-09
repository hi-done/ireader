import { contextBridge, ipcRenderer } from 'electron'
import type {
  Book,
  Collection,
  LibraryChangedPayload,
  LibraryImportResult,
  ReaderOpenResult,
  ReadingProgress,
  Result,
  Settings,
} from '../shared/types'

/** 渲染进程通过 window.ireader 访问的类型安全 API，对应设计文档 §6.2/§6.3 */
const ireaderApi = {
  /** 宿主平台（darwin/win32…）：渲染层据此为无标题栏窗口做红绿灯避让 */
  platform: process.platform,
  dialog: {
    pickPdfFiles: (): Promise<Result<string[] | null>> =>
      ipcRenderer.invoke('dialog:pickPdfFiles'),
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
  log: {
    write: (level: 'info' | 'warn' | 'error', message: string): Promise<Result<void>> =>
      ipcRenderer.invoke('log:write', { level, message }),
  },
  window: {
    setFullscreen: (fullscreen: boolean): Promise<Result<void>> =>
      ipcRenderer.invoke('window:setFullscreen', { fullscreen }),
  },
  shell: {
    showInFolder: (path: string): Promise<Result<void>> =>
      ipcRenderer.invoke('shell:showInFolder', { path }),
  },
}

contextBridge.exposeInMainWorld('ireader', ireaderApi)

export type IreaderApi = typeof ireaderApi
