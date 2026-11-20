// 屏幕像素比对单测：对齐搜索、重采样识别与结论分支（纯函数，不触碰 DOM / IPC）

import { describe, expect, it } from 'vitest'
import {
  compareScreenToBacking,
  formatPixelProbe,
  pixelProbeNote,
  type PixelCompareResult,
  type PixelProbeEntry,
  type RgbaBitmap,
} from './pixelProbe'

const MARGIN = 3

/** 确定性伪随机灰度图（LCG）：非周期，保证对齐搜索有唯一最优解 */
function noise(width: number, height: number, seed = 1): Float32Array {
  const out = new Float32Array(width * height)
  let state = seed
  for (let i = 0; i < out.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = state >>> 24
  }
  return out
}

function toBitmap(gray: Float32Array, width: number, height: number): RgbaBitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < gray.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray[i]
    data[i * 4 + 3] = 255
  }
  return { width, height, data }
}

/** 从后备图中按偏移裁出「屏幕」区域；sample 可替换为插值采样以模拟重采样 */
function cropScreen(
  backing: Float32Array,
  bw: number,
  w: number,
  h: number,
  sample: (x: number, y: number) => number
): RgbaBitmap {
  const gray = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = sample(x + MARGIN, y + MARGIN)
  }
  void backing
  void bw
  return toBitmap(gray, w, h)
}

const W = 40
const H = 30
const BW = W + MARGIN * 2
const BH = H + MARGIN * 2

describe('compareScreenToBacking', () => {
  const gray = noise(BW, BH)
  const backing = toBitmap(gray, BW, BH)
  const at = (x: number, y: number): number => gray[y * BW + x]

  it('屏幕与位图逐像素一致 → mad 0、零偏移、边缘比 1', () => {
    const screen = cropScreen(gray, BW, W, H, at)
    const result = compareScreenToBacking(screen, backing, MARGIN)
    expect(result).not.toBeNull()
    expect(result!.mad).toBe(0)
    expect([result!.dx, result!.dy]).toEqual([0, 0])
    expect(result!.edgeRatio).toBeCloseTo(1, 6)
    expect(result!.detail).toBeGreaterThan(10)
  })

  it('整像素错位 → 搜索到偏移后仍判逐像素一致', () => {
    const screen = cropScreen(gray, BW, W, H, (x, y) => at(x + 2, y - 1))
    const result = compareScreenToBacking(screen, backing, MARGIN)!
    expect(result.mad).toBe(0)
    expect([result.dx, result.dy]).toEqual([2, -1])
    expect(result.edgeRatio).toBeCloseTo(1, 6)
  })

  it('半像素插值平移（合成阶段重采样）→ 亮度差显著且边缘能量被削弱', () => {
    const screen = cropScreen(gray, BW, W, H, (x, y) => (at(x, y) + at(x + 1, y)) / 2)
    const result = compareScreenToBacking(screen, backing, MARGIN)!
    expect(result.mad).toBeGreaterThan(10)
    expect(result.edgeRatio).toBeLessThan(0.9)
  })

  it('空白区域：各偏移同分时保持零偏移，detail 为 0', () => {
    const flat = new Float32Array(BW * BH).fill(255)
    const result = compareScreenToBacking(
      toBitmap(new Float32Array(W * H).fill(255), W, H),
      toBitmap(flat, BW, BH),
      MARGIN
    )!
    expect(result.mad).toBe(0)
    expect([result.dx, result.dy]).toEqual([0, 0])
    expect(result.detail).toBe(0)
    expect(result.edgeRatio).toBe(1)
  })

  it('透明像素按黑底合成：透明白与不透明黑等价', () => {
    const clear = toBitmap(new Float32Array(BW * BH).fill(255), BW, BH)
    const data = clear.data as Uint8ClampedArray
    for (let i = 3; i < data.length; i += 4) data[i] = 0
    const black = toBitmap(new Float32Array(W * H).fill(0), W, H)
    expect(compareScreenToBacking(black, clear, MARGIN)!.mad).toBe(0)
  })

  it('尺寸不满足「后备四周各多 margin」约定 → null', () => {
    const screen = cropScreen(gray, BW, W, H, at)
    expect(compareScreenToBacking(screen, toBitmap(noise(W, H), W, H), MARGIN)).toBeNull()
    expect(compareScreenToBacking(screen, backing, 1)).toBeNull()
  })
})

describe('pixelProbeNote', () => {
  const same: PixelCompareResult = { mad: 0.1, dx: 0, dy: 0, edgeRatio: 1, detail: 12 }
  const soft: PixelCompareResult = { mad: 6.4, dx: 0, dy: 0, edgeRatio: 0.72, detail: 12 }
  const entry = (name: string, result: PixelCompareResult | null, error?: string): PixelProbeEntry => ({
    name,
    result,
    error,
  })

  it('当前状态逐像素一致 → 归因位图本身', () => {
    expect(pixelProbeNote([entry('now', same), entry('noSnap', soft)])).toContain('位图本身')
  })

  it('当前被重采样、某变体一致 → 点名该变体', () => {
    const note = pixelProbeNote([entry('now', soft), entry('noSnap', same), entry('noScroll', same)])
    expect(note).toContain('noSnap / noScroll')
    expect(note).toContain('72%')
  })

  it('所有变体都被重采样 → 指向已对照项之外', () => {
    expect(pixelProbeNote([entry('now', soft), entry('bare', soft)])).toContain('已对照项之外')
  })

  it('全部失败 → 带出首个错误；空白区域 → 提示换页', () => {
    expect(pixelProbeNote([entry('now', null, '窗口不可用')])).toContain('窗口不可用')
    const blank = { ...same, detail: 0 }
    expect(pixelProbeNote([entry('now', blank)])).toContain('没有内容')
  })

  it('formatPixelProbe：首行可检索，失败变体写 err', () => {
    const text = formatPixelProbe([entry('now', same), entry('bare', null, 'boom')], 'display=x')
    const lines = text.split('\n')
    expect(lines[0]).toBe('[sharpness-pixel] now mad=0.10 edge=1.00 @0,0 | bare err=boom')
    expect(lines[1]).toBe('  display=x')
    expect(lines[2]).toContain('pixelNote=')
  })
})
