// AI 译文请求的提示词构造与响应解析
// 对应设计文档《20261102-AI框选翻译功能设计方案》§4.3 / §4.4 / §7.2
// 纯逻辑、不 import electron，便于 Vitest 直接覆盖

import type { AiTargetLang, AiTranslateResult } from '../../shared/types'

/** 译文最大字数：防模型失控输出撑爆 UI，超出部分直接截断 */
export const MAX_TEXT_LEN = 2000

/** 字号比例（译文行高 ÷ 图片高度）默认值与上下限 */
export const DEFAULT_FONT_RATIO = 0.06
export const MIN_FONT_RATIO = 0.02
export const MAX_FONT_RATIO = 0.15

const TARGET_LANG_NAMES: Record<AiTargetLang, string> = {
  'zh-CN': '简体中文',
  en: '英文',
  ja: '日文',
}

/** 书名进提示词前先收敛长度与换行，避免被当成额外指令 */
function sanitizeTitle(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  return cleaned || '未命名作品'
}

/** fontRatio 归一：缺失/非数 → 默认值；越界 → 夹取到上下限 */
export function clampFontRatio(value: unknown): number {
  // 只接受数字与数字字符串：null / 布尔等会被 Number() 转成 0 而误判为合法值
  if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_FONT_RATIO
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FONT_RATIO
  return Math.min(MAX_FONT_RATIO, Math.max(MIN_FONT_RATIO, n))
}

/**
 * 漫画翻译提示词：书名定专名、目标语言定输出语种、强制纯 JSON 输出。
 * 提示词固定中文书写（模型侧兼容性最好），目标语言另行说明。
 */
export function buildTranslatePrompt(input: { bookTitle: string; targetLang: AiTargetLang }): string {
  const title = sanitizeTitle(input.bookTitle)
  const lang = TARGET_LANG_NAMES[input.targetLang] ?? TARGET_LANG_NAMES['zh-CN']
  return [
    '你是一名专业的漫画翻译助手。',
    '',
    '【任务】识别图片中全部对白、旁白与拟声词，并翻译为' + lang + '。',
    `【作品】《${title}》。人名、地名、招式名等专有名词必须使用该作品通行的${lang}译名，同一部作品内保持前后一致。`,
    '【顺序】画面中有多个气泡时，按日式漫画「从右到左、从上到下」的阅读顺序合并译文，每个气泡的译文单独占一行。',
    '【字号】结合原文字数与气泡高度估算译文行高，使译文能基本填满气泡。',
    '【输出】只输出一个 JSON 对象，不要解释、不要 Markdown 代码块、不要多余文字：',
    '{"text":"译文","fontRatio":0.06}',
    'fontRatio 是译文单行行高占图片高度的比例，取值 0.02 到 0.15。',
    '【空图】图中没有任何可译文字时，输出 {"text":"","fontRatio":0.06}。',
  ].join('\n')
}

/** 从非法 / 被截断的 JSON 片段里抢救 text 与 fontRatio：正则兜底，不依赖完整闭合 */
function salvageReply(json: string): AiTranslateResult | null {
  const textMatch = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(json)
  if (!textMatch) return null
  let text = textMatch[1]
  try {
    text = JSON.parse(`"${text}"`) as string
  } catch {
    // 转义不完整（多为输出被截断）：保留原始片段
  }
  const ratioMatch = /"fontRatio"\s*:\s*(-?\d*\.?\d+)/.exec(json)
  return {
    text: text.trim().slice(0, MAX_TEXT_LEN),
    fontRatio: clampFontRatio(ratioMatch ? Number(ratioMatch[1]) : undefined),
  }
}

/** 纯文本兜底：模型直接回译文（未包 JSON）时收入；拒绝语与 JSON 残片一律不认 */
function plainFallback(source: string): AiTranslateResult | null {
  const text = source.trim()
  if (!text || text.length > 200 || /[{}]/.test(text)) return null
  if (/抱歉|无法|不能|对不起|sorry|unable|cannot/i.test(text)) return null
  return { text: text.slice(0, MAX_TEXT_LEN), fontRatio: DEFAULT_FONT_RATIO }
}

/**
 * 从模型原始 content 抽取 { text, fontRatio }。
 * 容错顺序：完整 JSON → 非法/截断 JSON 正则抢救 → 纯文本译文 → 抛 AI_REQUEST_FAILED。
 * text 为空串是合法的「未识别到文字」结果，不视为错误。
 */
export function extractReply(content: string): AiTranslateResult {
  const source = String(content ?? '')
  const start = source.indexOf('{')
  if (start >= 0) {
    // 取第一个 { 到最后一个 }；无闭合括号（被截断）时一直取到结尾，交给 salvageReply
    const end = source.lastIndexOf('}')
    const json = end > start ? source.slice(start, end + 1) : source.slice(start)
    try {
      const raw = JSON.parse(json) as { text?: unknown; fontRatio?: unknown } | null
      const obj = raw && typeof raw === 'object' ? raw : {}
      const text = typeof obj.text === 'string' ? obj.text.trim().slice(0, MAX_TEXT_LEN) : ''
      return { text, fontRatio: clampFontRatio(obj.fontRatio) }
    } catch {
      const salvaged = salvageReply(json)
      if (salvaged) return salvaged
    }
  }
  const plain = plainFallback(source)
  if (plain) return plain
  throw { code: 'AI_REQUEST_FAILED', message: '模型返回内容无法解析' }
}
