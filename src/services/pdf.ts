// pdf.js 封装：文档加载、按页渲染、封面缩略图渲染
// 对应设计文档 §3.3 / §4.2

// 锁定 pdfjs-dist v4.x：v6 要求 Chromium ≥ 126（URL.parse 等），Electron 30 内置 Chromium 124 不兼容
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type PdfDocument = pdfjsLib.PDFDocumentProxy
export type PdfLoadingTask = pdfjsLib.PDFDocumentLoadingTask
export type PdfRenderTask = pdfjsLib.RenderTask

/** 加载文档并保留 loadingTask（销毁文档需经 task.destroy()） */
export async function loadPdfWithTask(
  url: string
): Promise<{ doc: PdfDocument; task: PdfLoadingTask }> {
  const task = pdfjsLib.getDocument({ url })
  return { doc: await task.promise, task }
}

export async function loadPdf(url: string): Promise<PdfDocument> {
  const { doc } = await loadPdfWithTask(url)
  return doc
}

export interface RenderPageOptions {
  /** 目标 canvas，渲染结果直接绘制到其中 */
  canvas: HTMLCanvasElement
  /** CSS 像素宽度（渲染时会乘以 devicePixelRatio 以保证高清） */
  targetWidth?: number
  /** CSS 像素高度 */
  targetHeight?: number
}

/** 同一 canvas 上进行中的渲染登记（canvas 不可并发 render，重入前必须取消旧任务） */
interface ActiveRender {
  task: PdfRenderTask | null
  cancelled: boolean
}
const activeRenders = new WeakMap<HTMLCanvasElement, ActiveRender>()

/**
 * 按页渲染到 canvas，canvas 尺寸会乘以 devicePixelRatio 保证高清屏清晰度。
 * 同一 canvas 重入时自动取消上一次进行中的渲染（被取消时以 resolve 结束而非 reject）。
 */
export function renderPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  options: RenderPageOptions
): Promise<void> {
  const prev = activeRenders.get(options.canvas)
  if (prev) {
    prev.cancelled = true // getPage 的 async 间隙内被取消：醒来后不再启动 render
    prev.task?.cancel()
  }
  const entry: ActiveRender = { task: null, cancelled: false }
  activeRenders.set(options.canvas, entry)
  return doRenderPage(doc, pageNumber, options, entry)
}

async function doRenderPage(
  doc: PdfDocument,
  pageNumber: number,
  options: RenderPageOptions,
  entry: ActiveRender
): Promise<void> {
  const page = await doc.getPage(pageNumber)
  if (entry.cancelled) return
  const baseViewport = page.getViewport({ scale: 1 })

  const dpr = window.devicePixelRatio || 1
  let scale = 1
  if (options.targetWidth) scale = options.targetWidth / baseViewport.width
  else if (options.targetHeight) scale = options.targetHeight / baseViewport.height

  const viewport = page.getViewport({ scale: scale * dpr })
  const canvas = options.canvas
  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.style.width = `${viewport.width / dpr}px`
  canvas.style.height = `${viewport.height / dpr}px`

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D context unavailable')

  const task = page.render({ canvasContext: context, viewport })
  entry.task = task
  try {
    await task.promise
  } catch (e) {
    // 被新渲染取消属正常流程，静默；其余错误（页码越界、文档已销毁等）照常抛出
    if ((e as Error)?.name !== 'RenderingCancelledException') throw e
  } finally {
    if (activeRenders.get(canvas) === entry) activeRenders.delete(canvas)
  }
}

/** 渲染第 1 页为封面缩略图，返回 JPEG 的 ArrayBuffer（供 cover:submit 提交） */
export async function renderCoverThumbnail(
  doc: PdfDocument,
  targetWidth = 480,
  quality = 0.8
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas')
  await renderPageToCanvas(doc, 1, { canvas, targetWidth })
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality
    )
  })
  return blob.arrayBuffer()
}
