// SQLite 初始化与版本迁移
// 对应设计文档 §5

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

const MIGRATIONS: Array<(db: Database.Database) => void> = [
  // v1: 初始建表
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        title          TEXT    NOT NULL,
        file_path      TEXT    NOT NULL UNIQUE,
        file_size      INTEGER NOT NULL,
        total_pages    INTEGER NOT NULL DEFAULT 0,
        cover_path     TEXT,
        added_at       INTEGER NOT NULL,
        last_opened_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS reading_progress (
        book_id    INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
        page       INTEGER NOT NULL,
        mode       TEXT    NOT NULL DEFAULT 'single',
        direction  TEXT    NOT NULL DEFAULT 'rtl',
        zoom_mode  TEXT    NOT NULL DEFAULT 'fitWidth',
        zoom_scale REAL    NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_books_last_opened ON books(last_opened_at DESC);
    `)
  },

  // v2: 合集（书单归属，books.collectionId 为 NULL 表示未分组）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );

      ALTER TABLE books ADD COLUMN collection_id INTEGER REFERENCES collections(id);

      CREATE INDEX IF NOT EXISTS idx_books_collection ON books(collection_id);
    `)
  },
]

/**
 * 初始化数据库连接，并按 PRAGMA user_version 顺序执行增量迁移。
 * @param userDataDir Electron app.getPath('userData') 返回的目录
 */
export function initDatabase(userDataDir: string): Database.Database {
  if (db) return db

  fs.mkdirSync(userDataDir, { recursive: true })
  const dbPath = path.join(userDataDir, 'library.db')

  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')

  const currentVersion = instance.pragma('user_version', { simple: true }) as number
  for (let v = currentVersion; v < MIGRATIONS.length; v++) {
    MIGRATIONS[v](instance)
  }
  instance.pragma(`user_version = ${MIGRATIONS.length}`)

  db = instance
  return db
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function closeDatabase(): void {
  db?.close()
  db = null
}
