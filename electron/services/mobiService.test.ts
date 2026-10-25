// mobiService 单元测试：纯函数（记录表/头/解压/页序/魔数）+ 自造 PDB 夹具端到端（无额外依赖，手写字节流）
// 对应设计文档 specs/MOBI漫画格式支持设计方案-20261025.md §11.1

import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  countPages,
  decompressPalmDoc,
  orderedPagesFromText,
  parseMobiHeader,
  parseRecordTable,
  readIndex,
  readPage,
  sniffImage,
} from './mobiService'

// ---------- 夹具 ----------

/** 最小合法图片字节（只需魔数命中，内容不参与校验） */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])

interface ExthEntry {
  type: number
  value: Buffer
}

/** MOBI 头长度（EXTH 紧随其后） */
const HEADER_LENGTH = 0xe8

interface Record0Options {
  compression: number
  textLength: number
  textRecordCount: number
  firstImageIndex: number
  encryptionType?: number
  exth?: ExthEntry[]
}

/** 构造 record 0：PalmDOC 头 + MOBI 头（含 firstImageIndex）+ 可选 EXTH */
function buildRecord0(options: Record0Options): Buffer {
  const exth = options.exth ?? []
  const exthLength = 12 + exth.reduce((sum, e) => sum + 8 + e.value.length, 0)
  const exthStart = 16 + HEADER_LENGTH
  const buf = Buffer.alloc(exthStart + (exth.length ? exthLength : 0) + 4)

  buf.writeUInt16BE(options.compression, 0)
  buf.writeUInt32BE(options.textLength, 4)
  buf.writeUInt16BE(options.textRecordCount, 8)
  buf.writeUInt16BE(4096, 10)
  buf.writeUInt16BE(options.encryptionType ?? 0, 12)

  buf.write('MOBI', 16, 'latin1')
  buf.writeUInt32BE(HEADER_LENGTH, 20)
  buf.writeUInt32BE(options.firstImageIndex, 108)

  if (exth.length) {
    buf.write('EXTH', exthStart, 'latin1')
    buf.writeUInt32BE(exthLength, exthStart + 4)
    buf.writeUInt32BE(exth.length, exthStart + 8)
    let cursor = exthStart + 12
    for (const entry of exth) {
      buf.writeUInt32BE(entry.type, cursor)
      buf.writeUInt32BE(8 + entry.value.length, cursor + 4)
      entry.value.copy(buf, cursor + 8)
      cursor += 8 + entry.value.length
    }
  }
  return buf
}

/** 把字面文本编码为 PalmDOC 压缩流（每块最多 8 字节，走 0x01~0x08 字面量块） */
function encodePalmDocLiteral(data: Buffer): Buffer {
  const parts: Buffer[] = []
  for (let i = 0; i < data.length; i += 8) {
    const chunk = data.subarray(i, i + 8)
    parts.push(Buffer.from([chunk.length]), chunk)
  }
  return Buffer.concat(parts)
}

/** 32 位大端整数 EXTH 值（121 / 201 等） */
function uint32(value: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return buf
}

interface MobiFixture {
  /** 文本记录原始字节（已按 compression 处理；缺省为空） */
  textRecords?: Buffer[]
  compression?: number
  /** 图片记录（lead 为图片前的记录内前导字节） */
  images?: Array<{ data: Buffer; lead?: Buffer }>
  /** 图片之后的非图片记录（模拟 INDX / FLIS 等） */
  extras?: Buffer[]
  encryptionType?: number
  /** 手动指定解压后文本总长（缺省 = 各文本记录长度之和） */
  textLength?: number
  exth?: ExthEntry[]
}

