// 阅读计时接线：ReadingTimer + 窗口事件 + IPC 上报（模块级单例）
// 对应设计文档《阅读时间统计功能设计方案》§8.2
// 纯计时逻辑在 readingTimer.ts；本文件只做副作用接线，不承载可测逻辑

import { ReadingTimer } from './readingTimer'
import { ipc } from './ipc'

let timer: ReadingTimer | null = null
/** 外部主动挂起（如加载失败页停留时不计时），恢复后按可见性重新评估 */
let suspended = false
let listenersBound = false

function ensureTimer(): ReadingTimer {
  if (!timer) {
    timer = new ReadingTimer({
      onReport: (r) => {
        // 统计上报失败静默：可丢弃数据，绝不能影响阅读主流程
        ipc.stats.addTime(r.bookId, r.day, r.deltaMs).catch(() => undefined)
      },
    })
    bindWindowEvents()
  }
  return timer
}

function bindWindowEvents(): void {
  if (listenersBound) return
  listenersBound = true
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('blur', sync)
  window.addEventListener('focus', sync)
}

/** 活跃判定：未挂起 + 页面可见 + 窗口聚焦 */
function sync(): void {
  if (!timer) return
  const active = !suspended && document.visibilityState === 'visible' && document.hasFocus()
  if (active) timer.resume()
  else timer.pause()
}

/** 阅读页打开/换书：开始或切换计时（换书由 Timer 内部先结算旧书） */
export function startTracking(bookId: number): void {
  if (!Number.isFinite(bookId)) return
  ensureTimer().start(bookId)
  sync() // 立即校正：窗口无焦点/不可见时先置为暂停，待 focus/visible 再恢复
}

/** 离开阅读页：结算并停止计时 */
export function stopTracking(): void {
  timer?.stop()
}

/** 临时挂起/恢复（加载失败等场景）；恢复时结合可见性与焦点重新评估 */
export function setTrackingPaused(paused: boolean): void {
  suspended = paused
  sync()
}
