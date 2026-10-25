// MOBI 漫画服务（主进程）：PalmDB 记录表 / MOBI 头 / EXTH 解析、PalmDOC 解压、图片页序推导、单页读取
// 对应设计文档 specs/MOBI漫画格式支持设计方案-20261025.md §4 / §7.1
// 仅依赖 node 标准库（不 import electron / logger / yauzl），保证 vitest 下可直接单测

import fs from 'node:fs'

/** 单条记录在文件中的字节区间（末条到 EOF） */
export interface PalmRecord {
  offset: number
  length: number
}

const PDB_TYPE_OFFSET = 60
const PDB_CREATOR_OFFSET = 64
const PDB_NUM_RECORDS_OFFSET = 76
const PDB_RECORD_TABLE_OFFSET = 78
/** 单条记录信息表项长度：offset(4) + attributes(1) + uniqueID(3) */
const PDB_RECORD_ENTRY_SIZE = 8

/** record 0 内的固定偏移：PalmDOC 头 0~15，MOBI 头自 16 起 */
const PALM_DOC_HEADER_SIZE = 16
const MOBI_IDENTIFIER_OFFSET = 16
/** MOBI 头读取的最小长度（覆盖到 firstImageIndex / EXTHFlags 所在字段） */
const MOBI_HEADER_MIN_LENGTH = 132
/** firstImageIndex 字段在 record 0 内的绝对偏移（MOBI 头 +92） */
const MOBI_FIRST_IMAGE_INDEX_OFFSET = 108
/** EXTH 类型：121=KF8 边界记录号 201=封面图相对偏移 */
const EXTH_KF8_BOUNDARY = 121
const EXTH_COVER_OFFSET = 201

/** 嗅探窗口：MOBI 图片记录常带若干字节前导，魔数只在记录头部附近 */
const SNIFF_WINDOW = 32

export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/gif'

/** MOBI 头解析结果（只保留业务必需字段） */
export interface MobiHeader {
  /** 0=未加密（其余值视为不可读） */
  encryptionType: number
  /** 1=无压缩 2=PalmDOC(LZ77) 17480=HUFF/CDIC */
  compression: number
  /** 解压后文本总长（用于截掉末条记录尾部的 trailing 数据） */
  textLength: number
  textRecordCount: number
  /** 第一条图片记录号 */
  firstImageIndex: number
  /** EXTH 201：封面图相对 firstImageIndex 的偏移（仅诊断，不参与业务） */
  coverOffset: number | null
  /** EXTH 121：MOBI7 + KF8 双格式文件的 KF8 起始记录号 */
  kf8Boundary: number | null
}

/** 页表：pages[i] 为第 i+1 页对应的物理记录号 */
export interface MobiIndex {
  pages: number[]
  /** 页序是否来自文本 recindex（false 表示回退为记录顺序） */
  orderFromText: boolean
}

function invalidMobi(reason: string): Error {
  return new Error(`MOBI 结构无效：${reason}`)
}

/**
 * 解析 PalmDB 文件头与记录表，得到每条记录的字节区间。
 * @param header 文件开头 78 + 8×numRecords 字节
 * @param fileSize 文件总长度（末条记录以 EOF 收尾）
 */
