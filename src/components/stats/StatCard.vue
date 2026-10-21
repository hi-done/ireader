<template>
  <div class="stat-card" :class="{ accent }">
    <div class="stat-title">{{ title }}</div>
    <div class="stat-value">{{ displayText }}</div>
    <div v-if="subText" class="stat-sub">{{ subText }}</div>
  </div>
</template>

<script setup lang="ts">
// 统计概览卡：主数值挂载后从 0 缓动滚入
import { computed, onUnmounted, ref, watch } from 'vue'
import { tp } from '../../i18n'
import { formatDuration } from '../../i18n/format'

const props = defineProps<{
  title: string
  /** 主数值（时长毫秒或天数，按 format 渲染） */
  value: number
  /** 展示格式：duration = 时长文本；days = 'N 天' */
  format?: 'duration' | 'days'
  subText?: string
  /** 渐变强调卡（白字） */
  accent?: boolean
}>()

const displayValue = ref(0)
let raf = 0

const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const displayText = computed(() =>
  props.format === 'days'
    ? tp('stats.dayCount', Math.round(displayValue.value))
    : formatDuration(displayValue.value)
)

/** 数字滚动：easeOutCubic 缓动到目标值（尊重系统减少动效偏好） */
function animateTo(target: number) {
  cancelAnimationFrame(raf)
  if (reducedMotion || target <= 0) {
    displayValue.value = target
    return
  }
  const from = displayValue.value
  const start = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / 600)
    displayValue.value = from + (target - from) * (1 - Math.pow(1 - progress, 3))
    if (progress < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}

watch(() => props.value, animateTo, { immediate: true })
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<style scoped>
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
}

.stat-card.accent {
  background: linear-gradient(135deg, #0a84ff, #5e5ce6);
  border-color: transparent;
  color: #fff;
}

.stat-title {
  font-size: 13px;
  color: var(--text-muted);
}

.stat-card.accent .stat-title {
  color: rgba(255, 255, 255, 0.78);
}

.stat-value {
  margin-top: 6px;
  font-size: 27px;
  font-weight: 600;
  letter-spacing: 0.2px;
  font-variant-numeric: tabular-nums;
}

.stat-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.stat-card.accent .stat-sub {
  color: rgba(255, 255, 255, 0.72);
}
</style>
