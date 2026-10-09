// settings 表数据访问（key-value，value 为 JSON 字符串）
// 对应设计文档 §5.1 / §4.4

import { getDatabase } from '../database'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types'

const SETTINGS_KEY = 'app'

export const settingsRepo = {
  getAll(): Settings {
    const row = getDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined
    if (!row) return { ...DEFAULT_SETTINGS }
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) }
    } catch {
      return { ...DEFAULT_SETTINGS }
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