export function parseRecordTable(header: Buffer, fileSize: number): PalmRecord[] {
  if (header.length < PDB_RECORD_TABLE_OFFSET) throw invalidMobi('文件头不完整')
  if (header.toString('latin1', PDB_TYPE_OFFSET, PDB_TYPE_OFFSET + 4) !== 'BOOK') {
    throw invalidMobi('type 不是 BOOK')
  }
  if (header.toString('latin1', PDB_CREATOR_OFFSET, PDB_CREATOR_OFFSET + 4) !== 'MOBI') {
    throw invalidMobi('creator 不是 MOBI')
  }
  const numRecords = header.readUInt16BE(PDB_NUM_RECORDS_OFFSET)
  if (numRecords < 2) throw invalidMobi('记录数不足')
  const tableEnd = PDB_RECORD_TABLE_OFFSET + numRecords * PDB_RECORD_ENTRY_SIZE
  if (header.length < tableEnd) throw invalidMobi('记录表不完整')

  const starts: number[] = []
  let prevStart = tableEnd
  for (let i = 0; i < numRecords; i++) {
    const start = header.readUInt32BE(PDB_RECORD_TABLE_OFFSET + i * PDB_RECORD_ENTRY_SIZE)
    // 记录区必须从记录表之后开始且单调不减，否则按损坏处理（避免负长度的非法区间）
    if (start < prevStart || start > fileSize) throw invalidMobi(`第 ${i} 条记录偏移异常`)
    starts.push(start)
    prevStart = start
  }
  return starts.map((start, i) => ({
    offset: start,
    length: (i + 1 < numRecords ? starts[i + 1] : fileSize) - start,
  }))
}

/** 解析 record 0 的 PalmDOC 头、MOBI 头与 EXTH */
export function parseMobiHeader(record0: Buffer): MobiHeader {
  if (record0.length < PALM_DOC_HEADER_SIZE + MOBI_HEADER_MIN_LENGTH) {
    throw invalidMobi('record 0 过短')
  }
  if (record0.toString('latin1', MOBI_IDENTIFIER_OFFSET, MOBI_IDENTIFIER_OFFSET + 4) !== 'MOBI') {
    throw invalidMobi('缺少 MOBI 标识')
  }
  const headerLength = record0.readUInt32BE(MOBI_IDENTIFIER_OFFSET + 4)
  const header: MobiHeader = {
    compression: record0.readUInt16BE(0),
    textLength: record0.readUInt32BE(4),
    textRecordCount: record0.readUInt16BE(8),
    encryptionType: record0.readUInt16BE(12),
    firstImageIndex: record0.readUInt32BE(MOBI_FIRST_IMAGE_INDEX_OFFSET),
    coverOffset: null,
    kf8Boundary: null,
  }

  // EXTH 紧跟在 MOBI 头之后（headerLength 不足以容纳时不会出现）
  const exthStart = PALM_DOC_HEADER_SIZE + headerLength
  if (
    exthStart + 12 <= record0.length &&
    record0.toString('latin1', exthStart, exthStart + 4) === 'EXTH'
  ) {
    const exthLength = record0.readUInt32BE(exthStart + 4)
    const count = record0.readUInt32BE(exthStart + 8)
    const end = Math.min(record0.length, exthStart + exthLength)
    let cursor = exthStart + 12
    for (let i = 0; i < count && cursor + 8 <= end; i++) {
      const type = record0.readUInt32BE(cursor)
      const length = record0.readUInt32BE(cursor + 4)
      if (length < 8 || cursor + length > end) break // 结构破损：停止解析已读到的部分仍可用
      const value = record0.subarray(cursor + 8, cursor + length)
      if (type === EXTH_KF8_BOUNDARY && value.length >= 4) {
        header.kf8Boundary = value.readUInt32BE(0)
      } else if (type === EXTH_COVER_OFFSET && value.length >= 4) {
        header.coverOffset = value.readUInt32BE(0)
      }
      cursor += length
    }
  }
  return header
}

/**
 * PalmDOC(LZ77) 解压（MOBI compression = 2）。
 * 字节语义：0x00 字面零；0x01~0x08 紧随 N 个字面字节；0x09~0x7F 字面字节；
 * 0x80~0xBF 双字节回溯复制（距离 11 位 + 长度 3 位）；0xC0~0xFF 空格 + (b ^ 0x80)。
 */
