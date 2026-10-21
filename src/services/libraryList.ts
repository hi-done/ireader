// 文库列表的过滤与排序纯函数：主页合集卡与图书卡共用同一套排序偏好
// 书名排序按当前界面语言取 collation，切语言即换拼音 / 字母序

import type { AppLocale, Book, Collection, SortBy, SortOrder } from '../../shared/types'

/** 界面语言 → 书名排序器（Intl.Collator 构造有开销，按语言缓存复用） */
const collators = new Map<AppLocale, Intl.Collator>()

/** 取（或创建）指定语言的书名排序器 */
export function titleCollator(locale: AppLocale): Intl.Collator {
  let c = collators.get(locale)
  if (!c) {
    // 仅切换 collation，不引入 numeric，保持现有书名排序语义
    c = new Intl.Collator(locale)
    collators.set(locale, c)
  }
  return c
}

/** 按界面语言比较两个书名（排序与选封面等场景共用） */
export function compareTitles(a: string, b: string, locale: AppLocale): number {
  return titleCollator(locale).compare(a, b)
}

/** 排序比较所需的字段集合（Book 结构天然满足） */
interface SortableItem {
  title: string
  /** 添加时间（书 = addedAt，合集 = createdAt） */
  addedAt: number
  /** 最近阅读时间；从未阅读为 null */
  lastOpenedAt: number | null
}

/** 三元比较：书名（当前语言 collation）/ 添加时间 / 最近阅读；dir 为 1 升序、-1 降序 */
function compareItems(
  a: SortableItem,
  b: SortableItem,
  sortBy: SortBy,
  dir: 1 | -1,
  locale: AppLocale
): number {
  if (sortBy === 'title') return compareTitles(a.title, b.title, locale) * dir
  if (sortBy === 'addedAt') return (a.addedAt - b.addedAt) * dir
  return ((a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)) * dir
}

/**
 * 图书排序（不修改入参，返回新数组）
 * @param books 待排序图书
 * @param sortBy 排序键
 * @param order 升 / 降序
 * @param locale 书名排序所用语言，缺省中文保持既有行为
 */
export function sortBooks(
  books: readonly Book[],
  sortBy: SortBy,
  order: SortOrder,
  locale: AppLocale = 'zh-CN'
): Book[] {
  const dir = order === 'asc' ? 1 : -1
  return [...books].sort((a, b) => compareItems(a, b, sortBy, dir, locale))
}

/**
 * 合集排序（不修改入参，返回新数组）。
 * 合集自身无阅读时间：以集内书 lastOpenedAt 最大值作「最近阅读」键，空合集 / 从未阅读记 0。
 * @param collections 待排序合集
 * @param allBooks 全量图书（用于派生集内最近阅读时间）
 * @param sortBy 排序键
 * @param order 升 / 降序
 * @param locale 书名排序所用语言，缺省中文保持既有行为
 */
export function sortCollections(
  collections: readonly Collection[],
  allBooks: readonly Book[],
  sortBy: SortBy,
  order: SortOrder,
  locale: AppLocale = 'zh-CN'
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
      dir,
      locale
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
