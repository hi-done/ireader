import { describe, expect, it } from 'vitest'
import type { Book, Collection } from '../../shared/types'
import { filterCollectionsByKeyword, sortBooks, sortCollections } from './libraryList'

/** 构造测试用图书：只关心排序相关字段，其余取最小默认值 */
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

function collection(id: number, title: string, createdAt: number): Collection {
  return { id, title, createdAt }
}

const titles = (list: readonly { title: string }[]) => list.map((item) => item.title)
const ids = (list: readonly { id: number }[]) => list.map((item) => item.id)

describe('sortBooks - 书名', () => {
  const books = [
    book({ id: 1, title: '伽马' }),
    book({ id: 2, title: '阿尔法' }),
    book({ id: 3, title: '贝塔' }),
  ]

  it('升序按中文拼音排列', () => {
    expect(titles(sortBooks(books, 'title', 'asc'))).toEqual(['阿尔法', '贝塔', '伽马'])
  })

  it('降序为升序的逆序', () => {
    expect(titles(sortBooks(books, 'title', 'desc'))).toEqual(['伽马', '贝塔', '阿尔法'])
  })
})

describe('sortBooks - 添加时间', () => {
  const books = [
    book({ id: 1, title: 'A', addedAt: 300 }),
    book({ id: 2, title: 'B', addedAt: 100 }),
    book({ id: 3, title: 'C', addedAt: 200 }),
  ]

  it('升序按添加时间从早到晚', () => {
    expect(ids(sortBooks(books, 'addedAt', 'asc'))).toEqual([2, 3, 1])
  })

  it('降序按添加时间从晚到早', () => {
    expect(ids(sortBooks(books, 'addedAt', 'desc'))).toEqual([1, 3, 2])
  })
})

describe('sortBooks - 最近阅读', () => {
  const books = [
    book({ id: 1, title: '未读', lastOpenedAt: null }),
    book({ id: 2, title: '最近 200', lastOpenedAt: 200 }),
    book({ id: 3, title: '最近 100', lastOpenedAt: 100 }),
  ]

  it('升序时未读（null 视为 0）排最前', () => {
    expect(titles(sortBooks(books, 'lastOpenedAt', 'asc'))).toEqual([
      '未读',
      '最近 100',
      '最近 200',
    ])
  })

  it('降序时未读（null 视为 0）排最后', () => {
    expect(titles(sortBooks(books, 'lastOpenedAt', 'desc'))).toEqual([
      '最近 200',
      '最近 100',
      '未读',
    ])
  })
})

describe('sortCollections - 书名', () => {
  const collections = [collection(1, '伽马', 1), collection(2, '阿尔法', 2)]

  it('升序按中文拼音排列', () => {
    expect(titles(sortCollections(collections, [], 'title', 'asc'))).toEqual(['阿尔法', '伽马'])
  })

  it('降序为升序的逆序', () => {
    expect(titles(sortCollections(collections, [], 'title', 'desc'))).toEqual(['伽马', '阿尔法'])
  })
})

describe('sortCollections - 添加时间（创建时间）', () => {
  const collections = [
    collection(1, '合集 A', 300),
    collection(2, '合集 B', 100),
    collection(3, '合集 C', 200),
  ]

  it('升序按创建时间从早到晚', () => {
    expect(ids(sortCollections(collections, [], 'addedAt', 'asc'))).toEqual([2, 3, 1])
  })

  it('降序按创建时间从晚到早', () => {
    expect(ids(sortCollections(collections, [], 'addedAt', 'desc'))).toEqual([1, 3, 2])
  })
})

describe('sortCollections - 最近阅读（集内最大值）', () => {
  const collections = [collection(1, '合集甲', 0), collection(2, '合集乙', 0)]
  const books = [
    book({ id: 1, title: 'a', collectionId: 1, lastOpenedAt: 100 }),
    book({ id: 2, title: 'b', collectionId: 1, lastOpenedAt: 500 }),
    book({ id: 3, title: 'c', collectionId: 2, lastOpenedAt: 300 }),
    // 未分组书的阅读时间不参与任何合集派生
    book({ id: 4, title: 'd', collectionId: null, lastOpenedAt: 900 }),
  ]

  it('取集内最新阅读时间，不累加也不受未分组书影响', () => {
    expect(ids(sortCollections(collections, books, 'lastOpenedAt', 'desc'))).toEqual([1, 2])
    expect(ids(sortCollections(collections, books, 'lastOpenedAt', 'asc'))).toEqual([2, 1])
  })
})

