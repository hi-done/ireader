// 文库卡片 3D 倾斜跟随：指针位置 → 倾角与高光中心（纯函数）+ 指针生命周期接线（DOM）
// 对应设计文档 specs/图书卡片交互与图标苹果风美化设计方案-20261021.md §4

export interface CardTiltRect {
  /** 卡片矩形左边界（视口坐标） */
  left: number
  /** 卡片矩形上边界（视口坐标） */
  top: number
  width: number
  height: number
}

export interface CardTiltInput extends CardTiltRect {
  /** 指针视口坐标 */
  clientX: number
  clientY: number
}

export interface CardTilt {
  /** 绕 X 轴旋转角（deg）：指针在卡片上半部为正（卡片上仰） */
  rotateX: number
  /** 绕 Y 轴旋转角（deg）：指针在卡片右半部为正（右侧后仰） */
  rotateY: number
  /** 高光中心横坐标（百分比 0~100） */
  glareX: number
  /** 高光中心纵坐标（百分比 0~100） */
  glareY: number
  /** 指针是否仍在卡片矩形内（越界坐标会被钳制到边缘） */
  inside: boolean
}

export interface CardTiltOptions {
  /** 最大倾角（deg），默认 6 */
  maxDeg?: number
}

export interface CardTiltHandle {
  /** 移除全部监听并取消未执行的 rAF（幂等） */
  detach(): void
}

/** 默认最大倾角：6° 在 160×230 的卡片上边缘位移约 12px，再大标题会明显发虚 */
const DEFAULT_MAX_DEG = 6

/** 把比例收敛到 0~1 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 指针位置 → 倾角与高光中心。
 * 角度是位置的线性函数，平滑交给 CSS transition（跟手 80ms），算法层不再引入滞后。
 * @param input 卡片矩形与指针视口坐标
 * @param maxDeg 最大倾角（deg），默认 6
 */
export function computeCardTilt(input: CardTiltInput, maxDeg = DEFAULT_MAX_DEG): CardTilt {
  const { left, top, width, height, clientX, clientY } = input
  // 隐藏 / 尚未布局的卡片：不倾斜，高光居中
  if (width <= 0 || height <= 0) {
    return { rotateX: 0, rotateY: 0, glareX: 50, glareY: 50, inside: false }
  }
  const rawX = (clientX - left) / width
  const rawY = (clientY - top) / height
  const inside = rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1
  const ratioX = clamp01(rawX)
  const ratioY = clamp01(rawY)
  return {
    rotateY: (ratioX * 2 - 1) * maxDeg,
    // 指针在上半部应上仰，故 Y 轴反向映射
    rotateX: (1 - ratioY * 2) * maxDeg,
    glareX: ratioX * 100,
    glareY: ratioY * 100,
    inside,
  }
}

/** 判定当前环境是否启用倾斜：减弱动效或粗指针（触屏）设备不启用 */
function shouldEnableTilt(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  // 与 StatCard / ReaderView / SelectMenu 一致：挂载时判定一次，不监听媒体变化
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

/**
 * 给卡片挂载 3D 倾斜跟随（写 CSS 变量，不触碰 Vue 响应式状态）。
 * 减弱动效 / 触屏环境下返回空句柄，卡片只保留阴影过渡。
 * @param el 卡片根元素（需同时带 .tilt-card 类以消费变量）
 * @param options 最大倾角等参数
 */
export function attachCardTilt(el: HTMLElement, options: CardTiltOptions = {}): CardTiltHandle {
  const maxDeg = options.maxDeg ?? DEFAULT_MAX_DEG
  const noop: CardTiltHandle = { detach: () => undefined }
  if (!shouldEnableTilt()) return noop

  let rect: CardTiltRect = { left: 0, top: 0, width: 0, height: 0 }
  // 布局尺寸（offsetWidth / offsetHeight）不受 transform 影响，用作「布局是否变化」的判据
  let layoutWidth = 0
  let layoutHeight = 0
  let pointerX = 0
  let pointerY = 0
  let frame = 0

  /** 重测基准矩形：rotate 会改变 getBoundingClientRect 的 left/top，故只在布局变化时调用 */
  function remeasure(): void {
    const box = el.getBoundingClientRect()
    rect = { left: box.left, top: box.top, width: box.width, height: box.height }
    layoutWidth = el.offsetWidth
    layoutHeight = el.offsetHeight
  }

  /** 写入一帧倾斜：只在指针仍在卡片内时写，越界帧交给 pointerleave 复位 */
  function applyFrame(): void {
    frame = 0
    const tilt = computeCardTilt({ ...rect, clientX: pointerX, clientY: pointerY }, maxDeg)
    if (!tilt.inside) return
    el.style.setProperty('--tilt-x', `${tilt.rotateX.toFixed(2)}deg`)
    el.style.setProperty('--tilt-y', `${tilt.rotateY.toFixed(2)}deg`)
    el.style.setProperty('--glare-x', `${tilt.glareX.toFixed(1)}%`)
    el.style.setProperty('--glare-y', `${tilt.glareY.toFixed(1)}%`)
  }

  /** 复位：取消未执行的帧，移除内联变量让样式表默认值（0deg / 50%）接管，由 CSS 缓出回正 */
  function reset(): void {
    if (frame) {
      cancelAnimationFrame(frame)
      frame = 0
    }
    el.classList.remove('is-tilting')
    el.style.removeProperty('--tilt-x')
    el.style.removeProperty('--tilt-y')
    el.style.removeProperty('--glare-x')
    el.style.removeProperty('--glare-y')
  }

  function onEnter(event: PointerEvent): void {
    // 触屏没有 hover 语义，直接忽略
    if (event.pointerType === 'touch') return
    remeasure()
    el.classList.add('is-tilting')
    // 进入即按当前指针位置算一帧，避免「进入后不动」时卡片不自正
    pointerX = event.clientX
    pointerY = event.clientY
    if (!frame) frame = requestAnimationFrame(applyFrame)
  }

  function onMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return
    pointerX = event.clientX
    pointerY = event.clientY
    // 窗口缩放 / 布局变化时刷新基准；逐帧重测会读到自身 rotate 后的矩形形成自激抖动
    if (el.offsetWidth !== layoutWidth || el.offsetHeight !== layoutHeight) remeasure()
    if (!frame) frame = requestAnimationFrame(applyFrame)
  }

  el.addEventListener('pointerenter', onEnter)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerleave', reset)
  el.addEventListener('pointercancel', reset)
  // 切走应用时复位，避免回到窗口时卡片停在倾斜态
  window.addEventListener('blur', reset)

  return {
    detach() {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', reset)
      el.removeEventListener('pointercancel', reset)
      window.removeEventListener('blur', reset)
      reset()
    },
  }
}
