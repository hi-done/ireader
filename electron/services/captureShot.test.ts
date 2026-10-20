// captureShot 单元测试：截图降采样的面积阈值、比例与边界（纯逻辑，无 Electron 依赖）

import { describe, expect, it } from 'vitest'
import {
  computeShotSize,
  SHOT_DOWNSAMPLE_PIXELS,
  SHOT_DOWNSAMPLE_SCALE,
} from './captureShot'

describe('computeShotSize - 截图降采样', () => {
  it('小窗口 1280×800@1x 不降采样', () => {
    expect(computeShotSize(1280, 800, 1)).toBeNull()
  })

  it('1080p 全屏 1920×1080@1x 按 0.6 降采样', () => {
    expect(computeShotSize(1920, 1080, 1)).toEqual({ width: 1152, height: 648 })
  })

  it('1080p@1.25x 按物理面积触发降采样', () => {
    expect(computeShotSize(1920, 1080, 1.25)).toEqual({ width: 1152, height: 648 })
  })

  it('4K 全屏 3840×2160@2x 按 0.6 降采样', () => {
    expect(computeShotSize(3840, 2160, 2)).toEqual({ width: 2304, height: 1296 })
  })

  it('面积恰好等于阈值不降采样（边界固定为 <=）', () => {
    expect(computeShotSize(1000, 2000, 1)).toBeNull()
    expect(computeShotSize(1414, 1414, 1)).toBeNull() // 1,999,396 像素
  })

  it('面积略超阈值按比例降采样并取整', () => {
    expect(computeShotSize(1415, 1415, 1)).toEqual({
      width: Math.round(1415 * SHOT_DOWNSAMPLE_SCALE),
      height: Math.round(1415 * SHOT_DOWNSAMPLE_SCALE),
    })
  })

  it('极小尺寸不降采样', () => {
    expect(computeShotSize(10, 10, 3)).toBeNull()
  })

  it('非法尺寸不降采样；非法缩放因子按 1 计算', () => {
    expect(computeShotSize(0, 100, 1)).toBeNull()
    expect(computeShotSize(Number.NaN, 100, 1)).toBeNull()
    expect(computeShotSize(-10, -10, 1)).toBeNull()
    // dpr=0 回退为 1；12M 像素仍超过阈值，按 0.6 降采样
    expect(computeShotSize(4000, 3000, 0)).toEqual({ width: 2400, height: 1800 })
  })

  it('阈值常量与设计稿一致', () => {
    expect(SHOT_DOWNSAMPLE_PIXELS).toBe(2_000_000)
    expect(SHOT_DOWNSAMPLE_SCALE).toBe(0.6)
  })
})
