// 设置读写编排：默认阅读方向变更时同步零进度书的方向
// 对应设计文档 specs/默认阅读方向同步零进度书设计方案-20261025.md §3

import { getDatabase } from '../db/database'
import { progressRepo } from '../db/repos/progressRepo'
import { settingsRepo } from '../db/repos/settingsRepo'
import { isUnstartedProgress, type Direction, type Settings } from '../../shared/types'
import * as logger from './logger'

/**
 * 事务内执行：把零进度书的 direction 对齐到新的默认方向。
 * 只写方向列——页码/模式/缩放/updated_at 保持原值，方向同步不属于阅读行为。
 * @param direction 新的默认阅读方向
 * @returns 实际被改写的行数
 */
function syncUnstartedDirection(direction: Direction): number {
  let changed = 0
  for (const row of progressRepo.listForDirectionSync()) {
    if (!isUnstartedProgress(row.page, row.percentage)) continue
    // 已是目标值：跳过写入，避免同步计数虚高
    if (row.direction === direction) continue
    progressRepo.updateDirection(row.book_id, direction)
    changed++
  }
  return changed
}

export const settingsService = {
  /**
   * 合并写入设置；若默认阅读方向实际变化，同事务内同步所有零进度书的方向。
   * 两步必须原子：否则会出现「设置已生效、零进度书仍用旧方向」的中间态。
   * @param partial 本次要修改的设置字段
   */
  patch(partial: Partial<Settings>): Settings {
    const run = getDatabase().transaction((p: Partial<Settings>) => {
      const prev = settingsRepo.getAll()
      const next = settingsRepo.patch(p)
      const directionChanged = next.defaultDirection !== prev.defaultDirection
      const synced = directionChanged ? syncUnstartedDirection(next.defaultDirection) : 0
      return { next, directionChanged, synced }
    })
    const { next, directionChanged, synced } = run(partial)
    if (directionChanged) {
      logger.info(`[settings] 默认阅读方向 → ${next.defaultDirection}，同步零进度书 ${synced} 本`)
    }
    return next
  },
}
