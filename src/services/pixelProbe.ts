// 屏幕像素比对：把「合成后真正上屏的像素」与 canvas 后备位图逐像素对照。
// 几何不变式（sharpnessProbe）只能证明尺寸与落位合格，证明不了上屏那一步有没有被重采样；
// 这里用主进程 capturePage 的合成输出做实证，并在若干「关掉一项」的变体下重复，直接定位降质环节。
// 对应设计文档 specs/20261116-阅读界面非全屏清晰度修复设计方案.md §13.6
// 比对与结论为纯函数（可单测）；DOM / IPC 在 runPixelProbe 收口，视图只负责触发

import type { CaptureRegionRect } from '../../shared/types'
import { ipc } from './ipc'
import { currentDpr } from './renderGeometry'

/** RGBA 位图（ImageData 的最小子集，便于单测构造） */
export interface RgbaBitmap {
  width: number
  height: number
  data: ArrayLike<number>
}

export interface PixelCompareResult {
  /** 最佳对齐下的平均绝对亮度差（0–255）：≈0 即屏幕输出与位图逐像素一致 */
  mad: number
  /** 最佳对齐偏移（设备像素）：屏幕 (x, y) 对应位图 (x + dx, y + dy) */
  dx: number
  dy: number
  /** 屏幕 / 位图的边缘能量比：明显小于 1 说明上屏时被低通（插值平移或缩放） */
  edgeRatio: number
  /** 位图自身的边缘能量（每像素）：过低说明采样区域没有内容，比对无区分度 */
  detail: number
}

export interface PixelProbeEntry {
  name: string
  result: PixelCompareResult | null
  error?: string
}

/** 一种「关掉一项」的对照：apply 施加临时样式并返回还原函数 */
export interface PixelVariant {
  name: string
  apply: () => () => void
}

export type StyleOverride = [el: HTMLElement | null | undefined, prop: string, value: string]

/** 逐像素一致的判据：亮度差在编码 / 色彩管理噪声以内，且边缘能量未被削弱 */
const SAME_MAD = 1
const SAME_EDGE = 0.97
/** 位图边缘能量下限：低于它视为空白区域 */
const MIN_DETAIL = 0.5
/** 对齐搜索半径（设备像素）：吸收实际绘制位置与 getBoundingClientRect 之间的取整差 */
const MARGIN = 3

/** 转亮度；透明像素按黑底合成（阅读区背景为 #000） */
function toLuma(bitmap: RgbaBitmap): Float32Array {
  const count = bitmap.width * bitmap.height
  const out = new Float32Array(count)
  const d = bitmap.data
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    out[i] = ((0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) * d[p + 3]) / 255
  }
  return out
}

/**
 * 屏幕截图与后备位图比对（纯函数）。
 * backing 须比 screen 四周各多 margin 像素；在 ±margin 内搜索最佳整数对齐。
 * 尺寸不满足约定时返回 null。
 */
