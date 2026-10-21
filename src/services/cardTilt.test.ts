import { describe, expect, it } from 'vitest'
import { computeCardTilt } from './cardTilt'

// 160×220 的卡片，左上角在视口 (100, 200)
const RECT = { left: 100, top: 200, width: 160, height: 220 }

describe('computeCardTilt - 相对位置映射', () => {
  it('卡片正中：无倾角、高光居中', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 180, clientY: 310 })
    expect(tilt.rotateX).toBe(0)
    expect(tilt.rotateY).toBe(0)
    expect(tilt.glareX).toBe(50)
    expect(tilt.glareY).toBe(50)
    expect(tilt.inside).toBe(true)
  })

  it('左上角：上仰且左侧后仰', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 100, clientY: 200 })
    expect(tilt.rotateX).toBe(6)
    expect(tilt.rotateY).toBe(-6)
    expect(tilt.glareX).toBe(0)
    expect(tilt.glareY).toBe(0)
  })

  it('右下角：下俯且右侧后仰', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 260, clientY: 420 })
    expect(tilt.rotateX).toBe(-6)
    expect(tilt.rotateY).toBe(6)
    expect(tilt.glareX).toBe(100)
    expect(tilt.glareY).toBe(100)
  })

  it('右边缘中点：只产生 Y 轴倾角', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 260, clientY: 310 })
    expect(tilt.rotateY).toBe(6)
    expect(tilt.rotateX).toBe(0)
  })
})

describe('computeCardTilt - 边界与参数', () => {
  it('越界坐标钳制到边缘并标记 inside=false', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 50, clientY: 310 })
    expect(tilt.rotateY).toBe(-6)
    expect(tilt.glareX).toBe(0)
    expect(tilt.inside).toBe(false)
  })

  it('自定义最大倾角', () => {
    const tilt = computeCardTilt({ ...RECT, clientX: 100, clientY: 200 }, 10)
    expect(tilt.rotateX).toBe(10)
    expect(tilt.rotateY).toBe(-10)
  })

  it('宽或高为 0：返回零值且 inside=false', () => {
    const tilt = computeCardTilt({ left: 0, top: 0, width: 0, height: 100, clientX: 0, clientY: 0 })
    expect(tilt).toEqual({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50, inside: false })
  })

  it('绝对坐标偏移不影响相对比例', () => {
    const a = computeCardTilt({ left: 0, top: 0, width: 100, height: 100, clientX: 25, clientY: 75 })
    const b = computeCardTilt({
      left: 500,
      top: 600,
      width: 100,
      height: 100,
      clientX: 525,
      clientY: 675,
    })
    expect(a).toEqual(b)
  })
})
