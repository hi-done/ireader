// reading_stats 表数据访问
// 对应设计文档《阅读时间统计功能设计方案》§5.2

import { getDatabase } from '../database'

/** 单书累计行（含 books 表 JOIN 出的标题） */
export interface BookStatRow {
  bookId: number
  title: string
  durationMs: number
  /** 最近一次阅读时间戳（= 最后一次累加的 updated_at） */
  lastReadAt: number
}

/** 逐日合计行 */
export interface DayStatRow {
  day: string
  durationMs: number
}

export const statsRepo = {
  /** 某书某日累加时长（UPSERT 原子累加；day 已由服务层校验） */
  addDuration(bookId: number, day: string, deltaMs: number, now: number): void {
    getDatabase()
      .prepare(
        `INSERT INTO reading_stats (book_id, day, duration_ms, updated_at)
         VALUES (@bookId, @day, @deltaMs, @now)
         ON CONFLICT(book_id, day) DO UPDATE SET
           duration_ms = duration_ms + excluded.duration_ms,
           updated_at  = excluded.updated_at`
      )
      .run({ bookId, day, deltaMs, now })
  },

  /** 每本书累计（JOIN books 取标题），时长降序 */
  listByBook(): BookStatRow[] {
    return getDatabase()
      .prepare(
        `SELECT s.book_id AS bookId, b.title AS title,
                SUM(s.duration_ms) AS durationMs, MAX(s.updated_at) AS lastReadAt
         FROM reading_stats s
         JOIN books b ON b.id = s.book_id
         GROUP BY s.book_id
         ORDER BY durationMs DESC`
      )
      .all() as BookStatRow[]
  },

  /** 自 fromDay（含）起的逐日合计（升序，仅返回有数据的天） */
  listByDay(fromDay: string): DayStatRow[] {
    return getDatabase()
      .prepare(
        `SELECT day, SUM(duration_ms) AS durationMs
         FROM reading_stats
         WHERE day >= ?
         GROUP BY day
         ORDER BY day`
      )
      .all(fromDay) as DayStatRow[]
  },

  /** 全部历史累计（无数据时为 0） */
  totalDuration(): number {
    const row = getDatabase()
      .prepare('SELECT COALESCE(SUM(duration_ms), 0) AS total FROM reading_stats')
      .get() as { total: number }
    return row.total
  },
}
