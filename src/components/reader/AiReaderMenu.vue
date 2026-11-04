<template>
  <!-- AI 翻译入口：主按钮 + 动作下拉（同一组描边拼成一个按钮组） -->
  <div ref="rootEl" class="ai-menu">
    <button
      class="ai-toggle"
      :class="{ active, off: !ready }"
      :aria-disabled="!ready"
      :aria-pressed="active"
      @click="emit('toggle')"
      @pointerenter="onTriggerEnter"
      @pointerleave="emit('triggerLeave')"
      @focus="onTriggerEnter"
      @blur="emit('triggerLeave')"
    >
      {{ t('ai.readerButton') }}
    </button>
    <button
      ref="caretEl"
      class="ai-caret"
      :disabled="!ready"
      :aria-label="t('ai.readerHint')"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click="toggleMenu"
    >▾</button>

    <!-- 动作下拉：Teleport 到 body，fixed 定位不受顶栏毛玻璃包含块影响 -->
    <Teleport to="body">
      <div v-if="menuOpen" class="ai-menu-pop" role="menu" :style="popStyle">
        <button
          role="menuitem"
          :disabled="!hasRecords || hiddenAll"
          @click="pick('hideAll')"
        >{{ t('ai.menu.hideAll') }}</button>
        <button
          role="menuitem"
          :disabled="!hasRecords"
          @click="pick('collapseAll')"
        >{{ t('ai.menu.collapseAll') }}</button>
        <button
          role="menuitem"
          :disabled="!hasRecords"
          @click="pick('expandAll')"
        >{{ t('ai.menu.expandAll') }}</button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// AI 翻译入口组件：主按钮 + 动作下拉（全部隐藏 / 全部折叠 / 全部展开）
// 对应设计文档《20261103-上下滚动模式AI翻译支持设计方案》§5.1
// 只负责「按钮组 + 弹层 + 关闭路径」；能否进入选词、未启用提示、工具栏 pin 由宿主视图决定
import { computed, onBeforeUnmount, ref } from 'vue'
import { t } from '../../i18n'

defineProps<{
  /** AI 可用：总开关开启且选中了有效的模型配置 */
  ready: boolean
  /** 选词中：按钮显示按下态 */
  active: boolean
  /** 本书记录数 > 0：折叠 / 展开动作可用 */
  hasRecords: boolean
  /** 全部隐藏中：「全部隐藏」置灰 */
  hiddenAll: boolean
}>()

const emit = defineEmits<{
  /** 点主按钮：视图据此决定「提示未启用」还是进 / 退选词 */
  toggle: []
  hideAll: []
  collapseAll: []
  expandAll: []
  /** 下拉展开：视图 pinBars()（展开期间顶栏常显） */
  open: []
  /** 下拉收起：视图 unpinBars()（解除 pin 并恢复自动隐藏） */
  close: []
  /** 悬停提示锚点：仿 SelectMenu，由宿主渲染 CardTip */
  triggerEnter: [anchor: HTMLElement]
  triggerLeave: []
}>()

const rootEl = ref<HTMLElement | null>(null)
const caretEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
/** 弹层位置：按 caret 矩形即时计算（顶栏 backdrop-filter 会改变 fixed 包含块，不能就地绝对定位） */
const menuPos = ref({ top: 0, right: 0 })

const popStyle = computed<Record<string, string>>(() => ({
  top: `${menuPos.value.top}px`,
  right: `${menuPos.value.right}px`,
}))

function toggleMenu(): void {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  const rect = caretEl.value?.getBoundingClientRect()
  if (!rect) return
  menuPos.value = {
    top: rect.bottom + 6,
    right: Math.max(window.innerWidth - rect.right, 8),
  }
  menuOpen.value = true
  emit('open')
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onMenuKeydown, true)
}

/** 关闭：移除文档级监听并通知宿主（宿主统一 unpinBars，避免顶栏停在常显态） */
function closeMenu(): void {
  if (!menuOpen.value) return
  menuOpen.value = false
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onMenuKeydown, true)
  emit('close')
}

/** 点菜单外任意处收起：caret 自身与弹层内的按下不算外部 */
function onDocPointerDown(e: PointerEvent): void {
  const target = e.target as Node | null
  const pop = document.querySelector('.ai-menu-pop')
  if (target === caretEl.value || (target && pop?.contains(target))) return
  closeMenu()
}

/** 菜单内的 Esc 优先收起菜单：捕获阶段拦下，避免冒泡到 window 后退出阅读页 */
function onMenuKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  closeMenu()
}

function pick(action: 'hideAll' | 'collapseAll' | 'expandAll'): void {
  closeMenu()
  if (action === 'hideAll') emit('hideAll')
  else if (action === 'collapseAll') emit('collapseAll')
  else emit('expandAll')
}

function onTriggerEnter(): void {
  if (rootEl.value) emit('triggerEnter', rootEl.value)
}

// 组件卸载（切到 EPUB / 离开阅读页）时必须摘掉文档级监听，否则会漏关菜单
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onMenuKeydown, true)
})

// 进 AI 选词前需要强制收起菜单：菜单关闭时顶栏要恢复自动隐藏，所以仍走 closeMenu（会 emit close）
defineExpose({ closeMenu })
</script>

<style scoped>
/* 按钮组：与顶栏其它控件同尺寸（26px 高、半透明白描边），自带样式不依赖宿主作用域 */
.ai-menu {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.ai-menu button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: #fff;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.ai-toggle {
  /* 与 caret 拼成一组：右侧不带圆角与描边，避免双线 */
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
  white-space: nowrap;
}

/* 选词态：按下态（底色浅填充 + 描边不透明） */
.ai-toggle.active {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.85);
}

/* 未启用：视觉禁用但仍可点击，点击才给「去配置」提示 */
.ai-toggle.off {
  opacity: 0.35;
  cursor: default;
}

.ai-caret {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 拉伸到主按钮高度：两段拼成一个按钮组 */
  align-self: stretch;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0 6px;
  line-height: 1;
}

.ai-caret:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 动作下拉：Teleport 到 body，fixed 定位不受顶栏毛玻璃包含块影响 */
.ai-menu-pop {
  position: fixed;
  z-index: 30;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
}

.ai-menu-pop button {
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  text-align: left;
}

.ai-menu-pop button:hover:not(:disabled) {
  background: var(--brand-soft);
  color: var(--brand);
}

.ai-menu-pop button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
