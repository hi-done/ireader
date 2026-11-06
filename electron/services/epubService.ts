// EPUB 逐页图片服务（主进程）：把「每页 XHTML 里的那张图」当成一页供给渲染层
// 与 cbzService 同构（只依赖 node 标准库 + yauzl，可单测）：按需解压单页，
// 不把整本塞进内存——漫画 EPUB 单本可达 170MB，整本加载会拖垮首页。
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.1 / §5.3

import fs from 'node:fs'
import path from 'node:path'
import { openPromise, type Entry, type ZipFile } from 'yauzl'

/** 已解析的 spine 表（按阅读顺序，元素为 zip 内完整路径；非 XHTML 项为空串占位） */
interface EpubSpine {
  mtimeMs: number
  size: number
  documents: string[]
}

/** OPF 解析结果缓存上限：首页侧栏一次只看一本书，8 本足够来回切换 */
const MAX_SPINE_CACHE = 8
const spineCache = new Map<string, EpubSpine>()

/** 图片扩展名 → MIME 类型 */
function contentTypeOf(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

/** 目录部分（无斜杠返回空串） */
function dirOf(name: string): string {
  const i = name.lastIndexOf('/')
  return i < 0 ? '' : name.slice(0, i)
}

/** 还原 OPF 里被转义的字符，避免带 & 的书名无法定位条目 */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 把 XHTML 里的相对引用解析为 zip 内路径（纯函数）：
 * 处理 `../` 与 `./`，并做 URL 解码（条目名可能是中文或带空格）。
 */
export function normalizeZipPath(baseDir: string, href: string): string {
  const parts = baseDir ? baseDir.split('/').filter(Boolean) : []
  for (const segment of href.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return decodeURIComponentSafe(parts.join('/'))
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * 从单页 XHTML 里取图片引用（纯函数，不引 DOM 解析器）：
 * 优先 `<img src>`，其次 SVG `<image href / xlink:href>`。
 * `data:` 内联图不处理——调用方按「无图」返回 404，交由渲染层回落封面。
 */
export function extractPageImageRef(html: string): string | null {
  const imgTag = /<img\b[^>]*>/i.exec(html)
  if (imgTag) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(imgTag[0])
    if (src) return decodeXmlText(src[1]).trim()
  }
  const svgTag = /<image\b[^>]*>/i.exec(html)
  if (svgTag) {
    const href = /(?:xlink:href|\bhref)\s*=\s*["']([^"']+)["']/i.exec(svgTag[0])
    if (href) return decodeXmlText(href[1]).trim()
  }
  return null
}

/**
 * spine 项是否可当作页面文档（纯函数）：优先看 media-type，缺失时退回扩展名。
 * 音频 / 字体 / 图片等非文档项不能当 XHTML 读，但位置必须保留——否则
 * 后面的页码会整体前移，与阅读器的 spine 索引错位。
 */
function isPageDocument(href: string, mediaType: string | undefined): boolean {
  if (mediaType) return /(?:xhtml|html|svg)/i.test(mediaType)
  return /\.(?:xhtml|html?|svg)$/i.test(href)
}

/**
 * 解析 OPF，得到按 spine 顺序排列的 XHTML 路径（纯函数）。
 * 非 XHTML 项保留空串占位，保证下标与阅读器的 spine 索引严格一一对应。
 */
export function parseSpineDocumentPaths(opf: string, opfDir: string): string[] {
  const manifest = new Map<string, string>()
  for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = match[0]
    const id = /(?:^|\s)id\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    const href = /(?:^|\s)href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (!id || !href) continue
    const mediaType = /(?:^|\s)media-type\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (isPageDocument(href, mediaType)) manifest.set(id, decodeXmlText(href))
  }
  const documents: string[] = []
  for (const match of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const idref = /(?:^|\s)idref\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1]
    const href = idref ? manifest.get(idref) : undefined
    documents.push(href ? normalizeZipPath(opfDir, href) : '')
  }
  return documents
}

