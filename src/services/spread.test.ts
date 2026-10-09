import { describe, expect, it } from 'vitest'
import { buildSpreads, findSpreadIndexByPage, toDisplayOrder } from './spread'

describe('buildSpreads - single 模式', () => {
  it('每组 1 页', () => {
    const spreads = buildSpreads(5, { mode: 'single', direction: 'rtl', coverSinglePage: true })
    expect(spreads.map((s) => s.pages)).toEqual([[1], [2], [3], [4], [5]])
  })
})

describe('buildSpreads - double 模式 + 封面单独成页', () => {
  it('[1] [2,3] [4,5]', () => {
    const spreads = buildSpreads(5, { mode: 'double', direction: 'rtl', coverSinglePage: true })
    expect(spreads.map((s) => s.pages)).toEqual([[1], [2, 3], [4, 5]])
  })

  it('奇数总页数末组落单', () => {
    const spreads = buildSpreads(6, { mode: 'double', direction: 'rtl', coverSinglePage: true })
    expect(spreads.map((s) => s.pages)).toEqual([[1], [2, 3], [4, 5], [6]])
  })
})

describe('buildSpreads - double 模式 + 封面不单独', () => {
  it('[1,2] [3,4] [5,6]', () => {
    const spreads = buildSpreads(6, { mode: 'double', direction: 'rtl', coverSinglePage: false })
    expect(spreads.map((s) => s.pages)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })
})

describe('toDisplayOrder - 阅读方向镜像', () => {
  it('LTR（韩漫）：第 1 页在左、第 2 页在右', () => {
    expect(toDisplayOrder([2, 3], 'ltr')).toEqual([2, 3])
  })

  it('RTL（日漫）：第 1 页在右、第 2 页在左，组 [2,3] 显示为左 3 右 2', () => {
    expect(toDisplayOrder([2, 3], 'rtl')).toEqual([3, 2])
  })

  it('单页页组方向不影响顺序', () => {
    expect(toDisplayOrder([1], 'rtl')).toEqual([1])
  })
})

describe('findSpreadIndexByPage', () => {
  it('能定位到包含该页码的页组', () => {
    const spreads = buildSpreads(6, { mode: 'double', direction: 'rtl', coverSinglePage: true })
    expect(findSpreadIndexByPage(spreads, 5)).toBe(2) // [4,5] 的索引
  })

  it('页码不存在时回退到 0', () => {
    const spreads = buildSpreads(6, { mode: 'double', direction: 'rtl', coverSinglePage: true })
    expect(findSpreadIndexByPage(spreads, 999)).toBe(0)
  })
})
