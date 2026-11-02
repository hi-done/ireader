// settings 表数据访问（key-value，value 为 JSON 字符串）
// 对应设计文档 §5.1 / §4.4

import { getDatabase } from '../database'
import { DEFAULT_SETTINGS, normalizeAiSettings, type Settings } from '../../../shared/types'

const SETTINGS_KEY = 'app'

/** 默认值副本：ai 需逐字段归一化后返回，避免直接把 DEFAULT_SETTINGS.ai 引用交给调用方 */
function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ai: normalizeAiSettings(null) }
}

export const settingsRepo = {
  getAll(): Settings {
    const row = getDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined
    if (!row) return defaultSettings()
    try {
      // 浅合并后 ai 单独归一：旧库没有该字段，或持久化了手改脏数据时逐字段回退
      const parsed = JSON.parse(row.value) as Partial<Settings>
      return { ...DEFAULT_SETTINGS, ...parsed, ai: normalizeAiSettings(parsed.ai) }
    } catch {
      return defaultSettings()
    }
  },

  patch(partial: Partial<Settings>): Settings {
    const merged = { ...this.getAll(), ...partial }
    getDatabase()
      .prepare(
        `INSERT INTO settings (key, value) VALUES (@key, @value)
         ON CONFLICT(key) DO UPDATE SET value = @value`
      )
      .run({ key: SETTINGS_KEY, value: JSON.stringify(merged) })
    return merged
  },
}
