// readingStats 单测：坐标轴取整、连续天数、排行口径
// 对应设计文档《阅读时间统计功能设计方案》§11.1
// 排行口径派生对应设计文档《书籍排行今日与总计切换设计方案》§9.1
// 展示文案（时长 / 相对日期）用例已迁至 src/i18n/format.test.ts

import { describe, expect, it } from 'vitest'
import { calcStreak, niceMax, pickRankingBooks } from './readingStats'
import type { BookReadingStat, DailyReadingStat } from '../../shared/types'

const MIN = 60_000
const HOUR = 3_600_000

/** 构造逐日序列：[日期, 分钟数] */
function mkDays(list: Array<[string, number]>): DailyReadingStat[] {
  return list.map(([day, minutes]) => ({ day, durationMs: minutes * MIN }))
}

describe('niceMax', () => {
  it('取不小于最大值的分钟阶梯', () => {
    expect(niceMax(80 * MIN)).toBe(90 * MIN)
  })

  it('低值与零值兜底 30 分钟', () => {
    expect(niceMax(4 * MIN)).toBe(30 * MIN)
    expect(niceMax(0)).toBe(30 * MIN)
  })

  it('超过 24 小时按整小时向上取整', () => {
    expect(niceMax(25 * HOUR)).toBe(25 * HOUR)
  })
})

describe('calcStreak', () => {
  it('今天为 0 时从昨天起算', () => {
    const days = mkDays([
      ['2026-10-13', 10],
      ['2026-10-14', 30],
      ['2026-10-15', 0],
    ])
    expect(calcStreak(days, '2026-10-15')).toBe(2)
  })

  it('中间断档在断点处截断', () => {
    const days = mkDays([
      ['2026-10-12', 10],
      ['2026-10-13', 0],
      ['2026-10-14', 30],
      ['2026-10-15', 5],
    ])
    expect(calcStreak(days, '2026-10-15')).toBe(2)
  })

  it('全部为零或空数组返回 0', () => {
    expect(calcStreak(mkDays([['2026-10-15', 0]]), '2026-10-15')).toBe(0)
    expect(calcStreak([], '2026-10-15')).toBe(0)
  })
})

describe('pickRankingBooks', () => {
  /** 构造单书统计行：[id, 总时长分, 今日时长分] */
  function mkBook(bookId: number, durationMin: number, todayMin: number): BookReadingStat {
    return {
      bookId,
      title: `书${bookId}`,
      coverUrl: `ireader://cover/${bookId}`,
      durationMs: durationMin * MIN,
      todayMs: todayMin * MIN,
      lastReadAt: 0,
    }
  }

  it('total 模式原样返回同序数组', () => {
    const books = [mkBook(1, 300, 0), mkBook(2, 200, 100)]
    expect(pickRankingBooks(books, 'total')).toBe(books)
  })

  it('today 模式过滤今日未读（todayMs = 0）', () => {
    const books = [mkBook(1, 300, 0), mkBook(2, 200, 100)]
    expect(pickRankingBooks(books, 'today').map((b) => b.bookId)).toEqual([2])
  })

  it('today 模式按今日时长降序', () => {
    const books = [mkBook(1, 500, 10), mkBook(2, 300, 30), mkBook(3, 100, 20)]
    expect(pickRankingBooks(books, 'today').map((b) => b.bookId)).toEqual([2, 3, 1])
  })

  it('今日时长并列时维持输入相对顺序（稳定排序）', () => {
    const books = [mkBook(1, 500, 20), mkBook(2, 300, 20), mkBook(3, 100, 20)]
    expect(pickRankingBooks(books, 'today').map((b) => b.bookId)).toEqual([1, 2, 3])
  })

  it('今日全部未读返回空数组', () => {
    const books = [mkBook(1, 300, 0), mkBook(2, 200, 0)]
    expect(pickRankingBooks(books, 'today')).toEqual([])
  })
})
