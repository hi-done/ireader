// 前端封面生成队列：导入后逐本用 pdf.js 渲染第 1 页 → cover:submit 回传主进程落盘
// 对应设计文档 §4.1 / §8.1：队列空闲时执行、不阻塞 UI；失败的书使用占位封面，不影响阅读

import { reactive } from 'vue'
import type { Book } from '../../shared/types'
import { ipc } from './ipc'
import { loadPdfWithTask, renderCoverThumbnail } from './pdf'

/** 判断一本书是否需要生成封面（无封面且页数未知），提取为纯函数便于单测 */
export function needsCoverGeneration(book: Pick<Book, 'coverUrl' | 'totalPages'>): boolean {
  return !book.coverUrl && !book.totalPages
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

async function processOne(bookId: number, title: string): Promise<void> {
  coverQueueState.currentTitle = title
  let task = null
  try {
    const loaded = await loadPdfWithTask(`ireader://pdf/${bookId}`)
    task = loaded.task
    const image = await renderCoverThumbnail(loaded.doc)
    await ipc.cover.submit(bookId, image, loaded.doc.numPages)
  } catch (e) {
    // 单本失败（损坏/加密 PDF 等）：跳过，占位封面，不中断队列；但必须留痕
    console.error(`[coverQueue] 生成封面失败 bookId=${bookId}`, e)
  } finally {
    await task?.destroy().catch(() => undefined)
    coverQueueState.currentTitle = null
  }
}

async function drain(): Promise<void> {
  running = true
  while (queue.length) {
    const { id, title } = queue.shift()!
    queuedIds.delete(id)
    await processOne(id, title)
    coverQueueState.done++
    coverQueueState.pending = queue.length
  }
  running = false
}

const queue: { id: number; title: string }[] = []

/** 将书籍加入封面生成队列；已在队列/正在处理的书自动去重 */
export function enqueueCovers(books: Pick<Book, 'id' | 'title' | 'coverUrl' | 'totalPages'>[]): void {
  const fresh = books.filter((b) => needsCoverGeneration(b) && !queuedIds.has(b.id))
  if (!fresh.length) return

  for (const b of fresh) {
    queuedIds.add(b.id)
    queue.push({ id: b.id, title: b.title })
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
