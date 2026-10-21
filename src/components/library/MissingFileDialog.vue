<template>
  <div class="dialog-mask" @click.self="$emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="dialog-title">{{ t('library.missingDialog.title') }}</h2>
      <p class="dialog-body">
        {{ t('library.missingDialog.body', { title: book.title }) }}
        <code class="path">{{ book.filePath }}</code>
      </p>
      <div class="dialog-actions">
        <button class="btn" @click="$emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="btn danger" @click="$emit('remove')">
          {{ t('library.missingDialog.remove') }}
        </button>
        <button class="btn primary" @click="$emit('relink')">
          {{ t('library.missingDialog.relink') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Book } from '../../../shared/types'
import { t } from '../../i18n'

defineProps<{ book: Book }>()
defineEmits<{ cancel: []; relink: []; remove: [] }>()
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
  border-radius: 8px;
  padding: 20px 24px;
  max-width: 480px;
  box-shadow: 0 8px 32px var(--shadow-md);
}

.dialog-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.dialog-body {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.6;
}

.path {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
  font-size: 13px;
}

.btn:hover {
  background: var(--surface-2);
}

.btn.primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.btn.primary:hover {
  background: var(--brand-hover);
}

.btn.danger {
  color: var(--danger);
}

.btn.danger:hover {
  background: var(--danger-soft);
}
</style>
