// 渲染进程侧对 window.ireader 的类型安全封装：统一解包 Result<T>，失败时抛出 AppError
// 对应设计文档 §6.1

import type {
  AppError,
  CaptureRegionRect,
  ReadingProgress,
  Result,
  Settings,
} from '../../shared/types'

export class IpcError extends Error {
  code: AppError['code']
  constructor(error: AppError) {
    super(error.message)
    this.code = error.code
  }
}

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (result.ok) return result.data
  throw new IpcError(result.error)
}

function api() {
  return window.ireader
}

export const ipc = {
  dialog: {
    pickBookFiles: () => unwrap(api().dialog.pickBookFiles()),
    pickFolder: () => unwrap(api().dialog.pickFolder()),
  },
  library: {
    import: (paths: string[], collectionId?: number | null) =>
      unwrap(api().library.import(paths, collectionId)),
    list: () => unwrap(api().library.list()),
    remove: (bookId: number, deleteFile?: boolean) =>
      unwrap(api().library.remove(bookId, deleteFile)),
    relink: (bookId: number, newPath: string) => unwrap(api().library.relink(bookId, newPath)),
    rename: (bookId: number, title: string) => unwrap(api().library.rename(bookId, title)),
    moveToCollection: (bookIds: number[], collectionId: number | null) =>
      unwrap(api().library.moveToCollection(bookIds, collectionId)),
    onChanged: (listener: Parameters<typeof window.ireader.library.onChanged>[0]) =>
      api().library.onChanged(listener),
  },
  reader: {
    open: (bookId: number) => unwrap(api().reader.open(bookId)),
    saveProgress: (bookId: number, progress: ReadingProgress) =>
      unwrap(api().reader.saveProgress(bookId, progress)),
  },
  cover: {
    submit: (bookId: number, image: ArrayBuffer, numPages: number) =>
      unwrap(api().cover.submit(bookId, image, numPages)),
  },
  collection: {
    create: (title: string) => unwrap(api().collection.create(title)),
    list: () => unwrap(api().collection.list()),
    remove: (id: number) => unwrap(api().collection.remove(id)),
  },
  settings: {
    all: () => unwrap(api().settings.all()),
    patch: (partial: Partial<Settings>) => unwrap(api().settings.patch(partial)),
  },
  stats: {
    addTime: (bookId: number, day: string, deltaMs: number) =>
      unwrap(api().stats.addTime(bookId, day, deltaMs)),
    summary: (days: number) => unwrap(api().stats.summary(days)),
  },
  updater: {
    status: () => unwrap(api().updater.status()),
    check: () => unwrap(api().updater.check()),
    download: () => unwrap(api().updater.download()),
    // 安装即退出应用：fire-and-forget，失败仅记日志（返回值无消费方）
    install: (): void => {
      api().updater.install().catch(() => undefined)
    },
    onProgress: (listener: Parameters<typeof window.ireader.updater.onProgress>[0]) =>
      api().updater.onProgress(listener),
  },
  log: {
    // 日志写入 fire-and-forget：失败静默（日志通道自身不能抛错影响业务流）
    write: (level: 'info' | 'warn' | 'error', message: string): void => {
      api().log.write(level, message).catch(() => undefined)
    },
  },
  window: {
    setFullscreen: (fullscreen: boolean) => unwrap(api().window.setFullscreen(fullscreen)),
    captureRegion: (rect: CaptureRegionRect) => unwrap(api().window.captureRegion(rect)),
  },
  shell: {
    showInFolder: (path: string) => unwrap(api().shell.showInFolder(path)),
    openExternal: (url: string) => unwrap(api().shell.openExternal(url)),
  },
}
