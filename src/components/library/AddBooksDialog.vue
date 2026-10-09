<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog">
      <h3 class="dialog-title">添加主页漫画</h3>
      <p class="dialog-sub">勾选要加入「{{ collectionTitle }}」的漫画，添加后将从主页移入合集</p>

      <div class="filter-row">
        <input
          v-model="keyword"
          class="filter-input"
          type="text"
          placeholder="搜索书名，空格分隔多个词…"
        />
        <label class="select-all">
          <input
            type="checkbox"
            :checked="allSelected"
            :indeterminate="someSelected && !allSelected"
            @change="toggleSelectAll"
          />
          全选
        </label>
      </div>

      <div class="book-list">
        <label v-for="b in filteredBooks" :key="b.id" class="book-item">
          <input v-model="checked" type="checkbox" :value="b.id" />
          <span class="book-name">{{ b.title }}</span>
        </label>
        <p v-if="!filteredBooks.length" class="empty-tip">
          {{ books.length ? '没有匹配的书' : '主页还没有未分组的漫画，可先在合集内直接导入' }}
        </p>
      </div>

      <div class="dialog-actions">
        <span class="count-tip">已选 {{ checked.length }} 本</span>
        <div class="action-group">
          <button @click="$emit('close')">取消</button>
          <button
            class="primary"
            :disabled="!checked.length"
            @click="$emit('confirm', [...checked])"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Book } from '../../../shared/types'

const props = defineProps<{ books: Book[]; collectionTitle: string }>()
defineEmits<{ close: []; confirm: [bookIds: number[]] }>()

const keyword = ref('')
const checked = ref<number[]>([])

const filteredBooks = computed(() => {
  // 多词模糊：空格分隔的词全部命中（不区分大小写的子串）即匹配，
  // 如输入「海 王」可命中「海贼王」
  const words = keyword.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return props.books
  return props.books.filter((b) => {
    const t = b.title.toLowerCase()
    return words.every((w) => t.includes(w))
  })
})

/** 全选针对当前过滤结果 */
const allSelected = computed(
  () =>
    filteredBooks.value.length > 0 &&
    filteredBooks.value.every((b) => checked.value.includes(b.id))
)

const someSelected = computed(() =>
  filteredBooks.value.some((b) => checked.value.includes(b.id))
)

function toggleSelectAll() {
  const ids = filteredBooks.value.map((b) => b.id)
  if (allSelected.value) {
    checked.value = checked.value.filter((id) => !ids.includes(id))
  } else {
    checked.value = [...new Set([...checked.value, ...ids])]
  }
}
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog {
  background: var(--surface);
  border-radius: 10px;
  padding: 20px 24px;
  width: 400px;
  box-shadow: var(--shadow-md);
}

.dialog-title {
  margin: 0;
  font-size: 16px;
}

.dialog-sub {
  margin: 6px 0 14px;
  font-size: 12px;
  color: var(--text-secondary);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.filter-input {
  flex: 1;
  max-width: 220px;
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.select-all input {
  accent-color: var(--brand);
  margin: 0;
}

.book-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.book-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.book-item:last-child {
  border-bottom: none;
}

.book-item:hover {
  background: var(--surface-2);
}

.book-item input {
  accent-color: var(--brand);
  margin: 0;
  flex-shrink: 0;
}

.book-name {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-tip {
  margin: 0;
  padding: 18px 14px;
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
}

.dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16px;
}

.count-tip {
  font-size: 12px;
  color: var(--text-muted);
}

.action-group {
  display: flex;
  gap: 8px;
}
</style>
