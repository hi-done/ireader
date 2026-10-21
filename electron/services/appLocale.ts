// 主进程界面语言解析：用户偏好优先，system 档读取 app.getLocale()
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §7.1

import { app } from 'electron'
import { DEFAULT_SETTINGS, resolveLocale, type AppLocale } from '../../shared/types'
import { settingsRepo } from '../db/repos/settingsRepo'

/** 主进程当前界面语言：每次实时读取设置，语言切换后无需重启或缓存失效 */
export function getAppLocale(): AppLocale {
  const { locale } = settingsRepo.getAll()
  return resolveLocale(locale ?? DEFAULT_SETTINGS.locale, app.getLocale())
}

/** 原生文件对话框过滤器名称（三语言）：唯一必须由主进程产出的内置文案 */
export function getBookFilesFilterName(): string {
  const names: Record<AppLocale, string> = {
    'zh-CN': '书籍与漫画',
    en: 'Books & Comics',
    ja: '書籍とコミック',
  }
  return names[getAppLocale()]
}
