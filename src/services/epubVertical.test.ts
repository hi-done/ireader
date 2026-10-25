import { describe, expect, it } from 'vitest'
import { resolveEpubImagePath } from './epubVertical'

describe('resolveEpubImagePath - 相对路径', () => {
  it('同一目录下的 ./a.png', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', './a.png')).toBe('OEBPS/text/a.png')
  })

  it('父目录 ../images/001.jpg', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', '../images/001.jpg')).toBe(
      'OEBPS/images/001.jpg'
    )
  })
})

describe('resolveEpubImagePath - 绝对路径', () => {
  it('压缩包根绝对路径去掉前导斜杠', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', '/OEBPS/a.png')).toBe('OEBPS/a.png')
  })

  it('含 %20 的路径做 URL 解码', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', '../images/page%2001.jpg')).toBe(
      'OEBPS/images/page 01.jpg'
    )
  })
})

describe('resolveEpubImagePath - 内联与远程', () => {
  it('data: URL 原样返回（不查压缩包）', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', src)).toBe(src)
  })

  it('https 远程地址返回 null（纯离线红线）', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', 'https://example.com/a.png')).toBeNull()
  })

  it('http 地址同样拒绝', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', 'http://example.com/a.png')).toBeNull()
  })
})

describe('resolveEpubImagePath - 异常输入', () => {
  it('空串返回 null', () => {
    expect(resolveEpubImagePath('OEBPS/text/ch1.xhtml', '   ')).toBeNull()
  })

  it('解析不到路径时返回 null', () => {
    expect(resolveEpubImagePath('', '?query=1')).toBeNull()
  })
})
