// 前端封面生成队列：导入后逐本渲染封面 → cover:submit 回传主进程落盘
// PDF 用 pdf.js 渲染第 1 页；EPUB 用 epubjs 提取封面图；CBZ / MOBI 拉取第 1 页内嵌图片
// 对应设计文档 §4.1 / §8.1：队列空闲时执行、不阻塞 UI；失败的书使用占位封面，不影响阅读

import { reactive } from 'vue'
import type { Book, BookFormat } from '../../shared/types'
import { ipc } from './ipc'
import { loadPdfWithTask, renderCoverThumbnail } from './pdf'

/** 判断一本书是否需要生成封面（无封面即需要；页数不再作为判据——CBZ / MOBI 导入时即已知页数，需照常生成封面） */
export function needsCoverGeneration(book: Pick<Book, 'coverUrl' | 'totalPages'>): boolean {
  return !book.coverUrl
}

/** 从书列表中筛出待生成封面的书 id（保持入参顺序） */
export function pickPendingCoverIds(
  books: Pick<Book, 'id' | 'coverUrl' | 'totalPages'>[]
): number[] {
  return books.filter(needsCoverGeneration).map((b) => b.id)
}

export interface CoverQueueState {
  /** 队列中剩余数量（含正在处理的一本） */
  pending: number
  /** 本轮已完成数量 */
  done: number
  /** 本轮总量 */
  total: number
  /** 正在处理的书名，空闲时为 null */
  currentTitle: string | null
}

export const coverQueueState = reactive<CoverQueueState>({
  pending: 0,
  done: 0,
  total: 0,
  currentTitle: null,
})

const queuedIds = new Set<number>()
let running = false

/** 提取 EPUB 封面并转成 JPEG（缩到宽 480；无封面时抛错走占位逻辑） */
async function renderEpubCoverJpeg(url: string): Promise<ArrayBuffer> {
  // 动态导入：epubjs 仅 EPUB 书需要，避免污染模块加载与单测环境
  const { default: ePub } = await import('epubjs')
  // ireader:// URL 没有 .epub 扩展名，先 fetch 成 ArrayBuffer 再交给 epub.js，绕开其按扩展名猜类型的逻辑
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载 EPUB 失败（HTTP ${res.status}）`)
  const data = await res.arrayBuffer()
  const book = ePub(data)
  try {
    await book.ready
    const coverUrl = await book.coverUrl()
    if (!coverUrl) throw new Error('EPUB 无封面')
    const img = new Image()
    img.src = coverUrl
    await img.decode()
    const targetWidth = 480
    const scale = Math.min(1, targetWidth / (img.naturalWidth || 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.8
      )
    })
    return blob.arrayBuffer()
  } finally {
    book.destroy()
  }
}

/** 拉取图片型书（CBZ / MOBI）第 1 页并转成 JPEG（缩到宽 480，只缩不放）；失败抛错走占位逻辑 */
async function renderImageCoverJpeg(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载漫画首页失败（HTTP ${res.status}）`)
  const blob = new Blob([await res.arrayBuffer()], {
    type: res.headers.get('Content-Type') ?? '',
  })
  const bitmap = await createImageBitmap(blob)
  try {
    const targetWidth = 480
    const scale = Math.min(1, targetWidth / (bitmap.width || 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const jpeg: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        0.8
      )
    })
    return jpeg.arrayBuffer()
  } finally {
    bitmap.close()
  }
}

async function processOne(
  bookId: number,
  title: string,
  format: BookFormat,
  totalPages: number
): Promise<void> {
  coverQueueState.currentTitle = title
  let task: { destroy: () => Promise<void> } | null = null
  try {
    if (format === 'epub') {
      const image = await renderEpubCoverJpeg(`ireader://epub/${bookId}`)
      // EPUB 分页数依赖视口、导入时未知，total_pages 保持 0，进度展示走 percentage
      await ipc.cover.submit(bookId, image, 0)
      return
    }
    if (format === 'cbz' || format === 'mobi') {
      const image = await renderImageCoverJpeg(`ireader://${format}/${bookId}/1`)
      // 页数已在导入时按图片页表统计入库，此处回写同值
      await ipc.cover.submit(bookId, image, totalPages)
      return
    }
    const loaded = await loadPdfWithTask(`ireader://pdf/${bookId}`)
    task = loaded.task
    const image = await renderCoverThumbnail(loaded.doc)
    await ipc.cover.submit(bookId, image, loaded.doc.numPages)
  } catch (e) {
    // 单本失败（损坏/加密文件、无封面等）：跳过，占位封面，不中断队列；但必须留痕
    console.error(`[coverQueue] 生成封面失败 bookId=${bookId}`, e)
  } finally {
    await task?.destroy().catch(() => undefined)
    coverQueueState.currentTitle = null
  }
}

async function drain(): Promise<void> {
  running = true
  while (queue.length) {
    const { id, title, format, totalPages } = queue.shift()!
    queuedIds.delete(id)
    await processOne(id, title, format, totalPages)
    coverQueueState.done++
    coverQueueState.pending = queue.length
  }
  running = false
}

const queue: { id: number; title: string; format: BookFormat; totalPages: number }[] = []

/** 将书籍加入封面生成队列；已在队列/正在处理的书自动去重 */
export function enqueueCovers(
  books: Pick<Book, 'id' | 'title' | 'coverUrl' | 'totalPages' | 'format'>[]
): void {
  const fresh = books.filter((b) => needsCoverGeneration(b) && !queuedIds.has(b.id))
  if (!fresh.length) return

  for (const b of fresh) {
    queuedIds.add(b.id)
    queue.push({ id: b.id, title: b.title, format: b.format, totalPages: b.totalPages })
  }
  coverQueueState.pending = queue.length
  coverQueueState.total = coverQueueState.pending
  coverQueueState.done = 0

  if (!running) void drain()
}

/** 移除书籍时同步清理队列，避免为已删除的书继续渲染 */
export function removeFromQueue(bookId: number): void {
  if (!queuedIds.has(bookId)) return
  queuedIds.delete(bookId)
  const idx = queue.findIndex((item) => item.id === bookId)
  if (idx !== -1) {
    queue.splice(idx, 1)
    coverQueueState.pending = queue.length
  }
}
