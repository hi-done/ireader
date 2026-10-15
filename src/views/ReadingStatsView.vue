<template>
  <div class="stats-view">
    <header class="page-head">
      <button class="ghost" @click="router.back()">← 返回</button>
      <h1>阅读统计</h1>
    </header>

    <!-- 加载骨架屏 -->
    <div v-if="loading" class="content">
      <div class="cards">
        <div v-for="i in 3" :key="i" class="skeleton skeleton-card"></div>
      </div>
      <div class="skeleton skeleton-panel"></div>
      <div class="skeleton skeleton-panel tall"></div>
    </div>

    <!-- 错误态 -->
    <div v-else-if="loadError" class="content error-wrap">
      <p class="error-text">{{ loadError }}</p>
      <button @click="load">重试</button>
    </div>

    <!-- 空态 -->
    <StatsEmptyState v-else-if="isEmpty" />

    <!-- 正常内容 -->
    <div v-else-if="summary" class="content">
      <div class="cards">
        <StatCard title="总阅读时长" :value="summary.totalMs" sub-text="全部书籍累计" accent />
        <StatCard title="今日阅读" :value="summary.todayMs" :sub-text="yesterdayText" />
        <StatCard
          title="连续阅读"
          :value="streak"
          format="days"
          :sub-text="`累计 ${readDays} 天有阅读`"
        />
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>最近阅读</h2>
          <div class="seg">
            <button :class="{ on: range === 7 }" @click="range = 7">近 7 天</button>
            <button :class="{ on: range === 30 }" @click="range = 30">近 30 天</button>
          </div>
        </div>
        <!-- key=range：切换窗口时重挂载，重播生长动画 -->
        <DailyBarChart :key="range" :days="visibleDays" />
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>书籍排行</h2>
          <span class="panel-count">共 {{ summary.books.length }} 本</span>
        </div>
        <BookRankingList :books="summary.books" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
// 阅读统计页：概览卡 + 每日柱状图 + 书籍排行
// 对应设计文档《阅读时间统计功能设计方案》§9.2
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatDayKey, type ReadingStatsSummary } from '../../shared/types'
import { IpcError, ipc } from '../services/ipc'
import { calcStreak, formatDuration } from '../services/readingStats'
import StatCard from '../components/stats/StatCard.vue'
import DailyBarChart from '../components/stats/DailyBarChart.vue'
import BookRankingList from '../components/stats/BookRankingList.vue'
import StatsEmptyState from '../components/stats/StatsEmptyState.vue'

const router = useRouter()

const summary = ref<ReadingStatsSummary | null>(null)
const loading = ref(true)
const loadError = ref('')
/** 柱状图窗口（7 / 30 天）；30 天数据一次拉取，切换仅切片不重复请求 */
const range = ref<7 | 30>(7)

const isEmpty = computed(() => summary.value !== null && summary.value.totalMs === 0)
const visibleDays = computed(() => summary.value?.days.slice(-range.value) ?? [])

const yesterdayText = computed(() => {
  const days = summary.value?.days
  const y = days && days.length >= 2 ? days[days.length - 2].durationMs : 0
  return y > 0 ? `昨天 ${formatDuration(y)}` : '昨天无记录'
})

const streak = computed(() =>
  summary.value ? calcStreak(summary.value.days, formatDayKey(new Date())) : 0
)

const readDays = computed(() => summary.value?.days.filter((d) => d.durationMs > 0).length ?? 0)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    summary.value = await ipc.stats.summary(30)
  } catch (e) {
    loadError.value = e instanceof IpcError ? `加载失败：${e.message}` : '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.stats-view {
  height: 100vh;
  overflow-y: auto;
  background: var(--page-veil), url('/bg001.jpg') center / cover no-repeat, var(--bg);
  color: var(--text);
}

.page-head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px 40px 8px;
  background: var(--surface-alpha);
  backdrop-filter: blur(20px) saturate(180%);
}

.page-head h1 {
  font-size: 22px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 880px;
  margin: 0 auto;
  padding: 20px 40px 48px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

/* 卡片入场：向上淡入，逐张 stagger */
.cards > * {
  animation: cardIn 0.45s ease-out both;
}

.cards > *:nth-child(2) {
  animation-delay: 60ms;
}

.cards > *:nth-child(3) {
  animation-delay: 120ms;
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 18px 20px 16px;
  box-shadow: var(--shadow-sm);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.panel-head h2 {
  font-size: 15px;
  font-weight: 600;
}

.panel-count {
  font-size: 12px;
  color: var(--text-muted);
}

/* 分段控件：7 天 / 30 天切换 */
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--surface-2);
  border-radius: 8px;
}

.seg button {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.seg button.on {
  background: var(--surface);
  color: var(--text);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

/* 骨架屏 */
.skeleton {
  background: var(--surface-2);
  border: 1px solid var(--border);
  animation: pulse 1.4s ease-in-out infinite;
}

.skeleton-card {
  height: 110px;
  border-radius: 14px;
}

.skeleton-panel {
  height: 280px;
  border-radius: 14px;
}

.skeleton-panel.tall {
  height: 360px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

.error-wrap {
  align-items: center;
  padding-top: 80px;
}

.error-text {
  font-size: 14px;
  color: var(--text-secondary);
}

@media (max-width: 760px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cards > *,
  .skeleton {
    animation: none;
  }
}
</style>
