// 内页缩略图取图口径：按书籍格式决定「当前阅读页 / 下一页」怎么取
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.1 / §5.3

import type { BookFormat, Direction, ReadingProgress } from '../../shared/types'
import { thumbPageOf, type ProgressInput } from './bookProgress'

/** 单页取图描述（渲染层内部类型，不是 IPC 契约，故不进 shared/types.ts） */
export type PageThumb =
  /** CBZ / MOBI / EPUB：逐页图片协议直接给地址，<img> 零成本 */
  | { kind: 'image'; url: string }
  /** PDF：pdf.js 离屏渲染指定页 */
  | { kind: 'pdf'; bookId: number; page: number }
  /** 兜底：取不到图时回落封面 */
  | { kind: 'cover'; url: string | null }

/** 页序方向：ltr = 左面先读；rtl = 右面先读（日漫默认） */
export type PageOrder = 'ltr' | 'rtl'

/**
 * 翻开后左右两个面：
 * - `current` 先读到的页（页码小的一面），`next` 后读到的页
 * - `order` 决定两者落在哪一侧：`ltr` 左先读（current 在左），`rtl` 右先读（current 在右）
 */
export interface PageThumbSource {
  current: PageThumb
  /** 下一页；超出总页数为 null，该面留白纸 */
  next: PageThumb | null
  order: PageOrder
}

/** 解析缩略图所需的最小书籍信息 */
export interface PageThumbBook extends ProgressInput {
  id: number
  format: BookFormat
  coverUrl: string | null
  /** 比 ProgressInput 多要 direction / rowOrder：页序由本书的阅读方向决定 */
  progress: Pick<ReadingProgress, 'page' | 'percentage' | 'direction' | 'rowOrder'> | null
}

/**
 * 单页取图：CBZ / MOBI / EPUB 走逐页图片协议，PDF 走 pdf.js，其余返回 null 由调用方兜底。
 * 无进度的书也照样取图——`thumbPageOf` 已把无进度归一到第 1 页，于是左右两面自然就是第 1 / 2 页。
 */
function thumbOf(book: PageThumbBook, page: number): PageThumb | null {
  if (book.format === 'cbz' || book.format === 'mobi') {
    return { kind: 'image', url: `ireader://${book.format}/${book.id}/${page}` }
  }
  if (book.format === 'pdf') return { kind: 'pdf', bookId: book.id, page }
  // EPUB 的 progress.page 就是 spine 索引 + 1；由主进程按 spine 取「该页 XHTML 里的那张图」，
  // 文字型 EPUB 取不到图会 404，组件自动回落封面
  if (book.format === 'epub') {
    return { kind: 'image', url: `ireader://epubpage/${book.id}/${page}` }
  }
  return null
}

/**
 * 页序方向（决定左右两面各放哪一页）：
 * - 已读过的书跟本书 `progress.direction`（阅读器里改方向会写进进度）；
 * - 未读过的书用全局默认方向 `defaultDirection`；
 * - 纵向条漫（ttb）没有跨页概念，行内页序取 `progress.rowOrder`，缺省左→右。
 */
export function pageOrderOf(book: PageThumbBook, defaultDirection: Direction): PageOrder {
  const direction = book.progress?.direction ?? defaultDirection
  if (direction === 'ttb') return book.progress?.rowOrder ?? 'ltr'
  return direction
}

/**
 * 决定翻开后两面各显示哪张图。
 * 页码口径与阅读器一致：progress.page 为 1 基页面号（双页模式为页组首页）；无进度的书从第 1 页起。
 * `defaultDirection` 仅在书没有进度时生效，传全局设置里的 defaultDirection。
 */
export function resolvePageThumb(
  book: PageThumbBook,
  defaultDirection: Direction = 'rtl'
): PageThumbSource {
  const page = thumbPageOf(book)
  const current = thumbOf(book, page) ?? { kind: 'cover', url: book.coverUrl }
  // 末页没有下一页；totalPages 未知（0）时先按 page+1 试，取图失败由组件兜底
  const inRange = book.totalPages <= 0 || page + 1 <= book.totalPages
  const next = inRange ? thumbOf(book, page + 1) : null
  return { current, next, order: pageOrderOf(book, defaultDirection) }
}

/** PDF 缩略图缓存上限：侧栏一次看两页，8 条足够覆盖来回切书 */
const MAX_CACHED_PDF_THUMBS = 8

/** key = `${bookId}:${page}`，value = JPEG dataURL；FIFO 淘汰，仅存活于本次会话 */
const pdfThumbCache = new Map<string, string>()

function cacheKey(bookId: number, page: number): string {
  return `${bookId}:${page}`
}

function rememberThumb(key: string, dataUrl: string): void {
  if (pdfThumbCache.size >= MAX_CACHED_PDF_THUMBS) {
    const oldest = pdfThumbCache.keys().next().value
    if (oldest !== undefined) pdfThumbCache.delete(oldest)
  }
  pdfThumbCache.set(key, dataUrl)
}

/**
 * 取 PDF 某页缩略图（JPEG dataURL）：命中缓存直接返回，否则渲染后写入缓存。
 * 页码越界、文件损坏等情况由调用方 catch 后回落封面。
 */
export async function getPdfPageThumb(bookId: number, page: number): Promise<string> {
  const key = cacheKey(bookId, page)
  const cached = pdfThumbCache.get(key)
  if (cached) return cached
  const dataUrl = await renderPdfPageThumb(`ireader://pdf/${bookId}`, page)
  rememberThumb(key, dataUrl)
  return dataUrl
}

/**
 * 用 pdf.js 渲染指定页为 JPEG dataURL（含 DOM 副作用，不做单测）。
 * 模块动态导入：pdf.js 体积大且依赖浏览器环境，避免污染纯函数模块的加载与单测。
 */
export async function renderPdfPageThumb(
  url: string,
  page: number,
  targetWidth = 300
): Promise<string> {
  const { loadPdfWithTask, renderPageToCanvas } = await import('./pdf')
  const { doc, task } = await loadPdfWithTask(url)
  try {
    const canvas = document.createElement('canvas')
    await renderPageToCanvas(doc, page, { canvas, targetWidth })
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    // 不销毁会残留 pdf.js worker 与解析缓存
    await task.destroy().catch(() => undefined)
  }
}
