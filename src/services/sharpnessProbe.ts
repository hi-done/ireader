// 阅读界面清晰度诊断：三条不变式（位图比例 / 页面缩放 / 亚像素相位）的采样与判定
// 对应设计文档 specs/20261116-阅读界面非全屏清晰度修复设计方案.md §4.1 / §4.3 / §7.2
// 判定为纯函数（可单测）；DOM 读取与上报在 sampleReaderSharpness 里收口，视图只负责触发

import { isFullscreen } from './fullscreen'
import { ipc } from './ipc'
import { currentDpr, devicePixelSnapOffset } from './renderGeometry'

export type SharpnessVerdict =
  | 'sharp'
  | 'no-canvas'
  | 'canvas-resample'
  | 'page-scaled'
  | 'container-mismatch'
  | 'subpixel-offset'
  | 'layer-suspect'

/** 单个显示 canvas 的实测数据：pixel 为后备像素，css 为实际显示尺寸（getBoundingClientRect） */
export interface SharpnessCanvasMetric {
  index: number
  pixelWidth: number
  pixelHeight: number
  cssWidth: number
  cssHeight: number
  /** 居中留白常是小数：左/上偏移 × dpr 落到 .5 附近就是最差相位 */
  offsetX: number
  offsetY: number
}

export interface SharpnessInput {
  fullscreen: boolean
  zoomMode: string
  doublePage: boolean
  dpr: number
  innerWidth: number
  innerHeight: number
  /** window.visualViewport.scale：浏览器层的页面缩放因子（1 = 未缩放） */
  visualScale: number
  /** window.visualViewport.width：被缩放后的可视宽，与 innerWidth 不等即说明整层被缩放 */
  visualWidth: number
  containerWidth: number
  containerHeight: number
  /** 当前缩放档位钉住的轴与目标值；null = 不比对（original 档等） */
  expected: { axis: 'width' | 'height'; value: number } | null
  canvases: SharpnessCanvasMetric[]
  /** 祖先链上可疑的合成样式（transform / filter / will-change / backdrop-filter / zoom） */
  suspiciousAncestors: string[]
}

export interface SharpnessResult {
  verdict: SharpnessVerdict
  detail: string
}

/** 位图比例容差：超过 0.5% 视为被重采样（dpr 取整误差的量级远小于此） */
const RATIO_TOLERANCE = 0.005
/** 页面缩放容差 */
const SCALE_TOLERANCE = 0.01
/** 尺寸比对容差（px）：容器与渲染目标允许 1px 内的取整差 */
const SIZE_TOLERANCE = 1
/**
 * 亚像素相位容差（设备像素）：显示起点离整设备像素超过 0.05 个设备像素时，
 * 整张位图会在合成阶段被双线性插值平移——比例仍是 1、分辨率也够，但笔画发灰发虚。
 */
const ALIGN_TOLERANCE = 0.05

/**
 * 清晰度判定（纯函数）。
 * 顺序有讲究：页面缩放最先排除——整层被缩放时，位图比例仍可能是 1，先判 canvas 会得出错误结论。
 */
export function evaluateSharpness(input: SharpnessInput): SharpnessResult {
  const dpr = input.dpr > 0 ? input.dpr : 1

  if (Math.abs(input.visualScale - 1) > SCALE_TOLERANCE) {
    return {
      verdict: 'page-scaled',
      detail: `visualScale=${input.visualScale.toFixed(3)}`,
    }
  }
  if (Math.abs(input.visualWidth - input.innerWidth) > SIZE_TOLERANCE) {
    return {
      verdict: 'page-scaled',
      detail: `visualWidth=${Math.round(input.visualWidth)} inner=${input.innerWidth}`,
    }
  }

  if (input.canvases.length === 0) {
    return {
      verdict: 'no-canvas',
      detail: `flow=${input.zoomMode} area=${input.containerWidth}x${input.containerHeight}`,
    }
  }

  for (const canvas of input.canvases) {
    const ratio = canvas.cssWidth > 0 ? canvas.pixelWidth / canvas.cssWidth / dpr : 1
    if (Math.abs(ratio - 1) > RATIO_TOLERANCE) {
      return {
        verdict: 'canvas-resample',
        detail:
          `i${canvas.index} pixel=${canvas.pixelWidth}x${canvas.pixelHeight} ` +
          `css=${fmt(canvas.cssWidth)}x${fmt(canvas.cssHeight)} ratio=${ratio.toFixed(3)}`,
      }
    }
  }

  if (input.expected) {
    const values = input.canvases.map((c) =>
      input.expected!.axis === 'width' ? c.cssWidth : c.cssHeight
    )
    const actual = Math.max(...values)
    if (Math.abs(actual - input.expected.value) > SIZE_TOLERANCE) {
      return {
        verdict: 'container-mismatch',
        detail: `${input.expected.axis} expected=${fmt(input.expected.value)} actual=${fmt(actual)}`,
      }
    }
  }

  // 亚像素相位：居中留白为小数时整张位图会被插值平移，比例仍为 1 但笔画发灰
  for (const canvas of input.canvases) {
    const drift = Math.max(Math.abs(canvas.offsetX), Math.abs(canvas.offsetY))
    if (drift * dpr > ALIGN_TOLERANCE) {
      return {
        verdict: 'subpixel-offset',
        detail:
          `i${canvas.index} snap=${canvas.offsetX.toFixed(2)},${canvas.offsetY.toFixed(2)} css ` +
          `(${(drift * dpr).toFixed(2)} device)`,
      }
    }
  }

  if (input.suspiciousAncestors.length > 0) {
    return {
      verdict: 'layer-suspect',
      detail: input.suspiciousAncestors.join(' '),
    }
  }
  return {
    verdict: 'sharp',
    detail: `i0 ratio=1.000 area=${input.containerWidth}x${input.containerHeight}`,
  }
}

