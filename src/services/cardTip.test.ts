import { describe, expect, it } from 'vitest'
import { resolveTipPosition } from './cardTip'

// 26px 的圆钮、68×28 的浮层，均按视口坐标
const ANCHOR = { top: 100, left: 100, width: 26, height: 26 }
const BASE = {
  anchor: ANCHOR,
  tipWidth: 68,
  tipHeight: 28,
  placement: 'below' as const,
  align: 'center' as const,
  viewportWidth: 1200,
  viewportHeight: 800,
}

describe('resolveTipPosition - 展开方向与对齐', () => {
  it('向下展开：贴锚点底部 7px，水平居中', () => {
    expect(resolveTipPosition(BASE)).toEqual({ top: 133, left: 79 })
  })

  it('右对齐：浮层右缘贴合锚点右缘', () => {
    expect(resolveTipPosition({ ...BASE, align: 'right' })).toEqual({ top: 133, left: 58 })
  })

  it('向上展开：贴锚点顶部 7px', () => {
    expect(resolveTipPosition({ ...BASE, placement: 'above' })).toEqual({ top: 65, left: 79 })
  })

  it('支持自定义间距与安全边距', () => {
    expect(resolveTipPosition({ ...BASE, gap: 10, margin: 20 })).toEqual({ top: 136, left: 79 })
  })
})

describe('resolveTipPosition - 视口钳制', () => {
  it('左侧越界时收敛到左边距', () => {
    expect(resolveTipPosition({ ...BASE, anchor: { ...ANCHOR, left: 0 } }).left).toBe(8)
  })

  it('右侧越界时收敛到右边距', () => {
    expect(resolveTipPosition({ ...BASE, anchor: { ...ANCHOR, left: 1180 } }).left).toBe(1124)
  })

  it('上方空间不足时收敛到上边距', () => {
    const position = resolveTipPosition({
      ...BASE,
      placement: 'above',
      anchor: { ...ANCHOR, top: 4 },
    })
    expect(position.top).toBe(8)
  })

  it('浮层宽于视口时退回左边距', () => {
    expect(resolveTipPosition({ ...BASE, viewportWidth: 60 }).left).toBe(8)
  })
})
