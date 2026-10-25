// 文库服务：导入扫描、去重、缺失检测、Book 行转换
// 对应设计文档 §4.1 / §8.1

import fs from 'node:fs'
import path from 'node:path'
import { booksRepo, type BookRow } from '../db/repos/booksRepo'
import { collectionsRepo } from '../db/repos/collectionsRepo'
import { progressRepo, toReadingProgress } from '../db/repos/progressRepo'
import type { Book } from '../../shared/types'
import { getCoverUrl } from './coverService'
import { countPages } from './cbzService'
import * as logger from './logger'

const SUPPORTED_EXTS = ['.pdf', '.epub', '.zip', '.cbz']

/** 按扩展名派生书格式（.zip/.cbz 归一为 cbz；未知扩展名按 PDF 处理，兼容旧数据） */
export function detectFormat(filePath: string): Book['format'] {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.epub') return 'epub'
  if (ext === '.zip' || ext === '.cbz') return 'cbz'
  return 'pdf'
}

/** 递归展开文件/文件夹路径为去重后的 PDF/EPUB/CBZ 绝对路径列表 */
function collectBookPaths(inputPaths: string[]): string[] {
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
    } else if (
      stat.isFile() &&
      SUPPORTED_EXTS.includes(path.extname(real).toLowerCase())
    ) {
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
    format: detectFormat(row.file_path),
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
   * 导入文件/文件夹列表，递归扫描 PDF/EPUB/CBZ 并按路径去重落库。
   * collectionId 非 null 时新导入的书直接归属该合集（合集视图内导入）。
   * CBZ 在导入时统计图片条目数写入 total_pages，避免「封面队列未完成时打开页数为 0」竞态。
   */
  async importPaths(
    inputPaths: string[],
    collectionId: number | null = null
  ): Promise<{ added: Book[]; skipped: number }> {
    if (collectionId !== null && !collectionsRepo.exists(collectionId)) {
      throw { code: 'FILE_NOT_FOUND', message: 'collection not found' }
    }
    const bookPaths = collectBookPaths(inputPaths)
    const added: Book[] = []
    let skipped = 0

    for (const filePath of bookPaths) {
      if (booksRepo.findByPath(filePath)) {
        skipped++
        continue
      }
      const stat = fs.statSync(filePath)
      const title = path.basename(filePath, path.extname(filePath))
      let totalPages = 0
      if (detectFormat(filePath) === 'cbz') {
        try {
          totalPages = await countPages(filePath)
        } catch (e) {
          // 统计失败不中止导入：书仍入库（0 页），由封面队列与打开时错误兜底
          logger.warn(
            `[libraryService] cbz 页数统计失败：${filePath}（${e instanceof Error ? e.message : String(e)}）`
          )
        }
      }
      const row = booksRepo.insert({
        title,
        filePath,
        fileSize: stat.size,
        addedAt: Date.now(),
        collectionId,
        totalPages,
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

  /**
   * 批量移除书籍：按存在性过滤后单事务删库，事务提交后再删文件（反序会在 DB 失败时已不可恢复地删掉文件）。
   * @param ids 待移除书 id（调用方已做非空 / 正整数过滤）
   * @param deleteFile 是否同时删除磁盘原文件
   * @returns 实际移除的 id 列表（库中不存在的 id 被忽略）
   */
  removeMany(ids: number[], deleteFile: boolean): number[] {
    // 只保留正整数 id（脏值过滤而非报错，避免一批里一个坏 id 拖垮整批），去重后为空则拒绝
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
    if (!uniqueIds.length) throw { code: 'INVALID_PARAMS', message: 'bookIds 不能为空' }
    const rows = uniqueIds
      .map((id) => booksRepo.findById(id))
      .filter((row): row is BookRow => Boolean(row))
    if (!rows.length) return []

    booksRepo.removeMany(rows.map((row) => row.id)) // 进度 / 统计随外键级联清理
    if (deleteFile) {
      for (const row of rows) {
        // 单本失败不中断整批：记录已删，残留文件可手工清理
        try {
          if (fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path)
        } catch (e) {
          logger.warn(
            `[libraryService] 删除文件失败：${row.file_path}（${e instanceof Error ? e.message : String(e)}）`
          )
        }
      }
    }
    return rows.map((row) => row.id)
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
