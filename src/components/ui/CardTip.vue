<template>
  <Teleport to="body">
    <Transition name="card-tip">
      <div
        v-if="shown"
        ref="tipEl"
        class="app-tip"
        :class="[`app-tip--${placement}`, { 'app-tip--wrap': maxWidth != null }]"
        :style="tipStyle"
        aria-hidden="true"
      >
        <span>{{ text }}</span>
        <span v-if="meta" class="app-tip-meta">{{ meta }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
// 卡片悬停提示框：Teleport 到 body 用 fixed 定位，脱离 .tilt-card 的 3D 变换层，
// 避免卡片倾斜时整层重采样导致的小字号发虚
// 对应设计文档 specs/图书卡片提示框苹果风美化设计方案-20261021.md §5.3
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { resolveTipPosition, type TipAlign, type TipPlacement } from '../../services/cardTip'

const props = withDefaults(
  defineProps<{
    /** 触发态：置 true 后延迟 delay 毫秒显示 */
    visible: boolean
    /** 锚点元素（按钮 / 书名行），用于测量 fixed 坐标 */
    anchor: HTMLElement | null
    text: string
    /** 第二行（阅读进度），空串不渲染 */
    meta?: string
    placement?: TipPlacement
    align?: TipAlign
    /** 固定宽度：书名提示锁定为书名行宽，长书名折行 */
    maxWidth?: number
    /** 显示延迟（毫秒） */
    delay?: number
  }>(),
  { meta: '', placement: 'below', align: 'center', delay: 350 }
)

const emit = defineEmits<{ dismiss: [] }>()

const tipEl = ref<HTMLDivElement | null>(null)
const shown = ref(false)
// 首帧先放到视口外完成测量，同一微任务内写入真实坐标，不会在左上角闪现
const position = ref({ top: -9999, left: -9999 })

const tipStyle = computed(() => ({
  top: `${position.value.top}px`,
  left: `${position.value.left}px`,
  ...(props.maxWidth != null ? { width: `${props.maxWidth}px` } : {}),
}))

let showTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.visible,
  (visible) => {
    clearTimer()
    if (visible && props.anchor) {
      showTimer = setTimeout(() => {
        showTimer = null
        shown.value = true
        void measure()
      }, props.delay)
      return
    }
    shown.value = false
  },
  { immediate: true }
)

watch(
  () => props.anchor,
  () => {
    if (shown.value) void measure()
  }
)

watch(shown, (value) => {
  if (value) addViewportListeners()
  else removeViewportListeners()
})

/** 测量锚点与浮层，写入 fixed 坐标（浮层挂在 body 上，坐标即视口坐标） */
async function measure() {
  await nextTick()
  const anchor = props.anchor
  const el = tipEl.value
  if (!anchor || !el) return
  const rect = anchor.getBoundingClientRect()
  const resolved = resolveTipPosition({
    anchor: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    tipWidth: el.offsetWidth,
    tipHeight: el.offsetHeight,
    placement: props.placement,
    align: props.align,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
  // 取整：fixed 层的半像素定位会让文字退回灰度抗锯齿
  position.value = { top: Math.round(resolved.top), left: Math.round(resolved.left) }
}

function clearTimer() {
  if (showTimer) {
    clearTimeout(showTimer)
    showTimer = null
  }
}

/** 滚动 / 缩放后浮层已与锚点错位，直接收起（与系统 tooltip 一致） */
function onViewportChange() {
  emit('dismiss')
}

function addViewportListeners() {
  // capture 才能捕获 .book-grid 这类内部滚动容器的 scroll
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('resize', onViewportChange)
}

function removeViewportListeners() {
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('resize', onViewportChange)
}

onBeforeUnmount(() => {
  clearTimer()
  removeViewportListeners()
})
</script>

<style scoped>
/* 材质单点：深浅主题由 --tip-* 令牌切换；fixed 坐标由脚本写入。
   不透明底 + 默认字体渲染是刻意的：半透明与 antialiased 都会让小字发虚 */
.app-tip {
  position: fixed;
  z-index: 40;
  box-sizing: border-box;
  padding: 5px 9px;
  border: 1px solid var(--tip-border);
  border-radius: 6px;
  background: var(--tip-bg);
  color: var(--tip-text);
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0;
  -webkit-font-smoothing: auto;
  white-space: nowrap;
  box-shadow: var(--tip-shadow);
  pointer-events: none;
}

/* 多行形态（书名提示）：宽度由 maxWidth 写入，超长折行 */
.app-tip--wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 9px;
  white-space: normal;
  word-break: break-word;
  text-align: center;
}

/* 进度行：比书名低一档，等宽数字避免百分比变化时抖动 */
.app-tip-meta {
  font-size: 11.5px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.card-tip-enter-active {
  transition: opacity 0.14s cubic-bezier(0.22, 0.8, 0.24, 1),
    transform 0.14s cubic-bezier(0.22, 0.8, 0.24, 1);
}

.card-tip-leave-active {
  transition: opacity 0.1s ease, transform 0.1s ease;
}

.app-tip--below.card-tip-enter-from,
.app-tip--below.card-tip-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

.app-tip--above.card-tip-enter-from,
.app-tip--above.card-tip-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

@media (prefers-reduced-motion: reduce) {
  .card-tip-enter-active,
  .card-tip-leave-active {
    transition: opacity 0.14s ease;
  }

  .app-tip--below.card-tip-enter-from,
  .app-tip--above.card-tip-enter-from {
    transform: none;
  }
}
</style>
