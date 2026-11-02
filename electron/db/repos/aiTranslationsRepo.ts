// ai_translations 表数据访问
// 对应设计文档《20261102-AI框选翻译功能设计方案》§5.1
// 矩形一律按相对单页显示盒的 0~1 比例存储，因此单双页 / 缩放 / 方向切换后位置不失效

import type { AiRect, AiTranslationRecord } from '../../../shared/types'
import { getDatabase } from '../database'

/** DB 行（下划线命名） */
interface AiTranslationRow {
  id: number
  bookId: number
  page: number
  rectX: number
  rectY: number
  rectW: number
  rectH: number
  text: string
  fontRatio: number
  collapsed: number
  createdAt: number
}

/** 写入字段（id / bookId / page 由调用方确定） */
export interface AiTranslationFields {
  rect: AiRect
  text: string
  fontRatio: number
  collapsed: boolean
}

function toRecord(row: AiTranslationRow): AiTranslationRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    page: row.page,
    rect: { x: row.rectX, y: row.rectY, w: row.rectW, h: row.rectH },
    text: row.text,
    fontRatio: row.fontRatio,
    collapsed: row.collapsed === 1,
    createdAt: row.createdAt,
  }
}

const SELECT_COLUMNS = `id, book_id AS bookId, page,
  rect_x AS rectX, rect_y AS rectY, rect_w AS rectW, rect_h AS rectH,
  text, font_ratio AS fontRatio, collapsed, created_at AS createdAt`

export const aiTranslationsRepo = {
  /** 某书全部译文（按页码、创建时间升序，渲染层按页分组） */
  listByBook(bookId: number): AiTranslationRecord[] {
    const rows = getDatabase()
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM ai_translations
         WHERE book_id = ?
         ORDER BY page, created_at, id`
      )
      .all(bookId) as AiTranslationRow[]
    return rows.map(toRecord)
  },

  findById(id: number): AiTranslationRecord | null {
    const row = getDatabase()
      .prepare(`SELECT ${SELECT_COLUMNS} FROM ai_translations WHERE id = ?`)
      .get(id) as AiTranslationRow | undefined
    return row ? toRecord(row) : null
  },

  insert(bookId: number, page: number, fields: AiTranslationFields, createdAt: number): AiTranslationRecord {
    const info = getDatabase()
      .prepare(
        `INSERT INTO ai_translations
           (book_id, page, rect_x, rect_y, rect_w, rect_h, text, font_ratio, collapsed, created_at)
         VALUES (@bookId, @page, @x, @y, @w, @h, @text, @fontRatio, @collapsed, @createdAt)`
      )
      .run({
        bookId,
        page,
        x: fields.rect.x,
        y: fields.rect.y,
        w: fields.rect.w,
        h: fields.rect.h,
        text: fields.text,
        fontRatio: fields.fontRatio,
        collapsed: fields.collapsed ? 1 : 0,
        createdAt,
      })
    return {
      id: Number(info.lastInsertRowid),
      bookId,
      page,
      rect: { ...fields.rect },
      text: fields.text,
      fontRatio: fields.fontRatio,
      collapsed: fields.collapsed,
      createdAt,
    }
  },

  /** 整体覆盖可编辑字段（页码与所属书不可改：改页等于换记录） */
  update(id: number, fields: AiTranslationFields): void {
    getDatabase()
      .prepare(
        `UPDATE ai_translations SET
           rect_x = @x, rect_y = @y, rect_w = @w, rect_h = @h,
           text = @text, font_ratio = @fontRatio, collapsed = @collapsed
         WHERE id = @id`
      )
      .run({
        id,
        x: fields.rect.x,
        y: fields.rect.y,
        w: fields.rect.w,
        h: fields.rect.h,
        text: fields.text,
        fontRatio: fields.fontRatio,
        collapsed: fields.collapsed ? 1 : 0,
      })
  },

  remove(id: number): void {
    getDatabase().prepare('DELETE FROM ai_translations WHERE id = ?').run(id)
  },
}