describe('sortCollections - 边界', () => {
  const collections = [
    collection(1, '有阅读', 0),
    collection(2, '空合集', 0),
    collection(3, '从未阅读', 0),
  ]
  const books = [
    book({ id: 1, title: 'a', collectionId: 1, lastOpenedAt: 100 }),
    book({ id: 2, title: 'b', collectionId: 3, lastOpenedAt: null }),
  ]

  it('降序时空合集与从未阅读合集排最后，并保持入参顺序', () => {
    expect(ids(sortCollections(collections, books, 'lastOpenedAt', 'desc'))).toEqual([1, 2, 3])
  })

  it('升序时空合集与从未阅读合集排最前', () => {
    expect(ids(sortCollections(collections, books, 'lastOpenedAt', 'asc'))).toEqual([2, 3, 1])
  })
})

describe('排序不修改入参且同值稳定', () => {
  it('返回新数组，入参顺序不变', () => {
    const books = [
      book({ id: 1, title: 'B', addedAt: 100 }),
      book({ id: 2, title: 'A', addedAt: 100 }),
    ]
    const sorted = sortBooks(books, 'title', 'asc')
    expect(sorted).not.toBe(books)
    expect(ids(sorted)).toEqual([2, 1])
    expect(ids(books)).toEqual([1, 2])
  })

  it('排序键相同时保持入参顺序', () => {
    const books = [
      book({ id: 1, title: 'A', addedAt: 100 }),
      book({ id: 2, title: 'B', addedAt: 100 }),
      book({ id: 3, title: 'C', addedAt: 100 }),
    ]
    expect(ids(sortBooks(books, 'addedAt', 'desc'))).toEqual([1, 2, 3])

    const collections = [collection(1, '甲', 100), collection(2, '乙', 100)]
    expect(ids(sortCollections(collections, [], 'addedAt', 'asc'))).toEqual([1, 2])
  })

  it('合集排序不修改入参', () => {
    const collections = [collection(1, '乙', 100), collection(2, '甲', 200)]
    const sorted = sortCollections(collections, [], 'addedAt', 'desc')
    expect(sorted).not.toBe(collections)
    expect(ids(collections)).toEqual([1, 2])
  })
})

describe('filterCollectionsByKeyword', () => {
  const collections = [collection(1, '我的收藏', 0), collection(2, '其他合集', 0)]
  const books = [
    book({ id: 1, title: '海贼王', collectionId: 1 }),
    book({ id: 2, title: '火影忍者', collectionId: 2 }),
    book({ id: 3, title: '未分组书', collectionId: null }),
  ]

  it('合集标题命中时保留', () => {
    expect(ids(filterCollectionsByKeyword(collections, books, '收藏'))).toEqual([1])
  })

  it('集内书名命中时保留所属合集', () => {
    expect(ids(filterCollectionsByKeyword(collections, books, '海贼'))).toEqual([1])
    expect(ids(filterCollectionsByKeyword(collections, books, '火影'))).toEqual([2])
  })

  it('空关键字或纯空格时返回全部合集', () => {
    expect(ids(filterCollectionsByKeyword(collections, books, ''))).toEqual([1, 2])
    expect(ids(filterCollectionsByKeyword(collections, books, '   '))).toEqual([1, 2])
  })

  it('关键字大小写不敏感且忽略首尾空格', () => {
    const list = [collection(1, 'One Piece 合集', 0), collection(2, '火影', 0)]
    expect(ids(filterCollectionsByKeyword(list, [], ' one '))).toEqual([1])
  })

  it('返回新数组，不修改入参', () => {
    const result = filterCollectionsByKeyword(collections, books, '')
    expect(result).not.toBe(collections)
    expect(ids(collections)).toEqual([1, 2])
  })
})
