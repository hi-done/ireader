import { describe, expect, it } from 'vitest'
import { needsCoverGeneration, pickPendingCoverIds } from './coverQueue'

describe('needsCoverGeneration', () => {
  it('无封面且页数未知时需要生成', () => {
    expect(needsCoverGeneration({ coverUrl: null, totalPages: 0 })).toBe(true)
  })

  it('已有封面则不需要', () => {
    expect(needsCoverGeneration({ coverUrl: 'ireader://cover/1', totalPages: 0 })).toBe(false)
  })

  it('页数已知（即使封面缺失）则不需要', () => {
    expect(needsCoverGeneration({ coverUrl: null, totalPages: 128 })).toBe(false)
  })
})

describe('pickPendingCoverIds', () => {
  it('只保留待生成的书并保持顺序', () => {
    const books = [
      { id: 3, coverUrl: null, totalPages: 0 },
      { id: 1, coverUrl: 'ireader://cover/1', totalPages: 10 },
      { id: 2, coverUrl: null, totalPages: 0 },
      { id: 4, coverUrl: null, totalPages: 5 },
    ]
    expect(pickPendingCoverIds(books)).toEqual([3, 2])
  })

  it('全部已生成时返回空数组', () => {
    const books = [{ id: 1, coverUrl: 'ireader://cover/1', totalPages: 1 }]
    expect(pickPendingCoverIds(books)).toEqual([])
  })

  it('空列表返回空数组', () => {
    expect(pickPendingCoverIds([])).toEqual([])
  })
})
