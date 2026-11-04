// 全屏状态唯一来源（单例）：窗口全屏完全由主进程 BrowserWindow.setFullScreen 承载
// 渲染层不再使用 HTML Fullscreen API——那会留下 document.fullscreenElement 与窗口态两个真相，
// 且 HTML 全屏下 Esc 可能被系统层抢先处理，导致「退 AI 选词」误退全屏。
// 对应设计文档《20261103-AI选词工具栏隐藏与Esc优先级修复设计方案》§4.3

import { readonly, ref, watch } from 'vue'
import { ipc } from './ipc'

const state = ref(false)
let inited = false
/** 最近一次「全屏 → 非全屏」的时刻（毫秒时间戳，0 = 从未发生） */
let exitedAt = 0
/** 主动退出全屏标记：应用自己退的不算「被 Esc 抢先退掉」，否则接下来那次 Esc 会被误吞 */
let selfExit = false

// state 是全屏唯一真相：由它推导「刚刚退过全屏」，避免各视图各记一份
watch(state, (on, was) => {
  if (!was || on) return
  if (selfExit) selfExit = false
  else exitedAt = Date.now()
})

/** 只读全屏状态：Esc 优先级判定与翻页诊断日志读同一处 */
export const isFullscreen = readonly(state)

/**
 * 启动时调用一次（src/main.ts 的 bootstrap）：
 * 订阅主进程广播覆盖所有窗口级变化，再查询一次当前态兜底「已在全屏时进入应用」。
 */
export function initFullscreenSync(): void {
  if (inited) return
  inited = true
  ipc.window.onFullscreenChanged(({ fullscreen }) => {
    state.value = fullscreen
  })
  ipc.window
    .getFullscreen()
    .then((on) => {
      state.value = on
    })
    .catch(() => undefined) // 主进程不可用时按非全屏处理，不阻断启动
}

/** 切换全屏（F 键 / 顶栏 ⛶） */
export async function toggleFullscreen(): Promise<void> {
  await setFullscreen(!state.value)
  // 切换后按窗口真实态校正一次：平台若不派发 enter/leave-full-screen，
  // 乐观值会与实际脱节（表现为 F 键退不出全屏、Esc 直接返回文库）
  syncFromMain()
}

/**
 * 本次 Esc 是否「刚刚已经用于退出全屏」。
 * Windows 上窗口全屏时按 Esc 可能先被窗口层处理，等 keydown 到达渲染层时 isFullscreen
 * 已变假——此时必须当成「退全屏」而非「返回文库」，否则一次 Esc 会退全屏 + 跳回主页。
 */
export function exitedFullscreenRecently(ms = 400): boolean {
  return exitedAt > 0 && Date.now() - exitedAt <= ms
}

/** 退出全屏（Esc 在「非选词态 + 全屏」时走这里） */
export async function exitFullscreen(): Promise<void> {
  await setFullscreen(false)
}

/**
 * 乐观置位再下发：刚按 F 立刻按 Esc 也能读到正确状态；
 * 事件回传与乐观值一致时幂等，失败则回滚避免状态与窗口脱节。
 */
async function setFullscreen(next: boolean): Promise<void> {
  const before = state.value
  if (before === next) return
  if (!next) selfExit = true // 主动退出：不记「刚被退掉」，下一次 Esc 照常返回文库
  state.value = next
  try {
    await ipc.window.setFullscreen(next)
  } catch (e) {
    selfExit = false // state 回滚到全屏：本次失败不应影响后续的退出判定
    state.value = before
    console.warn('[fullscreen] 切换失败', e)
  }
}

/** 校正序号：连续切换时只让最后一次查询落地，避免旧结果覆盖新状态 */
let syncSeq = 0

/** 延迟读一次主进程的真实全屏态（窗口切换完成之后才可信） */
function syncFromMain(delayMs = 400): void {
  const seq = ++syncSeq
  setTimeout(() => {
    if (seq !== syncSeq) return
    void ipc.window
      .getFullscreen()
      .then((on) => {
        if (seq === syncSeq) state.value = on
      })
      .catch(() => undefined)
  }, delayMs)
}
