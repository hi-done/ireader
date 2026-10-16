// cbz 渲染器纯函数单测：尺寸计算口径（适宽/适高/原始/DPR）

import { describe, expect, it } from 'vitest'
import { computeCbzPageSize } from './cbz'

describe('computeCbzPageSize', () => {
  it('适宽：宽度精确等于目标宽，高度按比例', () => {
    const size = computeCbzPageSize(1000, 2000, { targetWidth: 500 }, 1)
    expect(size.cssWidth).toBe(500)
    expect(size.cssHeight).toBe(1000)
    expect(size.pixelWidth).toBe(500)
    expect(size.pixelHeight).toBe(1000)
  })

  it('适高：高度精确等于目标高，宽度按比例', () => {
    const size = computeCbzPageSize(1000, 2000, { targetHeight: 800 }, 1)
    expect(size.cssWidth).toBe(400)
    expect(size.cssHeight).toBe(800)
  })

  it('原始：不传目标尺寸时 CSS 尺寸等于原图像素（1:1）', () => {
    const size = computeCbzPageSize(1000, 2000, {}, 1)
    expect(size.cssWidth).toBe(1000)
    expect(size.cssHeight).toBe(2000)
  })

  it('DPR 乘算进物理像素，且像素尺寸至少为 1', () => {
    const size = computeCbzPageSize(1000, 2000, { targetWidth: 500 }, 2)
    expect(size.pixelWidth).toBe(1000)
    expect(size.pixelHeight).toBe(2000)

    const tiny = computeCbzPageSize(1000, 2000, { targetWidth: 0.001 }, 1)
    expect(tiny.pixelWidth).toBeGreaterThanOrEqual(1)
    expect(tiny.pixelHeight).toBeGreaterThanOrEqual(1)
  })
})
