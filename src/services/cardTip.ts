// 卡片悬停提示框定位：锚点矩形 + 浮层尺寸 → fixed 坐标（纯函数，无 DOM 依赖）
// 对应设计文档 specs/图书卡片提示框苹果风美化设计方案-20261021.md §5.2

/** 浮层相对锚点的展开方向 */
export type TipPlacement = 'above' | 'below'

/** 浮层水平对齐方式：居中于锚点 / 右缘对齐锚点右缘 */
export type TipAlign = 'center' | 'right'

/** 视口坐标下的锚点矩形（getBoundingClientRect 的裁剪版） */
export interface TipAnchorRect {
  top: number
  left: number
  width: number
  height: number
}

export interface TipPositionInput {
  anchor: TipAnchorRect
  /** 浮层实测宽度 */
  tipWidth: number
  /** 浮层实测高度 */
  tipHeight: number
  placement: TipPlacement
  align: TipAlign
  /** 浮层与锚点间距，默认 7 */
  gap?: number
  /** 与视口的安全边距，默认 8 */
  margin?: number
  viewportWidth: number
  viewportHeight: number
}

export interface TipPosition {
  top: number
  left: number
}

/** 计算浮层 fixed 坐标：方向由 placement 决定，水平按 align 对齐后收敛到视口内 */
export function resolveTipPosition(input: TipPositionInput): TipPosition {
  const gap = input.gap ?? 7
  const margin = input.margin ?? 8
  const rawLeft =
    input.align === 'right'
      ? input.anchor.left + input.anchor.width - input.tipWidth
      : input.anchor.left + input.anchor.width / 2 - input.tipWidth / 2
  const rawTop =
    input.placement === 'below'
      ? input.anchor.top + input.anchor.height + gap
      : input.anchor.top - gap - input.tipHeight
  return {
    top: clamp(rawTop, margin, input.viewportHeight - margin - input.tipHeight),
    left: clamp(rawLeft, margin, input.viewportWidth - margin - input.tipWidth),
  }
}

/** 收敛到 [min, max]；区间反向收缩（浮层比视口还大）时退回 min */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
