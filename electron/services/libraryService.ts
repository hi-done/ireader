// 文库服务：导入扫描、去重、缺失检测、Book 行转换
// 对应设计文档 §4.1 / §8.1

import fs from 'node:fs'
import path from 'node:path'
import { booksRepo, type BookRow } from '../db/repos/booksRepo'
import { collectionsRepo } from '../db/repos/collectionsRepo'
import { progressRepo, toReadingProgress } from '../db/repos/progressRepo'
import type { Book } from '../../shared/types'
import { getCoverUrl } from './coverService'

const PDF_EXT = '.pdf'

/** 递归展开文件/文件夹路径为去重后的 PDF 绝对路径列表 */
function collectPdfPaths(inputPaths: string[]): string[] {
  const result = new Set<string>()

  function walk(p: string) {
    let real: string
    try {
      real = fs.realpathSync(p)
    } catch {
      return // 路径不存在，忽略
    }
    const stat = fs.statSync(real)
    if (stat.isDirectory()) {
      const name = path.basename(real)
      if (name.startsWith('.')) return // 跳过隐藏目录
      for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue // 防环：跳过符号链接
        walk(path.join(real, entry.name))
      }
    } else if (stat.isFile() && path.extname(real).toLowerCase() === PDF_EXT) {
      result.add(real)
    }
  }

  for (const p of inputPaths) walk(p)
  return [...result]
}

function rowToBook(row: BookRow): Book {
  const missing = !fs.existsSync(row.file_path)
  const progressRow = progressRepo.findByBookId(row.id)
  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    fileSize: row.file_size,
    totalPages: row.total_pages,
    coverUrl: row.cover_path ? getCoverUrl(row.id) : null,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    collectionId: row.collection_id,
    missing,
    progress: progressRow ? toReadingProgress(progressRow) : null,
  }
}

export const libraryService = {
  /**
   * 导入文件/文件夹列表，递归扫描 PDF 并按路径去重落库。
   * collectionId 非 null 时新导入的书直接归属该合集（合集视图内导入）。
   */
  importPaths(
    inputPaths: string[],
    collectionId: number | null = null
  ): { added: Book[]; skipped: number } {
    if (collectionId !== null && !collectionsRepo.exists(collectionId)) {
      throw { code: 'FILE_NOT_FOUND', message: 'collection not found' }
    }
    const pdfPaths = collectPdfPaths(inputPaths)
    const added: Book[] = []
    let skipped = 0

    for (const filePath of pdfPaths) {
      if (booksRepo.findByPath(filePath)) {
        skipped++
        continue
      }
      const stat = fs.statSync(filePath)
      const title = path.basename(filePath, path.extname(filePath))
      const row = booksRepo.insert({
        title,
        filePath,
        fileSize: stat.size,
        addedAt: Date.now(),
        collectionId,
      })
      added.push(rowToBook(row))
    }

    return { added, skipped }
  },

  list(): Book[] {
    return booksRepo.listAll().map(rowToBook)
  },

  getById(id: number): Book | undefined {
    const row = booksRepo.findById(id)
    return row ? rowToBook(row) : undefined
  },

  rename(id: number, title: string): Book | undefined {
    booksRepo.rename(id, title)
    return this.getById(id)
  },

  remove(id: number, deleteFile: boolean): void {
    const row = booksRepo.findById(id)
    booksRepo.remove(id) // reading_progress 通过外键 ON DELETE CASCADE 级联删除
    if (deleteFile && row && fs.existsSync(row.file_path)) {
      fs.unlinkSync(row.file_path)
    }
  },

  relink(id: number, newPath: string): Book | undefined {
    const real = fs.realpathSync(newPath)
    const stat = fs.statSync(real)
    booksRepo.updatePath(id, real, stat.size)
    return this.getById(id)
  },

  markOpened(id: number): void {
    booksRepo.updateLastOpened(id, Date.now())
  },

  /** 批量移动书至合集；校验合集存在与归属变化，返回无变化时 false */
  moveToCollection(ids: number[], collectionId: number | null): boolean {
    if (!ids.length) return false
    if (collectionId !== null && !collectionsRepo.exists(collectionId)) {
      throw { code: 'FILE_NOT_FOUND', message: 'collection not found' }
    }
    const before = ids.map((id) => booksRepo.findById(id)?.collection_id ?? null)
    const changed = before.some((cid) => cid !== collectionId)
    if (changed) booksRepo.moveToCollection(ids, collectionId)
    return changed
  },
}
