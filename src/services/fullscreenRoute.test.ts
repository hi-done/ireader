import { describe, expect, it } from 'vitest'
import { isFullscreenOutsideReader } from './fullscreenRoute'

describe('isFullscreenOutsideReader - 全屏归属判定', () => {
  it('主页 + 全屏：需要退出全屏', () => {
    expect(isFullscreenOutsideReader('library', true)).toBe(true)
  })

  it('阅读页 + 全屏：保持全屏（切书 / 刷新不误退）', () => {
    expect(isFullscreenOutsideReader('reader', true)).toBe(false)
  })

  it('主页 + 非全屏：无需退出', () => {
    expect(isFullscreenOutsideReader('library', false)).toBe(false)
  })

  it('阅读页 + 非全屏：无需退出', () => {
    expect(isFullscreenOutsideReader('reader', false)).toBe(false)
  })

  it('路由名缺失 + 全屏：按非阅读页处理，不留全屏死角', () => {
    expect(isFullscreenOutsideReader(undefined, true)).toBe(true)
  })
})
