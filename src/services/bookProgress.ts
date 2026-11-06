// 阅读进度派生口径：书卡进度环与侧栏内页缩略图共用同一套计算，避免两处漂移
// 对应设计文档 specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.1

import type { ReadingProgress } from '../../shared/types'

/** 进度计算所需的最小输入：只依赖当前页、百分比与总页数，便于纯函数单测 */
export interface ProgressInput {
  progress: Pick<ReadingProgress, 'page' | 'percentage'> | null
  totalPages: number
}

/**
 * 阅读进度百分比（0~100 整数）。
 * EPUB 直接存 percentage；PDF / CBZ / MOBI 按当前页与总页数折算。
 * 无进度、或页数未知且没有 percentage 时返回 null——调用方据此不渲染进度。
 */
export function progressPercentOf(book: ProgressInput): number | null {
  const { progress, totalPages } = book
  if (!progress) return null
  if (progress.percentage != null) return Math.min(100, Math.round(progress.percentage))
  if (!totalPages) return null
  return Math.min(100, Math.round((progress.page / totalPages) * 100))
}

/**
 * 内页缩略图页码（1 基）。
 * 有进度取 progress.page（双页模式为页组首页）；无进度或非法值落到第 1 页；
 * 超出总页数时钳制到末页，避免逐页协议返回 404。
 */
export function thumbPageOf(book: ProgressInput): number {
  const raw = book.progress?.page
  const floored = Number.isFinite(raw) ? Math.floor(raw as number) : 1
  const page = floored >= 1 ? floored : 1
  const total = book.totalPages > 0 ? Math.floor(book.totalPages) : 0
  return total > 0 ? Math.min(total, page) : page
}
