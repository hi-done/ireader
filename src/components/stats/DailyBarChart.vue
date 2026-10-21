<template>
  <div ref="wrapEl" class="bar-chart">
    <svg :width="svgWidth" :height="height" :class="{ ready }" aria-hidden="true">
      <defs>
        <linearGradient id="statsBarGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color: var(--brand)" />
          <stop offset="100%" style="stop-color: var(--brand); stop-opacity: 0.5" />
        </linearGradient>
        <linearGradient id="statsBarGradientDim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color: var(--brand); stop-opacity: 0.35" />
          <stop offset="100%" style="stop-color: var(--brand); stop-opacity: 0.16" />
        </linearGradient>
      </defs>

      <!-- 水平网格（1/4、1/2、3/4）与基线 -->
      <line
        v-for="(y, i) in layout.gridYs"
        :key="`grid${i}`"
        class="grid"
        :x1="layout.axisW"
        :x2="layout.plotRight"
        :y1="y"
        :y2="y"
      />
      <line
        class="baseline"
        :x1="layout.axisW"
        :x2="layout.plotRight"
        :y1="layout.baseY"
        :y2="layout.baseY"
      />

      <!-- Y 轴刻度（0 / 中值 / 上限） -->
      <text
        v-for="(t, i) in layout.yTicks"
        :key="`tick${i}`"
        class="tick"
        :x="layout.axisW - 10"
        :y="t.y"
        text-anchor="end"
        dominant-baseline="middle"
      >
        {{ t.text }}
      </text>

      <!-- 柱子与今日标记 -->
      <g v-for="bar in layout.bars" :key="bar.day">
        <rect
          class="bar"
          :class="{ dim: hoverIndex >= 0 && hoverIndex !== bar.index }"
          :x="bar.x"
          :y="bar.displayY"
          :width="bar.w"
          :height="bar.displayH"
          :rx="Math.min(bar.w / 2.4, 5)"
          :style="{ '--d': `${bar.index * 15}ms` }"
        />
        <circle
          v-if="ready && bar.isToday && bar.h > 0"
          class="today-dot"
          :cx="bar.x + bar.w / 2"
          :cy="bar.y - 7"
          r="2.5"
        />
      </g>

      <!-- 悬停热区（覆盖整个柱槽，拉大命中面积） -->
      <rect
        v-for="bar in layout.bars"
        :key="`hit${bar.day}`"
        class="hit"
        :x="bar.slotX"
        :y="layout.padTop"
        :width="bar.slotW"
        :height="layout.plotH"
        @mouseenter="onHover(bar, $event)"
        @mousemove="onHover(bar, $event)"
        @mouseleave="hoverIndex = -1"
      />

      <!-- X 轴标签：7 天视图全标星期，长视图每 5 天标日期 -->
      <text
        v-for="(l, i) in layout.xLabels"
        :key="`x${i}`"
        class="tick x-label"
        :class="{ today: l.isToday }"
        :x="l.x"
        :y="layout.xLabelY"
        text-anchor="middle"
      >
        {{ l.text }}
      </text>
    </svg>

    <div v-if="hoverBar" class="tooltip" :style="tooltipStyle">
      <div class="tt-date">{{ hoverDateText }}</div>
      <div class="tt-value">{{ hoverValueText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 每日阅读柱状图：SVG 像素坐标直绘 + ResizeObserver 响应宽度 + 生长入场动画
// 对应设计文档《阅读时间统计功能设计方案》§9.4
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { formatDayKey, type DailyReadingStat } from '../../../shared/types'
import { niceMax } from '../../services/readingStats'
import { t } from '../../i18n'
import { formatDuration, formatDurationCompact, formatMonthDay, formatWeekday } from '../../i18n/format'

const props = withDefaults(
  defineProps<{
    /** 已补齐升序的逐日序列（含今天） */
    days: DailyReadingStat[]
    height?: number
  }>(),
  { height: 220 }
)

/** 左侧刻度区宽度 / 底部标签区高度 / 顶部留白 */
const AXIS_W = 52
const X_AXIS_H = 28
const PAD_TOP = 12

const wrapEl = ref<HTMLElement | null>(null)
const svgWidth = ref(640)
const ready = ref(false)
let observer: ResizeObserver | null = null

const hoverIndex = ref(-1)
const mousePos = reactive({ x: 0, y: 0 })

/** 'YYYY-MM-DD' → 本地 Date（date-only 字符串会被按 UTC 解析，必须手动拆解） */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const layout = computed(() => {
  const days = props.days
  const n = Math.max(days.length, 1)
  const h = props.height
  const baseY = h - X_AXIS_H
  const plotH = baseY - PAD_TOP
  const plotRight = Math.max(svgWidth.value - 8, AXIS_W + 40)
  const maxMs = days.reduce((m, d) => Math.max(m, d.durationMs), 0)
  const axisMax = niceMax(maxMs)
  const slotW = (plotRight - AXIS_W) / n
  const barW = Math.max(3, Math.min(slotW * 0.6, 30))
  const today = formatDayKey(new Date())

  const bars = days.map((d, i) => {
    const fullH = d.durationMs > 0 ? Math.max(3, (d.durationMs / axisMax) * plotH) : 0
    const slotX = AXIS_W + slotW * i
    return {
      ...d,
      index: i,
      isToday: d.day === today,
      slotX,
      slotW,
      x: slotX + (slotW - barW) / 2,
      w: barW,
      y: baseY - fullH,
      h: fullH,
      // 未就绪时归零：挂载后由 CSS 过渡生长
      displayY: ready.value ? baseY - fullH : baseY,
      displayH: ready.value ? fullH : 0,
    }
  })

  const gridYs = [1, 2, 3].map((k) => PAD_TOP + plotH * (1 - k / 4))
  const yTicks = [
    { y: baseY, text: '0' },
    { y: PAD_TOP + plotH / 2, text: formatDurationCompact(axisMax / 2) },
    { y: PAD_TOP, text: formatDurationCompact(axisMax) },
  ]

  const labelStep = n > 10 ? 5 : 1
  const xLabels = days
    .map((d, i) => {
      if (labelStep > 1 && i % labelStep !== 0 && i !== n - 1) return null
      const date = parseDay(d.day)
      const text = n <= 7 ? formatWeekday(date) : formatMonthDay(date)
      return { x: AXIS_W + slotW * i + slotW / 2, text, isToday: d.day === today }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)

  return { axisW: AXIS_W, padTop: PAD_TOP, plotH, baseY, plotRight, gridYs, yTicks, bars, xLabels, xLabelY: h - 9 }
})

const hoverBar = computed(() =>
  hoverIndex.value >= 0 ? (layout.value.bars[hoverIndex.value] ?? null) : null
)

const hoverDateText = computed(() => {
  const d = hoverBar.value
  if (!d) return ''
  const date = parseDay(d.day)
  return `${formatMonthDay(date)} ${formatWeekday(date)}`
})

const hoverValueText = computed(() =>
  hoverBar.value && hoverBar.value.durationMs > 0
    ? formatDuration(hoverBar.value.durationMs)
    : t('stats.unread')
)

const tooltipStyle = computed(() => ({
  left: `${Math.min(mousePos.x + 14, window.innerWidth - 176)}px`,
  top: `${Math.max(mousePos.y - 66, 8)}px`,
}))

function onHover(bar: { index: number }, e: MouseEvent) {
  hoverIndex.value = bar.index
  mousePos.x = e.clientX
  mousePos.y = e.clientY
}

onMounted(() => {
  // 双 rAF：确保「零高初始态」已提交渲染后再切换到终态，触发生长过渡
  requestAnimationFrame(() => requestAnimationFrame(() => (ready.value = true)))
  if (wrapEl.value) {
    observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      svgWidth.value = Math.max(320, Math.round(w))
    })
    observer.observe(wrapEl.value)
  }
})

onUnmounted(() => observer?.disconnect())
</script>

<style scoped>
.bar-chart {
  position: relative;
  width: 100%;
}

svg {
  display: block;
}

.grid {
  stroke: var(--border);
  stroke-width: 1;
  stroke-dasharray: 3 6;
}

.baseline {
  stroke: var(--border);
  stroke-width: 1;
}

.tick {
  font-size: 11px;
  fill: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.x-label.today {
  fill: var(--brand);
  font-weight: 600;
}

/* 几何属性过渡做生长动画；--d 为逐柱 stagger（仅作用于 y/height，不拖慢 hover 的 fill 变化） */
.bar {
  fill: url(#statsBarGradient);
  transition:
    y 0.55s cubic-bezier(0.22, 1, 0.36, 1) var(--d, 0ms),
    height 0.55s cubic-bezier(0.22, 1, 0.36, 1) var(--d, 0ms),
    fill 0.15s ease;
}

.bar.dim {
  fill: url(#statsBarGradientDim);
}

.today-dot {
  fill: var(--brand);
  opacity: 0;
  transition: opacity 0.3s ease 0.55s;
}

svg.ready .today-dot {
  opacity: 1;
}

.hit {
  fill: transparent;
}

.tooltip {
  position: fixed;
  z-index: 30;
  pointer-events: none;
  background: var(--toast-bg);
  color: var(--toast-text);
  border-radius: 8px;
  padding: 7px 11px;
  box-shadow: var(--shadow-md);
  font-size: 12px;
  line-height: 1.45;
  white-space: nowrap;
}

.tt-value {
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .bar {
    transition: fill 0.15s ease;
  }

  .today-dot {
    transition: none;
  }
}
</style>