export function decompressPalmDoc(input: Buffer): Buffer {
  const out: number[] = []
  let i = 0
  while (i < input.length) {
    const b = input[i++]
    if (b === 0 || (b > 0x08 && b <= 0x7f)) {
      out.push(b)
      continue
    }
    if (b <= 0x08) {
      for (let n = 0; n < b && i < input.length; n++) out.push(input[i++])
      continue
    }
    if (b <= 0xbf) {
      const pair = (b << 8) | input[i++]
      const distance = (pair >> 3) & 0x7ff
      const length = (pair & 0x07) + 3
      // 回溯越界说明数据损坏：抛错由调用方回退「记录顺序」页序
      if (!distance || distance > out.length) throw new Error('PalmDOC 回溯越界')
      for (let n = 0; n < length; n++) out.push(out[out.length - distance])
      continue
    }
    out.push(0x20, b ^ 0x80)
  }
  return Buffer.from(out)
}

/** 在记录头部窗口内嗅探图片魔数；命中返回图片起点与 MIME（MOBI 图片记录无文件名可依） */
export function sniffImage(
  buf: Buffer,
  window = SNIFF_WINDOW
): { start: number; contentType: ImageContentType } | null {
  const magics: Array<{ bytes: number[]; contentType: ImageContentType }> = [
    { bytes: [0xff, 0xd8, 0xff], contentType: 'image/jpeg' },
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], contentType: 'image/png' },
    { bytes: [0x47, 0x49, 0x46, 0x38], contentType: 'image/gif' },
  ]
  for (const magic of magics) {
    const limit = Math.min(buf.length - magic.bytes.length, window)
    for (let start = 0; start <= limit; start++) {
      if (magic.bytes.every((byte, k) => buf[start + k] === byte)) {
        return { start, contentType: magic.contentType }
      }
    }
  }
  return null
}

const IMG_REF = /recindex\s*=\s*["']?(\d+)/g

/**
 * 按文本中 recindex 的引用顺序推导页表。
 * recindex 为 1 基、相对 firstImageIndex；指向非图片记录或越界的引用跳过，同一记录只出现一次
 * （避免「封面图在正文再引用一次」导致重复成页）。
 */
export function orderedPagesFromText(
  html: string,
  firstImageIndex: number,
  imageRecords: Set<number>
): number[] {
  const seen = new Set<number>()
  const pages: number[] = []
  for (const match of html.matchAll(IMG_REF)) {
    const record = firstImageIndex + Number(match[1]) - 1
    if (!imageRecords.has(record) || seen.has(record)) continue
    seen.add(record)
    pages.push(record)
  }
  return pages
}

// ---------- 文件读取 ----------

interface OpenedMobi {
  fd: fs.promises.FileHandle
  records: PalmRecord[]
  header: MobiHeader
}

/** 定长读取；文件末尾不足时返回实际读到的字节（调用方按需校验长度） */
async function readRange(fd: fs.promises.FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await fd.read(buf, filled, length - filled, offset + filled)
    if (bytesRead <= 0) break
    filled += bytesRead
  }
  return filled === length ? buf : buf.subarray(0, filled)
}

async function openMobi(filePath: string): Promise<OpenedMobi> {
  const fd = await fs.promises.open(filePath, 'r')
  try {
    const { size } = await fd.stat()
    const fixed = await readRange(fd, 0, PDB_RECORD_TABLE_OFFSET)
    if (fixed.length < PDB_RECORD_TABLE_OFFSET) throw invalidMobi('文件头不完整')
    const numRecords = fixed.readUInt16BE(PDB_NUM_RECORDS_OFFSET)
    // 记录数上限防御：异常文件不据其预分配超大缓冲
    if (numRecords < 2 || numRecords > 65535) throw invalidMobi('记录数异常')
    const table = await readRange(fd, PDB_RECORD_TABLE_OFFSET, numRecords * PDB_RECORD_ENTRY_SIZE)
    const records = parseRecordTable(Buffer.concat([fixed, table]), size)
    const record0 = await readRange(fd, records[0].offset, records[0].length)
    const header = parseMobiHeader(record0)
    return { fd, records, header }
  } catch (e) {
    await fd.close()
    throw e
  }
}

