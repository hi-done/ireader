import { describe, expect, it } from 'vitest'
import {
  buildMetrics,
  computePageBox,
  DEFAULT_PAGE_RATIO,
  estimateRatio,
  findRowByPage,
  mapAnchorToRow,
  restoreAnchor,
  rowAtOffset,
  VERTICAL_ROW_GAP,
  visibleRange,
  type VerticalRow,
} from './verticalLayout'

function makeMetrics(heights: number[], gap = VERTICAL_ROW_GAP, contentWidth = 1000) {
  return buildMetrics(heights, gap, contentWidth)
}

describe('buildMetrics - 行盒布局', () => {
  it('3 行等高：行间固定 16px，末行后不加间隙', () => {
    const metrics = makeMetrics([100, 100, 100])
    expect(metrics.tops).toEqual([0, 116, 232])
    expect(metrics.totalHeight).toBe(332) // 3*100 + 2*16
  })

  it('单行无间隙', () => {
    const metrics = makeMetrics([100])
    expect(metrics.tops).toEqual([0])
    expect(metrics.totalHeight).toBe(100)
  })

  it('空行表总高为 0', () => {
    const metrics = makeMetrics([])
    expect(metrics.tops).toEqual([])
    expect(metrics.totalHeight).toBe(0)
  })

  it('行高不等时按各自高度累加', () => {
    const metrics = makeMetrics([100, 200, 50])
    expect(metrics.tops).toEqual([0, 116, 332])
    expect(metrics.totalHeight).toBe(382) // 100+200+50 + 2*16
  })
})

describe('rowAtOffset - 二分定位', () => {
  const metrics = makeMetrics([100, 100, 100], 0)

  it('y 为非负边界：落在行首', () => {
    expect(rowAtOffset(metrics, metrics.tops[1])).toBe(1)
    expect(rowAtOffset(metrics, metrics.tops[2])).toBe(2)
  })

  it('y 在行首前一像素：归属上一行', () => {
    expect(rowAtOffset(metrics, metrics.tops[1] - 1)).toBe(0)
    expect(rowAtOffset(metrics, metrics.tops[2] - 1)).toBe(1)
  })

  it('y 为负或 0 返回首行', () => {
    expect(rowAtOffset(metrics, -50)).toBe(0)
    expect(rowAtOffset(metrics, 0)).toBe(0)
  })

  it('超过末行返回末行', () => {
    expect(rowAtOffset(metrics, 99999)).toBe(2)
  })
})

describe('visibleRange - 半屏 overscan 窗口', () => {
  it('窗口覆盖视口上下各半屏', () => {
    const metrics = makeMetrics([1000, 1000, 1000, 1000, 1000, 1000], 0)
    // scrollTop=2000、H=1000 → [1500, 3500] → 行 1 ~ 行 3
    expect(visibleRange(metrics, 2000, 1000)).toEqual([1, 3])
  })

  it('顶部越界夹取到首行', () => {
    const metrics = makeMetrics([1000, 1000, 1000], 0)
    expect(visibleRange(metrics, 0, 1000)).toEqual([0, 1])
  })

  it('底部越界夹取到末行', () => {
    const metrics = makeMetrics([1000, 1000, 1000], 0)
    expect(visibleRange(metrics, 1900, 1000)).toEqual([1, 2])
  })

  it('空行表返回 [0, -1]', () => {
    expect(visibleRange(makeMetrics([]), 0, 1000)).toEqual([0, -1])
  })
})

describe('restoreAnchor - 重排锚点保持', () => {
  it('顶部行不变且屏内偏移保持', () => {
    const prev = makeMetrics([100, 100, 100], 10)
    const next = makeMetrics([150, 150, 150], 10)
    // prev: tops [0,110,220]；scrollTop=120 落在行 1，偏移 10
    expect(restoreAnchor(prev, next, 120)).toBe(170) // next tops[1]=160 + 10
  })

  it('偏移超过新行高时夹取到行高', () => {
    const prev = makeMetrics([200, 200], 0)
    const next = makeMetrics([50, 50], 0)
    // prev: scrollTop=150 → 行 0，偏移 150 > 新行高 50
    expect(restoreAnchor(prev, next, 150)).toBe(50)
  })

  it('任一布局为空时原样返回', () => {
    expect(restoreAnchor(makeMetrics([]), makeMetrics([100]), 42)).toBe(42)
    expect(restoreAnchor(makeMetrics([100]), makeMetrics([]), 42)).toBe(42)
  })
})

