// 前后端（主进程 / 渲染进程）共享的类型与常量定义
// 对应设计文档 §6.4

export type ReadingMode = 'single' | 'double'
/**
 * 阅读方向：
 * - ltr：左→右（韩漫），横向分屏，向右翻页
 * - rtl：右→左（日漫），横向分屏，向左翻页
 * - ttb：上→下（条漫），纵向连续滚动，不播翻页动画，行间固定 16px
 */
export type Direction = 'ltr' | 'rtl' | 'ttb'
/**
 * 纵向（ttb）双页行内页序：沿用切入纵向前的横向方向（ltr = 行内左→右）。
 * 与 Direction 分开保存：方向切为 ttb 后已丢失原横向方向，需单独记住并持久化。
 */
export type RowOrder = 'ltr' | 'rtl'
export type ZoomMode = 'fitWidth' | 'fitHeight' | 'original' | 'custom'
export type SortBy = 'lastOpenedAt' | 'addedAt' | 'title'
export type SortOrder = 'asc' | 'desc'
export type BookFormat = 'pdf' | 'epub' | 'cbz'

export interface ReadingProgress {
  page: number // 当前页组第一页页码，从 1 起
  /** EPUB：断点续读的 CFI 定位（仅 epub 书使用） */
  cfi?: string | null
  /** EPUB：阅读进度百分比 0-100（供文库进度圆环，仅 epub 书使用） */
  percentage?: number | null
  mode: ReadingMode
  direction: Direction
  /** 纵向双页行内页序；缺省左→右（仅 ttb 生效，横向方向忽略） */
  rowOrder?: RowOrder
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

/** 界面语言偏好；system = 跟随操作系统语言 */
export const LOCALE_PREFERENCES = ['system', 'zh-CN', 'en', 'ja'] as const
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number]
/** 实际生效的界面语言（不含 system） */
export type AppLocale = 'zh-CN' | 'en' | 'ja'

export interface Settings {
  defaultMode: ReadingMode
  defaultDirection: Direction
  theme: 'light' | 'dark' | 'system'
  preloadSpreads: number // 0-4
  coverSinglePage: boolean
  /** EPUB 字号百分比（100 = 默认） */
  epubFontSize: number
  /** 界面语言偏好 */
  locale: LocalePreference
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'single',
  defaultDirection: 'rtl',
  theme: 'system',
  preloadSpreads: 2,
  coverSinglePage: true,
  epubFontSize: 100,
  locale: 'system',
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
  /** ireader://pdf/{id}、ireader://epub/{id}（直出原文件）或 ireader://cbz/{id}（逐页地址前缀） */
  fileUrl: string
  numPages: number
  progress: ReadingProgress | null
}

/** 窗口内容区截图矩形（CSS/DIP 像素，相对页面内容区左上角；EPUB 翻页冻结帧用） */
export interface CaptureRegionRect {
  x: number
  y: number
  width: number
  height: number
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
 * 解析生效语言：用户显式偏好优先；system 按系统语言前缀匹配，中文/日文以外回退英文。
 * 双进程共用（主进程 app.getLocale() / 渲染层 navigator.language）。
 */
export function resolveLocale(preference: LocalePreference, systemLocale: string): AppLocale {
  if (preference === 'zh-CN' || preference === 'en' || preference === 'ja') return preference
  // 运行期脏数据（持久化的非法值）一律回退英文，避免被误判为「跟随系统」
  if ((preference as string) !== 'system') return 'en'
  const tag = systemLocale.toLowerCase()
  if (tag.startsWith('zh')) return 'zh-CN'
  if (tag.startsWith('ja')) return 'ja'
  return 'en'
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

/**
 * 是否为零进度（默认阅读方向同步口径，双进程共用）。
 * 口径按「当前位置」而非「是否读过」：停在第一页且无百分比即视为零进度，
 * 因此翻回首页的已读书也会被判为零进度，后续修改默认方向会被覆盖
 * （详见 specs/默认阅读方向同步零进度书设计方案-20261025.md §十三）。
 */
export function isUnstartedProgress(page: number, percentage?: number | null): boolean {
  if (page > 1) return false
  return percentage == null || percentage <= 0
}
