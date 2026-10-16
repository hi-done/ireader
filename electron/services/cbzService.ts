// CBZ/ZIP 漫画服务（主进程）：条目枚举过滤、阅读顺序排序、单页解压读取
// 对应设计文档《CBZ漫画格式支持设计方案》§4.1 / §4.4 / §7.1
// 仅依赖 node 标准库与 yauzl（不 import electron），保证 vitest 下可直接单测

import path from 'node:path'
import { openPromise, type Entry, type ZipFile } from 'yauzl'

/** 可识别的图片扩展名（小写） */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** 是否为图片条目：排除目录条目、__MACOSX 旁车目录、隐藏文件与非图片扩展名 */
export function isImageEntry(entryName: string): boolean {
  if (entryName.endsWith('/')) return false
  const segments = entryName.split('/')
  if (segments.includes('__MACOSX')) return false
  const base = segments[segments.length - 1]
  if (base.startsWith('.')) return false
  return IMAGE_EXTS.has(path.extname(base).toLowerCase())
}

/** 条目名比较：字典序 + 数字段按数值排序（兼容零填充 001 与非零填充 1/2/10） */
function compareEntryNames(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true })
}

/** 过滤图片条目并按阅读顺序排序 */
export function sortImageEntries(entryNames: string[]): string[] {
  return entryNames.filter(isImageEntry).sort(compareEntryNames)
}

/**
 * 打开压缩包并读出中央目录中的全部条目。
 * 显式 autoClose: false —— 遍历结束后仍需保持打开以按需解压单页；调用方负责 close。
 * 加密条目（zipcrypto/AES）无法解压，在读取阶段整体剔除。
 */
async function openAndListEntries(filePath: string): Promise<{ zipfile: ZipFile; entries: Entry[] }> {
  const zipfile = await openPromise(filePath, { autoClose: false })
  try {
    const entries: Entry[] = []
    for await (const entry of zipfile.eachEntry()) {
      if ((entry.generalPurposeBitFlag & 0x1) === 0) entries.push(entry)
    }
    return { zipfile, entries }
  } catch (error) {
    zipfile.close()
    throw error
  }
}

/** 图片条目（条目名 + 原始 zip 条目） */
interface ZipImage {
  name: string
  entry: Entry
}

/** 从条目清单中挑出图片并按阅读顺序排列 */
function pickImages(entries: Entry[]): ZipImage[] {
  return entries
    .filter((entry) => isImageEntry(entry.fileName))
    .map((entry) => ({ name: entry.fileName, entry }))
    .sort((a, b) => compareEntryNames(a.name, b.name))
}

/** 列出压缩包内按阅读顺序排列的全部图片条目名（可能为空数组） */
export async function listImageEntries(filePath: string): Promise<string[]> {
  const { zipfile, entries } = await openAndListEntries(filePath)
  try {
    return pickImages(entries).map((image) => image.name)
  } finally {
    zipfile.close()
  }
}

/** 统计可读图片页数（导入建档与封面队列用） */
export async function countPages(filePath: string): Promise<number> {
  const { zipfile, entries } = await openAndListEntries(filePath)
  try {
    return pickImages(entries).length
  } finally {
    zipfile.close()
  }
}

/** 读取单页图片数据：page 从 1 起；越界返回 null（协议层转 404） */
export async function readPage(
  filePath: string,
  page: number
): Promise<{ data: Buffer<ArrayBuffer>; contentType: string } | null> {
  if (!Number.isInteger(page) || page < 1) return null
  const { zipfile, entries } = await openAndListEntries(filePath)
  try {
    const target = pickImages(entries)[page - 1]
    if (!target) return null
    const stream = await zipfile.openReadStreamPromise(target.entry)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    return { data: Buffer.concat(chunks), contentType: contentTypeOf(target.name) }
  } finally {
    zipfile.close()
  }
}

/** 按扩展名映射图片 MIME 类型（仅覆盖受支持扩展名） */
function contentTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}
