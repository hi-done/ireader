// books 表数据访问
// 对应设计文档 §5.1

import { getDatabase } from '../database'

export interface BookRow {
  id: number
  title: string
  file_path: string
  file_size: number
  total_pages: number
  cover_path: string | null
  added_at: number
  last_opened_at: number | null
  collection_id: number | null
}

export interface NewBookInput {
  title: string
  filePath: string
  fileSize: number
  addedAt: number
  /** 导入时直接归属的合集（可选） */
  collectionId?: number | null
}

export const booksRepo = {
  findByPath(filePath: string): BookRow | undefined {
    return getDatabase()
      .prepare('SELECT * FROM books WHERE file_path = ?')
      .get(filePath) as BookRow | undefined
  },

  findById(id: number): BookRow | undefined {
    return getDatabase().prepare('SELECT * FROM books WHERE id = ?').get(id) as
      | BookRow
      | undefined
  },

  insert(input: NewBookInput): BookRow {
    const result = getDatabase()
      .prepare(
        `INSERT INTO books (title, file_path, file_size, total_pages, cover_path, added_at, last_opened_at, collection_id)
         VALUES (@title, @filePath, @fileSize, 0, NULL, @addedAt, NULL, @collectionId)`
      )
      .run({ collectionId: null, ...input })
    return this.findById(Number(result.lastInsertRowid))!
  },

  listAll(): BookRow[] {
    return getDatabase()
      .prepare('SELECT * FROM books ORDER BY last_opened_at DESC NULLS LAST, added_at DESC')
      .all() as BookRow[]
  },

  updateCover(id: number, coverPath: string, totalPages: number): void {
    getDatabase()
      .prepare('UPDATE books SET cover_path = ?, total_pages = ? WHERE id = ?')
      .run(coverPath, totalPages, id)
  },

  updateLastOpened(id: number, timestamp: number): void {
    getDatabase().prepare('UPDATE books SET last_opened_at = ? WHERE id = ?').run(timestamp, id)
  },

  rename(id: number, title: string): void {
    getDatabase().prepare('UPDATE books SET title = ? WHERE id = ?').run(title, id)
  },

  updatePath(id: number, filePath: string, fileSize: number): void {
    getDatabase()
      .prepare('UPDATE books SET file_path = ?, file_size = ? WHERE id = ?')
      .run(filePath, fileSize, id)
  },

  remove(id: number): void {
    getDatabase().prepare('DELETE FROM books WHERE id = ?').run(id)
  },

  /** 批量移动书至合集（collectionId = NULL 表示移回未分组） */
  moveToCollection(ids: number[], collectionId: number | null): void {
    const stmt = getDatabase().prepare('UPDATE books SET collection_id = ? WHERE id = ?')
    const tx = getDatabase().transaction(() => {
      for (const id of ids) stmt.run(collectionId, id)
    })
    tx()
  },
}
