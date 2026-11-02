// 框选区域裁切：从页 canvas 的位图裁出矩形并编码为 JPEG base64
// 对应设计文档《20261102-AI框选翻译功能设计方案》§4.2 / §8.2
// 位图分辨率 = CSS × DPR，按位图裁切比屏幕截图更清晰；结果用完即弃，不落盘

import type { AiRect } from '../../shared/types'

/** 长边上限：1024px + JPEG 0.82，单次载荷通常 40~340KB（base64 后） */
const MAX_SIDE = 1024
const JPEG_QUALITY = 0.82

/**
 * 从页 canvas 位图裁切框选区域并编码为 JPEG base64（不含 data: 前缀）。
 * canvas 未绘制（宽高为 0）或裁切区域为空时返回 ''。
 */
export function cropPageToJpegBase64(
  canvas: HTMLCanvasElement,
  rect: AiRect,
  maxSide = MAX_SIDE,
  quality = JPEG_QUALITY
): string {
  const bitmapW = canvas.width
  const bitmapH = canvas.height
  if (!(bitmapW > 0) || !(bitmapH > 0)) return '' // 未绘制 / 已被翻页取消

  // 归一化矩形 → 位图像素矩形，夹取到位图边界内（脏数据也不越界采样）
  const sx = Math.max(0, Math.min(rect.x, 1) * bitmapW)
  const sy = Math.max(0, Math.min(rect.y, 1) * bitmapH)
  const sw = Math.min(bitmapW - sx, Math.max(rect.w, 0) * bitmapW)
  const sh = Math.min(bitmapH - sy, Math.max(rect.h, 0) * bitmapH)
  if (!(sw >= 1) || !(sh >= 1)) return ''

  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const outW = Math.max(1, Math.round(sw * scale))
  const outH = Math.max(1, Math.round(sh * scale))

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) return ''
  // JPEG 无 alpha 通道，透明区会变黑：先铺白底再画图
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, outW, outH)
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, outW, outH)

  const encoded = out.toDataURL('image/jpeg', quality)
  const comma = encoded.indexOf(',')
  return comma >= 0 ? encoded.slice(comma + 1) : ''
}
