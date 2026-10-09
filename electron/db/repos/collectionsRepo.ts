// collections 表数据访问
// 合集仅存标题与创建时间；封面与数量由渲染层从 books 数据本地计算

import { getDatabase } from '../database'

export interface CollectionRow {
  id: number
  title: string
  created_at: number
}

export const collectionsRepo = {
  create(title: string, createdAt: number): CollectionRow {
    const result = getDatabase()
      .prepare('INSERT INTO collections (title, created_at) VALUES (?, ?)')
      .run(title, createdAt)
    return getDatabase()
      .prepare('SELECT * FROM collections WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as CollectionRow
  },

  list(): CollectionRow[] {
    return getDatabase()
      .prepare('SELECT * FROM collections ORDER BY created_at DESC')
      .all() as CollectionRow[]
  },

  exists(id: number): boolean {
    return !!getDatabase().prepare('SELECT 1 FROM collections WHERE id = ?').get(id)
  },

  /** 解散合集：事务内把成员书移回未分组，再删除合集行 */
  remove(id: number): void {
    const db = getDatabase()
    const tx = db.transaction(() => {
      db.prepare('UPDATE books SET collection_id = NULL WHERE collection_id = ?').run(id)
      db.prepare('DELETE FROM collections WHERE id = ?').run(id)
    })
    tx()
  },
}
