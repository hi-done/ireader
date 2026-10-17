import { describe, expect, it } from 'vitest'
import {
  GESTURE_GAP_MS,
  normalizeWheelDelta,
  stepShiftWheelScroll,
  stepWheelScroll,
  type ShiftWheelInput,
  type WheelScrollState,
  type WheelStepInput,
} from './wheelScroll'

/** 测试用初始状态：无累计、未翻页，lastEventAt=0 保证首次事件按新手势处理 */
function idleState(): WheelScrollState {
  return { edgeAccum: 0, turnedInGesture: false, lastEventAt: 0, lastDir: 0 }
}

/** 纵向输入默认值：内容高 1000、视口 400，可滚动范围 0–600 */
function vInput(partial: Partial<WheelStepInput> = {}): WheelStepInput {
  return { deltaY: 0, scrollTop: 0, scrollHeight: 1000, clientHeight: 400, now: 1000, ...partial }
}

/** Shift 输入默认值：横向可滚动范围 0–1000 */
function sInput(partial: Partial<ShiftWheelInput> = {}): ShiftWheelInput {
  return {
    delta: 0,
    scrollLeft: 0,
    scrollWidth: 2000,
    clientWidth: 1000,
    scrollTop: 100,
    scrollHeight: 1000,
    clientHeight: 400,
    now: 1000,
    ...partial,
  }
}

describe('normalizeWheelDelta - 增量换算', () => {
  it('像素模式原样返回', () => {
    const e = { deltaY: 120, deltaX: 0, deltaMode: 0 } as WheelEvent
    expect(normalizeWheelDelta(e, 800)).toBe(120)
  })

  it('行模式按 16px/行换算', () => {
    const e = { deltaY: 3, deltaX: 0, deltaMode: 1 } as WheelEvent
    expect(normalizeWheelDelta(e, 800)).toBe(48)
  })

  it('页模式按视口高换算', () => {
    const e = { deltaY: 2, deltaX: 0, deltaMode: 2 } as WheelEvent
    expect(normalizeWheelDelta(e, 800)).toBe(1600)
  })

  it('纵向分量为 0 时兜底取横向分量', () => {
    const e = { deltaY: 0, deltaX: 100, deltaMode: 0 } as WheelEvent
    expect(normalizeWheelDelta(e, 800)).toBe(100)
  })
})

describe('stepWheelScroll - 页面中间滚动', () => {
  it('向下滚只移动 scrollTop，不翻页', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 100, scrollTop: 100 }))
    expect(r.scrollTop).toBe(200)
    expect(r.turn).toBeNull()
    expect(r.consumed).toBe(true)
    expect(r.state.edgeAccum).toBe(0)
  })

  it('向上滚只移动 scrollTop，不翻页', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: -50, scrollTop: 100 }))
    expect(r.scrollTop).toBe(50)
    expect(r.turn).toBeNull()
  })

  it('离开边缘时清空越界累计', () => {
    const state: WheelScrollState = {
      edgeAccum: 40,
      turnedInGesture: false,
      lastEventAt: 950,
      lastDir: 1,
    }
    const r = stepWheelScroll(state, vInput({ deltaY: 50, scrollTop: 100 }))
    expect(r.state.edgeAccum).toBe(0)
    expect(r.turn).toBeNull()
  })
})

describe('stepWheelScroll - 贴边累计与翻页', () => {
  it('已在底部继续向下、未达阈值：停在 max 并累计', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 30, scrollTop: 600 }))
    expect(r.scrollTop).toBe(600)
    expect(r.turn).toBeNull()
    expect(r.state.edgeAccum).toBe(30)
  })

  it('同一手势累计达到 80px 触发下一页', () => {
    const first = stepWheelScroll(idleState(), vInput({ deltaY: 50, scrollTop: 600 }))
    expect(first.turn).toBeNull()
    const second = stepWheelScroll(first.state, vInput({ deltaY: 30, scrollTop: 600, now: 1050 }))
    expect(second.turn).toBe('next')
    expect(second.state.edgeAccum).toBe(0)
    expect(second.state.turnedInGesture).toBe(true)
  })

  it('已在底部继续向下、达到 80px 触发下一页', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 80, scrollTop: 600 }))
    expect(r.turn).toBe('next')
  })

  it('已在顶部继续向上、达到 80px 触发上一页', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: -80, scrollTop: 0 }))
    expect(r.turn).toBe('prev')
  })

  it('已在底部向上滚：正常滚动、累计清零', () => {
    const state: WheelScrollState = {
      edgeAccum: 50,
      turnedInGesture: false,
      lastEventAt: 950,
      lastDir: 1,
    }
    const r = stepWheelScroll(state, vInput({ deltaY: -100, scrollTop: 600 }))
    expect(r.scrollTop).toBe(500)
    expect(r.turn).toBeNull()
    expect(r.state.edgeAccum).toBe(0)
  })

  it('已在顶部向下滚：正常滚动、不累计', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 100, scrollTop: 0 }))
    expect(r.scrollTop).toBe(100)
    expect(r.turn).toBeNull()
  })
})

