// 渲染几何单点单测：目标盒推导、像素对齐（后备像素 : CSS : dpr 严格为 1）、非法 dpr 退化

import { describe, expect, it } from 'vitest'
import { dprKey, devicePixelSnapOffset, fitCssSize, fitRenderBox } from './renderGeometry'

describe('fitCssSize', () => {
  it('适宽：宽度精确等于目标宽，高度按比例', () => {
    const css = fitCssSize(1000, 2000, { targetWidth: 500 })
    expect(css.width).toBe(500)
    expect(css.height).toBe(1000)
  })

  it('适高：高度精确等于目标高，宽度按比例', () => {
    const css = fitCssSize(1000, 2000, { targetHeight: 800 })
    expect(css.width).toBe(400)
    expect(css.height).toBe(800)
  })

  it('适宽优先于适高（两者同时给出时以宽度为准）', () => {
    const css = fitCssSize(1000, 2000, { targetWidth: 500, targetHeight: 999 })
    expect(css.width).toBe(500)
    expect(css.height).toBe(1000)
  })

  it('缺省目标：CSS 尺寸等于自然尺寸（original 档 1:1）', () => {
    const css = fitCssSize(1000, 2000, {})
    expect(css.width).toBe(1000)
    expect(css.height).toBe(2000)
  })
})

describe('fitRenderBox', () => {
  it('整数 dpr：后备像素与 CSS 尺寸同步翻倍', () => {
    const box = fitRenderBox(1000, 2000, { targetWidth: 500 }, 2)
    expect(box.pixelWidth).toBe(1000)
    expect(box.pixelHeight).toBe(2000)
    expect(box.cssWidth).toBe(500)
    expect(box.cssHeight).toBe(1000)
  })

  it('小数 dpr：后备像素与 CSS 尺寸之比严格等于 dpr（不引入取整误差）', () => {
    const targets = [{ targetWidth: 1279 }, { targetHeight: 769 }, { targetWidth: 640 }, {}]
    for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
      for (const target of targets) {
        const box = fitRenderBox(1000, 2000, target, dpr)
        expect(box.pixelWidth / box.cssWidth).toBeCloseTo(dpr, 9)
        expect(box.pixelHeight / box.cssHeight).toBeCloseTo(dpr, 9)
      }
    }
  })

  it('适高目标：CSS 高度与目标高的偏差不超过 1px', () => {
    const box = fitRenderBox(595, 842, { targetHeight: 769 }, 1.25)
    expect(Math.abs(box.cssHeight - 769)).toBeLessThanOrEqual(1)
  })

  it('极小目标：后备像素不小于 1', () => {
    const box = fitRenderBox(1000, 2000, { targetWidth: 0.001 }, 1)
    expect(box.pixelWidth).toBeGreaterThanOrEqual(1)
    expect(box.pixelHeight).toBeGreaterThanOrEqual(1)
  })

  it('非法 dpr（0 / 负数 / NaN）按 1 处理且比例仍为 1', () => {
    for (const dpr of [0, -1, Number.NaN]) {
      const box = fitRenderBox(1000, 2000, { targetWidth: 500 }, dpr)
      expect(box.cssWidth).toBe(500)
      expect(box.pixelWidth / box.cssWidth).toBe(1)
    }
  })
})

describe('dprKey', () => {
  it('保留两位小数：同一显示比例不会算出两个签名', () => {
    expect(dprKey(1.25)).toBe('1.25')
    expect(dprKey(1.5000001)).toBe('1.5')
    expect(dprKey(1)).toBe('1')
  })
})

describe('devicePixelSnapOffset', () => {
  it('补偿后落位严格在整设备像素上（小数 dpr）', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
      for (const left of [338.2, 93.8, 0, -12.3, 1279.5]) {
        const { x } = devicePixelSnapOffset(left, 0, dpr)
        const device = (left + x) * dpr
        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9)
      }
    }
  })

  it('半设备像素是最差相位：偏差不会超过半个设备像素', () => {
    // 338.2 × 1.25 = 422.75 → 吸附到 423（+0.2 CSS），剩余偏差 0
    const { x } = devicePixelSnapOffset(338.2, 0, 1.25)
    expect(x).toBeCloseTo(0.2, 9)
    // 94.0 × 1.25 = 117.5 → 吸附 +0.4 CSS
    expect(devicePixelSnapOffset(94, 0, 1.25).x).toBeCloseTo(0.4, 9)
  })

  it('已对齐时补偿量为 0', () => {
    expect(devicePixelSnapOffset(338.4, 100.8, 1.25).x).toBeCloseTo(0, 9)
    expect(devicePixelSnapOffset(338.4, 100.8, 1.25).y).toBeCloseTo(0, 9)
    expect(devicePixelSnapOffset(640, 480, 2)).toEqual({ x: 0, y: 0 })
  })

  it('非法 dpr 按 1 处理', () => {
    // 10.4 → 最近整数 10，需向左补 0.4 CSS
    expect(devicePixelSnapOffset(10.4, 0, 0).x).toBeCloseTo(-0.4, 9)
    expect(devicePixelSnapOffset(10.4, 0, Number.NaN).x).toBeCloseTo(-0.4, 9)
  })
})
