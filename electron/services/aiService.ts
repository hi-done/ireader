// AI 翻译服务：配置解析、参数校验、单点外网请求与错误映射、译文记录编排
// 对应设计文档《20261102-AI框选翻译功能设计方案》§6.2 / §7.1
// 网络边界：只有用户动作触发的两个入口（框选翻译 ai:translate / 测试连接 ai:test）会外发请求，无后台轮询

import { AI_PROTOCOLS } from '../../shared/types'
import type {
  AiProtocol,
  AiProviderConfig,
  AiRect,
  AiTestResult,
  AiTranslatePayload,
  AiTranslateResult,
  AiTranslationInput,
  AiTranslationRecord,
} from '../../shared/types'
import { aiTranslationsRepo } from '../db/repos/aiTranslationsRepo'
import { settingsRepo } from '../db/repos/settingsRepo'
import { buildTranslatePrompt, extractReply, clampFontRatio, MAX_TEXT_LEN } from './aiReply'
import {
  buildChatRequest,
  describeChatResponse,
  extractReplyText,
  type AiChatContent,
  type AiChatRequest,
} from './aiProtocol'
import { libraryService } from './libraryService'
import * as logger from './logger'

/** 单次请求超时：漫画家用大图偶有长尾，60s 仍无响应按失败处理 */
const REQUEST_TIMEOUT_MS = 60_000
/** base64 图片载荷上限（≈3MB 原始字节）：超出说明裁剪逻辑异常，拒收 */
const MAX_IMAGE_BASE64_LEN = 4_000_000
/** 框选矩形最小边长（相对页宽/页高）：更小视为误触 */
const MIN_RECT_SIDE = 0.01
/** 输出上限：关闭思考后 1500 足够（长译文 + JSON 包装留余量）；Anthropic 的 max_tokens 必填，两协议统一传值 */
const MAX_OUTPUT_TOKENS = 1500

function invalid(message: string): never {
  throw { code: 'INVALID_PARAMS', message }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** 矩形校验并夹取到页盒内；非法返回 null */
function resolveRect(raw: unknown): AiRect | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiRect>
  const values = [r.x, r.y, r.w, r.h].map((v) => Number(v))
  if (values.some((v) => !Number.isFinite(v))) return null
  const [x, y, w, h] = values
  if (w < MIN_RECT_SIDE || h < MIN_RECT_SIDE) return null
  const left = Math.min(Math.max(x, 0), 1)
  const top = Math.min(Math.max(y, 0), 1)
  return {
    x: left,
    y: top,
    w: Math.min(w, 1 - left),
    h: Math.min(h, 1 - top),
  }
}

