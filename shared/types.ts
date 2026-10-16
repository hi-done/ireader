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
  | 'UPDATER_UNAVAILABLE'
  | 'UPDATER_FAILED'
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

/** 阅读统计：单日合计 */
export interface DailyReadingStat {
  /** 本地日期 'YYYY-MM-DD' */
  day: string
  durationMs: number
}

/** 阅读统计：单书累计 */
export interface BookReadingStat {
  bookId: number
  title: string
  /** ireader://cover/{id}；封面缺失时前端 onerror 落占位 */
  coverUrl: string
  /** 全部历史累计时长（ms） */
  durationMs: number
  /** 今日已读时长（ms）；今日未读为 0。排行「今日」视图按此过滤与排序 */
  todayMs: number
  /** 最近一次阅读时间戳（ms） */
  lastReadAt: number
}

/** 阅读统计汇总（stats:summary 返回） */
export interface ReadingStatsSummary {
  /** 全部书籍累计（ms） */
  totalMs: number
  /** 今日累计（ms） */
  todayMs: number
  /** 最近 days 天逐日序列（升序、已补齐零值日、含今天） */
  days: DailyReadingStat[]
  /** 每本书累计（durationMs 降序） */
  books: BookReadingStat[]
}

/** 更新检查结果（updater:check 返回） */
export interface UpdateCheckResult {
  /** 当前安装版本（app.getVersion()） */
  currentVersion: string
  /** 是否发现新版本 */
  isUpdateAvailable: boolean
  /** 新版本号（isUpdateAvailable 为 true 时有效，否则 null） */
  newVersion: string | null
  /** 更新说明（GitHub Release body 原文；渲染层经 cleanReleaseNotes 清洗后展示） */
  releaseNotes: string | null
  /** 新版本 Release 页地址（macOS 跳转下载 / 手动查看用；无更新时为 latest 页） */
  releaseUrl: string | null
  /** 当前平台是否支持自动下载安装（Windows=true，macOS 未签名=false） */
  autoUpdateSupported: boolean
}

/** 更新器状态（updater:status 返回；设置页进入时恢复 UI 用，纯本地无网络） */
export interface UpdateStatus {
  currentVersion: string
  autoUpdateSupported: boolean
  /** idle=未检查；checking=检查中；available=有新版本；notAvailable=已最新；downloading=下载中；ready=下载完成待安装 */
  state: 'idle' | 'checking' | 'available' | 'notAvailable' | 'downloading' | 'ready'
  /** 新版本号（state 为 available / downloading / ready 时有效） */
  newVersion: string | null
  /** 最近一次下载进度（state 为 downloading 时非空） */
  progress: UpdateProgress | null
}

/** 更新下载进度（updater:progress 事件载荷） */
export interface UpdateProgress {
  /** 0-100 */
  percent: number
  /** 已传输字节 */
  transferred: number
  /** 总字节 */
  total: number
  /** 字节/秒 */
  bytesPerSecond: number
}

/**
 * 本地日期键 'YYYY-MM-DD'（双进程共用）。
 * 必须用本地时区字段拼接：toISOString 是 UTC 日期，跨时区会错位。
 */
export function formatDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
