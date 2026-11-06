// 阅读进度派生口径单测：百分比折算与缩略图页码归一
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §8.1

import { describe, expect, it } from 'vitest'
import { progressPercentOf, thumbPageOf } from './bookProgress'

describe('progressPercentOf', () => {
  it('EPUB 有 percentage 时直接取百分比', () => {
    expect(progressPercentOf({ progress: { page: 1, percentage: 42 }, totalPages: 0 })).toBe(42)
  })

  it('PDF 按当前页与总页数折算', () => {
    expect(progressPercentOf({ progress: { page: 30 }, totalPages: 120 })).toBe(25)
  })

  it('无进度返回 null', () => {
    expect(progressPercentOf({ progress: null, totalPages: 120 })).toBeNull()
  })

  it('percentage 超界时收敛到 100', () => {
    expect(progressPercentOf({ progress: { page: 1, percentage: 120 }, totalPages: 0 })).toBe(100)
  })

  it('有进度但总页数未知且无 percentage 时返回 null', () => {
    expect(progressPercentOf({ progress: { page: 5 }, totalPages: 0 })).toBeNull()
  })
})

describe('thumbPageOf', () => {
  it('有进度取当前页', () => {
    expect(thumbPageOf({ progress: { page: 30 }, totalPages: 120 })).toBe(30)
  })

  it('无进度落到第 1 页', () => {
    expect(thumbPageOf({ progress: null, totalPages: 120 })).toBe(1)
  })

  it('当前页超过总页数时钳制到末页', () => {
    expect(thumbPageOf({ progress: { page: 999 }, totalPages: 120 })).toBe(120)
  })

  it('页码为 0 或非法值时落到第 1 页', () => {
    expect(thumbPageOf({ progress: { page: 0 }, totalPages: 120 })).toBe(1)
    expect(thumbPageOf({ progress: { page: Number.NaN }, totalPages: 120 })).toBe(1)
  })

  it('总页数未知时不钳制，按当前页返回', () => {
    expect(thumbPageOf({ progress: { page: 7 }, totalPages: 0 })).toBe(7)
  })
})