describe('computePageBox - 缩放映射', () => {
  const viewport = { width: 1000, height: 800 }

  it('widthScale：双页行各占半屏宽', () => {
    const box = computePageBox(1.5, viewport, { mode: 'widthScale', scale: 1 }, 2)
    expect(box.width).toBe(500)
    expect(box.height).toBe(750)
  })

  it('widthScale：单页行占满整行宽', () => {
    const box = computePageBox(1.5, viewport, { mode: 'widthScale', scale: 1 }, 1)
    expect(box.width).toBe(1000)
    expect(box.height).toBe(1500)
  })

  it('fitHeight：页高等同视口高', () => {
    const box = computePageBox(1.5, viewport, { mode: 'fitHeight' })
    expect(box.height).toBe(800)
    expect(box.width).toBeCloseTo(800 / 1.5, 5)
  })

  it('custom：按视口高比例缩放', () => {
    const box = computePageBox(1.5, viewport, { mode: 'custom', scale: 0.5 })
    expect(box.height).toBe(400)
    expect(box.width).toBeCloseTo(400 / 1.5, 5)
  })

  it('original：未测量时按满行宽估计', () => {
    const box = computePageBox(1.5, viewport, { mode: 'original' })
    expect(box.width).toBe(1000)
    expect(box.height).toBe(1500)
  })

  it('比例非法时回退默认比例', () => {
    const box = computePageBox(0, viewport, { mode: 'widthScale', scale: 1 }, 1)
    expect(box.height).toBe(1000 * DEFAULT_PAGE_RATIO)
  })
})

describe('estimateRatio - 中位数估计', () => {
  it('无有效样本用默认比例', () => {
    expect(estimateRatio([])).toBe(DEFAULT_PAGE_RATIO)
    expect(estimateRatio([0, -1, Number.NaN])).toBe(DEFAULT_PAGE_RATIO)
  })

  it('奇数样本取中位数', () => {
    expect(estimateRatio([1.6, 1.2, 1.4])).toBe(1.4)
  })

  it('偶数样本取中间两值均值', () => {
    expect(estimateRatio([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('mapAnchorToRow - 单双页切换后的定位', () => {
  // 旧布局：3 行等高 100；新布局：3 行等高 200（如单页 → 双页行高翻倍）
  const prev = makeMetrics([100, 100, 100])
  const next = makeMetrics([200, 200, 200])

  it('停在行首时映射到新行行首', () => {
    expect(mapAnchorToRow(prev, next, 116, 1)).toBe(216)
  })

  it('停在行内 40% 时保持相对位移，不回退到行顶', () => {
    expect(mapAnchorToRow(prev, next, 156, 1)).toBe(296) // 216 + 0.4 * 200
  })

  it('旧偏移比例上限夹到 1（停在行底而不越到下一行）', () => {
    expect(mapAnchorToRow(prev, next, 216, 1)).toBe(416) // 216 + 1 * 200
  })

  it('旧布局为空（首帧）时取新行行首', () => {
    expect(mapAnchorToRow(makeMetrics([]), next, 0, 1)).toBe(216)
  })

  it('新布局为空时返回 0', () => {
    expect(mapAnchorToRow(prev, makeMetrics([]), 156, 0)).toBe(0)
  })

  it('目标行越界时夹到末行', () => {
    expect(mapAnchorToRow(makeMetrics([]), next, 0, 99)).toBe(432)
  })
})

describe('findRowByPage - 初始行定位', () => {
  const rows: VerticalRow[] = [
    { firstPage: 1, pages: [1] },
    { firstPage: 2, pages: [2, 3] },
    { firstPage: 4, pages: [4, 5] },
  ]

  it('命中行内任意页', () => {
    expect(findRowByPage(rows, 3)).toBe(1)
    expect(findRowByPage(rows, 5)).toBe(2)
  })

  it('不在任何行时取首页 id 最接近的行', () => {
    expect(findRowByPage(rows, 0)).toBe(0)
    expect(findRowByPage(rows, 99)).toBe(2)
  })

  it('空行表返回 -1', () => {
    expect(findRowByPage([], 1)).toBe(-1)
  })
})
