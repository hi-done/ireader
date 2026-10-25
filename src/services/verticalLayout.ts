// 纵向连续滚动的行盒布局与窗口计算（纯函数）
// 对应设计文档 specs/阅读方向上至下连续滚动设计方案-20261023.md §4

/** 纵向行间距（px）：需求「上下页之间留固定间隙」 */
export const VERTICAL_ROW_GAP = 16

/** 比例未知时的估计页高宽比（常见漫画页，高略大于宽） */
export const DEFAULT_PAGE_RATIO = 1.4

/** 一行：页 id 已按左→右排序（1 或 2 个） */
export interface VerticalRow {
  /** 行首页 id（进度持久化用） */
  firstPage: number
  /** 行内页 id，已按左→右排序 */
  pages: number[]
}

export interface VerticalMetrics {
  /** 每行顶部 y */
  tops: number[]
  /** 每行高度 */
  heights: number[]
  totalHeight: number
  /** 内容列宽；超过视口宽时出现横向滚动 */
  contentWidth: number
}

/**
 * 纵向缩放口径：
 * - widthScale：页宽 = 视口宽 * scale / 行内页数（PDF fitWidth、EPUB 图片型百分比）
 * - fitHeight：页高 = 视口高
 * - custom：页高 = 视口高 * scale
 * - original：按页面自然尺寸（未测量页先按 widthScale(1) 估计）
 */
export type VerticalSizing =
  | { mode: 'widthScale'; scale: number }
  | { mode: 'fitHeight' }
  | { mode: 'custom'; scale: number }
  | { mode: 'original' }

export interface PageBox {
  width: number
  height: number
}

/** 页面源契约：纵向视图只认「渲染到 canvas 并回报 CSS 尺寸」 */
export interface VerticalPageSource {
  render(
    page: number,
    canvas: HTMLCanvasElement,
    target: { width?: number; height?: number }
  ): Promise<PageBox>
  cancel?(canvas: HTMLCanvasElement): void
}

/**
 * 由各行高度生成布局表：行间固定 gap，行内页贴齐。
 * 空行表返回 totalHeight = 0。
 */
export function buildMetrics(
  rowHeights: readonly number[],
  gap: number,
  contentWidth: number
): VerticalMetrics {
  const heights = rowHeights.map((h) => Math.max(0, h))
  const tops: number[] = []
  let cursor = 0
  for (const height of heights) {
    tops.push(cursor)
    cursor += height + gap
  }
  // 最后一行的 gap 不计入总高
  const totalHeight = heights.length > 0 ? cursor - gap : 0
  return { tops, heights, totalHeight, contentWidth: Math.max(0, contentWidth) }
}

/** 二分：最后一个 tops[i] <= y 的行；y <= 0 返回 0；空表返回 0 */
export function rowAtOffset(metrics: VerticalMetrics, y: number): number {
  const { tops } = metrics
  if (tops.length === 0) return 0
  if (y <= tops[0]) return 0
  let lo = 0
  let hi = tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tops[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * 渲染窗口：视口上下各 overscan 屏（默认半屏）。
 * 空表返回 [0, -1]，调用方据此不挂载任何行。
 */
export function visibleRange(
  metrics: VerticalMetrics,
  scrollTop: number,
  viewportHeight: number,
  overscan = 0.5
): readonly [number, number] {
  if (metrics.tops.length === 0) return [0, -1]
  const from = rowAtOffset(metrics, scrollTop - viewportHeight * overscan)
  const to = rowAtOffset(metrics, scrollTop + viewportHeight * (1 + overscan))
  const last = metrics.tops.length - 1
  return [Math.max(0, Math.min(from, last)), Math.min(Math.max(to, 0), last)]
}

/**
 * 重排后保持顶部行与屏内偏移：测量回填导致行高变化时不把当前页顶出视口。
 * 空表原样返回。
 */
export function restoreAnchor(
  prev: VerticalMetrics,
  next: VerticalMetrics,
  scrollTop: number
): number {
  if (prev.tops.length === 0 || next.tops.length === 0) return scrollTop
  const anchorFrom = rowAtOffset(prev, scrollTop + 1)
  const anchorRow = Math.min(anchorFrom, next.tops.length - 1)
  const offset = scrollTop - prev.tops[anchorRow]
  const clamped = Math.min(Math.max(offset, 0), next.heights[anchorRow])
  return next.tops[anchorRow] + clamped
}

/**
 * 行表整体重建（单双页切换）后的定位：把旧布局的「顶部行 + 行内相对位移」映射到新布局的 nextRow。
 * 相对位移按行高比例换算，视图停在两行之间时不会被拉回页顶。
 */
export function mapAnchorToRow(
  prev: VerticalMetrics,
  next: VerticalMetrics,
  prevScrollTop: number,
  nextRow: number
): number {
  if (next.tops.length === 0) return 0
  const row = Math.min(Math.max(nextRow, 0), next.tops.length - 1)
  const top = next.tops[row]
  if (prev.tops.length === 0) return top

  const prevRow = rowAtOffset(prev, prevScrollTop + 1)
  const prevHeight = prev.heights[prevRow]
  if (!(prevHeight > 0)) return top
  const ratio = Math.min(1, Math.max(0, (prevScrollTop - prev.tops[prevRow]) / prevHeight))
  return top + ratio * next.heights[row]
}

/**
 * 单页在行盒内的目标尺寸。
 * cols 取「本行页数」：双页行两页各占半屏宽，封面单页行占满整行宽。
 */
export function computePageBox(
  ratio: number,
  viewport: { width: number; height: number },
  sizing: VerticalSizing,
  cols = 1
): PageBox {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_PAGE_RATIO
  const safeCols = Math.max(1, Math.floor(cols))

  switch (sizing.mode) {
    case 'fitHeight':
      return { width: viewport.height / safeRatio, height: viewport.height }
    case 'custom':
      return {
        width: (viewport.height * sizing.scale) / safeRatio,
        height: viewport.height * sizing.scale,
      }
    case 'widthScale': {
      const width = (viewport.width * sizing.scale) / safeCols
      return { width, height: width * safeRatio }
    }
    case 'original':
    default: {
      // 自然尺寸未知时先按满行宽估计，渲染返回真实尺寸后由调用方回填
      const width = viewport.width / safeCols
      return { width, height: width * safeRatio }
    }
  }
}

/** 估计比例：已测页比例的中位数；一页未测时用默认值 */
export function estimateRatio(measured: readonly number[]): number {
  const valid = measured.filter((r) => Number.isFinite(r) && r > 0)
  if (valid.length === 0) return DEFAULT_PAGE_RATIO
  const sorted = [...valid].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 定位页所在行：优先精确命中，否则取首页 id 最接近的行。
 * 空行表返回 -1。
 */
export function findRowByPage(rows: readonly VerticalRow[], page: number): number {
  if (rows.length === 0) return -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].pages.includes(page)) return i
  }
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  for (let i = 0; i < rows.length; i++) {
    const diff = Math.abs(rows[i].firstPage - page)
    if (diff < bestDiff) {
      bestDiff = diff
      best = i
    }
  }
  return best
}
