// 阅读页渲染分发器：按 PageDocument 种类分发到 PDF / CBZ 单页渲染实现
// 对应设计文档《CBZ漫画格式支持设计方案》§8.2

import {
  renderPageToCanvas as renderPdfPageToCanvas,
  type PdfDocument,
  type RenderPageOptions,
} from './pdf'
import { renderCbzPageToCanvas } from './cbz'

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

export type { RenderPageOptions }
