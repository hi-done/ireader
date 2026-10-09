<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog">
      <h3 class="dialog-title">移入合集</h3>
      <p class="dialog-book">《{{ book.title }}》</p>

      <div class="coll-list">
        <button
          v-for="c in selectableCollections"
          :key="c.id"
          class="coll-item"
          @click="$emit('select', c.id)"
        >
          <span class="coll-name">{{ c.title }}</span>
          <span class="coll-count">{{ countOf(c.id) }} 本</span>
        </button>

        <!-- 书已在某合集时提供"移回未分组" -->
        <button v-if="book.collectionId !== null" class="coll-item" @click="$emit('select', null)">
          <span class="coll-name">未分组</span>
          <span class="coll-count">移出当前合集</span>
        </button>

        <p v-if="!selectableCollections.length && book.collectionId === null" class="empty-tip">
          还没有合集，先创建一个吧
        </p>
      </div>

      <div v-if="!creating" class="dialog-actions">
        <button class="ghost" @click="creating = true">＋ 新建合集</button>
        <button @click="$emit('close')">取消</button>
      </div>
      <div v-else class="create-row">
        <input
          v-model="newTitle"
          class="create-input"
          placeholder="合集名称"
          autofocus
          @keyup.enter="create"
        />
        <button class="primary" :disabled="!newTitle.trim()" @click="create">创建并移入</button>
        <button class="ghost" @click="cancelCreate">取消</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Book, Collection } from '../../../shared/types'

const props = defineProps<{ book: Book; collections: Collection[]; books: Book[] }>()
const emit = defineEmits<{
  close: []
  select: [collectionId: number | null]
  create: [title: string]
}>()

// 排除书当前所在的合集；创建后由父组件完成"创建并移入"
const selectableCollections = computed(() =>
  props.collections.filter((c) => c.id !== props.book.collectionId)
)

function countOf(collectionId: number): number {
  return props.books.filter((b) => b.collectionId === collectionId).length
}

const creating = ref(false)
const newTitle = ref('')

function create() {
  const title = newTitle.value.trim()
  if (!title) return
  emit('create', title)
}

function cancelCreate() {
  creating.value = false
  newTitle.value = ''
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
  width: 380px;
  box-shadow: var(--shadow-md);
}

.dialog-title {
  margin: 0;
  font-size: 16px;
}

.dialog-book {
  margin: 6px 0 14px;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coll-list {
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.coll-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  padding: 10px 14px;
  text-align: left;
}

.coll-item:last-child {
  border-bottom: none;
}

.coll-name {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coll-count {
  font-size: 11.5px;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-left: 12px;
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
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.create-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.create-input {
  flex: 1;
}
</style>
