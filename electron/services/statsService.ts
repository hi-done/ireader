// 阅读统计服务：上报校验与汇总编排
// 对应设计文档《阅读时间统计功能设计方案》§7.1
// 每书今日时长对应设计文档《书籍排行今日与总计切换设计方案》§6.2

import { booksRepo } from '../db/repos/booksRepo'
import { statsRepo } from '../db/repos/statsRepo'
import { getCoverUrl } from './coverService'
import {
  formatDayKey,
  type AppError,
  type BookReadingStat,
  type DailyReadingStat,
  type ReadingStatsSummary,
} from '../../shared/types'

/** 单次上报增量上限（5 分钟）：正常心跳 30s 远低于此，仅防异常数据 */
const MAX_DELTA_MS = 300_000
/** 默认统计窗口天数 */
const DEFAULT_DAYS = 30
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export const statsService = {
  /**
   * 记录一段阅读时长。
   * 书不存在时静默忽略（书可能刚被删除、心跳在途，属正常竞态，统计不进入错误路径）。
   */
  addTime({ bookId, day, deltaMs }: { bookId: number; day: string; deltaMs: number }): void {
    if (!Number.isInteger(bookId) || bookId <= 0) {
      throw { code: 'INVALID_PARAMS', message: 'bookId 非法' } as AppError
    }
    if (!DAY_KEY_RE.test(day)) {
      throw { code: 'INVALID_PARAMS', message: 'day 格式非法' } as AppError
    }
    if (!Number.isInteger(deltaMs) || deltaMs <= 0 || deltaMs > MAX_DELTA_MS) {
      throw { code: 'INVALID_PARAMS', message: 'deltaMs 超出允许范围' } as AppError
    }
    if (!booksRepo.findById(bookId)) return
    statsRepo.addDuration(bookId, day, deltaMs, Date.now())
  },

  /** 汇总：总时长 + 今日 + 最近 days 天逐日序列（补齐零值日）+ 每本排行 */
  summary(daysInput: number): ReadingStatsSummary {
    const days =
      Number.isInteger(daysInput) && daysInput >= 1 && daysInput <= 365 ? daysInput : DEFAULT_DAYS

    const today = new Date()
    const fromDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1))
    const dayMap = new Map(statsRepo.listByDay(formatDayKey(fromDate)).map((r) => [r.day, r.durationMs]))

    // 补齐完整序列（IPC 契约保证 days 连续：渲染层零加工直接渲染）
    const filledDays: DailyReadingStat[] = []
    for (let i = 0; i < days; i++) {
      const key = formatDayKey(
        new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + i)
      )
      filledDays.push({ day: key, durationMs: dayMap.get(key) ?? 0 })
    }

    const books: BookReadingStat[] = statsRepo.listByBook(formatDayKey(today)).map((r) => ({
      bookId: r.bookId,
      title: r.title,
      coverUrl: getCoverUrl(r.bookId),
      durationMs: r.durationMs,
      todayMs: r.todayMs,
      lastReadAt: r.lastReadAt,
    }))

    return {
      totalMs: statsRepo.totalDuration(),
      todayMs: filledDays[filledDays.length - 1]?.durationMs ?? 0,
      days: filledDays,
      books,
    }
  },
}
