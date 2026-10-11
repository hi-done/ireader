// 前后端（主进程 / 渲染进程）共享的类型与常量定义
// 对应设计文档 §6.4

export type ReadingMode = 'single' | 'double'
export type Direction = 'ltr' | 'rtl' // ltr = 左→右（韩漫）  rtl = 右→左（日漫）
export type ZoomMode = 'fitWidth' | 'fitHeight' | 'original' | 'custom'
export type SortBy = 'lastOpenedAt' | 'addedAt' | 'title'
export type SortOrder = 'asc' | 'desc'
export type BookFormat = 'pdf' | 'epub'

export interface ReadingProgress {
  page: number // 当前页组第一页页码，从 1 起
  /** EPUB：断点续读的 CFI 定位（仅 epub 书使用） */
  cfi?: string | null
  /** EPUB：阅读进度百分比 0-100（供文库进度圆环，仅 epub 书使用） */
  percentage?: number | null
  mode: ReadingMode
  direction: Direction
  zoom: { mode: ZoomMode; scale: number }
  updatedAt: number
}

export interface Book {
  id: number
  title: string
  filePath: string
  /** 文件格式，按扩展名派生 */
  format: BookFormat
  fileSize: number
  totalPages: number
  coverUrl: string | null // ireader://cover/{id}
  addedAt: number
  lastOpenedAt: number | null
  collectionId: number | null // 所属合集；null = 未分组
  missing: boolean
  progress: ReadingProgress | null
}

export interface Collection {
  id: number
  title: string
  createdAt: number
}

export interface Settings {
  defaultMode: ReadingMode
  defaultDirection: Direction
  theme: 'light' | 'dark' | 'system'
  preloadSpreads: number // 0-4
  coverSinglePage: boolean
  /** EPUB 字号百分比（100 = 默认） */
  epubFontSize: number
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'single',
  defaultDirection: 'rtl',
  theme: 'system',
  preloadSpreads: 2,
  coverSinglePage: true,
  epubFontSize: 100,
}

export type ErrorCode =
  | 'FILE_NOT_FOUND'
  | 'PDF_INVALID'
  | 'PDF_ENCRYPTED'
  | 'PATH_EXISTS'
  | 'INVALID_PARAMS'
  | 'DB_ERROR'
  | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}

export interface LibraryImportResult {
  added: Book[]
  skipped: number
}

export interface ReaderOpenResult {
  format: BookFormat
  /** ireader://pdf/{id} 或 ireader://epub/{id} 原始文件地址 */
  fileUrl: string
  numPages: number
  progress: ReadingProgress | null
}

export type LibraryChangedPayload =
  | { type: 'added'; bookIds: number[] }
  | { type: 'coverReady'; bookIds: number[] }
  | { type: 'removed'; bookIds: number[] }
  | { type: 'missing'; bookIds: number[] }
