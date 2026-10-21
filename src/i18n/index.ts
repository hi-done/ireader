// 轻量自研 i18n 内核：模块级 ref 驱动模板响应式，零第三方依赖
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §8.1

import { computed, ref } from 'vue'
import { resolveLocale, type AppLocale } from '../../shared/types'
import { zhCN, type MessageKey } from './locales/zh-CN'
import { en } from './locales/en'
import { ja } from './locales/ja'

export type { MessageKey } from './locales/zh-CN'

/** 三语言词典：键集合由 zh-CN 类型基准保证严格同构 */
const dictionaries: Record<AppLocale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en,
  ja,
}

/** 渲染层系统语言；Vitest 等纯 node 环境无 navigator 时回退英文 */
function systemLanguage(): string {
  return typeof navigator !== 'undefined' && typeof navigator.language === 'string'
    ? navigator.language
    : 'en'
}

const locale = ref<AppLocale>(resolveLocale('system', systemLanguage()))

/** 当前生效语言（只读） */
export const appLocale = computed(() => locale.value)

/** 切换语言并同步 <html lang>（驱动日文字体栈与断词规则）；持久化由设置页负责 */
export function setLocale(next: AppLocale): void {
  locale.value = next
  if (typeof document !== 'undefined') document.documentElement.lang = next
}

/** 插值：{name} 占位；未提供的参数保留原样，便于开发期发现漏传 */
function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/** 取词并插值；缺失键按 当前语言 → zh-CN → error.UNKNOWN 回退，不向界面暴露裸键名 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = dictionaries[locale.value][key] ?? zhCN[key] ?? zhCN['error.UNKNOWN']
  return params ? interpolate(template, params) : template
}

/** 复数基础键：只允许存在 .one / .other 的基础键进入 tp() */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer Base}.other` ? Base : never
}[MessageKey]

/** 复数取词：按当前语言规则选 .one / .other，并注入 {count} */
export function tp(
  baseKey: PluralBase,
  count: number,
  params?: Record<string, string | number>
): string {
  const form = new Intl.PluralRules(locale.value).select(count)
  const dict = dictionaries[locale.value]
  const candidate = `${baseKey}.${form}` as MessageKey
  const key = candidate in dict ? candidate : (`${baseKey}.other` as MessageKey)
  return t(key, { ...params, count })
}
