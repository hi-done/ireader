// 三语格式化单测：时长、紧凑刻度、相对日期、星期与月日
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §11.1

import { afterEach, describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatDurationCompact,
  formatMonthDay,
  formatRelativeDay,
  formatWeekday,
} from './format'
import { setLocale } from './index'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

afterEach(() => setLocale('zh-CN'))

describe('formatDuration', () => {
  it('zh-CN', () => {
    setLocale('zh-CN')
    expect(formatDuration(20_000)).toBe('<1 分钟')
    expect(formatDuration(46 * MIN)).toBe('46 分钟')
    expect(formatDuration(12 * HOUR + 30 * MIN)).toBe('12 小时 30 分')
    expect(formatDuration(2 * HOUR)).toBe('2 小时')
  })

  it('en', () => {
    setLocale('en')
    expect(formatDuration(20_000)).toBe('<1 min')
    expect(formatDuration(46 * MIN)).toBe('46 min')
    expect(formatDuration(12 * HOUR + 30 * MIN)).toBe('12 h 30 min')
    expect(formatDuration(2 * HOUR)).toBe('2 h')
  })

  it('ja', () => {
    setLocale('ja')
    expect(formatDuration(20_000)).toBe('<1分')
    expect(formatDuration(46 * MIN)).toBe('46分')
    expect(formatDuration(12 * HOUR + 30 * MIN)).toBe('12時間30分')
    expect(formatDuration(2 * HOUR)).toBe('2時間')
  })
})

describe('formatDurationCompact', () => {
  it('zh-CN', () => {
    setLocale('zh-CN')
    expect(formatDurationCompact(0)).toBe('0')
    expect(formatDurationCompact(20 * MIN)).toBe('20 分')
    expect(formatDurationCompact(HOUR)).toBe('1 时')
    expect(formatDurationCompact(1.5 * HOUR)).toBe('1.5 时')
  })

  it('en', () => {
    setLocale('en')
    expect(formatDurationCompact(0)).toBe('0')
    expect(formatDurationCompact(20 * MIN)).toBe('20m')
    expect(formatDurationCompact(HOUR)).toBe('1h')
    expect(formatDurationCompact(1.5 * HOUR)).toBe('1.5h')
  })

  it('ja', () => {
    setLocale('ja')
    expect(formatDurationCompact(0)).toBe('0')
    expect(formatDurationCompact(20 * MIN)).toBe('20分')
    expect(formatDurationCompact(HOUR)).toBe('1時間')
    expect(formatDurationCompact(1.5 * HOUR)).toBe('1.5時間')
  })
})

describe('formatRelativeDay', () => {
  // 本地正午：避开夏令时切换点，日界差稳定
  const now = new Date(2026, 9, 21, 12, 0, 0).getTime()

  it('zh-CN', () => {
    setLocale('zh-CN')
    expect(formatRelativeDay(now, now)).toBe('今天')
    expect(formatRelativeDay(now - DAY, now)).toBe('昨天')
    expect(formatRelativeDay(now - 5 * DAY, now)).toBe('5 天前')
    expect(formatRelativeDay(now - 40 * DAY, now)).toBe('2026/9/11')
  })

  it('en', () => {
    setLocale('en')
    expect(formatRelativeDay(now, now)).toBe('Today')
    expect(formatRelativeDay(now - DAY, now)).toBe('Yesterday')
    expect(formatRelativeDay(now - 5 * DAY, now)).toBe('5 days ago')
    expect(formatRelativeDay(now - 40 * DAY, now)).toBe('9/11/2026')
  })

  it('ja', () => {
    setLocale('ja')
    expect(formatRelativeDay(now, now)).toBe('今日')
    expect(formatRelativeDay(now - DAY, now)).toBe('昨日')
    expect(formatRelativeDay(now - 5 * DAY, now)).toBe('5日前')
    expect(formatRelativeDay(now - 40 * DAY, now)).toBe('2026/9/11')
  })
})

describe('formatWeekday / formatMonthDay', () => {
  // 2026-10-21 为星期三
  const date = new Date(2026, 9, 21)

  it('zh-CN', () => {
    setLocale('zh-CN')
    expect(formatWeekday(date)).toBe('周三')
    expect(formatMonthDay(date)).toBe('10月21日')
  })

  it('en', () => {
    setLocale('en')
    expect(formatWeekday(date)).toBe('Wed')
    expect(formatMonthDay(date)).toBe('Oct 21')
  })

  it('ja', () => {
    setLocale('ja')
    expect(formatWeekday(date)).toBe('水')
    expect(formatMonthDay(date)).toBe('10月21日')
  })
})
