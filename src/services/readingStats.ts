// 阅读统计展示纯函数：时长格式化、坐标轴取整、连续天数、相对日期
// 对应设计文档《阅读时间统计功能设计方案》§9.7
// 排行口径派生对应设计文档《书籍排行今日与总计切换设计方案》§7.1

import type { BookReadingStat, DailyReadingStat } from '../../shared/types'

/** 时长格式化：'<1 分钟' / '46 分钟' / '12 小时 30 分' / '2 小时'（四舍五入到分钟） */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return '<1 分钟'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} 分钟`
  if (m === 0) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}

/** Y 轴刻度紧凑格式：'0' / '20 分' / '1 时' / '1.5 时' */
export function formatDurationCompact(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes === 0) return '0'
  if (minutes < 60) return `${minutes} 分`
  const hours = minutes / 60
  if (Number.isInteger(hours)) return `${hours} 时`
  return `${hours.toFixed(1)} 时`
}

/** 坐标轴上限阶梯（分钟） */
const STEPS_MINUTES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1080, 1440]

/**
 * 坐标轴上限取整：取 ≥ 最大值的分钟阶梯，兜底 ≥ minMinutes（默认 30 分钟，低数据时柱形不贴顶）。
 * 超过最大阶梯（24 小时）按整小时向上取整。
 */
export function niceMax(valueMs: number, minMinutes = 30): number {
  const minutes = Math.max(minMinutes, valueMs / 60_000)
  const hit = STEPS_MINUTES.find((s) => s >= minutes)
  if (hit) return hit * 60_000
  return Math.ceil(minutes / 60) * 3_600_000
}

/** 连续阅读天数：从今天（今天为 0 则从昨天）起往回数连续非零天 */
export function calcStreak(days: DailyReadingStat[], today: string): number {
  let count = 0
  let i = days.length - 1
  if (i >= 0 && days[i].day === today && days[i].durationMs === 0) i--
  while (i >= 0 && days[i].durationMs > 0) {
    count++
    i--
  }
  return count
}

/** 书籍排行展示口径（纯渲染层概念，不进 shared 契约） */
export type RankingMode = 'total' | 'today'

/**
 * 按口径派生排行列表：
 * - total：原样返回（stats:summary 已按总时长降序）
 * - today：过滤今日在读（todayMs > 0）并按今日时长降序；
 *   今日时长相同时维持原（总计降序）相对顺序（稳定排序）
 */
export function pickRankingBooks(books: BookReadingStat[], mode: RankingMode): BookReadingStat[] {
  if (mode === 'total') return books
  return books.filter((b) => b.todayMs > 0).sort((a, b) => b.todayMs - a.todayMs)
}

/** 相对日期文案：'今天' / '昨天' / 'N 天前'（超过 30 天显示 'YYYY/M/D'） */
export function formatRelativeDay(ts: number, now = Date.now()): string {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const target = new Date(ts)
  target.setHours(0, 0, 0, 0)
  // 用「日界差 ÷ 一天」而非固定毫秒差，避免夏令时导致的 23/25 小时偏差
  const diffDays = Math.round((startOfToday.getTime() - target.getTime()) / 86_400_000)
  if (diffDays <= 0) return '今天'
  if (diffDays === 1) return '昨天'
  if (diffDays <= 30) return `${diffDays} 天前`
  return `${target.getFullYear()}/${target.getMonth() + 1}/${target.getDate()}`
}
