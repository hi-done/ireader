// 阅读页渲染几何单点：等比目标盒、像素对齐、容器实测尺寸、dpr 变化监听、合成层重建
// 对应设计文档 specs/20261116-阅读界面非全屏清晰度修复设计方案.md §4.2 与 §7.1
// PDF（pdf.ts）与图片型（imagePage.ts）共用同一口径——禁止各自再算一遍（口径分叉会导致只修好一半格式）

/** 等比缩放目标：语义与 pdf.js RenderPageOptions 的 targetWidth / targetHeight 一致 */
export interface RenderTarget {
  targetWidth?: number
  targetHeight?: number
}

/** 目标盒：pixel 为整数后备像素；css 由 pixel / dpr 反推，保证 pixel/css/dpr 恒为 1 */
export interface RenderBox {
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
}

/**
 * 清晰度修复开关（二分定位用）：每项对应设计方案里的一条修复杠杆。
 * DEV 下可用地址栏 `?fix=0000`（顺序同字段）逐项关闭，用于确认哪一项真正消除发虚。
 */
export interface SharpnessFixFlags {
  /** 渲染目标改用容器实测尺寸（而非 window.innerWidth/innerHeight） */
  containerSize: boolean
  /** 先定整数后备像素再反推 CSS（否则比例只近似等于 dpr） */
  pixelAlign: boolean
  /** 全屏切换后重渲 + 请主进程复位页面缩放 */
  fullscreenRepaint: boolean
  /** 重渲前强制重建合成层（丢弃全屏尺寸的旧栅格） */
  layerRebuild: boolean
}

export const SHARPNESS_FIX: SharpnessFixFlags = resolveFixFlags()

/** DEV 下读 `?fix=<4 位 0/1>` 覆盖开关；正式构建恒为全开（不解析地址栏，零开销） */
function resolveFixFlags(): SharpnessFixFlags {
  const flags: SharpnessFixFlags = {
    containerSize: true,
    pixelAlign: true,
    fullscreenRepaint: true,
    layerRebuild: true,
  }
  if (import.meta.env?.DEV !== true) return flags
  // 单测跑在 node 环境（无 window）：直接返回全开
  if (typeof window === 'undefined') return flags
  // 路由是 hash 模式：查询串在 #/reader/1?fix=0000 里，不在 location.search 上
  const query = window.location.hash.split('?')[1] ?? ''
  const raw = new URLSearchParams(query).get('fix')
  if (!raw || raw.length !== 4) return flags
  return {
    containerSize: raw[0] !== '0',
    pixelAlign: raw[1] !== '0',
    fullscreenRepaint: raw[2] !== '0',
    layerRebuild: raw[3] !== '0',
  }
}

/** 目标 CSS 盒：适宽精确等于 targetWidth、适高精确等于 targetHeight，缺省 1:1（original 档） */
export function fitCssSize(
  naturalWidth: number,
  naturalHeight: number,
  target: RenderTarget
): { width: number; height: number } {
  let scale = 1
  if (target.targetWidth) scale = target.targetWidth / naturalWidth
  else if (target.targetHeight) scale = target.targetHeight / naturalHeight
  return { width: naturalWidth * scale, height: naturalHeight * scale }
}

/**
 * 像素对齐：以整数后备像素为基准，再反推 CSS 尺寸。
 * 反向推导（先定 CSS 再乘 dpr 取整）必然留下 ≤1px 的取整误差，
 * 显示时浏览器会把整张位图重采样 → 全局轻微发虚；正向推导可让比例严格等于 dpr。
 */
export function fitRenderBox(
  naturalWidth: number,
  naturalHeight: number,
  target: RenderTarget,
  dpr: number
): RenderBox {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const css = fitCssSize(naturalWidth, naturalHeight, target)
  const pixelWidth = Math.max(1, Math.round(css.width * d))
  const pixelHeight = Math.max(1, Math.round(css.height * d))
  return {
    pixelWidth,
    pixelHeight,
    cssWidth: pixelWidth / d,
    cssHeight: pixelHeight / d,
  }
}

/**
 * 渲染目标尺寸：取容器实测尺寸（整数），容器尚未布局时回退窗口视口。
 * 用容器而非 window.inner*：二者是两个尺寸真相，全屏切换的瞬间必然错位。
 */
export function renderTargetSize(el: HTMLElement | null | undefined): {
  width: number
  height: number
} {
  const fallbackWidth = typeof window === 'undefined' ? 1 : window.innerWidth
  const fallbackHeight = typeof window === 'undefined' ? 1 : window.innerHeight
  const width = el?.clientWidth || fallbackWidth
  const height = el?.clientHeight || fallbackHeight
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) }
}

/** 当前 dpr（非法值按 1 处理） */
export function currentDpr(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1
}

/**
 * 把显示起点吸附到整设备像素所需的平移量（CSS px，带符号）。
 * 注意：此函数仅用于诊断读数（sharpnessProbe 的 `align=` 行）。
 * 实测证明 Chromium 对 canvas 显示原点已做设备像素对齐，强行用 transform 补偿反而会把层推离
 * 整像素网格并触发双线性插值，因此不再作为修复手段使用。
 */
export function devicePixelSnapOffset(
  left: number,
  top: number,
  dpr: number
): { x: number; y: number } {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return {
    x: Math.round(left * d) / d - left,
    y: Math.round(top * d) / d - top,
  }
}

/** dpr 缓存键：两位小数，避免浮点表示差异把同一显示比例算成两个签名 */
export function dprKey(dpr = currentDpr()): string {
  return (Math.round(dpr * 100) / 100).toString()
}

/**
 * 监听 devicePixelRatio 变化（换显示器、改系统缩放）。
 * 不能用 resize 代替：只改缩放、窗口尺寸不变时 resize 不保证触发。
 * 变化后可连续发生（拖到另一块屏），因此每次都按新 dpr 重新挂载一次性监听。
 */
export function watchDevicePixelRatio(onChange: (dpr: number) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }
  let mql: MediaQueryList | null = null
  let disposed = false

  const unbind = (): void => {
    mql?.removeEventListener('change', handleChange)
    mql = null
  }

  const bind = (): void => {
    if (disposed) return
    mql = window.matchMedia(`(resolution: ${currentDpr()}dppx)`)
    mql.addEventListener('change', handleChange, { once: true })
  }

  function handleChange(): void {
    if (disposed) return
    unbind()
    onChange(currentDpr())
    bind() // 换成新 dpr 的媒体查询继续监听
  }

  bind()
  return () => {
    disposed = true
    unbind()
  }
}

/**
 * 强制重建合成层：一帧内挂上 translateZ(0) 与 will-change，再撤掉。
 * 用于全屏切换后仍发虚的情形——此时布局与位图尺寸都正确，是 Chromium 保留了旧尺寸的栅格，
 * 只有让该层重新栅格化才能取到新尺寸的像素。
 */
export function forceRepaint(el: HTMLElement | null | undefined): void {
  if (!el) return
  el.style.willChange = 'transform'
  el.style.transform = 'translateZ(0)'
  // 等两帧再撤：一帧只够提交样式，栅格化发生在下一帧的绘制阶段
  void doubleRaf().then(() => {
    el.style.willChange = ''
    el.style.transform = ''
  })
}

function doubleRaf(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
