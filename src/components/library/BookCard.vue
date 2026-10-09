<template>
  <div class="book-card" @click="$emit('open', book.id)">
    <div class="cover">
      <img v-if="book.coverUrl" :src="book.coverUrl" :alt="book.title" />
      <div v-else class="cover-placeholder">无封面</div>
      <span v-if="book.missing" class="badge-missing">文件缺失</span>
      <!-- 阅读进度圆环：悬浮在封面右上角，hover 时让位给操作按钮；
           无进度的卡片不渲染，封面高度不变，卡片尺寸保持一致 -->
      <div v-if="progressPercent !== null" class="progress-ring" title="阅读进度">
        <svg viewBox="0 0 36 36">
          <circle class="ring-bg" cx="18" cy="18" r="15.5" />
          <circle
            class="ring-fill"
            cx="18"
            cy="18"
            r="15.5"
            :stroke-dasharray="RING_CIRC"
            :stroke-dashoffset="RING_CIRC * (1 - progressPercent / 100)"
          />
        </svg>
        <span class="ring-text">{{ progressPercent }}<i>%</i></span>
      </div>
    </div>
    <div class="title" :title="book.title">{{ book.title }}</div>
    <div class="card-actions">
      <button class="action-btn move-btn" title="移入合集" @click.stop="$emit('move', book.id)">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2l1.4 1.8H13A1.5 1.5 0 0 1 14.5 5.3v6.2A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-8z"
          />
        </svg>
      </button>
      <button
        class="action-btn rename-btn"
        title="重命名"
        @click.stop="$emit('rename', book.id)"
      >
        ✎
      </button>
      <button
        class="action-btn remove-btn"
        :title="removeLabel"
        @click.stop="$emit('remove', book.id)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Book } from '../../../shared/types'

const props = withDefaults(
  defineProps<{ book: Book; /** 合集视图内 × 的语义变为移出合集 */ removeLabel?: string }>(),
  { removeLabel: '从文库移除' }
)
defineEmits<{ open: [bookId: number]; remove: [bookId: number]; rename: [bookId: number]; move: [bookId: number] }>()

const progressPercent = computed(() => {
  const { progress, totalPages } = props.book
  if (!progress || !totalPages) return null
  return Math.min(100, Math.round((progress.page / totalPages) * 100))
})

/** 进度圆环周长（r=15.5） */
const RING_CIRC = 2 * Math.PI * 15.5
</script>

<style scoped>
.book-card {
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 卡片底浮在浅色背景上，分层细腻不堆阴影 */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.book-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  border-color: var(--text-muted);
}

.cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--placeholder);
  border-radius: 4px;
  overflow: hidden;
  /* 封面细描边 + 轻阴影，从卡片底上再浮起一层 */
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(28, 28, 26, 0.12);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}

.badge-missing {
  position: absolute;
  top: 4px;
  left: 4px;
  background: var(--danger);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
}

.title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 阅读进度圆环（封面右上角悬浮）—— */
.progress-ring {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s ease;
}

.progress-ring svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 从 12 点方向顺时针起始 */
  transform: rotate(-90deg);
}

.ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.25);
  stroke-width: 3.5;
}

.ring-fill {
  fill: none;
  stroke: var(--brand);
  stroke-width: 3.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.3s ease;
}

.ring-text {
  position: relative;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.ring-text i {
  font-style: normal;
  font-size: 8px;
}

/* hover 时圆环让位给右上角的操作按钮 */
.book-card:hover .progress-ring {
  opacity: 0;
}

.card-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 4px;
}

.action-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}

.book-card:hover .card-actions {
  display: flex;
}
</style>
