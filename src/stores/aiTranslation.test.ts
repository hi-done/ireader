// AI 译文 store 单测：落库载荷必须是纯对象
// 背景：records 中的条目是 Vue reactive 代理，直接经 contextBridge 过 IPC 会 clone 失败，
// 表现为「调整尺寸 / 折叠后立刻弹回」；对应设计文档 specs/20261102-AI框选翻译功能设计方案.md §8.5

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isProxy } from 'vue'
import type { AiTranslationInput, AiTranslationRecord } from '../../shared/types'
import { useAiTranslationStore } from './aiTranslation'

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  translate: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../services/ipc', () => ({ ipc: { ai: mock } }))

const RECORD: AiTranslationRecord = {
  id: 1,
  bookId: 1,
  page: 1,
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  text: '译文',
  fontRatio: 0.06,
  collapsed: false,
  createdAt: 1,
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mock.list.mockResolvedValue([{ ...RECORD, rect: { ...RECORD.rect } }])
  mock.save.mockImplementation(
    async (input: AiTranslationInput): Promise<AiTranslationRecord> => ({
      ...input,
      id: input.id ?? RECORD.id,
      createdAt: RECORD.createdAt,
    })
  )
})

function lastPayload(): AiTranslationInput {
  return mock.save.mock.calls[0][0] as AiTranslationInput
}

describe('aiTranslation 落库载荷', () => {
  it('折叠：payload 与其 rect 都是纯对象（否则 IPC clone 失败）', async () => {
    const store = useAiTranslationStore()
    await store.load(1)
    await store.setCollapsed(store.records[0], true)

    const payload = lastPayload()
    expect(isProxy(payload)).toBe(false)
    expect(isProxy(payload.rect)).toBe(false)
    expect(payload.collapsed).toBe(true)
    expect(store.records[0].collapsed).toBe(true)
  })

  it('调整尺寸：落库用新矩形，且矩形为纯对象', async () => {
    const store = useAiTranslationStore()
    await store.load(1)
    const next = { x: 0.05, y: 0.06, w: 0.5, h: 0.5 }
    await store.applyResize(store.records[0], next)

    const payload = lastPayload()
    expect(isProxy(payload.rect)).toBe(false)
    expect(payload.rect).toEqual(next)
    expect(store.records[0].rect).toEqual(next)
  })

  it('调整尺寸落库失败时回滚为原矩形', async () => {
    const store = useAiTranslationStore()
    await store.load(1)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mock.save.mockRejectedValueOnce(new Error('boom'))

    await store.applyResize(store.records[0], { x: 0.05, y: 0.06, w: 0.5, h: 0.5 })

    expect(store.records[0].rect).toEqual(RECORD.rect)
    warn.mockRestore()
  })
})
