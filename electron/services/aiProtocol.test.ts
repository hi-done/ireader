// AI 协议适配单测：URL 归一、鉴权头、请求体（图片块）与响应取值
// 对应设计文档 specs/20261102-AI翻译多协议适配设计方案.md §11.1

import { describe, expect, it } from 'vitest'
import type { AiProviderConfig } from '../../shared/types'
import {
  buildChatRequest,
  describeChatResponse,
  extractReplyText,
  resolveEndpoint,
  type AiChatContent,
} from './aiProtocol'

function provider(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 1,
    name: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'sk-test',
    model: 'deepseek-flash',
    protocol: 'openai',
    ...overrides,
  }
}

const CONTENT: AiChatContent[] = [
  { type: 'text', text: '翻译这张图' },
  { type: 'image', base64: 'AAA' },
]

interface RequestBody {
  model: string
  temperature: number
  max_tokens: number
  messages: { role: string; content: Record<string, unknown>[] }[]
}

function bodyOf(req: ReturnType<typeof buildChatRequest>): RequestBody {
  return req.body as RequestBody
}

describe('resolveEndpoint', () => {
  it('openai：带 /v1 的基础地址', () => {
    expect(resolveEndpoint(provider({ baseUrl: 'https://api.openai.com/v1' }))).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('openai：不带 /v1 也正确', () => {
    expect(resolveEndpoint(provider())).toBe('https://api.deepseek.com/chat/completions')
  })

  it('openai：已含 /chat/completions（带尾斜杠）不重复拼接', () => {
    expect(
      resolveEndpoint(provider({ baseUrl: 'https://api.openai.com/v1/chat/completions/' }))
    ).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('openai：末尾多个斜杠归一为单斜杠', () => {
    expect(resolveEndpoint(provider({ baseUrl: 'https://api.deepseek.com///' }))).toBe(
      'https://api.deepseek.com/chat/completions'
    )
  })

  it('anthropic：官方域名补 /v1/messages', () => {
    expect(
      resolveEndpoint(provider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' }))
    ).toBe('https://api.anthropic.com/v1/messages')
  })

  it('anthropic：DeepSeek 的 /anthropic 端点再补 /v1/messages', () => {
    expect(
      resolveEndpoint(
        provider({ protocol: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' })
      )
    ).toBe('https://api.deepseek.com/anthropic/v1/messages')
  })

  it('anthropic：已含 /v1 不重复追加', () => {
    expect(
      resolveEndpoint(provider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }))
    ).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('buildChatRequest 鉴权头', () => {
  it('openai 有 key：只发 Bearer，不带 anthropic-version', () => {
    const { headers } = buildChatRequest(provider(), CONTENT, 800)
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers['anthropic-version']).toBeUndefined()
  })

  it('openai 空 key：不发任何鉴权头', () => {
    const { headers } = buildChatRequest(provider({ apiKey: '' }), CONTENT, 800)
    expect(headers.Authorization).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('anthropic 有 key：x-api-key 与 Bearer 双发，并带 anthropic-version', () => {
    const { headers } = buildChatRequest(provider({ protocol: 'anthropic' }), CONTENT, 800)
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('anthropic 空 key：不发鉴权头但仍带 anthropic-version', () => {
    const { headers } = buildChatRequest(provider({ protocol: 'anthropic', apiKey: '' }), CONTENT, 800)
    expect(headers['x-api-key']).toBeUndefined()
    expect(headers.Authorization).toBeUndefined()
    expect(headers['anthropic-version']).toBe('2023-06-01')
  })
})

describe('buildChatRequest 请求体', () => {
  it('openai：图片走 image_url 的 data URL', () => {
    const body = bodyOf(buildChatRequest(provider(), CONTENT, 800))
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '翻译这张图' })
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,AAA' },
    })
  })

  it('anthropic：图片走 image 的 base64 source', () => {
    const body = bodyOf(buildChatRequest(provider({ protocol: 'anthropic' }), CONTENT, 800))
    expect(body.messages[0].content[0]).toEqual({ type: 'text', text: '翻译这张图' })
    expect(body.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' },
    })
  })

  it('两协议采样参数一致', () => {
    const openai = bodyOf(buildChatRequest(provider(), CONTENT, 850))
    const anthropic = bodyOf(buildChatRequest(provider({ protocol: 'anthropic' }), CONTENT, 850))
    for (const body of [openai, anthropic]) {
      expect(body.model).toBe('deepseek-flash')
      expect(body.temperature).toBe(0.2)
      expect(body.max_tokens).toBe(850)
      expect(body.messages).toHaveLength(1)
    }
  })
})

describe('extractReplyText', () => {
  it('openai：字符串内容原样返回', () => {
    expect(extractReplyText('openai', { choices: [{ message: { content: '你好' } }] })).toBe('你好')
  })

  it('openai：分段数组按 text / content 拼接', () => {
    const json = {
      choices: [{ message: { content: [{ text: '你' }, { content: '好' }, {}] } }],
    }
    expect(extractReplyText('openai', json)).toBe('你好')
  })

  it('anthropic：多个 text 块依次拼接', () => {
    const json = { content: [{ type: 'text', text: '{"text":' }, { type: 'text', text: '"你好"}' }] }
    expect(extractReplyText('anthropic', json)).toBe('{"text":"你好"}')
  })

  it('anthropic：thinking 等非 text 块被丢弃', () => {
    const json = {
      content: [
        { type: 'thinking', thinking: '{"text":"错误"}' },
        { type: 'text', text: '{"text":"正确"}' },
        { type: 'tool_use', id: 'x' },
      ],
    }
    expect(extractReplyText('anthropic', json)).toBe('{"text":"正确"}')
  })

  it('anthropic：content 缺失或非数组返回空串', () => {
    expect(extractReplyText('anthropic', null)).toBe('')
    expect(extractReplyText('anthropic', {})).toBe('')
    expect(extractReplyText('anthropic', { content: 'oops' })).toBe('')
  })

  it('空文本块返回空串（交由上层走未识别兜底）', () => {
    expect(extractReplyText('anthropic', { content: [{ type: 'text', text: '' }] })).toBe('')
    expect(extractReplyText('openai', { choices: [] })).toBe('')
  })
})

describe('buildChatRequest 思考模式开关', () => {
  it('默认显式关闭思考，两协议一致', () => {
    const openai = bodyOf(buildChatRequest(provider(), CONTENT, 800)) as RequestBody & {
      thinking?: { type?: string }
    }
    expect(openai.thinking).toEqual({ type: 'disabled' })
    const anthropic = bodyOf(
      buildChatRequest(provider({ protocol: 'anthropic' }), CONTENT, 800)
    ) as RequestBody & { thinking?: { type?: string } }
    expect(anthropic.thinking).toEqual({ type: 'disabled' })
  })

  it('thinkingControl=false 时不带该字段（端点不接受时重试）', () => {
    const body = bodyOf(
      buildChatRequest(provider(), CONTENT, 800, { thinkingControl: false })
    ) as RequestBody & { thinking?: unknown }
    expect('thinking' in body).toBe(false)
  })
})

describe('describeChatResponse 响应结构摘要', () => {
  it('openai：给出 finish_reason 与 message 字段名', () => {
    const json = {
      choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '…' } }],
    }
    expect(describeChatResponse('openai', json)).toBe('finish=length keys=content,reasoning_content')
  })

  it('anthropic：给出 stop_reason 与内容块类型', () => {
    expect(describeChatResponse('anthropic', { stop_reason: 'max_tokens', content: [{ type: 'thinking' }] })).toBe(
      'stop=max_tokens blocks=thinking'
    )
  })

  it('结构缺失时不抛错', () => {
    expect(describeChatResponse('openai', null)).toBe('finish=? keys=none')
    expect(describeChatResponse('anthropic', {})).toBe('stop=? blocks=none')
  })
})
