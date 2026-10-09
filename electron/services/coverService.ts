// 封面服务：封面落盘路径管理
// 对应设计文档 §4.1 / §6.5

import fs from 'node:fs'
import path from 'node:path'

let coversDir: string | null = null

export function initCoverService(userDataDir: string): void {
  coversDir = path.join(userDataDir, 'covers')
  fs.mkdirSync(coversDir, { recursive: true })
}

function getCoversDir(): string {
  if (!coversDir) throw new Error('Cover service not initialized. Call initCoverService() first.')
  return coversDir
}

export function getCoverFilePath(bookId: number): string {
  return path.join(getCoversDir(), `${bookId}.jpg`)
}

/** 渲染进程通过 ireader://cover/{id} 访问封面，这里只生成逻辑地址 */
export function getCoverUrl(bookId: number): string {
  return `ireader://cover/${bookId}`
}

/** 封面生成队列（渲染进程 pdf.js 渲染完成后）回写落盘 */
export function saveCover(bookId: number, imageBuffer: Buffer): string {
  const filePath = getCoverFilePath(bookId)
  fs.writeFileSync(filePath, imageBuffer)
  return filePath
}

export function removeCover(bookId: number): void {
  const filePath = getCoverFilePath(bookId)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}
