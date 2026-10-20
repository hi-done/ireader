// 阅读页渲染分发器：按 PageDocument 种类分发到 PDF / CBZ 单页渲染实现
// 对应设计文档《CBZ漫画格式支持设计方案》§8.2

import {
  cancelPdfRender,
  renderPageToCanvas as renderPdfPageToCanvas,
  type PdfDocument,
  type RenderPageOptions,
} from './pdf'
import { cancelCbzRender, renderCbzPageToCanvas } from './cbz'

/** 阅读器文档句柄：PDF 持有 pdf.js 文档；CBZ 只需 bookId 构造逐页地址 */
export type PageDocument =
  | { kind: 'pdf'; pdf: PdfDocument }
  | { kind: 'cbz'; bookId: number }

/** 将某阅读页渲染到目标 canvas（pdf 与 cbz 共用同一套页组/缓存/动画管线） */
export function renderPageToCanvas(
  doc: PageDocument,
  pageNumber: number,
  options: RenderPageOptions
): Promise<void> {
  return doc.kind === 'cbz'
    ? renderCbzPageToCanvas(doc.bookId, pageNumber, options)
    : renderPdfPageToCanvas(doc.pdf, pageNumber, options)
}

/** 取消 doc 在目标 canvas 上进行中的渲染（PDF 可中止、CBZ 只标记跳过绘制） */
export function cancelPageRender(doc: PageDocument, canvas: HTMLCanvasElement): void {
  if (doc.kind === 'cbz') cancelCbzRender(canvas)
  else cancelPdfRender(canvas)
}

export type { RenderPageOptions }
