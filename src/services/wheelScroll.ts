// 滚轮滚动状态机：纵向到边翻页 + Shift+滚轮横向优先、到边转纵向
// 对应设计文档《适宽滚轮滚动与边缘翻页设计方案》§4.2、§4.5
// 纯逻辑模块：不访问 DOM，几何与时间均由调用方传入，便于注入假时钟单测

/** 滚轮事件间隔超过该值视为新手势（ms） */
export const GESTURE_GAP_MS = 200

/** 贴边后累计到该越界量才翻页（CSS px） */
export const EDGE_TURN_THRESHOLD_PX = 80

/** 纵向滚动状态：一次连续手势内有效 */
export interface WheelScrollState {
  /** 当前手势内累计的越界滚动量（CSS px，≥0） */
  edgeAccum: number
  /** 当前手势已触发过翻页：剩余事件全部吞掉 */
  turnedInGesture: boolean
  /** 上一次滚轮事件时间（performance.now） */
  lastEventAt: number
  /** 上一次滚动方向：1=向下 / -1=向上 / 0=无 */
  lastDir: -1 | 0 | 1
}

export interface WheelStepInput {
  /** 已归一化为 CSS 像素 */
  deltaY: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  now: number
}

export interface WheelStepResult {
  /** 调用方写回 pageArea.scrollTop */
  scrollTop: number
  /** 需要翻页时非 null */
  turn: 'next' | 'prev' | null
  /** 滚动模式下恒为 true，调用方据此 preventDefault */
  consumed: boolean
  state: WheelScrollState
}

/**
 * 将滚轮增量统一换算为 CSS 像素。
 * 鼠标滚轮常见 deltaMode 为 0（像素）；部分平台/设备按行或按页上报。
 * 纵向分量为 0 时兜底取横向分量：Shift+滚轮在部分设备上只给 deltaX。
 */
export function normalizeWheelDelta(e: WheelEvent, viewportHeight: number): number {
  const raw = e.deltaY !== 0 ? e.deltaY : e.deltaX
  switch (e.deltaMode) {
    case 1:
      return raw * 16 // DOM_DELTA_LINE：按一行约 16px
    case 2:
      return raw * viewportHeight // DOM_DELTA_PAGE：按一页 = 视口高
    default:
      return raw // DOM_DELTA_PIXEL
  }
}

/**
 * 纵向滚动一步：滚动、贴边累计、翻页。
 * 只在「事件发生前已经贴边」时累计，避免快速甩到边缘的那次事件直接翻页。
 * @param state 上一次事件后的手势状态
 * @param input 已归一化的滚轮增量与当前滚动几何
 * @param thresholdPx 翻页阈值（默认 80px，单测可注入）
 */
export function stepWheelScroll(
  state: WheelScrollState,
  input: WheelStepInput,
  thresholdPx = EDGE_TURN_THRESHOLD_PX
): WheelStepResult {
  if (input.deltaY === 0) {
    return { scrollTop: input.scrollTop, turn: null, consumed: true, state }
  }

  const max = Math.max(0, input.scrollHeight - input.clientHeight)
  const dir: 1 | -1 = input.deltaY > 0 ? 1 : -1
  const newGesture = input.now - state.lastEventAt > GESTURE_GAP_MS

  const next: WheelScrollState = newGesture
    ? { edgeAccum: 0, turnedInGesture: false, lastEventAt: input.now, lastDir: 0 }
    : { ...state, lastEventAt: input.now }

  if (next.lastDir !== 0 && next.lastDir !== dir) next.edgeAccum = 0
  next.lastDir = dir

  // 同一手势已翻过页：吞掉剩余事件，防止惯性滚走新页
  if (next.turnedInGesture) {
    return { scrollTop: clamp(input.scrollTop, 0, max), turn: null, consumed: true, state: next }
  }

  const raw = input.scrollTop + input.deltaY
  const clamped = clamp(raw, 0, max)
  const atEdge = dir === 1 ? input.scrollTop >= max - 0.5 : input.scrollTop <= 0.5

  if (!atEdge) {
    return { scrollTop: clamped, turn: null, consumed: true, state: { ...next, edgeAccum: 0 } }
  }

  const accum = next.edgeAccum + Math.abs(raw - clamped)
  if (accum < thresholdPx) {
    return { scrollTop: clamped, turn: null, consumed: true, state: { ...next, edgeAccum: accum } }
  }

  return {
    scrollTop: clamped,
    turn: dir === 1 ? 'next' : 'prev',
    consumed: true,
    state: { ...next, edgeAccum: 0, turnedInGesture: true },
  }
}

export interface ShiftWheelInput {
  /** 已归一化的滚轮量（>0 向右/下，<0 向左/上） */
  delta: number
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  /** 纵向回退所需几何 */
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  now: number
}

export interface ShiftWheelResult {
  scrollLeft: number
  scrollTop: number
  turn: 'next' | 'prev' | null
  consumed: boolean
  state: WheelScrollState
}

/**
 * Shift+滚轮一步：横向优先，贴边后整量转纵向并复用纵向状态机。
 * 横向无溢出时直接回退为普通纵向逻辑；跨边事件只做横向夹取，
 * 下一次事件开始时已贴边才转为纵向，避免一次事件中途变向造成画面跳变。
 */
export function stepShiftWheelScroll(
  state: WheelScrollState,
  input: ShiftWheelInput
): ShiftWheelResult {
  const maxX = Math.max(0, input.scrollWidth - input.clientWidth)

  // 横向无溢出：Shift 回退为普通纵向逻辑
  if (maxX <= 1) {
    const r = stepWheelScroll(state, {
      deltaY: input.delta,
      scrollTop: input.scrollTop,
      scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight,
      now: input.now,
    })
    return {
      scrollLeft: input.scrollLeft,
      scrollTop: r.scrollTop,
      turn: r.turn,
      consumed: r.consumed,
      state: r.state,
    }
  }

  // 只在事件开始前已贴边时才转纵向：跨边的那次事件只做横向
  const atRight = input.scrollLeft >= maxX - 0.5
  const atLeft = input.scrollLeft <= 0.5
  const toVertical = input.delta > 0 ? atRight : atLeft
  if (!toVertical) {
    return {
      scrollLeft: clamp(input.scrollLeft + input.delta, 0, maxX),
      scrollTop: input.scrollTop,
      turn: null,
      consumed: true,
      state, // 横向纯移动不写入纵向手势状态
    }
  }

  // 已贴边：整个增量转为纵向（右缘向下 / 左缘向上）
  const r = stepWheelScroll(state, {
    deltaY: input.delta,
    scrollTop: input.scrollTop,
    scrollHeight: input.scrollHeight,
    clientHeight: input.clientHeight,
    now: input.now,
  })
  return {
    scrollLeft: input.scrollLeft,
    scrollTop: r.scrollTop,
    turn: r.turn,
    consumed: r.consumed,
    state: r.state,
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
