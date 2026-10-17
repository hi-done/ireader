// 窗口区域截图（渲染层）：经 window:captureRegion 取 PNG 像素 → 合成 canvas 快照
// 快照约定与 PDF 侧 snapshotForTurn 一致：物理像素尺寸 + style 为逻辑尺寸（供 pageCurl 使用）

import type { CaptureRegionRect } from '../../shared/types'
import { ipc } from './ipc'

/**
 * 捕获窗口内容区指定矩形（含 iframe 合成输出），返回可直接交给 playPageCurl 的快照 canvas。
 * @param rect 相对页面内容区左上角的 CSS/DIP 像素矩形（通常来自 getBoundingClientRect）
 */
export async function captureRegionToCanvas(rect: CaptureRegionRect): Promise<HTMLCanvasElement> {
  const bytes = await ipc.window.captureRegion(rect)
  // TS 5.7 泛型数组：Uint8Array<ArrayBufferLike> 不满足 BlobPart，slice() 得到 ArrayBuffer 底层的拷贝视图
  const pngBytes = bytes.slice()
  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0)
    return canvas
  } finally {
    bitmap.close()
  }
}
