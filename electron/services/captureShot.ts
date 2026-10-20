// 截图降采样策略：大面积截图（全屏 / 高 DPI 窗口）先缩小再编码，
// 直接削减 PNG 编码、IPC 传输与渲染层解码的耗时——这段成本是 EPUB 全屏翻页动画
// 超出启动预算的主要来源。对应设计文档《EPUB全屏翻页动画与工具栏层级修复设计方案-20261020》§4.2

/** 截图降采样阈值（物理像素）：超过该面积的 PNG 编码/传输会拖垮全屏翻页动画 */
export const SHOT_DOWNSAMPLE_PIXELS = 2_000_000
/** 大面积截图降采样比例（0.6 → 像素量约 36%）；快照仅在卷曲位移/暗化中短暂可见 */
export const SHOT_DOWNSAMPLE_SCALE = 0.6

export interface ShotSize {
  width: number
  height: number
}

/**
 * 按物理像素面积计算降采样后的截图尺寸；单位与入参一致（NativeImage 的 getSize 尺寸）。
 * @param width 截图逻辑宽度
 * @param height 截图逻辑高度
 * @param dpr 图像缩放因子（取 NativeImage.getScaleFactors() 的最大值）
 * @returns 降采样后的宽高；无需降采样或尺寸非法时返回 null
 */
export function computeShotSize(width: number, height: number, dpr = 1): ShotSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  if (width * height * safeDpr * safeDpr <= SHOT_DOWNSAMPLE_PIXELS) return null
  return {
    width: Math.max(1, Math.round(width * SHOT_DOWNSAMPLE_SCALE)),
    height: Math.max(1, Math.round(height * SHOT_DOWNSAMPLE_SCALE)),
  }
}
