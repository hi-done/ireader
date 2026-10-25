// 零进度判定单测：默认阅读方向同步口径
// 对应设计文档 specs/默认阅读方向同步零进度书设计方案-20261025.md §11.1

import { describe, expect, it } from 'vitest'
import { isUnstartedProgress } from './types'

describe('isUnstartedProgress', () => {
  it('首页且无百分比（PDF 首页）', () => {
    expect(isUnstartedProgress(1, null)).toBe(true)
  })

  it('首页且百分比为 0（EPUB 首页）', () => {
    expect(isUnstartedProgress(1, 0)).toBe(true)
  })

  it('首页且未传百分比', () => {
    expect(isUnstartedProgress(1)).toBe(true)
  })

  it('首页但百分比 0.4 不算零进度', () => {
    expect(isUnstartedProgress(1, 0.4)).toBe(false)
  })

  it('第二页无百分比不算零进度', () => {
    expect(isUnstartedProgress(2, null)).toBe(false)
  })

  it('第二页百分比 0 仍按页码判为非零', () => {
    expect(isUnstartedProgress(2, 0)).toBe(false)
  })

  it('脏数据首页 0 视为零进度', () => {
    expect(isUnstartedProgress(0, null)).toBe(true)
  })
})