describe('stepWheelScroll - 手势与边界', () => {
  it('同手势翻页后继续滚：不滚动不翻页', () => {
    const state: WheelScrollState = {
      edgeAccum: 0,
      turnedInGesture: true,
      lastEventAt: 950,
      lastDir: 1,
    }
    const r = stepWheelScroll(state, vInput({ deltaY: 100, scrollTop: 0 }))
    expect(r.scrollTop).toBe(0)
    expect(r.turn).toBeNull()
    expect(r.consumed).toBe(true)
  })

  it('间隔超过 200ms 视为新手势，可再次累计/翻页', () => {
    const state: WheelScrollState = {
      edgeAccum: 0,
      turnedInGesture: true,
      lastEventAt: 1000 - GESTURE_GAP_MS - 1,
      lastDir: 1,
    }
    const first = stepWheelScroll(state, vInput({ deltaY: 30, scrollTop: 600 }))
    expect(first.state.turnedInGesture).toBe(false)
    expect(first.turn).toBeNull()

    const second = stepWheelScroll(first.state, vInput({ deltaY: 50, scrollTop: 600, now: 1050 }))
    expect(second.turn).toBe('next')
  })

  it('方向反转时清空累计', () => {
    const state: WheelScrollState = {
      edgeAccum: 50,
      turnedInGesture: false,
      lastEventAt: 950,
      lastDir: 1,
    }
    const r = stepWheelScroll(state, vInput({ deltaY: -100, scrollTop: 600 }))
    expect(r.state.edgeAccum).toBe(0)
    expect(r.turn).toBeNull()
  })

  it('一次快速滚动从中间冲到底：本次不翻页，下一次贴边才累计', () => {
    const first = stepWheelScroll(idleState(), vInput({ deltaY: 300, scrollTop: 500 }))
    expect(first.scrollTop).toBe(600)
    expect(first.turn).toBeNull()
    expect(first.state.edgeAccum).toBe(0)

    const second = stepWheelScroll(first.state, vInput({ deltaY: 80, scrollTop: 600, now: 1050 }))
    expect(second.turn).toBe('next')
  })

  it('接近底部但未贴边：不累计越界量', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 10, scrollTop: 599.4 }))
    expect(r.scrollTop).toBe(600)
    expect(r.state.edgeAccum).toBe(0)
    expect(r.turn).toBeNull()
  })

  it('分数位置贴边判定稳定，clamp 不越界', () => {
    const r = stepWheelScroll(idleState(), vInput({ deltaY: 10, scrollTop: 599.5 }))
    expect(r.scrollTop).toBe(600)
    expect(r.state.edgeAccum).toBeCloseTo(9.5)
    expect(r.turn).toBeNull()
  })
})

describe('stepShiftWheelScroll - 横向优先', () => {
  it('未到右边：向右移动 scrollLeft，不改纵向位置', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: 100, scrollLeft: 200 }))
    expect(r.scrollLeft).toBe(300)
    expect(r.scrollTop).toBe(100)
    expect(r.turn).toBeNull()
    expect(r.consumed).toBe(true)
  })

  it('未到左边：向左移动 scrollLeft', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: -100, scrollLeft: 500 }))
    expect(r.scrollLeft).toBe(400)
    expect(r.turn).toBeNull()
  })

  it('横向移动不写入纵向手势状态', () => {
    const state: WheelScrollState = {
      edgeAccum: 40,
      turnedInGesture: false,
      lastEventAt: 950,
      lastDir: 1,
    }
    const r = stepShiftWheelScroll(state, sInput({ delta: 100, scrollLeft: 200 }))
    expect(r.state).toEqual(state)
  })

  it('跨边事件只做横向夹取，不转纵向', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: 100, scrollLeft: 950 }))
    expect(r.scrollLeft).toBe(1000)
    expect(r.scrollTop).toBe(100)
    expect(r.turn).toBeNull()
  })

  it('已在右缘向上：仍为横向移动，不转纵向', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: -100, scrollLeft: 1000 }))
    expect(r.scrollLeft).toBe(900)
    expect(r.scrollTop).toBe(100)
    expect(r.turn).toBeNull()
  })
})

describe('stepShiftWheelScroll - 到边转纵向', () => {
  it('右缘继续向下：转为向下移动', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: 100, scrollLeft: 1000 }))
    expect(r.scrollLeft).toBe(1000)
    expect(r.scrollTop).toBe(200)
    expect(r.turn).toBeNull()
  })

  it('左缘继续向上：转为向上移动', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: -100, scrollLeft: 0, scrollTop: 300 }))
    expect(r.scrollLeft).toBe(0)
    expect(r.scrollTop).toBe(200)
    expect(r.turn).toBeNull()
  })

  it('跨边后下一次事件才转纵向', () => {
    const first = stepShiftWheelScroll(idleState(), sInput({ delta: 100, scrollLeft: 950 }))
    expect(first.scrollTop).toBe(100)
    const second = stepShiftWheelScroll(first.state, sInput({ delta: 100, scrollLeft: 1000, now: 1050 }))
    expect(second.scrollTop).toBe(200)
  })

  it('右缘向下到纵向底部后继续滚触发下一页', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: 80, scrollLeft: 1000, scrollTop: 600 }))
    expect(r.turn).toBe('next')
    expect(r.state.turnedInGesture).toBe(true)
  })

  it('左缘向上到纵向顶部后继续滚触发上一页', () => {
    const r = stepShiftWheelScroll(idleState(), sInput({ delta: -80, scrollLeft: 0, scrollTop: 0 }))
    expect(r.turn).toBe('prev')
  })

  it('横向无溢出：回退为普通纵向滚动', () => {
    const r = stepShiftWheelScroll(
      idleState(),
      sInput({ delta: 100, scrollLeft: 0, scrollWidth: 1000, scrollTop: 100 })
    )
    expect(r.scrollLeft).toBe(0)
    expect(r.scrollTop).toBe(200)
    expect(r.turn).toBeNull()
  })

  it('横向无溢出且纵向到底：回退后仍可翻页', () => {
    const r = stepShiftWheelScroll(
      idleState(),
      sInput({ delta: 80, scrollLeft: 0, scrollWidth: 1000, scrollTop: 600 })
    )
    expect(r.turn).toBe('next')
  })
})
