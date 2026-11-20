// 清晰度诊断判定单测：两条不变式的优先顺序与各结论分支（纯函数，不触碰 DOM）

import { describe, expect, it } from 'vitest'
import { evaluateSharpness, verdictNote, type SharpnessInput } from './sharpnessProbe'

/** 基准输入：单页适高、dpr 1、容器与画布尺寸一致 → 应判定 sharp */
function base(over: Partial<SharpnessInput> = {}): SharpnessInput {
  return {
    fullscreen: false,
    zoomMode: 'fitHeight',
    doublePage: false,
    dpr: 1,
    innerWidth: 1280,
    innerHeight: 769,
    visualScale: 1,
    visualWidth: 1280,
    containerWidth: 1280,
    containerHeight: 769,
    expected: { axis: 'height', value: 769 },
    canvases: [
      { index: 0, pixelWidth: 1280, pixelHeight: 769, cssWidth: 1280, cssHeight: 769, offsetX: 0, offsetY: 0 },
    ],
    suspiciousAncestors: [],
    ...over,
  }
}

describe('evaluateSharpness', () => {
  it('位图与显示尺寸严格按 dpr → sharp', () => {
    expect(evaluateSharpness(base()).verdict).toBe('sharp')
  })

  it('位图被 CSS 缩小（重采样）→ canvas-resample', () => {
    const result = evaluateSharpness(
      base({
        canvases: [
          { index: 0, pixelWidth: 1280, pixelHeight: 769, cssWidth: 1790, cssHeight: 1075, offsetX: 0, offsetY: 0 },
        ],
        expected: null,
      })
    )
    expect(result.verdict).toBe('canvas-resample')
    expect(result.detail).toContain('ratio=0.715')
  })

  it('页面被浏览器缩放（visualScale ≠ 1）→ page-scaled，且优先于 canvas-resample', () => {
    const result = evaluateSharpness(
      base({
        visualScale: 0.712,
        visualWidth: 1798,
        canvases: [
          { index: 0, pixelWidth: 1280, pixelHeight: 769, cssWidth: 1790, cssHeight: 1075, offsetX: 0, offsetY: 0 },
        ],
      })
    )
    expect(result.verdict).toBe('page-scaled')
  })

  it('visualViewport 宽与 innerWidth 不一致 → page-scaled', () => {
    const result = evaluateSharpness(base({ visualScale: 1, visualWidth: 1800 }))
    expect(result.verdict).toBe('page-scaled')
  })

  it('无 canvas（EPUB 文字流）→ no-canvas，且不做除零判定', () => {
    expect(evaluateSharpness(base({ canvases: [], expected: null })).verdict).toBe('no-canvas')
  })

  it('适宽单页：画布宽度与容器不一致 → container-mismatch', () => {
    const result = evaluateSharpness(
      base({
        zoomMode: 'fitWidth',
        expected: { axis: 'width', value: 1280 },
        canvases: [
          { index: 0, pixelWidth: 1000, pixelHeight: 769, cssWidth: 1000, cssHeight: 769, offsetX: 0, offsetY: 0 },
        ],
      })
    )
    expect(result.verdict).toBe('container-mismatch')
  })

  it('适宽双页：单页宽等于容器一半时不误报', () => {
    const result = evaluateSharpness(
      base({
        zoomMode: 'fitWidth',
        doublePage: true,
        expected: { axis: 'width', value: 640 },
        canvases: [
          { index: 0, pixelWidth: 640, pixelHeight: 900, cssWidth: 640, cssHeight: 900, offsetX: 0, offsetY: 0 },
          { index: 1, pixelWidth: 640, pixelHeight: 900, cssWidth: 640, cssHeight: 900, offsetX: 0, offsetY: 0 },
        ],
      })
    )
    expect(result.verdict).toBe('sharp')
  })

  it('祖先链含可疑合成样式 → layer-suspect', () => {
    const result = evaluateSharpness(base({ suspiciousAncestors: ['.page-area(will-change:transform)'] }))
    expect(result.verdict).toBe('layer-suspect')
    expect(result.detail).toContain('will-change')
  })

  // 居中留白带小数时（实测：容器 1266、双页共 1078.4 → 左偏 93.8 CSS × dpr 1.25 = 117.25）
  it('页面落在非整设备像素位置 → subpixel-offset（比例仍为 1）', () => {
    const result = evaluateSharpness(
      base({
        dpr: 1.25,
        // 适高钉住的是像素对齐后的高度 954 / 1.25 = 763.2，与容器 763 差 0.2，不构成 container-mismatch
        expected: { axis: 'height', value: 763.2 },
        canvases: [
          {
            index: 0,
            pixelWidth: 674,
            pixelHeight: 954,
            cssWidth: 539.2,
            cssHeight: 763.2,
            offsetX: 0.4,
            offsetY: 0,
          },
        ],
      })
    )
    expect(result.verdict).toBe('subpixel-offset')
    expect(result.detail).toContain('0.50 device')
  })

  it('亚像素偏差在容差内（0.03 CSS = 0.0375 设备像素）→ 仍判 sharp', () => {
    const canvases = [
      { index: 0, pixelWidth: 1280, pixelHeight: 769, cssWidth: 1280, cssHeight: 769, offsetX: 0.03, offsetY: 0.02 },
    ]
    expect(evaluateSharpness(base({ canvases })).verdict).toBe('sharp')
  })
})

describe('verdictNote', () => {
  it('每个结论都有可读解释（日志与面板共用，不留空串）', () => {
    for (const verdict of [
      'sharp',
      'no-canvas',
      'canvas-resample',
      'page-scaled',
      'container-mismatch',
      'subpixel-offset',
      'layer-suspect',
    ] as const) {
      expect(verdictNote(verdict).length).toBeGreaterThan(0)
    }
  })
})