/** 判定结论的人话解释：日志与 DEV 面板共用，避免两处措辞漂移 */
export function verdictNote(verdict: SharpnessVerdict): string {
  switch (verdict) {
    case 'page-scaled':
      return '整层被浏览器缩放：需主进程复位页面缩放'
    case 'canvas-resample':
      return '位图被重采样：渲染尺寸与显示尺寸不一致'
    case 'container-mismatch':
      return '渲染目标与容器实测尺寸不一致'
    case 'subpixel-offset':
      return '页面显示起点非整设备像素：Chromium 通常自动对齐，需以 [sharpness-pixel] edge 比对为准判断是否真被重采样'
    case 'layer-suspect':
      return '不变式成立但祖先链有可疑合成样式'
    case 'no-canvas':
      return '无 canvas（文字流）：仅校验页面缩放'
    case 'sharp':
    default:
      return '三项不变式成立'
  }
}

/** DEV 面板缓冲：只留结论行，明细在控制台 / 主进程日志 */
const diagBuffer: string[] = []
let latestReport = ''

export function getSharpnessDiag(): string[] {
  return [...diagBuffer]
}

/** 最近一次完整采样文本（DEV 面板展示用；正式构建不调用） */
export function getLatestSharpnessReport(): string {
  return latestReport
}

export interface SampleOptions {
  /** 阅读内容容器：横向为 .page-area，纵向为滚动容器，EPUB 为 .epub-area */
  container: HTMLElement | null | undefined
  /** 缩放档位标识（仅用于日志标注与预期尺寸推导） */
  zoomMode: string
  doublePage: boolean
  /** custom 档位的缩放比例（1 = 100%） */
  zoomScale?: number
}

/**
 * 采样一次并上报：写主进程日志（打包版可取证），DEV 下额外打印控制台与面板缓冲。
 * 返回完整采样文本，供调用方在 DEV 面板展示。
 */
export function sampleReaderSharpness(options: SampleOptions): string {
  const container = options.container
  if (!container) return ''
  const dpr = currentDpr()
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight
  const input: SharpnessInput = {
    fullscreen: isFullscreen.value,
    zoomMode: options.zoomMode,
    doublePage: options.doublePage,
    dpr,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualScale: window.visualViewport?.scale ?? 1,
    visualWidth: window.visualViewport?.width ?? window.innerWidth,
    containerWidth,
    containerHeight,
    expected: expectedAxis(options, containerWidth, containerHeight),
    canvases: collectCanvases(container, dpr),
    suspiciousAncestors: collectSuspiciousAncestors(container),
  }
  const result = evaluateSharpness(input)
  const text = formatReport(input, result)
  // 日志通道自身失败不得影响阅读：ipc.log.write 已是 fire-and-forget
  ipc.log.write('info', text)
  if (import.meta.env?.DEV === true) {
    console.info(text)
    latestReport = text
    diagBuffer.push(`${new Date().toISOString()} ${text.split('\n')[0]}`)
    if (diagBuffer.length > 20) diagBuffer.splice(0, diagBuffer.length - 20)
  }
  return text
}