/** 单次 POST：网络层异常向上抛，HTTP 状态与响应文本原样返回，便于按需重试 */
async function postChat(
  req: AiChatRequest,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(req.body),
      signal: controller.signal,
    })
    return { status: res.status, ok: res.ok, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 单点外网请求：按配置协议走 OpenAI 兼容 /chat/completions 或 Anthropic 兼容 /v1/messages。
 * 只在此处触及网络，错误统一映射为三个 AI 错误码，日志不写 apiKey、不写图片内容。
 */
async function requestChat(
  provider: AiProviderConfig,
  content: AiChatContent[],
  timeoutMs: number
): Promise<unknown> {
  // URL、鉴权头、图片内容块均由 aiProtocol 按协议构造
  let res: { status: number; ok: boolean; text: string }
  try {
    // 默认显式关闭思考模式：DeepSeek 默认开启，思维链会吃光 max_tokens 让 content 变空
    res = await postChat(buildChatRequest(provider, content, MAX_OUTPUT_TOKENS), timeoutMs)
    if (res.status === 400 && /thinking/i.test(res.text)) {
      // 端点不认识 thinking 字段（如 OpenAI 官方）：去掉后重试一次
      logger.warn(`[ai] 端点不接受 thinking 参数，去掉后重试 model=${provider.model}`)
      res = await postChat(
        buildChatRequest(provider, content, MAX_OUTPUT_TOKENS, { thinkingControl: false }),
        timeoutMs
      )
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    logger.warn(`[ai] 请求失败 model=${provider.model} reason=${reason}`)
    throw { code: 'AI_REQUEST_FAILED', message: '网络请求失败或超时' }
  }

  if (res.status === 401 || res.status === 403) {
    logger.warn(`[ai] 鉴权失败 model=${provider.model} status=${res.status}`)
    throw { code: 'AI_AUTH_FAILED', message: `鉴权失败（HTTP ${res.status}）` }
  }
  if (!res.ok) {
    // 错误体只取前 300 字：足够定位（余额不足 / 模型不存在），又不至于把响应灌进日志
    logger.warn(`[ai] 接口错误 model=${provider.model} status=${res.status} body=${res.text.slice(0, 300)}`)
    throw { code: 'AI_REQUEST_FAILED', message: `接口返回错误（HTTP ${res.status}）` }
  }
  try {
    return JSON.parse(res.text)
  } catch {
    throw { code: 'AI_REQUEST_FAILED', message: '接口返回内容不是合法 JSON' }
  }
}

/** 校验草稿配置：配置页「测试连接」用的是表单里尚未保存的值 */
function validateProvider(raw: unknown): AiProviderConfig {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiProviderConfig>
  const baseUrl = typeof p.baseUrl === 'string' ? p.baseUrl.trim() : ''
  if (!/^https?:\/\//.test(baseUrl)) invalid('baseUrl 必须以 http:// 或 https:// 开头')
  const apiKey = typeof p.apiKey === 'string' ? p.apiKey.trim() : ''
  const model = typeof p.model === 'string' ? p.model.trim() : ''
  if (!model) invalid('model 不能为空')
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  // 草稿本身未经过 normalizeAiSettings：协议非法/缺失时按 openai 处理，避免测试连接凭空报错
  const protocol = (AI_PROTOCOLS as readonly string[]).includes(p.protocol as string)
    ? (p.protocol as AiProtocol)
    : 'openai'
  return { id: Number(p.id) || 0, name: name || model, baseUrl, apiKey, model, protocol }
}

/** 读取当前启用中的服务配置；未开启 / 未选择时抛 AI_NOT_CONFIGURED */
function activeProvider(): AiProviderConfig {
  const ai = settingsRepo.getAll().ai
  if (!ai.enabled) throw { code: 'AI_NOT_CONFIGURED', message: 'AI 翻译未启用' }
  const provider = ai.providers.find((p) => p.id === ai.activeProviderId)
  if (!provider) throw { code: 'AI_NOT_CONFIGURED', message: '未选择可用的 AI 配置' }
  return provider
}

export const aiService = {
  /** 翻译一张框选图：不落库，落库由渲染层拿到结果后调 save */
  async translate(payload: AiTranslatePayload): Promise<AiTranslateResult> {
    const provider = activeProvider()
    const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<AiTranslatePayload>

    if (!isPositiveInt(p.bookId) || !libraryService.getById(p.bookId)) {
      throw { code: 'FILE_NOT_FOUND', message: 'book not found' }
    }
    if (!isPositiveInt(p.page)) invalid('page 必须是正整数')
    const image = typeof p.imageBase64 === 'string' ? p.imageBase64 : ''
    if (!image) invalid('imageBase64 不能为空')
    if (image.length > MAX_IMAGE_BASE64_LEN) invalid('imageBase64 超出长度上限')

    const bookTitle = (typeof p.bookTitle === 'string' ? p.bookTitle : '').slice(0, 200)
    const targetLang = settingsRepo.getAll().ai.targetLang
    const prompt = buildTranslatePrompt({ bookTitle, targetLang })

    const startedAt = Date.now()
    const json = await requestChat(
      provider,
      [
        { type: 'text', text: prompt },
        { type: 'image', base64: image },
      ],
      REQUEST_TIMEOUT_MS
    )
    const result = (() => {
      const replyText = extractReplyText(provider.protocol, json)
      try {
        return extractReply(replyText)
      } catch (e) {
        // 解析失败此前是静默的：把模型原文摘要写进日志，便于区分「模型未按 JSON 输出」与「接口层失败」
        const head = replyText.slice(0, 200).replace(/\s+/g, ' ')
        const shape = describeChatResponse(provider.protocol, json)
        logger.warn(`[ai] 解析失败 model=${provider.model} chars=${replyText.length} ${shape} head=${head}`)
        throw e
      }
    })()
    logger.info(
      `[ai] 翻译完成 model=${provider.model} page=${p.page} chars=${result.text.length} ratio=${result.fontRatio} ${Date.now() - startedAt}ms`
    )
    return result
  },

  /** 测试连接：最小文本请求，返回模型名与往返耗时 */
  async test(rawProvider: AiProviderConfig): Promise<AiTestResult> {
    const provider = validateProvider(rawProvider)
    const startedAt = Date.now()
    await requestChat(provider, [{ type: 'text', text: '请只回复：OK' }], 30_000)
    const latencyMs = Date.now() - startedAt
    logger.info(`[ai] 连接测试通过 model=${provider.model} ${latencyMs}ms`)
    return { model: provider.model, latencyMs }
  },

  /** 某书全部译文；书已删除（竞态）时返回空数组而不是报错 */
  list(bookId: number): AiTranslationRecord[] {
    if (!isPositiveInt(bookId) || !libraryService.getById(bookId)) return []
    return aiTranslationsRepo.listByBook(bookId)
  },

  /** 新增或更新一条译文（折叠状态、尺寸调整、换页重算都走这里） */
  save(input: AiTranslationInput): AiTranslationRecord {
    const p = (input && typeof input === 'object' ? input : {}) as Partial<AiTranslationInput>
    if (!isPositiveInt(p.bookId) || !libraryService.getById(p.bookId)) {
      throw { code: 'FILE_NOT_FOUND', message: 'book not found' }
    }
    if (!isPositiveInt(p.page)) invalid('page 必须是正整数')
    const rect = resolveRect(p.rect)
    if (!rect) invalid('rect 非法')
    const text = (typeof p.text === 'string' ? p.text : '').slice(0, MAX_TEXT_LEN)

    const fields = {
      rect,
      text,
      fontRatio: clampFontRatio(p.fontRatio),
      collapsed: p.collapsed === true,
    }

    if (p.id == null) {
      return aiTranslationsRepo.insert(p.bookId, p.page, fields, Date.now())
    }
    if (!isPositiveInt(p.id) || !aiTranslationsRepo.findById(p.id)) invalid('译文记录不存在')
    aiTranslationsRepo.update(p.id, fields)
    return aiTranslationsRepo.findById(p.id) as AiTranslationRecord
  },

  /** 删除单条译文；id 非法直接拒绝，记录不存在时静默成功（删除幂等） */
  remove(id: number): void {
    if (!isPositiveInt(id)) invalid('id 必须是正整数')
    aiTranslationsRepo.remove(id)
  },
}