export function compareScreenToBacking(
  screen: RgbaBitmap,
  backing: RgbaBitmap,
  margin: number
): PixelCompareResult | null {
  const w = screen.width
  const h = screen.height
  const bw = backing.width
  if (w < 2 || h < 2 || margin < 0 || !Number.isInteger(margin)) return null
  if (bw !== w + margin * 2 || backing.height !== h + margin * 2) return null
  if (screen.data.length < w * h * 4 || backing.data.length < bw * backing.height * 4) return null

  const s = toLuma(screen)
  const b = toLuma(backing)
  const madAt = (dx: number, dy: number): number => {
    let sum = 0
    for (let y = 0; y < h; y++) {
      const so = y * w
      const bo = (y + margin + dy) * bw + margin + dx
      for (let x = 0; x < w; x++) sum += Math.abs(s[so + x] - b[bo + x])
    }
    return sum / (w * h)
  }

  // 先算零偏移：空白区域各偏移同分时保持 (0, 0)，不报出误导性的对齐量
  let best = { mad: madAt(0, 0), dx: 0, dy: 0 }
  for (let dy = -margin; dy <= margin; dy++) {
    for (let dx = -margin; dx <= margin; dx++) {
      if (dx === 0 && dy === 0) continue
      const mad = madAt(dx, dy)
      if (mad < best.mad - 1e-9) best = { mad, dx, dy }
    }
  }

  const edgeOf = (buf: Float32Array, stride: number, ox: number, oy: number): number => {
    let sum = 0
    for (let y = 0; y < h - 1; y++) {
      const row = (y + oy) * stride + ox
      for (let x = 0; x < w - 1; x++) {
        const v = buf[row + x]
        sum += Math.abs(buf[row + x + 1] - v) + Math.abs(buf[row + stride + x] - v)
      }
    }
    return sum / ((w - 1) * (h - 1))
  }
  const screenEdge = edgeOf(s, w, 0, 0)
  const backingEdge = edgeOf(b, bw, margin + best.dx, margin + best.dy)
  return {
    ...best,
    edgeRatio: backingEdge > 0 ? screenEdge / backingEdge : 1,
    detail: backingEdge,
  }
}

function isSame(result: PixelCompareResult): boolean {
  return result.mad < SAME_MAD && result.edgeRatio > SAME_EDGE
}

/** 比对结论的人话解释（首个条目约定为当前状态，其余为对照变体） */
export function pixelProbeNote(entries: PixelProbeEntry[]): string {
  const measured = entries.filter(
    (e): e is PixelProbeEntry & { result: PixelCompareResult } => e.result !== null
  )
  if (measured.length === 0) {
    return `像素比对未完成：${entries[0]?.error ?? '无可用变体'}`
  }
  if (measured.every((e) => e.result.detail < MIN_DETAIL)) {
    return '采样区域几乎没有内容：请翻到有正文的页面再采样'
  }
  const now = measured[0]
  if (isSame(now.result)) {
    return '屏幕输出与位图逐像素一致：上屏阶段没有重采样，发虚来自位图本身（栅格化分辨率 / 抗锯齿方式）'
  }
  const kept = `${Math.round(now.result.edgeRatio * 100)}%`
  const better = measured.slice(1).filter((e) => isSame(e.result))
  if (better.length > 0) {
    return (
      `当前上屏被重采样（边缘保留 ${kept}），` +
      `变体 ${better.map((e) => e.name).join(' / ')} 下逐像素一致：降质来自这些变体关掉的那一项`
    )
  }
  return `所有变体下上屏都被重采样（当前边缘保留 ${kept}）：降质在已对照项之外的合成环节`
}

export function formatPixelProbe(entries: PixelProbeEntry[], displayLine: string): string {
  const cells = entries.map((e) =>
    e.result
      ? `${e.name} mad=${e.result.mad.toFixed(2)} edge=${e.result.edgeRatio.toFixed(2)} ` +
        `@${e.result.dx},${e.result.dy}`
      : `${e.name} err=${e.error ?? 'unknown'}`
  )
  return [
    `[sharpness-pixel] ${cells.join(' | ') || '-'}`,
    `  ${displayLine}`,
    `  pixelNote=${pixelProbeNote(entries)}`,
  ].join('\n')
}

/** 内联样式临时覆盖（!important 压过 scoped 规则），还原时恢复原内联值与优先级 */
export function styleVariant(name: string, overrides: StyleOverride[]): PixelVariant {
  return {
    name,
    apply: () => {
      const undo: Array<() => void> = []
      for (const [el, prop, value] of overrides) {
        if (!el) continue
        const prev = el.style.getPropertyValue(prop)
        const priority = el.style.getPropertyPriority(prop)
        el.style.setProperty(prop, value, 'important')
        undo.push(() => {
          if (prev) el.style.setProperty(prop, prev, priority)
          else el.style.removeProperty(prop)
        })
      }
      return () => undo.reverse().forEach((fn) => fn())
    },
  }
}

