import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_LEN,
  buildTranslatePrompt,
  clampFontRatio,
  extractReply,
} from './aiReply'

describe('extractReply 模型响应解析', () => {
  it('标准 JSON 直接取 text 与 fontRatio', () => {
    expect(extractReply('{"text":"你好","fontRatio":0.05}')).toEqual({ text: '你好', fontRatio: 0.05 })
  })

  it('```json 围栏可解析', () => {
    const content = '```json\n{"text":"闭嘴","fontRatio":0.07}\n```'
    expect(extractReply(content)).toEqual({ text: '闭嘴', fontRatio: 0.07 })
  })

  it('前后夹杂说明文字时取第一个 { 到最后一个 }', () => {
    const content = '好的，结果如下：{"text":"快跑","fontRatio":0.04} 希望对你有帮助'
    expect(extractReply(content)).toEqual({ text: '快跑', fontRatio: 0.04 })
  })

  it('空 text 视为未识别到文字，不抛错', () => {
    expect(extractReply('{"text":"","fontRatio":0.06}')).toEqual({ text: '', fontRatio: 0.06 })
  })

  it('缺失 text 时回退空串（交由渲染层显示兜底文案）', () => {
    expect(extractReply('{"fontRatio":0.06}').text).toBe('')
  })

  it('fontRatio 缺失或非数时回退默认 0.06', () => {
    expect(extractReply('{"text":"a"}').fontRatio).toBe(0.06)
    expect(extractReply('{"text":"a","fontRatio":"abc"}').fontRatio).toBe(0.06)
  })

  it('超长文本截断到 MAX_TEXT_LEN', () => {
    const long = 'あ'.repeat(MAX_TEXT_LEN + 50)
    expect(extractReply(`{"text":"${long}"}`).text).toHaveLength(MAX_TEXT_LEN)
  })

  it('无 JSON 时抛 AI_REQUEST_FAILED', () => {
    expect(() => extractReply('抱歉，我无法识别这张图片')).toThrowError()
    try {
      extractReply('抱歉，我无法识别这张图片')
    } catch (e) {
      expect((e as { code: string }).code).toBe('AI_REQUEST_FAILED')
    }
  })

  it('JSON 不合法时抛 AI_REQUEST_FAILED', () => {
    expect(() => extractReply('{text: 坏掉的}')).toThrowError()
  })

  it('模型直接回纯文本（未包 JSON）时当译文收入', () => {
    expect(extractReply('闭嘴')).toEqual({ text: '闭嘴', fontRatio: 0.06 })
  })

  it('拒绝语不被当作译文', () => {
    expect(() => extractReply('抱歉，我无法识别这张图片')).toThrowError()
  })

  it('被截断的 JSON 用正则抢救 text 与 fontRatio', () => {
    expect(extractReply('{"text":"快跑","fontRatio":0.08,"x":')).toEqual({
      text: '快跑',
      fontRatio: 0.08,
    })
    // 比例被截断成 0.0：按非法值回退默认
    expect(extractReply('{"text":"快跑","fontRatio":0.0')).toEqual({ text: '快跑', fontRatio: 0.06 })
  })

  it('尾随逗号等非法 JSON 也能抢救', () => {
    expect(extractReply('{"text":"闭嘴","fontRatio":0.05,}')).toEqual({
      text: '闭嘴',
      fontRatio: 0.05,
    })
  })

  it('译文内含转义引号时按 JSON 解码', () => {
    expect(extractReply('{"text":"他说\\"快跑\\"","fontRatio":0.04}')).toEqual({
      text: '他说"快跑"',
      fontRatio: 0.04,
    })
  })

  it('空内容与超长纯文本仍抛错', () => {
    expect(() => extractReply('')).toThrowError()
    expect(() => extractReply('あ'.repeat(201))).toThrowError()
  })
})

describe('clampFontRatio 字号比例归一', () => {
  it('缺失与非法值回退默认', () => {
    expect(clampFontRatio(undefined)).toBe(0.06)
    expect(clampFontRatio(null)).toBe(0.06)
    expect(clampFontRatio(Number.NaN)).toBe(0.06)
  })

  it('越界值夹取到上下限', () => {
    expect(clampFontRatio(0.001)).toBe(0.02)
    expect(clampFontRatio(0.9)).toBe(0.15)
  })

  it('区间内数值原样返回', () => {
    expect(clampFontRatio(0.1)).toBe(0.1)
  })

  it('字符串数字可解析', () => {
    expect(clampFontRatio('0.08')).toBe(0.08)
  })
})

describe('buildTranslatePrompt 提示词', () => {
  it('包含书名与目标语言', () => {
    const prompt = buildTranslatePrompt({ bookTitle: '海贼王', targetLang: 'zh-CN' })
    expect(prompt).toContain('《海贼王》')
    expect(prompt).toContain('简体中文')
  })

  it('英文目标语言写入对应语种名', () => {
    expect(buildTranslatePrompt({ bookTitle: 'ONE PIECE', targetLang: 'en' })).toContain('英文')
  })

  it('强制 JSON 与 fontRatio 输出口径', () => {
    const prompt = buildTranslatePrompt({ bookTitle: 'X', targetLang: 'ja' })
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('fontRatio')
    expect(prompt).toContain('"text"')
  })

  it('书名换行与首尾空白被收敛，空书名回退占位', () => {
    expect(buildTranslatePrompt({ bookTitle: '  甲\n乙  ', targetLang: 'zh-CN' })).toContain('《甲 乙》')
    expect(buildTranslatePrompt({ bookTitle: '   ', targetLang: 'zh-CN' })).toContain('《未命名作品》')
  })

  it('超长书名截断，不把整段正文带进提示词', () => {
    const prompt = buildTranslatePrompt({ bookTitle: 'あ'.repeat(300), targetLang: 'zh-CN' })
    expect(prompt).not.toContain('あ'.repeat(121))
  })
})
