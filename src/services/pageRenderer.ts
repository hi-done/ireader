// 阅读页渲染分发器：按 PageDocument 种类分发到 PDF / 图片型（CBZ · MOBI）单页渲染实现
// 对应设计文档《CBZ漫画格式支持设计方案》§8.2 与 specs/MOBI漫画格式支持设计方案-20261025.md §8.2

import {
  cancelPdfRender,
  renderPageToCanvas as renderPdfPageToCanvas,
  type PdfDocument,
  type RenderPageOptions,
} from './pdf'
import {
  cancelImageRender,
  imagePageUrl,
  renderImagePageToCanvas,
  type ImagePageFormat,
} from './imagePage'

/** 阅读器文档句柄：PDF 持有 pdf.js 文档；图片型（CBZ/MOBI）只需格式 + bookId 构造逐页地址 */
export type PageDocument =
  | { kind: 'pdf'; pdf: PdfDocument }
  | { kind: 'image'; format: ImagePageFormat; bookId: number }

/** 将某阅读页渲染到目标 canvas（PDF 与图片型共用同一套页组/缓存/动画管线） */
export function renderPageToCanvas(
  doc: PageDocument,
  pageNumber: number,
  options: RenderPageOptions
): Promise<void> {
  if (doc.kind === 'pdf') return renderPdfPageToCanvas(doc.pdf, pageNumber, options)
  return renderImagePageToCanvas(imagePageUrl(doc.format, doc.bookId, pageNumber), options)
}

/** 取消 doc 在目标 canvas 上进行中的渲染（PDF 可中止、图片型只标记跳过绘制） */
export function cancelPageRender(doc: PageDocument, canvas: HTMLCanvasElement): void {
  if (doc.kind === 'pdf') cancelPdfRender(canvas)
  else cancelImageRender(canvas)
}

export type { RenderPageOptions }
