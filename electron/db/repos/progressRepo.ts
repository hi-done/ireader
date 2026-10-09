// reading_progress 表数据访问
// 对应设计文档 §5.1

import { getDatabase } from '../database'
import type { Direction, ReadingMode, ReadingProgress, ZoomMode } from '../../../shared/types'

export interface ProgressRow {
  book_id: number
  page: number
  mode: ReadingMode
  direction: Direction
  zoom_mode: ZoomMode
  zoom_scale: number
  updated_at: number
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
        `INSERT INTO reading_progress (book_id, page, mode, direction, zoom_mode, zoom_scale, updated_at)
         VALUES (@bookId, @page, @mode, @direction, @zoomMode, @zoomScale, @updatedAt)
         ON CONFLICT(book_id) DO UPDATE SET
           page = @page, mode = @mode, direction = @direction,
           zoom_mode = @zoomMode, zoom_scale = @zoomScale, updated_at = @updatedAt`
      )
      .run({
        bookId,
        page: progress.page,
        mode: progress.mode,
        direction: progress.direction,
        zoomMode: progress.zoom.mode,
        zoomScale: progress.zoom.scale,
        updatedAt: progress.updatedAt,
      })
  },
}

export function toReadingProgress(row: ProgressRow): ReadingProgress {
  return {
    page: row.page,
    mode: row.mode,
    direction: row.direction,
    zoom: { mode: row.zoom_mode, scale: row.zoom_scale },
    updatedAt: row.updated_at,
  }
}