/** 当前档位钉住的轴：适宽比宽、适高 / 自定义比高，其余不比对 */
function expectedAxis(
  options: SampleOptions,
  width: number,
  height: number
): { axis: 'width' | 'height'; value: number } | null {
  switch (options.zoomMode) {
    case 'fitWidth':
      return { axis: 'width', value: options.doublePage ? width / 2 : width }
    case 'fitHeight':
      return { axis: 'height', value: height }
    case 'custom':
      return { axis: 'height', value: height * (options.zoomScale ?? 1) }
    default:
      return null
  }
}

/** 采集容器内已出图的 canvas（纵向滚动行内多张，只取前 4 张，够判定且日志不冗长） */
function collectCanvases(container: HTMLElement, dpr: number): SharpnessCanvasMetric[] {
  const nodes = container.querySelectorAll('canvas')
  const out: SharpnessCanvasMetric[] = []
  for (const node of nodes) {
    if (node.width <= 0 || node.height <= 0) continue
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    // 居中留白常是小数：把起点吸附到整设备像素所需平移量（CSS px，带符号）
    const snap = devicePixelSnapOffset(rect.left, rect.top, dpr)
    out.push({
      index: out.length,
      pixelWidth: node.width,
      pixelHeight: node.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      offsetX: snap.x,
      offsetY: snap.y,
    })
    if (out.length >= 4) break
  }
  return out
}

/** 祖先链可疑合成样式扫描：逐级到 body，命中即为潜在「整层重采样」来源 */
function collectSuspiciousAncestors(el: HTMLElement): string[] {
  const out: string[] = []
  let node: HTMLElement | null = el
  for (let depth = 0; node && depth < 8; depth++) {
    const style = window.getComputedStyle(node)
    const marks: string[] = []
    const transform = style.getPropertyValue('transform')
    if (transform && transform !== 'none') marks.push(`transform:${transform}`)
    const filter = style.getPropertyValue('filter')
    if (filter && filter !== 'none') marks.push(`filter:${filter}`)
    const willChange = style.getPropertyValue('will-change')
    if (willChange && willChange !== 'auto') marks.push(`will-change:${willChange}`)
    const backdrop = style.getPropertyValue('backdrop-filter')
    if (backdrop && backdrop !== 'none') marks.push('backdrop-filter')
    const zoom = style.getPropertyValue('zoom')
    if (zoom && zoom !== '1' && zoom !== 'normal') marks.push(`zoom:${zoom}`)
    if (marks.length > 0) out.push(`${labelOf(node)}(${marks.join(',')})`)
    node = node.parentElement
  }
  return out
}

function labelOf(node: HTMLElement): string {
  const tag = node.tagName.toLowerCase()
  const className = typeof node.className === 'string' ? node.className.trim() : ''
  return className ? `${tag}.${className.split(/\s+/).join('.')}` : tag
}

/** 采样文本：首行结论，其后为可对照的读数（整段限长，通道单条上限 2000 字符） */
function formatReport(input: SharpnessInput, result: SharpnessResult): string {
  const canvasLines = input.canvases.map(
    (c) =>
      `canvas=i${c.index} ${c.pixelWidth}x${c.pixelHeight} ` +
      `css=${fmt(c.cssWidth)}x${fmt(c.cssHeight)} ratio=${ratioOf(c, input.dpr).toFixed(3)}`
  )
  const alignLines = input.canvases.map(
    (c) =>
      `i${c.index} snap=${c.offsetX.toFixed(2)},${c.offsetY.toFixed(2)} css ` +
      `fix=translate(${c.offsetX.toFixed(2)}px,${c.offsetY.toFixed(2)}px)`
  )
  const lines = [
    `[sharpness] verdict=${result.verdict} full=${input.fullscreen ? 1 : 0} ` +
      `z=${input.zoomMode} dpr=${input.dpr} pair=${input.doublePage ? 1 : 0}`,
    `  vv=scale:${input.visualScale.toFixed(3)} w:${Math.round(input.visualWidth)} ` +
      `h:${Math.round(window.visualViewport?.height ?? input.innerHeight)} ` +
      `inner=${input.innerWidth}x${input.innerHeight}`,
    `  area=${input.containerWidth}x${input.containerHeight} ${canvasLines.join(' | ') || 'no-canvas'}`,
    `  align=${alignLines.join(' | ') || '-'}`,
    `  detail=${result.detail}`,
    `  ancestors=${input.suspiciousAncestors.join(' ') || '-'}`,
    `  note=${verdictNote(result.verdict)}`,
  ]
  const text = lines.join('\n')
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text
}

function ratioOf(canvas: SharpnessCanvasMetric, dpr: number): number {
  const d = dpr > 0 ? dpr : 1
  return canvas.cssWidth > 0 ? canvas.pixelWidth / canvas.cssWidth / d : 1
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
