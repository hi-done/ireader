// 悬停提示状态：锚点 / 文案 / 展开方向 + 触发过滤（依赖 Vue，不查询 DOM）
// 对应设计文档 specs/阅读器工具栏提示框苹果风美化设计方案-20261021.md §5.2
import { ref } from 'vue'
import { shouldShowTip, type TipAlign, type TipPlacement } from '../../services/cardTip'

/** 提示选项：默认向下、居中（顶栏按钮形态） */
interface TipOptions {
  placement?: TipPlacement
  align?: TipAlign
}

export function useHoverTip() {
  /** 锚点即「是否触发」：置 null 收起，无需第二个布尔量 */
  const tipAnchor = ref<HTMLElement | null>(null)
  const tipText = ref('')
  const tipPlacement = ref<TipPlacement>('below')
  const tipAlign = ref<TipAlign>('center')

  /** 模板事件入口（pointerenter / focus 共用）：过滤触屏与鼠标点击产生的 focus */
  function openTip(event: PointerEvent | FocusEvent, text: string, options: TipOptions = {}) {
    const el = event.currentTarget as HTMLElement | null
    if (!el) return
    const visible = shouldShowTip({
      type: event.type,
      pointerType: event instanceof PointerEvent ? event.pointerType : undefined,
      // 只在 focus 时查询：指针事件没有可见焦点语义
      focusVisible: event.type === 'focus' ? el.matches(':focus-visible') : undefined,
    })
    if (!visible) return
    apply(el, text, options)
  }

  /** 子组件上报锚点入口（SelectMenu trigger-enter）：过滤已由子组件完成 */
  function openTipAt(anchor: HTMLElement, text: string, options: TipOptions = {}) {
    apply(anchor, text, options)
  }

  function apply(anchor: HTMLElement, text: string, options: TipOptions) {
    tipAnchor.value = anchor
    tipText.value = text
    tipPlacement.value = options.placement ?? 'below'
    tipAlign.value = options.align ?? 'center'
  }

  function closeTip() {
    tipAnchor.value = null
  }

  return { tipAnchor, tipText, tipPlacement, tipAlign, openTip, openTipAt, closeTip }
}
