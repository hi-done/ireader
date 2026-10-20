import { describe, expect, it } from 'vitest'
import {
  clampMenuLeft,
  initialActiveIndex,
  moveActiveIndex,
  resolveMenuPlacement,
  type SelectOption,
} from './selectMenu'

const options: SelectOption[] = [
  { value: 'single', label: '单页' },
  { value: 'double', label: '双页' },
  { value: 'triple', label: '三页' },
]

describe('initialActiveIndex - 展开时的高亮初始位置', () => {
  it('命中当前值时返回其下标', () => {
    expect(initialActiveIndex(options, 'double')).toBe(1)
    expect(initialActiveIndex(options, 'triple')).toBe(2)
  })

  it('值不在列表中时回退首项', () => {
    expect(initialActiveIndex(options, 'missing')).toBe(0)
  })

  it('空列表返回 -1', () => {
    expect(initialActiveIndex([], 'single')).toBe(-1)
  })

  it('数值档位（阅读页缩放 / 字号）按值匹配，档位外回退首项', () => {
    const zoomOptions: SelectOption<number>[] = [
      { value: 75, label: '75%' },
      { value: 100, label: '100%' },
      { value: 125, label: '125%' },
    ]
    expect(initialActiveIndex(zoomOptions, 125)).toBe(2)
    // Ctrl+滚轮可调出档位外的自定义值，此时高亮首项
    expect(initialActiveIndex(zoomOptions, 115)).toBe(0)
  })
})

describe('moveActiveIndex - 循环移动高亮', () => {
  it('向下移动到下一项', () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1)
  })

  it('末项向下回绕到首项', () => {
    expect(moveActiveIndex(2, 1, 3)).toBe(0)
  })

  it('首项向上回绕到末项', () => {
    expect(moveActiveIndex(0, -1, 3)).toBe(2)
  })

  it('无高亮时向下取首项、向上取末项', () => {
    expect(moveActiveIndex(-1, 1, 3)).toBe(0)
    expect(moveActiveIndex(-1, -1, 3)).toBe(2)
  })

  it('空列表返回 -1', () => {
    expect(moveActiveIndex(0, 1, 0)).toBe(-1)
    expect(moveActiveIndex(-1, -1, 0)).toBe(-1)
  })
})

describe('resolveMenuPlacement - 弹层纵向翻转', () => {
  it('下方空间充足时向下展开', () => {
    expect(
      resolveMenuPlacement({
        triggerTop: 200,
        triggerBottom: 232,
        menuHeight: 100,
        viewportHeight: 800,
      })
    ).toBe('below')
  })

  it('下方不足、上方充足时向上展开', () => {
    expect(
      resolveMenuPlacement({
        triggerTop: 700,
        triggerBottom: 760,
        menuHeight: 200,
        viewportHeight: 800,
      })
    ).toBe('above')
  })

  it('上下均不足时取空间较大的一侧', () => {
    expect(
      resolveMenuPlacement({
        triggerTop: 400,
        triggerBottom: 500,
        menuHeight: 300,
        viewportHeight: 600,
      })
    ).toBe('above')
  })

  it('上下空间相等时保持向下', () => {
    expect(
      resolveMenuPlacement({
        triggerTop: 300,
        triggerBottom: 500,
        menuHeight: 400,
        viewportHeight: 800,
      })
    ).toBe('below')
  })
})

describe('clampMenuLeft - 弹层横向收敛', () => {
  it('左越界时收敛到安全边距', () => {
    expect(clampMenuLeft(-20, 160, 800)).toBe(8)
  })

  it('右越界时收敛到视口右侧安全边距', () => {
    expect(clampMenuLeft(700, 160, 800)).toBe(632)
  })

  it('在安全范围内保持原坐标', () => {
    expect(clampMenuLeft(300, 160, 800)).toBe(300)
  })

  it('弹层宽于视口时取左边距兜底', () => {
    expect(clampMenuLeft(100, 900, 800)).toBe(8)
  })
})
