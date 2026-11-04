// 阅读页底部提示胶囊：选词提示与「AI 未启用」提示共用，自动淡出
// 对应设计文档《20261103-上下滚动模式AI翻译支持设计方案》§5.1
// 与 components/ui/useHoverTip.ts 同构：状态与收尾逻辑收在一处，PDF / EPUB 两个视图共用

import { onScopeDispose, ref } from 'vue'

/**
 * 提示胶囊状态：show() 立刻上屏并起计时，到期自动清空；clear() 立即清空。
 * 重复 show 会重置计时，避免旧计时把新文案提前收走。
 */
export function useAiNotice(defaultMs = 3000) {
  const text = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  function show(message: string, ms = defaultMs): void {
    if (timer) clearTimeout(timer)
    text.value = message
    timer = setTimeout(() => {
      timer = null
      text.value = ''
    }, ms)
  }

  function clear(): void {
    if (timer) clearTimeout(timer)
    timer = null
    text.value = ''
  }

  // 作用域销毁（离开阅读页）时清计时器：残留定时器不该再改已卸载视图的状态
  onScopeDispose(clear)

  return { text, show, clear }
}
