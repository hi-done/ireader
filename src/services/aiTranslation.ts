// AI 框选翻译的纯逻辑：归一化矩形、百分比样式、缩放 / 拖动的位置夹取、字号换算
// 对应设计文档《20261102-AI框选翻译功能设计方案》§4.1 / §4.3 / §8.1
// 不依赖 DOM / electron，便于 Vitest 直接覆盖

import type { AiRect } from '../../shared/types'

/** 框选误触过滤：宽 / 高小于该像素阈值视为点选而非框选 */
export const MIN_SELECT_W = 24
export const MIN_SELECT_H = 16

/** 手动缩放后的最小框尺寸（px） */
export const MIN_BOX_W = 40
export const MIN_BOX_H = 28

/** 字号比例：默认 / 下限 / 上限（译文行高 ÷ 图片高度） */
export const DEFAULT_FONT_RATIO = 0.06
export const MIN_FONT_RATIO = 0.02
export const MAX_FONT_RATIO = 0.15

/** 字号像素上下限：过小不可读、过大撑破气泡；MIN_FONT_PX 同时是自适应收缩的下限 */
export const MIN_FONT_PX = 10
const MAX_FONT_PX = 96

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * 显示盒内的像素矩形 → 0~1 归一化矩形。
 * 小于最小框选尺寸返回 null（误触过滤）；超出页盒的部分夹到边界内。
 */
export function normalizeRect(
  rect: { x: number; y: number; w: number; h: number },
  page: { width: number; height: number }
): AiRect | null {
  const { width, height } = page
  if (!(width > 0) || !(height > 0)) return null
  if (![rect.x, rect.y, rect.w, rect.h].every((n) => Number.isFinite(n))) return null
  if (Math.abs(rect.w) < MIN_SELECT_W || Math.abs(rect.h) < MIN_SELECT_H) return null

  const left = clamp(rect.x, 0, width)
  const top = clamp(rect.y, 0, height)
  const right = clamp(rect.x + rect.w, 0, width)
  const bottom = clamp(rect.y + rect.h, 0, height)
  const w = Math.abs(right - left)
  const h = Math.abs(bottom - top)
  if (w < 1 || h < 1) return null

  return {
    x: clamp(Math.min(left, right) / width, 0, 1),
    y: clamp(Math.min(top, bottom) / height, 0, 1),
    w: Math.min(w / width, 1),
    h: Math.min(h / height, 1),
  }
}

/** 比例转百分比字符串：保留 4 位小数，避免 0.1*100 这类浮点尾数污染内联样式 */
export function toPercent(value: number): string {
  return `${Number((value * 100).toFixed(4))}%`
}

/** 归一化矩形 → 百分比内联样式；覆盖层与框体同尺寸，故百分比即像素比例 */
export function toPercentStyle(rect: AiRect): Record<string, string> {
  return {
    left: toPercent(rect.x),
    top: toPercent(rect.y),
    width: toPercent(rect.w),
    height: toPercent(rect.h),
  }
}

/**
 * 右下角拖拽后的新矩形：宽高不小于下限，右下边不超出页盒。
 * delta 为像素位移，page 为显示盒像素尺寸。
 */
export function resizeRect(
  rect: AiRect,
  delta: { dx: number; dy: number },
  page: { width: number; height: number }
): AiRect {
  const { width, height } = page
  if (!(width > 0) || !(height > 0)) return rect
  const minW = Math.min(MIN_BOX_W / width, 1 - rect.x)
  const minH = Math.min(MIN_BOX_H / height, 1 - rect.y)
  return {
    x: rect.x,
    y: rect.y,
    w: clamp(rect.w + delta.dx / width, Math.max(minW, 0.01), 1 - rect.x),
    h: clamp(rect.h + delta.dy / height, Math.max(minH, 0.01), 1 - rect.y),
  }
}

/**
 * 拖动框体后的新矩形：宽高原样保留，左上角夹取到页盒内。
 * 上限必须扣掉宽高：主进程 resolveRect 会按 (1 - x) 截断 w，越界的 x 会让框体被悄悄改窄。
 * delta 为相对按下点的像素位移，page 为显示盒像素尺寸。
 */
export function moveRect(
  rect: AiRect,
  delta: { dx: number; dy: number },
  page: { width: number; height: number }
): AiRect {
  const { width, height } = page
  if (!(width > 0) || !(height > 0)) return rect
  const maxX = Math.max(0, 1 - rect.w)
  const maxY = Math.max(0, 1 - rect.h)
  return {
    x: clamp(rect.x + delta.dx / width, 0, maxX),
    y: clamp(rect.y + delta.dy / height, 0, maxY),
    w: rect.w,
    h: rect.h,
  }
}

/**
 * 字号换算：页显示高度 × 比例，钳制到 [10, 96] px。
 * 非法比例回退默认值，保证脏数据不产生 0 号字。
 */
export function computeFontPx(fontRatio: number, pageHeightCss: number): number {
  const ratio = Number.isFinite(fontRatio)
    ? clamp(fontRatio, MIN_FONT_RATIO, MAX_FONT_RATIO)
    : DEFAULT_FONT_RATIO
  const height = Number.isFinite(pageHeightCss) && pageHeightCss > 0 ? pageHeightCss : 0
  if (!height) return MIN_FONT_PX
  return Math.round(clamp(ratio * height, MIN_FONT_PX, MAX_FONT_PX))
}
