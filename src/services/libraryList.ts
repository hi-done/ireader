// 文库列表的过滤与排序纯函数：主页合集卡与图书卡共用同一套排序偏好

import type { Book, Collection, SortBy, SortOrder } from '../../shared/types'

/** 排序比较所需的字段集合（Book 结构天然满足） */
interface SortableItem {
  title: string
  /** 添加时间（书 = addedAt，合集 = createdAt） */
  addedAt: number
  /** 最近阅读时间；从未阅读为 null */
  lastOpenedAt: number | null
}

/** 三元比较：书名（中文拼音序）/ 添加时间 / 最近阅读；dir 为 1 升序、-1 降序 */
function compareItems(a: SortableItem, b: SortableItem, sortBy: SortBy, dir: 1 | -1): number {
  if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-Hans-CN') * dir
  if (sortBy === 'addedAt') return (a.addedAt - b.addedAt) * dir
  return ((a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)) * dir
}

/**
 * 图书排序（不修改入参，返回新数组）
 * @param books 待排序图书
 * @param sortBy 排序键
 * @param order 升 / 降序
 */
export function sortBooks(books: readonly Book[], sortBy: SortBy, order: SortOrder): Book[] {
  const dir = order === 'asc' ? 1 : -1
  return [...books].sort((a, b) => compareItems(a, b, sortBy, dir))
}

/**
 * 合集排序（不修改入参，返回新数组）。
 * 合集自身无阅读时间：以集内书 lastOpenedAt 最大值作「最近阅读」键，空合集 / 从未阅读记 0。
 * @param collections 待排序合集
 * @param allBooks 全量图书（用于派生集内最近阅读时间）
 * @param sortBy 排序键
 * @param order 升 / 降序
 */
export function sortCollections(
  collections: readonly Collection[],
  allBooks: readonly Book[],
  sortBy: SortBy,
  order: SortOrder
): Collection[] {
  const dir = order === 'asc' ? 1 : -1
  // 单遍聚合：合集 id → 集内最新阅读时间，避免排序比较器里反复扫描全量书
  const lastRead = new Map<number, number>()
  for (const book of allBooks) {
    if (book.collectionId == null || book.lastOpenedAt == null) continue
    if (book.lastOpenedAt > (lastRead.get(book.collectionId) ?? 0)) {
      lastRead.set(book.collectionId, book.lastOpenedAt)
    }
  }
  return [...collections].sort((a, b) =>
    compareItems(
      { title: a.title, addedAt: a.createdAt, lastOpenedAt: lastRead.get(a.id) ?? null },
      { title: b.title, addedAt: b.createdAt, lastOpenedAt: lastRead.get(b.id) ?? null },
      sortBy,
      dir
    )
  )
}

/**
 * 合集关键字过滤（不修改入参，返回新数组）。
 * 合集标题命中，或集内任意书名命中，即保留该合集——搜索集内书时不丢失入口。
 * @param collections 待过滤合集
 * @param allBooks 全量图书（用于匹配集内书名）
 * @param keyword 关键字；空白时返回全部合集
 */
export function filterCollectionsByKeyword(
  collections: readonly Collection[],
  allBooks: readonly Book[],
  keyword: string
): Collection[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return [...collections]
  // 先单遍聚合「有书名命中的合集」，避免每个合集都全量扫描书列表
  const hit = new Set<number>()
  for (const book of allBooks) {
    if (book.collectionId != null && book.title.toLowerCase().includes(kw)) {
      hit.add(book.collectionId)
    }
  }
  return collections.filter((c) => c.title.toLowerCase().includes(kw) || hit.has(c.id))
}
