// 内页取图口径单测：左右两面分支、页码归一与页序方向
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.1 / §8.1

import { describe, expect, it } from 'vitest'
import type { Direction, RowOrder } from '../../shared/types'
import { resolvePageThumb, type PageThumbBook } from './pageThumbnail'

/** 构造取图书：progress 需要带 direction，未读过的书传 null */
function book(
  format: PageThumbBook['format'],
  progress: { page: number; direction: Direction; rowOrder?: RowOrder } | null,
  extra: Partial<PageThumbBook> = {}
): PageThumbBook {
  return {
    id: 7,
    format,
    totalPages: 60,
    coverUrl: 'ireader://cover/7',
    progress: progress ? { ...progress } : null,
    ...extra,
  }
}

describe('pageOrderOf（页序方向）', () => {
  it('已读过的书跟本书 direction：rtl 右先读、ltr 左先读', () => {
    expect(
      resolvePageThumb(book('cbz', { page: 12, direction: 'rtl' }), 'ltr').order
    ).toBe('rtl')
    expect(
      resolvePageThumb(book('cbz', { page: 12, direction: 'ltr' }), 'rtl').order
    ).toBe('ltr')
  })

  it('未读过的书用全局默认方向', () => {
    expect(resolvePageThumb(book('cbz', null), 'rtl').order).toBe('rtl')
    expect(resolvePageThumb(book('cbz', null), 'ltr').order).toBe('ltr')
  })

  it('纵向条漫按 rowOrder 决定行内页序，缺省左→右', () => {
    const ttb = (rowOrder?: RowOrder) =>
      resolvePageThumb(book('cbz', { page: 3, direction: 'ttb', rowOrder }), 'rtl').order
    expect(ttb('rtl')).toBe('rtl')
    expect(ttb('ltr')).toBe('ltr')
    expect(ttb()).toBe('ltr')
  })
})

describe('resolvePageThumb（取图口径）', () => {
  it('CBZ 取当前页与下一页的逐页图片地址', () => {
    expect(resolvePageThumb(book('cbz', { page: 12, direction: 'rtl' }))).toEqual({
      current: { kind: 'image', url: 'ireader://cbz/7/12' },
      next: { kind: 'image', url: 'ireader://cbz/7/13' },
      order: 'rtl',
    })
  })

  it('MOBI 无进度时从第 1 页起取图', () => {
    expect(resolvePageThumb(book('mobi', null), 'rtl')).toEqual({
      current: { kind: 'image', url: 'ireader://mobi/7/1' },
      next: { kind: 'image', url: 'ireader://mobi/7/2' },
      order: 'rtl',
    })
  })

  it('停在末页时没有下一页', () => {
    expect(
      resolvePageThumb(book('cbz', { page: 60, direction: 'rtl' }, { totalPages: 60 })).next
    ).toBeNull()
  })

  it('PDF 有进度时两页都交给 pdf.js（页码随方向落位由组件负责）', () => {
    expect(resolvePageThumb(book('pdf', { page: 40, direction: 'ltr' }), 'ltr')).toEqual({
      current: { kind: 'pdf', bookId: 7, page: 40 },
      next: { kind: 'pdf', bookId: 7, page: 41 },
      order: 'ltr',
    })
  })

  it('PDF 无进度时取第 1 页与第 2 页', () => {
    expect(resolvePageThumb(book('pdf', null), 'rtl')).toEqual({
      current: { kind: 'pdf', bookId: 7, page: 1 },
      next: { kind: 'pdf', bookId: 7, page: 2 },
      order: 'rtl',
    })
  })

  it('EPUB 两页都按 spine 索引取图（progress.page = 索引 + 1）', () => {
    expect(
      resolvePageThumb(book('epub', { page: 11, direction: 'rtl' }, { totalPages: 0 }), 'rtl')
    ).toEqual({
      current: { kind: 'image', url: 'ireader://epubpage/7/11' },
      next: { kind: 'image', url: 'ireader://epubpage/7/12' },
      order: 'rtl',
    })
  })

  it('EPUB 无进度时两页都从第 1 页起取图', () => {
    expect(resolvePageThumb(book('epub', null, { totalPages: 0 }), 'ltr')).toEqual({
      current: { kind: 'image', url: 'ireader://epubpage/7/1' },
      next: { kind: 'image', url: 'ireader://epubpage/7/2' },
      order: 'ltr',
    })
  })

  it('封面缺失不影响逐页取图（总页数未知时右页照取 page+1）', () => {
    expect(
      resolvePageThumb(book('cbz', null, { totalPages: 0, coverUrl: null }), 'ltr')
    ).toEqual({
      current: { kind: 'image', url: 'ireader://cbz/7/1' },
      next: { kind: 'image', url: 'ireader://cbz/7/2' },
      order: 'ltr',
    })
  })
})