/** 使 step × dpr 为整数的最小 DIP 步长：截图矩形按它取整，设备像素边界才无歧义 */
function dipStep(dpr: number): number {
  for (let k = 1; k <= 8; k++) {
    if (Math.abs(k * dpr - Math.round(k * dpr)) < 1e-6) return k
  }
  return 1
}

function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message
  const message = (e as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(e)
}

async function readScreen(rect: CaptureRegionRect): Promise<ImageData> {
  const bytes = await ipc.window.captureRegion(rect)
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: 'image/png' }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0)
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
}

/** 取页面可见区域中部一块做比对：避开顶 / 底栏，小面积也不会触发截图通道的降采样 */
async function measure(canvas: HTMLCanvasElement): Promise<PixelCompareResult> {
  const dpr = currentDpr()
  const step = dipStep(dpr)
  const rect = canvas.getBoundingClientRect()
  const left = Math.max(rect.left, 0)
  const top = Math.max(rect.top, 0)
  const visibleWidth = Math.min(rect.right, window.innerWidth) - left
  const visibleHeight = Math.min(rect.bottom, window.innerHeight) - top
  const x = Math.ceil((left + visibleWidth * 0.15) / step) * step
  const y = Math.ceil((top + visibleHeight * 0.25) / step) * step
  const width = Math.floor(Math.min(visibleWidth * 0.7, 480) / step) * step
  const height = Math.floor(Math.min(visibleHeight * 0.5, 320) / step) * step
  if (width < 32 || height < 32) throw new Error('页面可见区域过小')

  const screen = await readScreen({ x, y, width, height })
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)
  if (screen.width !== pixelWidth || screen.height !== pixelHeight) {
    throw new Error(`截图 ${screen.width}x${screen.height} 与预期 ${pixelWidth}x${pixelHeight} 不符`)
  }

  // 复制到临时画布再读：直接对显示 canvas 调 getImageData 会让它退回 CPU 后备，改变被测对象。
  // 位图坐标 = 设备像素坐标的前提是位图比例为 1（由 sharpnessProbe 的比例不变式保证）
  const copy = document.createElement('canvas')
  copy.width = pixelWidth + MARGIN * 2
  copy.height = pixelHeight + MARGIN * 2
  const ctx = copy.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  const sx = Math.round(x * dpr) - Math.round(rect.left * dpr) - MARGIN
  const sy = Math.round(y * dpr) - Math.round(rect.top * dpr) - MARGIN
  ctx.drawImage(canvas, sx, sy, copy.width, copy.height, 0, 0, copy.width, copy.height)
  const backing = ctx.getImageData(0, 0, copy.width, copy.height)

  const result = compareScreenToBacking(screen, backing, MARGIN)
  if (!result) throw new Error('位图尺寸不匹配')
  return result
}

/**
 * 依次在各变体下比对并上报：写主进程日志（打包版可取证），DEV 下额外打印控制台。
 * 调用方须保证比对期间没有浮层盖住页面中部（诊断面板应先收起）。
 */
export async function runPixelProbe(
  canvas: HTMLCanvasElement,
  variants: PixelVariant[]
): Promise<string> {
  const entries: PixelProbeEntry[] = []
  for (const variant of variants) {
    const restore = variant.apply()
    try {
      await twoFrames()
      entries.push({ name: variant.name, result: await measure(canvas) })
    } catch (e) {
      entries.push({ name: variant.name, result: null, error: messageOf(e) })
    } finally {
      restore()
    }
  }
  await twoFrames()

  const dpr = currentDpr()
  // 全屏页高是「位图本身分辨率不足」这一解释的直接参照：同一页在全屏下能拿到多少像素
  const displayLine =
    `display=${window.screen.width}x${window.screen.height}css dpr=${dpr} ` +
    `pageH=${canvas.height}px fullscreenH≈${Math.round(window.screen.height * dpr)}px`
  const text = formatPixelProbe(entries, displayLine)
  ipc.log.write('info', text)
  if (import.meta.env?.DEV === true) console.info(text)
  return text
}
