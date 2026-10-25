// 漫画批量管理页的纯逻辑：行构建、位置 / 关键字筛选、导入时间格式化
// 对应设计文档 specs/漫画批量管理设计方案-20261025.md §4

import type { Book, Collection } from '../../shared/types'

/** 管理页行数据：书 + 所属位置（null = 主页 / 未分组） */
export interface ManageBookRow {
  book: Book
  /** 所属合集标题；null 表示主页（未分组，含合集已被解散的失效归属） */
  collectionTitle: string | null
}

/** 位置筛选：all = 全部；ungrouped = 主页；number = 指定合集 id */
export type CollectionFilter = 'all' | 'ungrouped' | number

/**
 * 构建管理页行数据（不修改入参）。
 * 合集标题一次建 Map，避免逐行 find；排序为导入时间降序，同刻按 id 降序保证稳定。
 */
export function buildManageRows(
  books: readonly Book[],
  collections: readonly Collection[]
): ManageBookRow[] {
  const titleById = new Map(collections.map((c) => [c.id, c.title]))
  return [...books]
    .sort((a, b) => b.addedAt - a.addedAt || b.id - a.id)
    .map((book) => ({
      book,
      // collectionId 指向已不存在的合集时按主页兜底：否则该行既显示不出位置也无法被筛选
      collectionTitle: book.collectionId == null ? null : (titleById.get(book.collectionId) ?? null),
    }))
}

/**
 * 位置 + 关键字（AND）筛选（不修改入参）。
 * 关键字按空白切词，每个词都必须是书名子串（不区分大小写），与 AddBooksDialog 语义一致。
 */
export function filterManageRows(
  rows: readonly ManageBookRow[],
  keyword: string,
  filter: CollectionFilter
): ManageBookRow[] {
  const words = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => {
    if (!matchFilter(row, filter)) return false
    if (!words.length) return true
    const title = row.book.title.toLowerCase()
    return words.every((word) => title.includes(word))
  })
}

/** 位置判定：与行显示口径一致（合集失效时已按主页兜底） */
function matchFilter(row: ManageBookRow, filter: CollectionFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'ungrouped') return row.collectionTitle === null
  return row.book.collectionId === filter
}

/**
 * 导入时间：本地时区 'YYYY-MM-DD HH:mm'；非法 / 缺失值返回 '—'。
 * 禁止用 toISOString()：UTC 偏移会让「今天导入」显示成昨天（与 formatDayKey 同口径）。
 */
export function formatAddedAt(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const date = new Date(ts)
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}
