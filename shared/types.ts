// 前后端（主进程 / 渲染进程）共享的类型与常量定义
// 对应设计文档 §6.4

export type ReadingMode = 'single' | 'double'
export type Direction = 'ltr' | 'rtl' // ltr = 左→右（韩漫）  rtl = 右→左（日漫）
export type ZoomMode = 'fitWidth' | 'fitHeight' | 'original' | 'custom'
export type SortBy = 'lastOpenedAt' | 'addedAt' | 'title'
export type SortOrder = 'asc' | 'desc'

export interface ReadingProgress {
  page: number // 当前页组第一页页码，从 1 起
  mode: ReadingMode
  direction: Direction
  zoom: { mode: ZoomMode; scale: number }
  updatedAt: number
}

export interface Book {
  id: number
  title: string
  filePath: string
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
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'single',
  defaultDirection: 'rtl',
  theme: 'system',
  preloadSpreads: 2,
  coverSinglePage: true,
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
  pdfUrl: string
  numPages: number
  progress: ReadingProgress | null
}

export type LibraryChangedPayload =
  | { type: 'added'; bookIds: number[] }
  | { type: 'coverReady'; bookIds: number[] }
  | { type: 'removed'; bookIds: number[] }
  | { type: 'missing'; bookIds: number[] }
