// aiTranslation 纯逻辑单测：归一化矩形、缩放/拖动的位置夹取、字号换算、百分比样式
// 对应设计文档《20261102-AI框选翻译功能设计方案》§11.1

import { describe, expect, it } from 'vitest'
import {
  computeFontPx,
  moveRect,
  normalizeRect,
  resizeRect,
  toPercentStyle,
  DEFAULT_FONT_RATIO,
} from './aiTranslation'

const PAGE = { width: 200, height: 100 }

describe('normalizeRect', () => {
  it('普通矩形归一化为页内比例', () => {
    expect(normalizeRect({ x: 20, y: 10, w: 50, h: 40 }, PAGE)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.25,
      h: 0.4,
    })
  })

  it('小于最小框选尺寸视为误触', () => {
    expect(normalizeRect({ x: 0, y: 0, w: 20, h: 12 }, PAGE)).toBeNull()
    expect(normalizeRect({ x: 10, y: 10, w: 24, h: 15 }, PAGE)).toBeNull()
  })

  it('反向拖拽（负宽高）取左上角为正', () => {
    expect(normalizeRect({ x: 70, y: 50, w: -50, h: -40 }, PAGE)).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.25,
      h: 0.4,
    })
  })

  it('拖到页外时夹取到 [0,1] 且宽高为正', () => {
    const rect = normalizeRect({ x: -30, y: -20, w: 320, h: 200 }, PAGE)
    expect(rect).not.toBeNull()
    const got = rect as NonNullable<typeof rect>
    expect(got).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('页盒尺寸非法返回 null', () => {
    expect(normalizeRect({ x: 0, y: 0, w: 50, h: 40 }, { width: 0, height: 0 })).toBeNull()
    expect(
      normalizeRect({ x: Number.NaN, y: 0, w: 50, h: 40 }, PAGE)
    ).toBeNull()
  })
})

describe('toPercentStyle', () => {
  it('四个键齐全且为百分比', () => {
    expect(toPercentStyle({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({
      left: '10%',
      top: '20%',
      width: '30%',
      height: '40%',
    })
  })
})

describe('resizeRect', () => {
  it('按像素位移等比换算并夹取到页内', () => {
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    // dx=+20 → +0.1 宽；dy=+10 → +0.1 高
    const got = resizeRect(rect, { dx: 20, dy: 10 }, PAGE)
    expect(got.x).toBe(0.1)
    expect(got.y).toBe(0.1)
    expect(got.w).toBeCloseTo(0.3)
    expect(got.h).toBeCloseTo(0.3)
  })

  it('目标超出页边界时右下边夹取到页内', () => {
    const rect = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
    const got = resizeRect(rect, { dx: 500, dy: 500 }, PAGE)
    expect(got.x).toBe(0.5)
    expect(got.y).toBe(0.5)
    expect(got.w).toBeCloseTo(0.5)
    expect(got.h).toBeCloseTo(0.5)
  })

  it('缩小到下限时保留最小尺寸（40×28px）', () => {
    const rect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }
    const got = resizeRect(rect, { dx: -1000, dy: -1000 }, PAGE)
    expect(got.w).toBeCloseTo(40 / PAGE.width)
    expect(got.h).toBeCloseTo(28 / PAGE.height)
  })

  it('页盒尺寸非法时原样返回', () => {
    const rect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }
    expect(resizeRect(rect, { dx: 10, dy: 10 }, { width: 0, height: 0 })).toEqual(rect)
  })
})

describe('moveRect', () => {
  it('按像素位移换算位置，宽高不变', () => {
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }
    // dx=+20 → +0.1；dy=+10 → +0.1
    const got = moveRect(rect, { dx: 20, dy: 10 }, PAGE)
    expect(got.x).toBeCloseTo(0.2)
    expect(got.y).toBeCloseTo(0.2)
    expect(got.w).toBe(0.2)
    expect(got.h).toBe(0.3)
  })

  it('右下越界时左上角夹取到 1-w / 1-h，宽高不变', () => {
    const rect = { x: 0.5, y: 0.5, w: 0.3, h: 0.2 }
    const got = moveRect(rect, { dx: 500, dy: 500 }, PAGE)
    expect(got.x).toBeCloseTo(0.7)
    expect(got.y).toBeCloseTo(0.8)
    expect(got.w).toBe(0.3)
    expect(got.h).toBe(0.2)
  })

  it('左上越界时夹到 0', () => {
    const rect = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 }
    const got = moveRect(rect, { dx: -1000, dy: -1000 }, PAGE)
    expect(got.x).toBe(0)
    expect(got.y).toBe(0)
    expect(got.w).toBe(0.2)
    expect(got.h).toBe(0.2)
  })

  it('通栏框在该轴不可移动', () => {
    const rect = { x: 0, y: 0.2, w: 1, h: 0.2 }
    const got = moveRect(rect, { dx: 60, dy: 10 }, PAGE)
    expect(got.x).toBe(0)
    expect(got.y).toBeCloseTo(0.3)
  })

  it('页盒尺寸非法时原样返回', () => {
    const rect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }
    expect(moveRect(rect, { dx: 10, dy: 10 }, { width: 0, height: 0 })).toEqual(rect)
  })
})

describe('computeFontPx', () => {
  it('页高 × 比例', () => {
    expect(computeFontPx(0.06, 800)).toBe(48)
  })

  it('比例先归一到 0.02~0.15，再换算像素并钳制到 [10, 96]', () => {
    // 0.001 → 比例下限 0.02 → 0.02 × 800 = 16
    expect(computeFontPx(0.001, 800)).toBe(16)
    // 0.9 → 比例上限 0.15 → 0.15 × 800 = 120 → 像素上限 96
    expect(computeFontPx(0.9, 800)).toBe(96)
    // 0.06 × 100 = 6 → 像素下限 10（极小页盒仍可读）
    expect(computeFontPx(0.06, 100)).toBe(10)
  })

  it('非法比例回退默认比例', () => {
    expect(computeFontPx(Number.NaN, 800)).toBe(Math.round(DEFAULT_FONT_RATIO * 800))
    expect(computeFontPx(Number.NaN, 1000)).toBe(Math.round(DEFAULT_FONT_RATIO * 1000))
  })

  it('页高非法时给出可读下限', () => {
    expect(computeFontPx(0.06, 0)).toBe(10)
    expect(computeFontPx(0.06, Number.NaN)).toBe(10)
  })
})
