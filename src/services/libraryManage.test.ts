// libraryManage 纯逻辑单测：行构建、位置 / 关键字筛选、导入时间格式化
// 对应设计文档 specs/漫画批量管理设计方案-20261025.md §11.1

import { describe, expect, it } from 'vitest'
import type { Book, Collection } from '../../shared/types'
import { buildManageRows, filterManageRows, formatAddedAt } from './libraryManage'

/** 构造测试用图书：只关心管理页相关字段，其余取最小默认值 */
function book(overrides: Partial<Book> & Pick<Book, 'id' | 'title'>): Book {
  return {
    filePath: `C:/books/${overrides.id}.cbz`,
    format: 'cbz',
    fileSize: 0,
    totalPages: 10,
    coverUrl: null,
    addedAt: 0,
    lastOpenedAt: null,
    collectionId: null,
    missing: false,
    progress: null,
    ...overrides,
  }
}

function collection(id: number, title: string): Collection {
  return { id, title, createdAt: 0 }
}

const ids = (rows: readonly { book: Book }[]) => rows.map((row) => row.book.id)

describe('buildManageRows', () => {
  const collections = [collection(7, '合集 A'), collection(9, '合集 B')]
  const books = [
    book({ id: 1, title: '未分组书', addedAt: 100 }),
    book({ id: 2, title: '集内书', addedAt: 300, collectionId: 7 }),
    book({ id: 3, title: '失效归属书', addedAt: 200, collectionId: 99 }),
  ]

  it('合集书映射合集标题，未分组为 null', () => {
    const rows = buildManageRows(books, collections)
    const byId = new Map(rows.map((row) => [row.book.id, row.collectionTitle]))
    expect(byId.get(1)).toBeNull()
    expect(byId.get(2)).toBe('合集 A')
  })

  it('collectionId 指向不存在的合集时兜底为 null，行不丢失', () => {
    const rows = buildManageRows(books, collections)
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.book.id === 3)?.collectionTitle).toBeNull()
  })

  it('按导入时间降序，同刻按 id 降序', () => {
    expect(ids(buildManageRows(books, collections))).toEqual([2, 3, 1])
    const sameTime = [book({ id: 4, title: 'D', addedAt: 500 }), book({ id: 5, title: 'E', addedAt: 500 })]
    expect(ids(buildManageRows(sameTime, collections))).toEqual([5, 4])
  })

  it('不修改入参数组顺序', () => {
    const input = [...books]
    buildManageRows(input, collections)
    expect(input.map((b) => b.id)).toEqual([1, 2, 3])
  })
})

describe('filterManageRows', () => {
  const collections = [collection(7, '合集 A'), collection(9, '合集 B')]
  const rows = buildManageRows(
    [
      book({ id: 1, title: '海贼王 第 1 卷', addedAt: 500 }),
      book({ id: 2, title: '海贼王 第 2 卷', addedAt: 400, collectionId: 7 }),
      book({ id: 3, title: 'one piece 画集', addedAt: 300, collectionId: 7 }),
      book({ id: 4, title: '孤独摇滚', addedAt: 200, collectionId: 9 }),
      book({ id: 5, title: '失效归属书', addedAt: 100, collectionId: 99 }),
    ],
    collections
  )

  it('关键字多词 AND：空格分隔的词需全部命中', () => {
    expect(ids(filterManageRows(rows, '海 王', 'all'))).toEqual([1, 2])
    expect(ids(filterManageRows(rows, '海 贼', 'all'))).toEqual([1, 2])
    expect(ids(filterManageRows(rows, '海贼 第 2', 'all'))).toEqual([2])
  })

  it('关键字不区分大小写', () => {
    expect(ids(filterManageRows(rows, 'ONE', 'all'))).toEqual([3])
  })

  it('位置筛选 all / ungrouped / 具体合集', () => {
    expect(ids(filterManageRows(rows, '', 'all'))).toEqual([1, 2, 3, 4, 5])
    // 失效归属已在行构建时兜底为主页，故归入 ungrouped
    expect(ids(filterManageRows(rows, '', 'ungrouped'))).toEqual([1, 5])
    expect(ids(filterManageRows(rows, '', 7))).toEqual([2, 3])
  })

  it('关键字与位置条件 AND 叠加取交集', () => {
    expect(ids(filterManageRows(rows, '海', 7))).toEqual([2])
  })

  it('空白关键字等同不过滤，无命中返回空数组', () => {
    expect(filterManageRows(rows, '   ', 'all')).toHaveLength(5)
    expect(filterManageRows(rows, '不存在的书名', 'all')).toEqual([])
  })
})

describe('formatAddedAt', () => {
  it('按本地时区输出 YYYY-MM-DD HH:mm', () => {
    const ts = new Date(2026, 9, 20, 14, 32).getTime()
    expect(formatAddedAt(ts)).toBe('2026-10-20 14:32')
  })

  it('月 / 日 / 时 / 分补零', () => {
    const ts = new Date(2026, 0, 5, 9, 7).getTime()
    expect(formatAddedAt(ts)).toBe('2026-01-05 09:07')
  })

  it('非法 / 缺失时间戳返回占位横线', () => {
    expect(formatAddedAt(Number.NaN)).toBe('—')
    expect(formatAddedAt(0)).toBe('—')
    expect(formatAddedAt(-1)).toBe('—')
  })
})
