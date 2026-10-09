// 页组划分与方向映射（纯函数）
// 对应设计文档 §4.2，重点单测对象

import type { Direction, ReadingMode } from '../../shared/types'

/** 一个页组：按阅读方向已排好左右显示顺序的页码数组（1-2 个） */
export interface Spread {
  /** 页组内第一页页码（即持久化存储的 page 字段） */
  firstPage: number
  /** 页组内包含的所有页码，升序 */
  pages: number[]
  /** 按屏幕左→右顺序排列后的页码（用于渲染） */
  displayOrder: number[]
}

export interface SpreadOptions {
  mode: ReadingMode
  direction: Direction
  /** 双页模式下封面（第 1 页）是否单独成页 */
  coverSinglePage: boolean
}

/**
 * 计算给定总页数、给定配置下的全部页组。
 * 页码从 1 开始。
 */
export function buildSpreads(totalPages: number, options: SpreadOptions): Spread[] {
  if (totalPages <= 0) return []

  const groups: number[][] = []

  if (options.mode === 'single') {
    for (let p = 1; p <= totalPages; p++) groups.push([p])
  } else {
    let p = 1
    if (options.coverSinglePage) {
      groups.push([1])
      p = 2
    }
    for (; p <= totalPages; p += 2) {
      if (p + 1 <= totalPages) groups.push([p, p + 1])
      else groups.push([p])
    }
  }

  return groups.map((pages) => ({
    firstPage: pages[0],
    pages,
    displayOrder: toDisplayOrder(pages, options.direction),
  }))
}

/** 将页组内页码按屏幕左→右的顺序排列 */
export function toDisplayOrder(pages: number[], direction: Direction): number[] {
  if (pages.length < 2) return [...pages]
  // LTR（韩漫）：第 1 页在左、第 2 页在右 → 原顺序即为显示顺序
  // RTL（日漫）：第 1 页在右、第 2 页在左 → 反转
  return direction === 'ltr' ? [...pages] : [...pages].reverse()
}

/** 根据页码定位其所属页组在 spreads 中的索引 */
export function findSpreadIndexByPage(spreads: Spread[], page: number): number {
  const idx = spreads.findIndex((s) => s.pages.includes(page))
  return idx === -1 ? 0 : idx
}

/**
 * 在模式/方向切换时，根据当前所在页码计算新配置下应定位到的页组索引。
 * 保证始终定位到「包含该页码」的页组，不跳回开头。
 */
export function remapSpreadIndex(
  totalPages: number,
  currentPage: number,
  newOptions: SpreadOptions
): { spreads: Spread[]; index: number } {
  const spreads = buildSpreads(totalPages, newOptions)
  const index = findSpreadIndexByPage(spreads, currentPage)
  return { spreads, index }
}