/** 枚举图片记录号（升序）。combo 文件只取 F8 边界之前的 MOBI7 段 */
async function listImageRecords(mobi: OpenedMobi): Promise<number[]> {
  const { fd, records, header } = mobi
  const start = header.firstImageIndex
  if (start >= records.length) return [] // 0xFFFFFFFF（无图片）等异常值直接判无图
  const boundary = header.kf8Boundary
  // EXTH 121 在不同产出工具下可能是记录号而非字节偏移：越界值忽略，退化为全记录扫描
  const end =
    boundary != null && boundary > start && boundary < records.length
      ? boundary
      : records.length
  const result: number[] = []
  for (let r = start; r < end; r++) {
    const peek = await readRange(fd, records[r].offset, Math.min(SNIFF_WINDOW, records[r].length))
    if (sniffImage(peek)) result.push(r)
  }
  return result
}

/**
 * 解压并拼接文本记录得到 HTML 文本；不支持 HUFF/CDIC（17480）与解压失败时返回 null，
 * 由页序回退到记录顺序。文本只用于提取 recindex，故按 latin1 解码（ASCII 安全）。
 */
async function readText(mobi: OpenedMobi): Promise<string | null> {
  const { fd, records, header } = mobi
  if (header.compression !== 1 && header.compression !== 2) return null
  const count = Math.min(header.textRecordCount, records.length - 1)
  const chunks: Buffer[] = []
  try {
    for (let r = 1; r <= count; r++) {
      const raw = await readRange(fd, records[r].offset, records[r].length)
      chunks.push(header.compression === 2 ? decompressPalmDoc(raw) : raw)
    }
  } catch {
    return null // 解压失败（损坏）：放弃文本，页序回退记录顺序
  }
  const text = Buffer.concat(chunks)
  // 末条记录尾部拼有 trailing entry，按 textLength 截断即可剔除
  return text.subarray(0, Math.min(text.length, header.textLength || text.length)).toString('latin1')
}

/** 在同一文件句柄上构建页表（readIndex / readPage 共用，避免重复开文件） */
async function buildIndex(mobi: OpenedMobi): Promise<MobiIndex> {
  // 加密书无法解析内容：按无可读图片处理（打开时走「仅支持图片型」错误页）
  if (mobi.header.encryptionType !== 0) return { pages: [], orderFromText: false }
  const imageRecords = await listImageRecords(mobi)
  if (!imageRecords.length) return { pages: [], orderFromText: false }
  const html = await readText(mobi)
  if (html) {
    const ordered = orderedPagesFromText(html, mobi.header.firstImageIndex, new Set(imageRecords))
    if (ordered.length) return { pages: ordered, orderFromText: true }
  }
  return { pages: imageRecords, orderFromText: false }
}

/** 读页表；结构无效时抛出（协议层转 500，导入侧记 warn） */
export async function readIndex(filePath: string): Promise<MobiIndex> {
  const mobi = await openMobi(filePath)
  try {
    return await buildIndex(mobi)
  } finally {
    await mobi.fd.close()
  }
}

/** 导入时页数统计（= 页表长度；不可读时抛出，由调用方容错为 0） */
export async function countPages(filePath: string): Promise<number> {
  const { pages } = await readIndex(filePath)
  return pages.length
}

/** 读取第 page 页（1 基）；越界或该记录不是图片返回 null；解析失败抛出 */
export async function readPage(
  filePath: string,
  page: number
): Promise<{ data: Buffer; contentType: ImageContentType } | null> {
  if (!Number.isInteger(page) || page < 1) return null
  const mobi = await openMobi(filePath)
  try {
    const { pages } = await buildIndex(mobi)
    const record = pages[page - 1]
    if (record === undefined) return null
    const data = await readRange(mobi.fd, mobi.records[record].offset, mobi.records[record].length)
    const sniffed = sniffImage(data)
    if (!sniffed) return null
    // 去掉图片记录的前导字节，只返回图片本体
    return { data: data.subarray(sniffed.start), contentType: sniffed.contentType }
  } finally {
    await mobi.fd.close()
  }
}
