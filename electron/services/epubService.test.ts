// epubService 单元测试：路径归一 / 图片引用提取 / spine 解析 + 最小 zip 端到端
// 夹具手写 STORED 条目字节流，不依赖额外打包库

import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  countPages,
  extractPageImageRef,
  normalizeZipPath,
  parseSpineDocumentPaths,
  readPage,
} from './epubService'

// ---------- 最小 zip 夹具 ----------

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
  text?: string
  data?: Buffer
}

function buildZip(files: FixtureFile[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const data = file.data ?? Buffer.from(file.text ?? '', 'utf8')
    const nameBytes = Buffer.from(file.name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBytes, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralBuf, eocd])
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ireader-epub-test-'))
let seq = 0

function writeFixture(files: FixtureFile[]): string {
  const filePath = path.join(tmpDir, `fixture-${++seq}.epub`)
  fs.writeFileSync(filePath, buildZip(files))
  return filePath
}

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ---------- 纯函数 ----------

describe('normalizeZipPath', () => {
  it('按所在目录解析 ../ 与 ./', () => {
    expect(normalizeZipPath('OEBPS/Text', '../Images/001.jpg')).toBe('OEBPS/Images/001.jpg')
    expect(normalizeZipPath('OEBPS/Text', './same.png')).toBe('OEBPS/Text/same.png')
    expect(normalizeZipPath('', 'OEBPS/content.opf')).toBe('OEBPS/content.opf')
  })

  it('URL 解码条目名（空格 / 中文）', () => {
    expect(normalizeZipPath('OEBPS', 'Images/a%20b.jpg')).toBe('OEBPS/Images/a b.jpg')
    expect(normalizeZipPath('', 'OEBPS/%E7%AC%AC1%E9%A1%B5.jpg')).toBe('OEBPS/第1页.jpg')
  })

  it('一路 ../ 时不会越出压缩包根', () => {
    expect(normalizeZipPath('a', '../../b.png')).toBe('b.png')
  })
})

describe('extractPageImageRef', () => {
  it('取 img 的 src（属性顺序无关，容错单引号）', () => {
    expect(extractPageImageRef('<div><img alt="x" src="../Images/1.jpg"/></div>')).toBe(
      '../Images/1.jpg'
    )
    expect(extractPageImageRef("<img src='2.png'>")).toBe('2.png')
  })

  it('退化到 SVG image 的 href / xlink:href', () => {
    expect(extractPageImageRef('<svg><image xlink:href="../i/3.jpg"/></svg>')).toBe('../i/3.jpg')
    expect(extractPageImageRef('<svg><image href="4.jpg"/></svg>')).toBe('4.jpg')
  })

  it('纯文字页返回 null', () => {
    expect(extractPageImageRef('<html><body><p>只有文字</p></body></html>')).toBeNull()
  })
})

describe('parseSpineDocumentPaths', () => {
  const opf = `<?xml version="1.0"?>
    <package>
      <manifest>
        <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
        <item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
        <item id="audio" href="Media/a.mp3" media-type="audio/mpeg"/>
        <item id="p2" href="Text/p2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="cover"/>
        <itemref idref="p1"/>
        <itemref idref="audio"/>
        <itemref idref="p2"/>
      </spine>
    </package>`

  it('按 spine 顺序给路径，非 XHTML 项留空串占位（下标与 spine 索引对齐）', () => {
    expect(parseSpineDocumentPaths(opf, 'OEBPS')).toEqual([
      'OEBPS/Text/cover.xhtml',
      'OEBPS/Text/p1.xhtml',
      '',
      'OEBPS/Text/p2.xhtml',
    ])
  })

  it('manifest 里引用的 id 缺失时也占位，不吞掉位置', () => {
    expect(parseSpineDocumentPaths('<spine><itemref idref="nope"/></spine>', '')).toEqual([''])
  })
})

// ---------- 端到端（真实 zip 字节流） ----------

const CONTAINER = `<?xml version="1.0"?>
<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`

const OPF = `<?xml version="1.0"?>
<package><manifest>
  <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
  <item id="p1" href="Text/p1.xhtml" media-type="application/xhtml+xml"/>
  <item id="p2" href="Text/p2.xhtml" media-type="application/xhtml+xml"/>
  <item id="img1" href="Images/001.jpg" media-type="image/jpeg"/>
  <item id="img2" href="Images/002.jpg" media-type="image/jpeg"/>
</manifest><spine>
  <itemref idref="cover"/>
  <itemref idref="p1"/>
  <itemref idref="p2"/>
</spine></package>`

const pageDoc = (src: string, body = '') =>
  `<html><body><div><img src="${src}" alt=""/></div>${body}</body></html>`

describe('readPage（图片型 EPUB）', () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  const filePath = writeFixture([
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'META-INF/container.xml', text: CONTAINER },
    { name: 'OEBPS/content.opf', text: OPF },
    { name: 'OEBPS/Text/cover.xhtml', text: pageDoc('../Images/001.jpg') },
    { name: 'OEBPS/Text/p1.xhtml', text: pageDoc('../Images/002.jpg') },
    { name: 'OEBPS/Text/p2.xhtml', text: pageDoc('') },
    { name: 'OEBPS/Images/001.jpg', data: JPEG },
    { name: 'OEBPS/Images/002.jpg', data: JPEG },
  ])

  it('第 1 页 = spine[0] 的封面图', async () => {
    const page = await readPage(filePath, 1)
    expect(page?.contentType).toBe('image/jpeg')
    expect(page?.data.equals(JPEG)).toBe(true)
  })

  it('第 2 页取到正文图（../ 相对路径能解析）', async () => {
    const page = await readPage(filePath, 2)
    expect(page?.data.equals(JPEG)).toBe(true)
  })

  it('该页 XHTML 里没有图片时返回 null（协议层转 404，组件回落封面）', async () => {
    expect(await readPage(filePath, 3)).toBeNull()
  })

  it('越界与非整数页码返回 null', async () => {
    expect(await readPage(filePath, 0)).toBeNull()
    expect(await readPage(filePath, 99)).toBeNull()
    expect(await readPage(filePath, 1.5)).toBeNull()
  })

  it('countPages 统计有 XHTML 的页数', async () => {
    expect(await countPages(filePath)).toBe(3)
  })

  it('缺 container.xml 的书不会抛错，直接当作无页', async () => {
    const broken = writeFixture([{ name: 'mimetype', text: 'application/epub+zip' }])
    expect(await readPage(broken, 1)).toBeNull()
  })
})
