// readingStats 单测：时长格式化、坐标轴取整、连续天数、相对日期
// 对应设计文档《阅读时间统计功能设计方案》§11.1

import { describe, expect, it } from 'vitest'
import {
  calcStreak,
  formatDuration,
  formatDurationCompact,
  formatRelativeDay,
  niceMax,
} from './readingStats'
import type { DailyReadingStat } from '../../shared/types'

const MIN = 60_000
const HOUR = 3_600_000

/** 构造逐日序列：[日期, 分钟数] */
function mkDays(list: Array<[string, number]>): DailyReadingStat[] {
  return list.map(([day, minutes]) => ({ day, durationMs: minutes * MIN }))
}

describe('formatDuration', () => {
  it('不足一分钟显示 <1 分钟', () => {
    expect(formatDuration(29_000)).toBe('<1 分钟')
  })

  it('分钟级显示 N 分钟', () => {
    expect(formatDuration(46 * MIN)).toBe('46 分钟')
  })

  it('小时级显示 N 小时 M 分', () => {
    expect(formatDuration(750 * MIN)).toBe('12 小时 30 分')
  })

  it('整小时省略分钟尾巴', () => {
    expect(formatDuration(2 * HOUR)).toBe('2 小时')
  })
})

describe('formatDurationCompact', () => {
  it('零值显示 0', () => {
    expect(formatDurationCompact(0)).toBe('0')
  })

  it('分钟级显示 N 分', () => {
    expect(formatDurationCompact(20 * MIN)).toBe('20 分')
  })

  it('整小时显示 N 时', () => {
    expect(formatDurationCompact(HOUR)).toBe('1 时')
  })

  it('半小时倍数显示 1.5 时', () => {
    expect(formatDurationCompact(90 * MIN)).toBe('1.5 时')
  })
})

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

describe('formatRelativeDay', () => {
  const now = new Date(2026, 9, 15, 12, 0, 0).getTime()

  it('今天', () => {
    expect(formatRelativeDay(new Date(2026, 9, 15, 8, 0).getTime(), now)).toBe('今天')
  })

  it('昨天', () => {
    expect(formatRelativeDay(new Date(2026, 9, 14, 23, 0).getTime(), now)).toBe('昨天')
  })

  it('N 天前', () => {
    expect(formatRelativeDay(new Date(2026, 9, 10).getTime(), now)).toBe('5 天前')
  })

  it('超过 30 天显示日期', () => {
    expect(formatRelativeDay(new Date(2026, 8, 5).getTime(), now)).toBe('2026/9/5')
  })
})
