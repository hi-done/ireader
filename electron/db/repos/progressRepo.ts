// reading_progress 表数据访问
// 对应设计文档 §5.1

import { getDatabase } from '../database'
import type { Direction, ReadingMode, ReadingProgress, RowOrder, ZoomMode } from '../../../shared/types'

export interface ProgressRow {
  book_id: number
  page: number
  mode: ReadingMode
  direction: Direction
  zoom_mode: ZoomMode
  zoom_scale: number
  updated_at: number
  cfi: string | null
  percentage: number | null
  /** 纵向双页行内页序；旧版本行为 NULL（视为左→右） */
  row_order: RowOrder | null
}

/** 方向同步用精简行：只读判定所需字段，避免把整行进度带进内存 */
export interface DirectionSyncRow {
  book_id: number
  page: number
  percentage: number | null
  direction: Direction
}

export const progressRepo = {
  findByBookId(bookId: number): ProgressRow | undefined {
    return getDatabase()
      .prepare('SELECT * FROM reading_progress WHERE book_id = ?')
      .get(bookId) as ProgressRow | undefined
  },

  upsert(bookId: number, progress: ReadingProgress): void {
    getDatabase()
      .prepare(
        `INSERT INTO reading_progress (book_id, page, mode, direction, zoom_mode, zoom_scale, updated_at, cfi, percentage, row_order)
         VALUES (@bookId, @page, @mode, @direction, @zoomMode, @zoomScale, @updatedAt, @cfi, @percentage, @rowOrder)
         ON CONFLICT(book_id) DO UPDATE SET
           page = @page, mode = @mode, direction = @direction,
           zoom_mode = @zoomMode, zoom_scale = @zoomScale, updated_at = @updatedAt,
           cfi = @cfi, percentage = @percentage, row_order = @rowOrder`
      )
      .run({
        bookId,
        page: progress.page,
        mode: progress.mode,
        direction: progress.direction,
        zoomMode: progress.zoom.mode,
        zoomScale: progress.zoom.scale,
        updatedAt: progress.updatedAt,
        cfi: progress.cfi ?? null,
        percentage: progress.percentage ?? null,
        rowOrder: progress.rowOrder ?? 'ltr',
      })
  },

  /** 列出全部进度的方向判定字段（默认方向同步用：书数量级小，一次性读取后在事务内过滤） */
  listForDirectionSync(): DirectionSyncRow[] {
    return getDatabase()
      .prepare('SELECT book_id, page, percentage, direction FROM reading_progress')
      .all() as DirectionSyncRow[]
  },

  /**
   * 仅更新方向列：page / mode / zoom / cfi / percentage / updated_at 一律不动。
   * 不复用 upsert——那会整行覆盖，把方向同步写成一次「假阅读」。
   */
  updateDirection(bookId: number, direction: Direction): void {
    getDatabase()
      .prepare('UPDATE reading_progress SET direction = ? WHERE book_id = ?')
      .run(direction, bookId)
  },
}

export function toReadingProgress(row: ProgressRow): ReadingProgress {
  return {
    page: row.page,
    cfi: row.cfi,
    percentage: row.percentage,
    mode: row.mode,
    direction: row.direction,
    rowOrder: row.row_order === 'rtl' ? 'rtl' : 'ltr',
    zoom: { mode: row.zoom_mode, scale: row.zoom_scale },
    updatedAt: row.updated_at,
  }
}
