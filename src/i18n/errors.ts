// 渲染层统一错误文案入口：IpcError 按 ErrorCode 映射当前语言，第三方引擎错误原文透传
// 对应设计文档 specs/多语言界面切换设计方案-20261021.md §6.2

import type { ErrorCode } from '../../shared/types'
import { IpcError } from '../services/ipc'
import { t, type MessageKey } from './index'

/** ErrorCode → 词典键；新增 code 时此表在编译期提示补齐 */
const ERROR_KEYS: Record<ErrorCode, MessageKey> = {
  FILE_NOT_FOUND: 'error.FILE_NOT_FOUND',
  PDF_INVALID: 'error.PDF_INVALID',
  PDF_ENCRYPTED: 'error.PDF_ENCRYPTED',
  PATH_EXISTS: 'error.PATH_EXISTS',
  INVALID_PARAMS: 'error.INVALID_PARAMS',
  DB_ERROR: 'error.DB_ERROR',
  UPDATER_UNAVAILABLE: 'error.UPDATER_UNAVAILABLE',
  UPDATER_FAILED: 'error.UPDATER_FAILED',
  UNKNOWN: 'error.UNKNOWN',
}

/** 统一错误文案：主进程错误按 code 本地化；pdf.js / epub.js 等第三方错误原文展示 */
export function localizeError(e: unknown): string {
  if (e instanceof IpcError) return t(ERROR_KEYS[e.code] ?? 'error.UNKNOWN')
  if (e instanceof Error) return e.message
  return String(e)
}
