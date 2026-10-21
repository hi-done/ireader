// 三语时长 / 相对日期 / 星期 / 月日格式化：内部读取 appLocale，调用点无需传语言
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §8.3

import type { AppLocale } from '../../shared/types'
import { appLocale, t, tp } from './index'

/** Intl 实例按语言缓存：统计页单次渲染会多次取同一语言的 formatter */
const weekdayFormatters = new Map<AppLocale, Intl.DateTimeFormat>()
const monthDayFormatters = new Map<AppLocale, Intl.DateTimeFormat>()
const dateFormatters = new Map<AppLocale, Intl.DateTimeFormat>()

function cached(
  cache: Map<AppLocale, Intl.DateTimeFormat>,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  let formatter = cache.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    cache.set(locale, formatter)
  }
  return formatter
}

/** 时长格式化：'<1 分钟' / '46 分钟' / '12 小时 30 分' / '2 小时'（四舍五入到分钟） */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return t('format.duration.lessThanMinute')
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return t('format.duration.minutes', { minutes: m })
  if (m === 0) return t('format.duration.hours', { hours: h })
  return t('format.duration.hoursMinutes', { hours: h, minutes: m })
}

/** Y 轴刻度紧凑格式：'0' / '20 分' / '1 时' / '1.5 时' */
export function formatDurationCompact(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes === 0) return '0'
  if (minutes < 60) return t('format.compact.minutes', { minutes })
  const hours = minutes / 60
  const display = Number.isInteger(hours) ? hours : hours.toFixed(1)
  return t('format.compact.hours', { hours: display })
}

/** 相对日期文案：'今天' / '昨天' / 'N 天前'（超过 30 天按当前语言显示日期） */
export function formatRelativeDay(ts: number, now = Date.now()): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const target = new Date(ts)
  target.setHours(0, 0, 0, 0)
  // 用「日界差 ÷ 一天」而非固定毫秒差，避免夏令时导致的 23/25 小时偏差
  const diffDays = Math.round((startOfToday.getTime() - target.getTime()) / 86_400_000)
  if (diffDays <= 0) return t('format.relative.today')
  if (diffDays === 1) return t('format.relative.yesterday')
  if (diffDays <= 30) return tp('format.relative.daysAgo', diffDays)
  return cached(dateFormatters, appLocale.value, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(target)
}

/** 星期：zh '周一' / en 'Mon' / ja '月' */
export function formatWeekday(date: Date): string {
  return cached(weekdayFormatters, appLocale.value, { weekday: 'short' }).format(date)
}

/** 月日：zh '10月21日' / en 'Oct 21' / ja '10月21日' */
export function formatMonthDay(date: Date): string {
  return cached(monthDayFormatters, appLocale.value, {
    month: 'short',
    day: 'numeric',
  }).format(date)
}
