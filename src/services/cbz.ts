// CBZ 单页渲染：经 ireader://cbz/{id}/{page} 拉取单张图片并按 pdf.js 同规格绘制到 canvas
// 对应设计文档《CBZ漫画格式支持设计方案》§4.3 / §8.1

import { t } from '../i18n'
import type { RenderPageOptions } from './pdf'

interface CbzPageSize {
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
}

/** 计算目标绘制尺寸（口径与 pdf.ts 一致：适宽精确等于目标宽、适高精确等于目标高、缺省为原图 CSS 1:1） */
export function computeCbzPageSize(
  naturalWidth: number,
  naturalHeight: number,
  options: Pick<RenderPageOptions, 'targetWidth' | 'targetHeight'>,
  dpr: number
): CbzPageSize {
  let scale = 1
  if (options.targetWidth) scale = options.targetWidth / naturalWidth
  else if (options.targetHeight) scale = options.targetHeight / naturalHeight
  const cssWidth = naturalWidth * scale
  const cssHeight = naturalHeight * scale
  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.round(cssHeight * dpr)),
  }
}

/** 同一 canvas 上进行中的绘制登记（取消语义对照 pdf.ts：重入时旧结果不上屏） */
interface ActiveDraw {
  cancelled: boolean
}
const activeDraws = new WeakMap<HTMLCanvasElement, ActiveDraw>()

/**
 * 渲染 CBZ 第 pageNumber 页到 canvas，canvas 尺寸乘以 devicePixelRatio 保证高清屏清晰度。
 * 同一 canvas 重入时标记上一次绘制为取消（图片解码无法中止，醒来后只跳过绘制）。
 */
export function renderCbzPageToCanvas(
  bookId: number,
  pageNumber: number,
  options: RenderPageOptions
): Promise<void> {
  const prev = activeDraws.get(options.canvas)
  if (prev) prev.cancelled = true
  const entry: ActiveDraw = { cancelled: false }
  activeDraws.set(options.canvas, entry)
  return doRenderCbzPage(bookId, pageNumber, options, entry)
}

/** 取消同一 canvas 上进行中的绘制（预取让路用）；图片解码不可中止，醒来后只跳过绘制 */
export function cancelCbzRender(canvas: HTMLCanvasElement): void {
  const entry = activeDraws.get(canvas)
  if (entry) entry.cancelled = true
}

async function doRenderCbzPage(
  bookId: number,
  pageNumber: number,
  options: RenderPageOptions,
  entry: ActiveDraw
): Promise<void> {
  const res = await fetch(`ireader://cbz/${bookId}/${pageNumber}`)
  if (!res.ok) {
    throw new Error(t('reader.cbzPageFailed', { page: pageNumber, status: res.status }))
  }
  // 显式携带 Content-Type：Chromium 的 createImageBitmap 按 MIME 选择解码器
  const blob = new Blob([await res.arrayBuffer()], {
    type: res.headers.get('Content-Type') ?? '',
  })
  const bitmap = await createImageBitmap(blob)
  try {
    if (entry.cancelled) return
    const dpr = window.devicePixelRatio || 1
    const { cssWidth, cssHeight, pixelWidth, pixelHeight } = computeCbzPageSize(
      bitmap.width,
      bitmap.height,
      options,
      dpr
    )
    const canvas = options.canvas
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    context.drawImage(bitmap, 0, 0, pixelWidth, pixelHeight)
  } finally {
    bitmap.close()
    if (activeDraws.get(options.canvas) === entry) activeDraws.delete(options.canvas)
  }
}
