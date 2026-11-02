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
export type BookFormat = 'pdf' | 'epub' | 'cbz' | 'mobi'

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
  /** 本书是否单独指定「双页封面单独成页」；null / 缺省 = 跟随全局设置（仅双页模式生效） */
  coverSinglePage?: boolean | null
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

/** 译文目标语言：简体中文 / 英文 / 日文 */
export const AI_TARGET_LANGS = ['zh-CN', 'en', 'ja'] as const
export type AiTargetLang = (typeof AI_TARGET_LANGS)[number]

/** 接口协议：openai = /chat/completions；anthropic = /v1/messages（DeepSeek 的 /anthropic 端点属于此类） */
export const AI_PROTOCOLS = ['openai', 'anthropic'] as const
export type AiProtocol = (typeof AI_PROTOCOLS)[number]

/** 单个模型服务配置（明文存于 settings JSON，取舍见 spec §13 风险表） */
export interface AiProviderConfig {
  /** 渲染层生成的本地 id（时间戳），仅用于列表选中与增删，不参与请求 */
  id: number
  /** 展示名，如「GPT-4o mini」 */
  name: string
  /** 基础地址，如 https://api.openai.com/v1 或 https://api.deepseek.com/anthropic */
  baseUrl: string
  apiKey: string
  /** 模型名，如 gpt-4o-mini */
  model: string
  /** 请求协议；旧配置缺此字段时由 normalizeAiSettings 补齐为 openai */
  protocol: AiProtocol
}

/** AI 框选翻译设置（Settings.ai） */
export interface AiSettings {
  enabled: boolean
  targetLang: AiTargetLang
  /** 当前使用配置的 id；null = 未选择 */
  activeProviderId: number | null
  providers: AiProviderConfig[]
}

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
  /** AI 框选翻译设置 */
  ai: AiSettings
}

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'single',
  defaultDirection: 'rtl',
  theme: 'system',
  preloadSpreads: 2,
  coverSinglePage: true,
  epubFontSize: 100,
  locale: 'system',
  ai: { enabled: false, targetLang: 'zh-CN', activeProviderId: null, providers: [] },
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
  | 'AI_NOT_CONFIGURED'
  | 'AI_AUTH_FAILED'
  | 'AI_REQUEST_FAILED'
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

/** 批量移除结果（library:removeMany 返回） */
export interface LibraryRemoveResult {
  /** 实际被移除的书 id；库中不存在的 id 被忽略，供渲染层精确同步本地列表与计数 */
  removed: number[]
}

export interface ReaderOpenResult {
  format: BookFormat
  /** ireader://pdf/{id}、ireader://epub/{id}（直出原文件）或 ireader://cbz|mobi/{id}（逐页地址前缀） */
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

/** 归一化矩形：相对单页显示盒的 0~1 比例 */
export interface AiRect {
  x: number
  y: number
  w: number
  h: number
}

/** 一条译文记录（DB 行映射） */
export interface AiTranslationRecord {
  id: number
  bookId: number
  /** 真实页码（1 基，与 reader.spreads 口径一致） */
  page: number
  rect: AiRect
  text: string
  /** 文字行高 / 页高，渲染字号 = 页显示高度 × 该值 */
  fontRatio: number
  collapsed: boolean
  createdAt: number
}

/** 译文写入载荷：id 为空 = 新增，有值 = 更新该条 */
export interface AiTranslationInput {
  id?: number | null
  bookId: number
  page: number
  rect: AiRect
  text: string
  fontRatio: number
  collapsed: boolean
}

/** 翻译请求（渲染层已裁切好图片） */
export interface AiTranslatePayload {
  bookId: number
  page: number
  /** 书名：提示词用于专名译法一致 */
  bookTitle: string
  /** 框选区域的 JPEG，base64（不含 data: 前缀） */
  imageBase64: string
}

/** 翻译结果 */
export interface AiTranslateResult {
  /** 译文；空串表示图内未识别到文字 */
  text: string
  /** 建议字号比例（已钳制到 0.02~0.15） */
  fontRatio: number
}

/** 连接测试结果 */
export interface AiTestResult {
  model: string
  /** 往返耗时（ms） */
  latencyMs: number
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

/**
 * 归一化 AI 设置（双进程共用：主进程落盘前、渲染层读回后都过一遍）。
 * 旧库没有 settings.ai 字段，或持久化了非法/手改脏数据时，逐字段回退默认值，避免渲染层崩溃。
 */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiSettings>
  const seen = new Set<number>()
  const providers: AiProviderConfig[] = []
  for (const item of Array.isArray(source.providers) ? source.providers : []) {
    const p = (item && typeof item === 'object' ? item : {}) as Partial<AiProviderConfig>
    const id = Number(p.id)
    if (!Number.isFinite(id) || seen.has(id)) continue // 丢弃无 id / 重复 id，否则列表选中态会串行
    seen.add(id)
    providers.push({
      id,
      name: typeof p.name === 'string' ? p.name : '',
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      model: typeof p.model === 'string' ? p.model : '',
      // 旧配置 / 脏数据回退 openai：协议字段是后加的，历史记录里不存在
      protocol: (AI_PROTOCOLS as readonly string[]).includes(p.protocol as string)
        ? (p.protocol as AiProtocol)
        : 'openai',
    })
  }
  const targetLang = (AI_TARGET_LANGS as readonly string[]).includes(source.targetLang as string)
    ? (source.targetLang as AiTargetLang)
    : DEFAULT_SETTINGS.ai.targetLang
  const activeId = Number(source.activeProviderId)
  return {
    enabled: source.enabled === true,
    targetLang,
    // 选中项已随配置删除时回退为未选择，避免请求阶段才发现配置悬空
    activeProviderId: providers.some((p) => p.id === activeId) ? activeId : null,
    providers,
  }
}
