import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { toIpcPayload } from './ipcPayload'

describe('toIpcPayload IPC 入参净化', () => {
  it('含嵌套响应式代理的载荷可直接结构化克隆', () => {
    const payload = reactive({
      coverSinglePage: false,
      ai: { enabled: true, providers: [{ id: 1, model: 'gpt-4o-mini' }] },
    })

    // 未净化时浅拷贝里仍持有代理，克隆失败（本函数存在的理由）
    expect(() => structuredClone({ ...payload })).toThrow()
    // 净化后与主进程一致的克隆路径不再抛错
    expect(() => structuredClone(toIpcPayload(payload))).not.toThrow()
  })

  it('净化不改变数据内容', () => {
    const payload = reactive({
      coverSinglePage: false,
      ai: { enabled: true, providers: [{ id: 1, model: 'gpt-4o-mini' }] },
    })

    expect(toIpcPayload(payload)).toEqual({
      coverSinglePage: false,
      ai: { enabled: true, providers: [{ id: 1, model: 'gpt-4o-mini' }] },
    })
  })

  it('值为 undefined 的字段被丢弃，不留下 undefined 键', () => {
    const payload = toIpcPayload<{ coverSinglePage?: boolean; mode?: string }>({
      coverSinglePage: undefined,
      mode: 'double',
    })

    expect('coverSinglePage' in payload).toBe(false)
    expect(payload).toEqual({ mode: 'double' })
  })
})
