// 纵向连续滚动的页面源适配：PDF / CBZ 复用既有单页渲染与取消能力
// 对应设计文档 specs/阅读方向上至下连续滚动设计方案-20261023.md §6.1

import { cancelPageRender, renderPageToCanvas, type PageDocument } from './pageRenderer'
import type { PageBox, VerticalPageSource } from './verticalLayout'

/** 读回渲染层写入 canvas 的 CSS 显示尺寸（pdf.ts / cbz.ts 均会写 style.width/height） */
function readCanvasCssSize(canvas: HTMLCanvasElement): PageBox {
  const width = Number.parseFloat(canvas.style.width)
  const height = Number.parseFloat(canvas.style.height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height }
  }
  // 兜底：style 尚未写入时按物理像素 / dpr 还原
  const dpr = window.devicePixelRatio || 1
  return { width: canvas.width / dpr, height: canvas.height / dpr }
}

/** 构造 PDF / CBZ 的纵向页面源；target 为空表示按页面自然尺寸渲染 */
export function createPageDocumentSource(doc: PageDocument): VerticalPageSource {
  return {
    async render(page, canvas, target) {
      await renderPageToCanvas(doc, page, {
        canvas,
        targetWidth: target.width,
        targetHeight: target.height,
      })
      return readCanvasCssSize(canvas)
    },
    cancel(canvas) {
      cancelPageRender(doc, canvas)
    },
  }
}
