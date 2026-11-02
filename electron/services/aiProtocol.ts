// AI 请求协议适配：URL 归一、鉴权头与图片内容块按协议分支、响应文本取值
// 对应设计文档《20261102-AI翻译多协议适配设计方案》§4 / §7.1
// 纯函数无副作用：便于单测，也让 aiService 只保留校验与编排

import type { AiProtocol, AiProviderConfig } from '../../shared/types'

/** Anthropic 协议版本头：官方要求必填，DeepSeek 兼容层同样接受 */
const ANTHROPIC_VERSION = '2023-06-01'

/** 与协议无关的内容块，由调用方拼装，这里再翻译成各协议的结构 */
export type AiChatContent = { type: 'text'; text: string } | { type: 'image'; base64: string }

export interface AiChatRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface AiChatRequestOptions {
  /** 是否在请求体里显式关闭思考模式（默认 true）；端点不认该字段时由调用方去掉后重试 */
  thinkingControl?: boolean
}

/** OpenAI 兼容的图片块：base64 走 data URL 内联 */
interface OpenAiBlock {
  type: string
  text?: string
  image_url?: { url: string }
}

/** Anthropic 兼容的图片块：base64 需显式声明 media_type */
interface AnthropicBlock {
  type: string
  text?: string
  source?: { type: 'base64'; media_type: string; data: string }
}

/** 拼请求地址：先裁尾斜杠；已含目标路径时不再重复拼接 */
export function resolveEndpoint(provider: AiProviderConfig): string {
  const base = provider.baseUrl.trim().replace(/\/+$/, '')
  if (provider.protocol === 'anthropic') {
    // 官方 base 为 https://api.anthropic.com；DeepSeek 为 .../anthropic，两者都需再补 /v1/messages
    return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`
  }
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function toOpenAiBlock(content: AiChatContent): OpenAiBlock {
  if (content.type === 'text') return { type: 'text', text: content.text }
  // 裁图侧只产出 JPEG，media 类型固定
  return { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${content.base64}` } }
}

function toAnthropicBlock(content: AiChatContent): AnthropicBlock {
  if (content.type === 'text') return { type: 'text', text: content.text }
  return {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: content.base64 },
  }
}

/**
 * 按协议构造请求：图片块结构与鉴权头不同，采样参数保持一致。
 * apiKey 留空时不发鉴权头（本地服务常不校验密钥，部分服务对空 Bearer 直接 401）。
 */
export function buildChatRequest(
  provider: AiProviderConfig,
  content: AiChatContent[],
  maxTokens: number,
  options: AiChatRequestOptions = {}
): AiChatRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // DeepSeek 等端点默认开启思考：思维链会吃光 max_tokens，导致 content 为空、解析失败
  const thinking = options.thinkingControl === false ? {} : { thinking: { type: 'disabled' } }

  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_VERSION
    if (provider.apiKey) {
      // 双发：官方只认 x-api-key，部分第三方网关只认 Bearer
      headers['x-api-key'] = provider.apiKey
      headers.Authorization = `Bearer ${provider.apiKey}`
    }
    return {
      url: resolveEndpoint(provider),
      headers,
      body: {
        model: provider.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        ...thinking,
        messages: [{ role: 'user', content: content.map(toAnthropicBlock) }],
      },
    }
  }

  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
  return {
    url: resolveEndpoint(provider),
    headers,
    body: {
      model: provider.model,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...thinking,
      messages: [{ role: 'user', content: content.map(toOpenAiBlock) }],
    },
  }
}

/** 响应结构摘要（不含正文）：解析失败时写日志，用于区分「被思考吃光」「输出被截断」与「端点返回异常结构」 */
export function describeChatResponse(protocol: AiProtocol, json: unknown): string {
  if (protocol === 'anthropic') {
    const j = (json ?? {}) as { stop_reason?: unknown; content?: unknown }
    const blocks = Array.isArray(j.content)
      ? j.content.map((p) => String((p as { type?: unknown }).type ?? '?')).join(',')
      : ''
    return `stop=${String(j.stop_reason ?? '?')} blocks=${blocks || 'none'}`
  }
  const choice = (json as { choices?: { finish_reason?: unknown; message?: object }[] } | null)?.choices?.[0]
  const keys = choice?.message ? Object.keys(choice.message).join(',') : ''
  return `finish=${String(choice?.finish_reason ?? '?')} keys=${keys || 'none'}`
}

/** 按协议取回复文本；取不到一律返回空串，由上层降级为「未识别」兜底 */
export function extractReplyText(protocol: AiProtocol, json: unknown): string {
  if (protocol === 'anthropic') {
    const content = (json as { content?: unknown } | null)?.content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => {
        const p = part as { type?: unknown; text?: unknown }
        // 思考模式下会混入 thinking 等非文本块，只取 text 块以免污染 JSON 抽取
        return p.type === 'text' && typeof p.text === 'string' ? p.text : ''
      })
      .join('')
  }

  // OpenAI 兼容：choices[0].message.content 可能是字符串，也可能是分段数组
  const message = (json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]
    ?.message
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const p = part as { text?: unknown; content?: unknown }
        if (typeof p.text === 'string') return p.text
        if (typeof p.content === 'string') return p.content
        return ''
      })
      .join('')
  }
  return ''
}
