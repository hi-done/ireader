// i18n 内核与词典一致性单测：语言解析、插值、复数、回退与三语言同构
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §11.1

import { afterEach, describe, expect, it } from 'vitest'
import { resolveLocale } from '../../shared/types'
import { appLocale, setLocale, t, tp } from './index'
import { zhCN, type MessageKey } from './locales/zh-CN'
import { en } from './locales/en'
import { ja } from './locales/ja'

afterEach(() => setLocale('zh-CN'))

describe('resolveLocale', () => {
  it('显式三档原样返回', () => {
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN')
    expect(resolveLocale('en', 'zh-CN')).toBe('en')
    expect(resolveLocale('ja', 'zh-CN')).toBe('ja')
  })

  it('system 按系统语言前缀匹配，其余回退英文', () => {
    expect(resolveLocale('system', 'zh-TW')).toBe('zh-CN')
    expect(resolveLocale('system', 'ja-JP')).toBe('ja')
    expect(resolveLocale('system', 'ko-KR')).toBe('en')
    expect(resolveLocale('system', 'en-US')).toBe('en')
    expect(resolveLocale('system', '')).toBe('en')
  })
})

describe('t', () => {
  it('插值替换占位符', () => {
    expect(t('library.book.progress', { percent: 42 })).toBe('阅读进度 42%')
  })

  it('缺失参数保留占位符原样', () => {
    expect(t('library.book.progress')).toBe('阅读进度 {percent}%')
  })

  it('缺失键回退中文而不是裸键名', () => {
    const result = t('missing.key' as MessageKey)
    expect(result).not.toBe('missing.key')
    expect(result).toBe(zhCN['error.UNKNOWN'])
  })

  it('英文界面取英文文案', () => {
    setLocale('en')
    expect(t('common.cancel')).toBe('Cancel')
  })
})

describe('tp', () => {
  it('英文区分单复数', () => {
    setLocale('en')
    expect(tp('format.relative.daysAgo', 1)).toBe('1 day ago')
    expect(tp('format.relative.daysAgo', 2)).toBe('2 days ago')
  })

  it('中文与日文无复数变化，均取 other', () => {
    setLocale('zh-CN')
    expect(tp('format.relative.daysAgo', 1)).toBe('1 天前')
    setLocale('ja')
    expect(tp('format.relative.daysAgo', 1)).toBe('1日前')
  })

  it('注入 {count} 且不覆盖调用方其他参数', () => {
    setLocale('en')
    expect(tp('library.addDialog.selected', 3, { count: 999 })).toBe('3 selected')
  })
})

describe('setLocale', () => {
  it('更新 appLocale，node 环境无 DOM 不抛错', () => {
    expect(() => setLocale('ja')).not.toThrow()
    expect(appLocale.value).toBe('ja')
  })
})

/** 提取模板占位符名并排序，用于跨语言一致性断言 */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('词典同构', () => {
  const keys = Object.keys(zhCN).sort()

  it('三语言键集合完全相等', () => {
    expect(Object.keys(en).sort()).toEqual(keys)
    expect(Object.keys(ja).sort()).toEqual(keys)
  })

  it('三语言均无空值', () => {
    for (const key of keys as MessageKey[]) {
      expect(en[key].length).toBeGreaterThan(0)
      expect(ja[key].length).toBeGreaterThan(0)
    }
  })

  it('同键占位符集合相等', () => {
    for (const key of keys as MessageKey[]) {
      expect(placeholders(en[key])).toEqual(placeholders(zhCN[key]))
      expect(placeholders(ja[key])).toEqual(placeholders(zhCN[key]))
    }
  })
})
