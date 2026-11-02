// 零进度判定与 AI 配置归一化单测
// 对应设计文档 specs/默认阅读方向同步零进度书设计方案-20261025.md §11.1
// 对应设计文档 specs/20261102-AI翻译多协议适配设计方案.md §11.1

import { describe, expect, it } from 'vitest'
import { isUnstartedProgress, normalizeAiSettings } from './types'

describe('isUnstartedProgress', () => {
  it('首页且无百分比（PDF 首页）', () => {
    expect(isUnstartedProgress(1, null)).toBe(true)
  })

  it('首页且百分比为 0（EPUB 首页）', () => {
    expect(isUnstartedProgress(1, 0)).toBe(true)
  })

  it('首页且未传百分比', () => {
    expect(isUnstartedProgress(1)).toBe(true)
  })

  it('首页但百分比 0.4 不算零进度', () => {
    expect(isUnstartedProgress(1, 0.4)).toBe(false)
  })

  it('第二页无百分比不算零进度', () => {
    expect(isUnstartedProgress(2, null)).toBe(false)
  })

  it('第二页百分比 0 仍按页码判为非零', () => {
    expect(isUnstartedProgress(2, 0)).toBe(false)
  })

  it('脏数据首页 0 视为零进度', () => {
    expect(isUnstartedProgress(0, null)).toBe(true)
  })
})

describe('normalizeAiSettings', () => {
  /** 造一条 provider：protocol 传 undefined 模拟协议字段上线前保存的配置 */
  function withProtocol(protocol?: unknown) {
    return {
      enabled: true,
      targetLang: 'zh-CN',
      activeProviderId: 1,
      providers: [
        {
          id: 1,
          name: 'deepseek',
          baseUrl: 'https://api.deepseek.com',
          apiKey: '',
          model: 'deepseek-flash',
          protocol,
        },
      ],
    }
  }

  it('旧配置缺少协议字段时补 openai', () => {
    expect(normalizeAiSettings(withProtocol()).providers[0].protocol).toBe('openai')
  })

  it('非法协议值回退 openai', () => {
    expect(normalizeAiSettings(withProtocol('gemini')).providers[0].protocol).toBe('openai')
  })

  it('合法协议值原样保留', () => {
    expect(normalizeAiSettings(withProtocol('anthropic')).providers[0].protocol).toBe('anthropic')
  })
})
