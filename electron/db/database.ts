// SQLite 初始化与版本迁移
// 对应设计文档 §5

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

let db: Database.Database | null = null

/**
 * 判断表是否已有指定列。
 * SQLite 的 ALTER TABLE ADD COLUMN 不幂等：进程若在「列已提交、user_version 未写入」之间被强杀，
 * 下次启动会重复执行同一迁移并抛 duplicate column name，导致 initDatabase 失败、窗口永不创建。
 * 因此每条 ADD COLUMN 迁移都要先查列、已存在则跳过，让半迁移状态能自愈。
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  return columns.some((c) => c.name === column)
}

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
    `)
    if (!hasColumn(db, 'books', 'collection_id')) {
      db.exec('ALTER TABLE books ADD COLUMN collection_id INTEGER REFERENCES collections(id);')
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_books_collection ON books(collection_id);')
  },

  // v3: EPUB 阅读进度（CFI 定位 + 百分比；PDF 书两列保持 NULL）
  (db) => {
    if (!hasColumn(db, 'reading_progress', 'cfi')) {
      db.exec('ALTER TABLE reading_progress ADD COLUMN cfi TEXT;')
    }
    if (!hasColumn(db, 'reading_progress', 'percentage')) {
      db.exec('ALTER TABLE reading_progress ADD COLUMN percentage REAL;')
    }
  },

  // v4: 阅读时长统计（日粒度聚合：每本书每天一行，毫秒累加；删书级联清除）
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reading_stats (
        book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
        day         TEXT    NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL,
        PRIMARY KEY (book_id, day)
      );

      CREATE INDEX IF NOT EXISTS idx_reading_stats_day ON reading_stats(day);
    `)
  },

  // v5: 纵向双页行内页序（ltr / rtl；NULL 视为左→右）
  (db) => {
    if (!hasColumn(db, 'reading_progress', 'row_order')) {
      db.exec('ALTER TABLE reading_progress ADD COLUMN row_order TEXT;')
    }
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
  // 迁移与版本号写入必须同一事务：否则中途被强杀会留下「schema 已改、user_version 未涨」的
  // 半迁移状态（SQLite 的 DDL 本身是事务性的，这里只是把两者绑到一起）
  const migrate = instance.transaction(() => {
    for (let v = currentVersion; v < MIGRATIONS.length; v++) {
      MIGRATIONS[v](instance)
    }
    instance.pragma(`user_version = ${MIGRATIONS.length}`)
  })
  migrate()

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
