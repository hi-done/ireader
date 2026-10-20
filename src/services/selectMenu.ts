// 下拉菜单纯逻辑：高亮下标移动、弹层翻转与横向收敛
// 对应设计文档《设置页与文库下拉菜单苹果风格美化设计方案》§4.2
// 纯逻辑模块：不访问 DOM，几何值均由调用方传入，便于单测

/** 下拉选项：value 为字面量联合或数值档位（阅读页缩放 / 字号），label 为展示文案 */
export interface SelectOption<T extends string | number = string> {
  value: T
  label: string
}

/**
 * 展开时的高亮初始下标：定位当前选中项，未匹配时回退首项。
 * @param options 选项列表
 * @param value 当前选中值
 */
export function initialActiveIndex<T extends string | number>(
  options: readonly SelectOption<T>[],
  value: T
): number {
  const index = options.findIndex((option) => option.value === value)
  if (index >= 0) return index
  return options.length ? 0 : -1
}

/**
 * 循环移动高亮下标（首尾回绕）。
 * @param current 当前下标，-1 表示无高亮
 * @param delta 1=向下 / -1=向上
 * @param count 选项数量
 */
export function moveActiveIndex(current: number, delta: -1 | 1, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta === 1 ? 0 : count - 1
  return (current + delta + count) % count
}

export interface MenuPlacementInput {
  triggerTop: number
  triggerBottom: number
  menuHeight: number
  viewportHeight: number
  /** 触发器与弹层间距（px），默认 6 */
  gap?: number
  /** 视口安全边距（px），默认 8 */
  margin?: number
}

/**
 * 弹层纵向落点：下方放得下就向下，否则上方更宽裕时向上。
 * @param input 触发器 / 弹层 / 视口几何
 */
export function resolveMenuPlacement(input: MenuPlacementInput): 'below' | 'above' {
  const gap = input.gap ?? 6
  const margin = input.margin ?? 8
  const spaceBelow = input.viewportHeight - input.triggerBottom - margin
  const spaceAbove = input.triggerTop - margin
  // 下方空间足够，或上下都不足但下方不差于上方时保持向下（默认方向更符合直觉）
  return spaceBelow >= input.menuHeight + gap || spaceBelow >= spaceAbove ? 'below' : 'above'
}

/**
 * 弹层横向收敛：右边缘对齐触发器后不越出视口安全边距。
 * @param preferredLeft 未收敛的左边缘坐标
 * @param menuWidth 弹层宽度
 * @param viewportWidth 视口宽度
 * @param margin 视口安全边距（px），默认 8
 */
export function clampMenuLeft(
  preferredLeft: number,
  menuWidth: number,
  viewportWidth: number,
  margin = 8
): number {
  // 弹层比视口还宽时，右边界会小于左边距，取左边距兜底
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin)
  return Math.min(Math.max(preferredLeft, margin), maxLeft)
}