/** 组装完整 PDB 字节流：文件头 + 记录信息表 + 各记录正文 */
function buildMobiFile(fixture: MobiFixture): Buffer {
  const textRecords = fixture.textRecords ?? []
  const images = fixture.images ?? []
  const extras = fixture.extras ?? []
  const firstImageIndex = 1 + textRecords.length

  const record0 = buildRecord0({
    compression: fixture.compression ?? 1,
    textLength: fixture.textLength ?? textRecords.reduce((sum, b) => sum + b.length, 0),
    textRecordCount: textRecords.length,
    firstImageIndex,
    encryptionType: fixture.encryptionType,
    exth: fixture.exth,
  })
  const records = [
    record0,
    ...textRecords,
    ...images.map((image) => Buffer.concat([image.lead ?? Buffer.alloc(0), image.data])),
    ...extras,
  ]

  const tableEnd = 78 + records.length * 8
  let offset = tableEnd
  const starts: number[] = []
  for (const record of records) {
    starts.push(offset)
    offset += record.length
  }

  const head = Buffer.alloc(tableEnd)
  head.write('Fixture Mobi', 0, 'latin1')
  head.write('BOOK', 60, 'latin1')
  head.write('MOBI', 64, 'latin1')
  head.writeUInt16BE(records.length, 76)
  starts.forEach((start, i) => head.writeUInt32BE(start, 78 + i * 8))

  return Buffer.concat([head, ...records])
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ireader-mobi-test-'))
let fixtureSeq = 0

/** 写出临时 .mobi 并返回路径 */
function writeFixture(fixture: MobiFixture): string {
  const filePath = path.join(tmpDir, `fixture-${++fixtureSeq}.mobi`)
  fs.writeFileSync(filePath, buildMobiFile(fixture))
  return filePath
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------- 纯函数 ----------

describe('parseRecordTable', () => {
  it('按记录信息表切分区间，末条到文件末尾', () => {
    const file = buildMobiFile({ images: [{ data: JPEG }, { data: PNG }] })
    const numRecords = file.readUInt16BE(76)
    const records = parseRecordTable(file.subarray(0, 78 + numRecords * 8), file.length)
    expect(records).toHaveLength(numRecords)
    for (let i = 0; i < numRecords; i++) {
      expect(records[i].offset).toBeGreaterThanOrEqual(78 + numRecords * 8)
      if (i + 1 < numRecords) {
        expect(records[i].offset + records[i].length).toBe(records[i + 1].offset)
      } else {
        expect(records[i].offset + records[i].length).toBe(file.length)
      }
    }
  })

  it('type 不是 BOOK 或 creator 不是 MOBI 时抛错', () => {
    const file = buildMobiFile({ images: [{ data: JPEG }] })
    const numRecords = file.readUInt16BE(76)
    const table = file.subarray(0, 78 + numRecords * 8)
    const badType = Buffer.from(table)
    badType.write('TEXT', 60, 'latin1')
    expect(() => parseRecordTable(badType, file.length)).toThrow(/type/)
    const badCreator = Buffer.from(table)
    badCreator.write('TEXt', 64, 'latin1')
    expect(() => parseRecordTable(badCreator, file.length)).toThrow(/creator/)
  })

  it('记录表不完整或写入计数过小都按损坏处理', () => {
    const file = buildMobiFile({ images: [{ data: JPEG }] })
    expect(() => parseRecordTable(file.subarray(0, 40), file.length)).toThrow(/文件头不完整/)
    const tooFew = Buffer.from(file.subarray(0, 78 + file.readUInt16BE(76) * 8))
    tooFew.writeUInt16BE(1, 76)
    expect(() => parseRecordTable(tooFew, file.length)).toThrow(/记录数不足/)
  })
})

describe('parseMobiHeader', () => {
  function record0Of(fixture: MobiFixture): Buffer {
    const file = buildMobiFile(fixture)
    const record0Start = file.readUInt32BE(78)
    const record0End = file.readUInt32BE(86)
    return file.subarray(record0Start, record0End)
  }

  it('解析 compression / textLength / firstImageIndex', () => {
    const text = Buffer.from('<html></html>')
    const header = parseMobiHeader(
      record0Of({ textRecords: [text], images: [{ data: JPEG }, { data: PNG }] })
    )
    expect(header.compression).toBe(1)
    expect(header.textLength).toBe(text.length)
    expect(header.textRecordCount).toBe(1)
    expect(header.firstImageIndex).toBe(2)
    expect(header.coverOffset).toBeNull()
    expect(header.kf8Boundary).toBeNull()
  })

  it('解析 EXTH 121（KF8 边界）与 201（封面偏移）', () => {
    const header = parseMobiHeader(
      record0Of({
        images: [{ data: JPEG }],
        exth: [
          { type: 201, value: uint32(1) },
          { type: 121, value: uint32(5) },
        ],
      })
    )
    expect(header.coverOffset).toBe(1)
    expect(header.kf8Boundary).toBe(5)
  })

  it('缺少 MOBI 标识或 record 0 过短时抛错', () => {
    const file = buildMobiFile({ images: [{ data: JPEG }] })
    const record0Start = file.readUInt32BE(78)
    const record0End = file.readUInt32BE(86)
    const record0 = Buffer.from(file.subarray(record0Start, record0End))
    record0.write('XXXX', 16, 'latin1')
    expect(() => parseMobiHeader(record0)).toThrow(/MOBI 标识/)
    expect(() => parseMobiHeader(Buffer.alloc(64))).toThrow(/过短/)
  })
})

describe('decompressPalmDoc', () => {
  it('0x00 与 0x09~0x7F 为字面字节', () => {
    expect(decompressPalmDoc(Buffer.from([0x00, 0x41, 0x7f])).toString('latin1')).toBe('\u0000A\u007f')
  })

  it('0x01~0x08 后紧跟 N 个字面字节', () => {
    expect(decompressPalmDoc(Buffer.from([0x03, 0x61, 0x62, 0x63])).toString()).toBe('abc')
  })

  it('0x80~0xBF 回溯复制（含重叠复制）', () => {
    // 先输出 "abc"，再按距离 3、长度 6 复制 → "abcabcabc"
    const pair = (3 << 3) | (6 - 3)
    const data = Buffer.from([0x61, 0x62, 0x63, 0x80 | (pair >> 8), pair & 0xff])
    expect(decompressPalmDoc(data).toString()).toBe('abcabcabc')
  })

  it('0xC0~0xFF 输出空格 + (b ^ 0x80)', () => {
    expect(decompressPalmDoc(Buffer.from([0xc1, 0xc2])).toString()).toBe(' A B')
  })

  it('回溯距离越界时抛错（由调用方回退记录顺序）', () => {
    const pair = (5 << 3) | 0 // 距离 5，但输出缓冲为空
    expect(() => decompressPalmDoc(Buffer.from([0x80 | (pair >> 8), pair & 0xff]))).toThrow(
      /回溯越界/
    )
  })
})

describe('orderedPagesFromText', () => {
  it('按 recindex 引用顺序生成页表（1 基相对 firstImageIndex）', () => {
    const html = '<img recindex="00002"/><img recindex="00001"/>'
    expect(orderedPagesFromText(html, 10, new Set([10, 11]))).toEqual([11, 10])
  })

  it('重复引用去重、越界与非图片引用跳过', () => {
    const html = [
      '<img recindex="1">',
      '<img recindex="1">',
      '<img recindex="9">',
      '<img recindex="2">',
    ].join('')
    expect(orderedPagesFromText(html, 5, new Set([5, 6]))).toEqual([5, 6])
  })

  it('无 recindex 时返回空数组', () => {
    expect(orderedPagesFromText('<html><body>text</body></html>', 5, new Set([5]))).toEqual([])
  })
})

describe('sniffImage', () => {
  it('识别 JPEG / PNG / GIF 魔数', () => {
    expect(sniffImage(JPEG)?.contentType).toBe('image/jpeg')
    expect(sniffImage(PNG)?.contentType).toBe('image/png')
    expect(sniffImage(GIF)?.contentType).toBe('image/gif')
  })

  it('容忍记录内的前导字节并返回真实起点', () => {
    const sniffed = sniffImage(Buffer.concat([Buffer.alloc(4), JPEG]))
    expect(sniffed).toEqual({ start: 4, contentType: 'image/jpeg' })
  })

  it('非图片记录返回 null', () => {
    expect(sniffImage(Buffer.from('INDX some index data'))).toBeNull()
    expect(sniffImage(Buffer.alloc(0))).toBeNull()
  })
})

// ---------- 端到端（真实 PDB 字节流） ----------

describe('mobiService 端到端', () => {
  /** 两页图片 + 文本按 2 → 1 顺序引用 */
  function sampleFixture(): string {
    return writeFixture({
      textRecords: [Buffer.from('<html><body><img recindex="00002"/><img recindex="00001"/></body></html>')],
      images: [{ data: JPEG }, { data: PNG }],
    })
  }

  it('页序按文本 recindex 顺序（第二张图在前）', async () => {
    const index = await readIndex(sampleFixture())
    expect(index.orderFromText).toBe(true)
    expect(index.pages).toHaveLength(2)
    await expect(countPages(sampleFixture())).resolves.toBe(2)
  })

  it('readPage 返回图片本体与 MIME（1 基页码）', async () => {
    const filePath = sampleFixture()
    const first = await readPage(filePath, 1)
    expect(first?.contentType).toBe('image/png')
    expect(first?.data.subarray(0, 4)).toEqual(PNG.subarray(0, 4))
    const second = await readPage(filePath, 2)
    expect(second?.contentType).toBe('image/jpeg')
    expect(second?.data.subarray(0, 3)).toEqual(JPEG.subarray(0, 3))
  })

  it('图片记录前导字节被剥离', async () => {
    const filePath = writeFixture({
      textRecords: [Buffer.from('<img recindex="1">')],
      images: [{ data: JPEG, lead: Buffer.from([0x00, 0x00, 0x00, 0x01]) }],
    })
    const page = await readPage(filePath, 1)
    expect(page?.data.subarray(0, 3)).toEqual(JPEG.subarray(0, 3))
  })

  it('页序去重：同一记录被引用两次只成一页', async () => {
    const filePath = writeFixture({
      textRecords: [Buffer.from('<img recindex="1"><img recindex="1">')],
      images: [{ data: JPEG }],
    })
    await expect(countPages(filePath)).resolves.toBe(1)
  })

  it('HUFF/CDIC 文本（compression=17480）回退记录顺序', async () => {
    const filePath = writeFixture({
      compression: 17480,
      textRecords: [Buffer.from([0xde, 0xad, 0xbe, 0xef])],
      images: [{ data: JPEG }, { data: PNG }, { data: GIF }],
    })
    const index = await readIndex(filePath)
    expect(index.orderFromText).toBe(false)
    expect(index.pages).toEqual([2, 3, 4])
    await expect(countPages(filePath)).resolves.toBe(3)
  })

  it('文本解压失败（回溯越界）时回退记录顺序', async () => {
    const broken = Buffer.from([0x80 | 0x00, 0x05]) // 距离 5、输出为空 → 越界
    const filePath = writeFixture({
      compression: 2,
      textRecords: [broken],
      images: [{ data: JPEG }],
    })
    const index = await readIndex(filePath)
    expect(index.orderFromText).toBe(false)
    expect(index.pages).toEqual([2])
  })

  it('PalmDOC 压缩文本可解出 recindex 顺序', async () => {
    // 文本 "<img recindex=\"2\"><img recindex=\"1\">" 以 PalmDOC 字面量块编码
    const html = Buffer.from('<img recindex="2"><img recindex="1">')
    const filePath = writeFixture({
      compression: 2,
      textRecords: [encodePalmDocLiteral(html)],
      images: [{ data: JPEG }, { data: PNG }],
    })
    const index = await readIndex(filePath)
    expect(index.orderFromText).toBe(true)
    expect(index.pages).toEqual([3, 2])
  })

  it('按 textLength 截断，trailing 数据不参与页序', async () => {
    const html = '<img recindex="1">'
    const trailing = '<img recindex="2">' // 模拟末条记录尾部 trailing entry
    const filePath = writeFixture({
      textRecords: [Buffer.from(html + trailing)],
      textLength: html.length,
      images: [{ data: JPEG }, { data: PNG }],
    })
    await expect(countPages(filePath)).resolves.toBe(1)
  })

  it('非图片记录（INDX 等）不计入页表', async () => {
    const filePath = writeFixture({
      compression: 17480,
      images: [{ data: JPEG }],
      extras: [Buffer.from('INDX0000000000'), Buffer.from('FLIS0000')],
    })
    await expect(countPages(filePath)).resolves.toBe(1)
  })

  it('EXTH 121 边界之后的记录被忽略；异常边界值退化为全量扫描', async () => {
    const withBoundary = writeFixture({
      compression: 17480,
      images: [{ data: JPEG }],
      extras: [Buffer.from('INDX')],
      exth: [{ type: 121, value: uint32(3) }], // 记录 3 起为 KF8 段
    })
    await expect(countPages(withBoundary)).resolves.toBe(1)

    const badBoundary = writeFixture({
      compression: 17480,
      images: [{ data: JPEG }],
      exth: [{ type: 121, value: uint32(9999) }],
    })
    await expect(countPages(badBoundary)).resolves.toBe(1)
  })

  it('加密 MOBI 视为无可读图片', async () => {
    const filePath = writeFixture({ encryptionType: 2, images: [{ data: JPEG }] })
    await expect(countPages(filePath)).resolves.toBe(0)
    await expect(readPage(filePath, 1)).resolves.toBeNull()
  })

  it('越界 / 非法页码返回 null', async () => {
    const filePath = sampleFixture()
    await expect(readPage(filePath, 0)).resolves.toBeNull()
    await expect(readPage(filePath, 3)).resolves.toBeNull()
    await expect(readPage(filePath, 1.5)).resolves.toBeNull()
  })

  it('无图片记录返回零页', async () => {
    const filePath = writeFixture({ textRecords: [Buffer.from('<html></html>')] })
    await expect(countPages(filePath)).resolves.toBe(0)
    await expect(readPage(filePath, 1)).resolves.toBeNull()
  })

  it('非 MOBI 文件读取直接抛错（协议层转 500 / 导入侧记 warn）', async () => {
    const filePath = path.join(tmpDir, 'not-a-mobi.mobi')
    fs.writeFileSync(filePath, 'this is not a mobi file')
    await expect(countPages(filePath)).rejects.toThrow()
    await expect(readPage(filePath, 1)).rejects.toThrow()
  })
})
