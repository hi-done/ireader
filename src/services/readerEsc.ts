// 阅读页 Esc 优先级（纯逻辑）：选词 > 全屏 > 返回文库
// PDF 横向、PDF 纵向、EPUB 三处分支共用同一判定，避免再出现「某分支漏判选词态」
// 对应设计文档《20261103-AI选词工具栏隐藏与Esc优先级修复设计方案》§4.1

export type ReaderEscAction = 'exitAiSelect' | 'exitFullscreen' | 'backToLibrary'

export interface ReaderEscState {
  /** AI 选词态（十字光标 / 拖框进行中） */
  selecting: boolean
  /** 窗口是否全屏（services/fullscreen 的 isFullscreen，不是 document.fullscreenElement） */
  fullscreen: boolean
  /**
   * 同一次 Esc 刚刚已经把窗口踢出全屏（Windows 窗口层抢先处理）。
   * 为真时按键到达渲染层的情形等价于「这次 Esc 已消费在退全屏上」。
   */
  justExitedFullscreen?: boolean
}

/** Esc 唯一优先级：先退 AI 选词，再退全屏，最后返回文库 */
export function resolveReaderEsc(state: ReaderEscState): ReaderEscAction {
  if (state.selecting) return 'exitAiSelect'
  if (state.fullscreen) return 'exitFullscreen'
  // 全屏已被本次按键退掉：仍按「退全屏」收尾，绝不再叠一次返回文库
  if (state.justExitedFullscreen) return 'exitFullscreen'
  return 'backToLibrary'
}
