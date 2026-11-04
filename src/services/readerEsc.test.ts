import { describe, expect, it } from 'vitest'
import { resolveReaderEsc } from './readerEsc'

describe('resolveReaderEsc - Esc 优先级', () => {
  it('选词态 + 全屏：只退出选词，不退全屏', () => {
    expect(resolveReaderEsc({ selecting: true, fullscreen: true })).toBe('exitAiSelect')
  })

  it('选词态 + 非全屏：只退出选词，不返回文库', () => {
    expect(resolveReaderEsc({ selecting: true, fullscreen: false })).toBe('exitAiSelect')
  })

  it('非选词 + 全屏：退出全屏', () => {
    expect(resolveReaderEsc({ selecting: false, fullscreen: true })).toBe('exitFullscreen')
  })

  it('非选词 + 非全屏：返回文库', () => {
    expect(resolveReaderEsc({ selecting: false, fullscreen: false })).toBe('backToLibrary')
  })

  it('选词态恒优先于全屏：两个全屏取值结果一致', () => {
    expect(resolveReaderEsc({ selecting: true, fullscreen: true })).toBe(
      resolveReaderEsc({ selecting: true, fullscreen: false })
    )
  })

  it('全屏已被本次 Esc 退掉：只退全屏，不返回文库', () => {
    expect(
      resolveReaderEsc({ selecting: false, fullscreen: false, justExitedFullscreen: true })
    ).toBe('exitFullscreen')
  })

  it('选词态仍优先于「刚退过全屏」：只退选词', () => {
    expect(
      resolveReaderEsc({ selecting: true, fullscreen: false, justExitedFullscreen: true })
    ).toBe('exitAiSelect')
  })
})
