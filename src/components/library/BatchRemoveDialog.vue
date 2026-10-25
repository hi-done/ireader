<template>
  <div class="dialog-mask" @click.self="$emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="dialog-title">{{ t('manage.dialog.title') }}</h2>
      <p class="dialog-body">{{ t('manage.dialog.body', { count: books.length }) }}</p>

      <!-- 书名预览：只列前 5 本，其余折成「等 N 本」，避免弹窗被长清单撑高 -->
      <ul class="book-list">
        <li v-for="b in preview" :key="b.id" class="book-item" :title="b.title">{{ b.title }}</li>
        <li v-if="moreCount > 0" class="book-item more">
          {{ t('manage.dialog.more', { count: moreCount }) }}
        </li>
      </ul>

      <div class="dialog-actions">
        <button @click="$emit('cancel')">{{ t('common.cancel') }}</button>
        <button @click="$emit('confirm', false)">{{ t('manage.dialog.recordOnly') }}</button>
        <button class="danger-fill" @click="$emit('confirm', true)">
          {{ t('manage.dialog.withFile') }}
        </button>
      </div>
      <p class="dialog-hint">{{ t('manage.dialog.hint', { count: books.length }) }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// 批量删除确认弹窗：与单本 RemoveConfirmDialog 同构，二选一（仅移除记录 / 同时删除文件）
// 对应设计文档 specs/漫画批量管理设计方案-20261025.md §9.6
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { Book } from '../../../shared/types'
import { t } from '../../i18n'

const props = defineProps<{ books: Book[] }>()
const emit = defineEmits<{ cancel: []; confirm: [deleteFile: boolean] }>()

const preview = computed(() => props.books.slice(0, 5))
const moreCount = computed(() => Math.max(0, props.books.length - preview.value.length))

/** Esc 等同取消（遮罩点击已由模板处理） */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
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
  width: 440px;
  max-width: calc(100vw - 48px);
  box-shadow: var(--shadow-md);
}

.dialog-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.dialog-body {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.6;
}

.book-list {
  margin: 0 0 16px;
  padding: 8px 12px;
  max-height: 150px;
  overflow-y: auto;
  list-style: none;
  background: var(--surface-2);
  border-radius: 8px;
  /* 全局未设 border-box，这里显式声明防止 padding 撑破容器 */
  box-sizing: border-box;
}

.book-item {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.book-item.more {
  color: var(--text-muted);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-hint {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
}
</style>
