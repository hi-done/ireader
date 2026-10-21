// epubSpread 纯函数单测：跨页组规则、对齐与步进
// 对应设计文档《EPUB双页翻页跨页步进修复设计方案-20261021》§8.1

import { describe, it, expect } from 'vitest'
import {
  alignPrePaginatedPage,
  buildPrePaginatedSpreads,
  stepPrePaginatedPage,
  type EpubSpineItem,
} from './epubSpread'

/** 构造连续 spine 项；props 按索引指定 itemref properties */
function spine(count: number, props: Record<number, string[]> = {}): EpubSpineItem[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    properties: props[index] ?? [],
    linear: true,
  }))
}

describe('buildPrePaginatedSpreads - 封面单独成页', () => {
  it('10 页：[0] [1,2] [3,4] [5,6] [7,8] [9]', () => {
    const groups = buildPrePaginatedSpreads(spine(10), true)
    expect(groups).toEqual([[0], [1, 2], [3, 4], [5, 6], [7, 8], [9]])
  })

  it('奇数 5 页：末页单独成组', () => {
    const groups = buildPrePaginatedSpreads(spine(5), true)
    expect(groups).toEqual([[0], [1, 2], [3, 4]])
  })

  it('next 带 page-spread-left：当前页单独，该页成为下一组组首', () => {
    const groups = buildPrePaginatedSpreads(spine(6, { 2: ['page-spread-left'] }), true)
    expect(groups).toEqual([[0], [1], [2, 3], [4, 5]])
  })

  it('page-spread-right 的线性首项独占成组', () => {
    const items = spine(6, { 2: ['page-spread-right'] })
    // 0、1 非线性：线性序列首项是带 page-spread-right 的 2
    items[0].linear = false
    items[1].linear = false
    const groups = buildPrePaginatedSpreads(items, true)
    expect(groups).toEqual([[2], [3, 4], [5]])
  })
})

describe('buildPrePaginatedSpreads - 封面不单独成页', () => {
  it('10 页：[0,1] [2,3] … [8,9]', () => {
    const groups = buildPrePaginatedSpreads(spine(10), false)
    expect(groups).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ])
  })

  it('奇数 5 页：末页单独成组', () => {
    const groups = buildPrePaginatedSpreads(spine(5), false)
    expect(groups).toEqual([[0, 1], [2, 3], [4]])
  })

  it('用户设置优先：无视 page-spread 元数据一律两两并排', () => {
    const groups = buildPrePaginatedSpreads(
      spine(6, { 1: ['page-spread-left'], 2: ['page-spread-right'] }),
      false
    )
    expect(groups).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ])
  })
})

describe('buildPrePaginatedSpreads - linear 与属性兜底', () => {
  it('linear=no 的项跳过，组内保留原索引', () => {
    const items = spine(6)
    items[2].linear = false
    const groups = buildPrePaginatedSpreads(items, true)
    expect(groups).toEqual([[0], [1, 3], [4, 5]])
  })

  it('properties 缺失时不抛错，按无属性处理', () => {
    const items = spine(4).map((it) => ({ ...it, properties: undefined as unknown as string[] }))
    const groups = buildPrePaginatedSpreads(items, true)
    expect(groups).toEqual([[0], [1, 2], [3]])
  })

  it('空 spine 返回空组表', () => {
    expect(buildPrePaginatedSpreads([], true)).toEqual([])
  })
})

describe('alignPrePaginatedPage', () => {
  const groups = [[0], [1, 2], [3, 4], [5]]

  it('组内第二页对齐到组首', () => {
    expect(alignPrePaginatedPage(groups, 2)).toBe(1)
    expect(alignPrePaginatedPage(groups, 4)).toBe(3)
  })

  it('组首页原样返回', () => {
    expect(alignPrePaginatedPage(groups, 0)).toBe(0)
    expect(alignPrePaginatedPage(groups, 3)).toBe(3)
  })

  it('linear=no / 组间空洞前向对齐到最近下一组', () => {
    expect(alignPrePaginatedPage([[0], [1, 3], [4, 5]], 2)).toBe(1)
  })

  it('越界落到末组首页', () => {
    expect(alignPrePaginatedPage(groups, 99)).toBe(5)
  })

  it('空组表原样返回', () => {
    expect(alignPrePaginatedPage([], 4)).toBe(4)
  })
})

describe('stepPrePaginatedPage', () => {
  const groups = [[0], [1, 2], [3, 4], [5]]

  it('步进一个跨页', () => {
    expect(stepPrePaginatedPage(groups, 3, 1)).toBe(5)
    expect(stepPrePaginatedPage(groups, 3, -1)).toBe(1)
    expect(stepPrePaginatedPage(groups, 0, 1)).toBe(1)
  })

  it('从组内第二页出发只前进一组', () => {
    expect(stepPrePaginatedPage(groups, 4, 1)).toBe(5)
    expect(stepPrePaginatedPage(groups, 4, -1)).toBe(1)
  })

  it('首组再上一页、末组再下一页夹取不越界', () => {
    expect(stepPrePaginatedPage(groups, 0, -1)).toBe(0)
    expect(stepPrePaginatedPage(groups, 5, 1)).toBe(5)
  })

  it('多步越过末尾夹取到末组首页', () => {
    expect(stepPrePaginatedPage(groups, 1, 10)).toBe(5)
    expect(stepPrePaginatedPage(groups, 3, -10)).toBe(0)
  })

  it('空组表按原索引放行', () => {
    expect(stepPrePaginatedPage([], 4, 1)).toBe(4)
  })
})
