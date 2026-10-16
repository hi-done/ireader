<template>
  <div class="rank-list">
    <div v-if="books.length === 0" class="rank-empty">{{ emptyText }}</div>
    <div v-for="(b, i) in visibleBooks" :key="b.bookId" class="rank-row">
      <span class="rank-badge" :class="{ top: i < 3 }">{{ i + 1 }}</span>
      <div class="rank-cover">
        <img
          v-if="!coverFailed.has(b.bookId)"
          :src="b.coverUrl"
          alt=""
          loading="lazy"
          @error="coverFailed.add(b.bookId)"
        />
        <span v-else class="cover-fallback">{{ b.title.slice(0, 1) }}</span>
      </div>
      <div class="rank-info">
        <div class="rank-title" :title="b.title">{{ b.title }}</div>
        <div class="rank-sub">最近阅读：{{ formatRelativeDay(b.lastReadAt) }}</div>
        <div class="rank-track">
          <div class="rank-fill" :style="fillStyle(b, i)"></div>
        </div>
      </div>
      <div class="rank-duration">{{ formatDuration(valueOf(b)) }}</div>
    </div>

    <button v-if="books.length > TOP_N" class="ghost rank-expand" @click="expanded = !expanded">
      {{ expanded ? '收起' : `展开全部（共 ${books.length} 本）` }}
    </button>
  </div>
</template>

<script setup lang="ts">
// 书籍阅读时长排行：封面缩略 + 占比条（相对第一名归一化）+ Top 10 折叠
// 对应设计文档《阅读时间统计功能设计方案》§9.5
// 今日 / 总计口径切换对应设计文档《书籍排行今日与总计切换设计方案》§7.2
import { computed, onMounted, ref } from 'vue'
import type { BookReadingStat } from '../../../shared/types'
import { formatDuration, formatRelativeDay, type RankingMode } from '../../services/readingStats'

const TOP_N = 10

const props = defineProps<{
  /** 已按当前口径降序（total 总时长 / today 今日时长） */
  books: BookReadingStat[]
  /** 展示口径：total 显示累计时长；today 显示今日时长。缺省 total */
  mode?: RankingMode
}>()

const expanded = ref(false)
const ready = ref(false)
/** 封面加载失败的书 id（ireader://cover 文件缺失时回退占位块） */
const coverFailed = ref(new Set<number>())

const visibleBooks = computed(() => (expanded.value ? props.books : props.books.slice(0, TOP_N)))

/** 空列表文案：今日口径为局部空态；总计口径正常被整页空态拦截，仅防御 */
const emptyText = computed(() =>
  (props.mode ?? 'total') === 'today' ? '今天还没有阅读记录，打开一本书开始吧' : '暂无阅读记录'
)

/** 当前口径的时长取值 */
function valueOf(book: BookReadingStat): number {
  return (props.mode ?? 'total') === 'today' ? book.todayMs : book.durationMs
}

/** 占比条：挂载后从 0 过渡到位（逐行 stagger）；基准随口径取第一名时长 */
function fillStyle(book: BookReadingStat, index: number) {
  const first = props.books[0]
  const max = first ? valueOf(first) : 0
  const percent = ready.value && max > 0 ? (valueOf(book) / max) * 100 : 0
  return {
    width: `${percent}%`,
    transitionDelay: `${Math.min(index, TOP_N) * 30}ms`,
  }
}

onMounted(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => (ready.value = true)))
})
</script>

<style scoped>
.rank-list {
  display: flex;
  flex-direction: column;
}

.rank-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  transition: background-color 0.15s ease;
  animation: rowIn 0.35s ease-out both;
}

@keyframes rowIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.rank-row:hover {
  background: var(--surface-2);
}

.rank-badge {
  flex: none;
  width: 18px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.rank-badge.top {
  color: var(--brand);
}

.rank-cover {
  flex: none;
  width: 40px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--placeholder);
  box-shadow: var(--shadow-sm);
}

.rank-cover img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 16px;
  color: var(--text-muted);
  background: var(--surface-2);
}

.rank-info {
  flex: 1;
  min-width: 0;
}

.rank-title {
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rank-sub {
  margin-top: 1px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.rank-track {
  height: 4px;
  margin-top: 7px;
  border-radius: 2px;
  background: var(--surface-2);
  overflow: hidden;
}

.rank-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--brand), #5e5ce6);
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.rank-duration {
  flex: none;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rank-expand {
  align-self: center;
  margin-top: 10px;
  font-size: 12.5px;
}

.rank-empty {
  padding: 28px 0;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-muted);
}
</style>