/** 收集中央目录（跳过加密条目：zipcrypto/AES 无法解压） */
async function collectEntries(zipfile: ZipFile): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>()
  for await (const entry of zipfile.eachEntry()) {
    if ((entry.generalPurposeBitFlag & 0x1) === 0) entries.set(entry.fileName, entry)
  }
  return entries
}

async function readEntryData(zipfile: ZipFile, entry: Entry): Promise<Buffer> {
  const stream = await zipfile.openReadStreamPromise(entry)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function readEntryText(zipfile: ZipFile, entry: Entry): Promise<string> {
  return (await readEntryData(zipfile, entry)).toString('utf8')
}

/** 取书内条目：先按原名，再试 URL 解码后的名字（OPF 里可能未编码） */
function entryOf(entries: Map<string, Entry>, name: string): Entry | undefined {
  return entries.get(name) ?? entries.get(decodeURIComponentSafe(name))
}

function rememberSpine(filePath: string, spine: EpubSpine): void {
  spineCache.delete(filePath)
  spineCache.set(filePath, spine)
  while (spineCache.size > MAX_SPINE_CACHE) {
    const oldest = spineCache.keys().next().value
    if (oldest === undefined) break
    spineCache.delete(oldest)
  }
}

/**
 * 解析（并缓存）spine 表：container.xml → OPF → itemref 顺序。
 * 以 mtime + size 判缓存新鲜度，书文件被替换后自动重解析。
 */
async function spineOf(
  filePath: string,
  entries: Map<string, Entry>,
  zipfile: ZipFile
): Promise<string[]> {
  let stat: { mtimeMs: number; size: number } | null = null
  try {
    const s = await fs.promises.stat(filePath)
    stat = { mtimeMs: s.mtimeMs, size: s.size }
  } catch {
    stat = null
  }
  const cached = spineCache.get(filePath)
  if (cached && stat && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.documents
  }

  const containerEntry = entries.get('META-INF/container.xml')
  const container = containerEntry ? await readEntryText(zipfile, containerEntry) : ''
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(container)?.[1]
  const opfName = opfPath ? normalizeZipPath('', decodeXmlText(opfPath)) : ''
  const opfEntry = opfName ? entryOf(entries, opfName) : undefined
  const opf = opfEntry ? await readEntryText(zipfile, opfEntry) : ''
  const documents = opf ? parseSpineDocumentPaths(opf, dirOf(opfName)) : []

  if (stat) rememberSpine(filePath, { ...stat, documents })
  return documents
}

/**
 * 读取单页图片：page 从 1 起，等于 spine 索引 + 1（与阅读器 progress.page 同口径）。
 * 越界 / 该页 XHTML 无图 / 条目缺失一律返回 null，由协议层转 404。
 */
export async function readPage(
  filePath: string,
  page: number
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!Number.isInteger(page) || page < 1) return null

  const zipfile = await openPromise(filePath, { autoClose: false })
  try {
    const entries = await collectEntries(zipfile)
    const documents = await spineOf(filePath, entries, zipfile)
    const docName = documents[page - 1]
    if (!docName) return null

    const docEntry = entryOf(entries, docName)
    if (!docEntry) return null
    const html = await readEntryText(zipfile, docEntry)

    const ref = extractPageImageRef(html)
    // 内联 data: 图不在压缩包里，按无图处理
    if (!ref || ref.startsWith('data:') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) return null

    const imageName = normalizeZipPath(dirOf(docName), ref)
    const imageEntry = entryOf(entries, imageName)
    if (!imageEntry) return null

    return {
      data: await readEntryData(zipfile, imageEntry),
      contentType: contentTypeOf(imageName),
    }
  } finally {
    zipfile.close()
  }
}

/** 统计可展示的图片页数（调试/测试用） */
export async function countPages(filePath: string): Promise<number> {
  const zipfile = await openPromise(filePath, { autoClose: false })
  try {
    const entries = await collectEntries(zipfile)
    const documents = await spineOf(filePath, entries, zipfile)
    return documents.filter(Boolean).length
  } finally {
    zipfile.close()
  }
}
