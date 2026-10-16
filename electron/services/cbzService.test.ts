// cbzService 单元测试：过滤/排序纯函数 + 最小 zip 夹具端到端（无额外依赖，手写 STORED 条目字节流）

import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { countPages, isImageEntry, listImageEntries, readPage, sortImageEntries } from './cbzService'

// ---------- 最小 zip 夹具 ----------

/** CRC32 查表（zip 条目头必需字段） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface FixtureFile {
  name: string
  data: Buffer
  /** 置加密标记位（仅清单过滤测试用，不实际加密数据） */
  encrypted?: boolean
}

/** 组装最小合法 zip：仅包含 yauzl 解析所需字段，条目全部 STORED（不压缩） */
function buildZip(files: FixtureFile[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const flags = file.encrypted ? 0x1 : 0
    // zipcrypto 加密条目在数据前有 12 字节加密头，compressedSize = 数据长 + 12（yauzl 会校验）
    const storedData = file.encrypted
      ? Buffer.concat([Buffer.alloc(12), file.data])
      : file.data

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(0, 8) // method: STORED
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(storedData.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBytes, storedData)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(storedData.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)

    offset += 30 + nameBytes.length + storedData.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralBuf, eocd])
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ireader-cbz-test-'))
let fixtureSeq = 0

/** 将夹具写出为临时 .cbz 并返回路径 */
function writeFixture(files: FixtureFile[]): string {
  const filePath = path.join(tmpDir, `fixture-${++fixtureSeq}.cbz`)
  fs.writeFileSync(filePath, buildZip(files))
  return filePath
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------- 纯函数 ----------

describe('isImageEntry', () => {
  it('识别受支持图片（含大小写扩展名与嵌套路径）', () => {
    expect(isImageEntry('001.png')).toBe(true)
    expect(isImageEntry('002.JPG')).toBe(true)
    expect(isImageEntry('pages/003.jpeg')).toBe(true)
    expect(isImageEntry('cover.WebP')).toBe(true)
  })

  it('排除目录条目、隐藏文件、__MACOSX 旁车与非图片文件', () => {
    expect(isImageEntry('pages/')).toBe(false)
    expect(isImageEntry('.DS_Store')).toBe(false)
    expect(isImageEntry('__MACOSX/._001.png')).toBe(false)
    expect(isImageEntry('readme.txt')).toBe(false)
    expect(isImageEntry('001.png.bak')).toBe(false)
  })
})

describe('sortImageEntries', () => {
  it('零填充命名（001/002/010）按字典序且数字段正确', () => {
    expect(sortImageEntries(['010.png', '002.png', '001.png', '020.png'])).toEqual([
      '001.png',
      '002.png',
      '010.png',
      '020.png',
    ])
  })

  it('非零填充命名（1/2/10）按数值序而非字符串序', () => {
    expect(sortImageEntries(['10.png', '2.png', '1.png'])).toEqual(['1.png', '2.png', '10.png'])
  })

  it('混合扩展名时过滤非图片且保持自然顺序', () => {
    expect(sortImageEntries(['ch02/b.jpg', 'ch01/a.PNG', 'ch01/x.txt', 'ch10/c.png'])).toEqual([
      'ch01/a.PNG',
      'ch02/b.jpg',
      'ch10/c.png',
    ])
  })
})

// ---------- 端到端（真实 zip 字节流） ----------

describe('cbzService 端到端', () => {
  function sampleFixture(): string {
    return writeFixture([
      { name: '002.png', data: Buffer.from('img-002') },
      { name: '001.png', data: Buffer.from('img-001') },
      { name: '010.png', data: Buffer.from('img-010') },
      { name: '003.png', data: Buffer.from('img-003-encrypted'), encrypted: true },
      { name: '__MACOSX/._001.png', data: Buffer.from('macosx') },
      { name: '.DS_Store', data: Buffer.from('ds') },
      { name: 'readme.txt', data: Buffer.from('text') },
      { name: 'pages/001.jpg', data: Buffer.from('img-pages-001') },
    ])
  }

  it('listImageEntries 返回按阅读顺序排列的图片条目（过滤旁车/隐藏/非图片/加密）', async () => {
    await expect(listImageEntries(sampleFixture())).resolves.toEqual([
      '001.png',
      '002.png',
      '010.png',
      'pages/001.jpg',
    ])
  })

  it('countPages 统计可读图片数', async () => {
    await expect(countPages(sampleFixture())).resolves.toBe(4)
  })

  it('readPage 按阅读顺序返回单页数据与 MIME 类型', async () => {
    const filePath = sampleFixture()
    const first = await readPage(filePath, 1)
    expect(first?.data.toString()).toBe('img-001')
    expect(first?.contentType).toBe('image/png')
    const last = await readPage(filePath, 4)
    expect(last?.data.toString()).toBe('img-pages-001')
    expect(last?.contentType).toBe('image/jpeg')
  })

  it('readPage 对越界页码与非法入参返回 null', async () => {
    const filePath = sampleFixture()
    await expect(readPage(filePath, 5)).resolves.toBeNull()
    await expect(readPage(filePath, 0)).resolves.toBeNull()
    await expect(readPage(filePath, 1.5)).resolves.toBeNull()
  })

  it('空压缩包返回零页且无可用页', async () => {
    const filePath = writeFixture([])
    await expect(countPages(filePath)).resolves.toBe(0)
    await expect(readPage(filePath, 1)).resolves.toBeNull()
  })

  it('非 zip 文件读取直接抛错（协议层转 500）', async () => {
    const filePath = path.join(tmpDir, 'not-a-zip.cbz')
    fs.writeFileSync(filePath, 'this is not a zip file')
    await expect(countPages(filePath)).rejects.toThrow()
  })
})
