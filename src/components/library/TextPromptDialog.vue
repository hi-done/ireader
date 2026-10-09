<template>
  <div class="dialog-mask" @click.self="$emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <h2 class="dialog-title">{{ title }}</h2>
      <form @submit.prevent="onConfirm">
        <input
          ref="inputEl"
          v-model="value"
          class="text-input"
          type="text"
          :placeholder="placeholder"
          autofocus
        />
        <div class="dialog-actions">
          <button class="btn" type="button" @click="$emit('cancel')">取消</button>
          <button class="btn primary" type="submit" :disabled="!value.trim()">确定</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const props = defineProps<{
  title: string
  initialValue: string
  placeholder?: string
}>()

const emit = defineEmits<{ cancel: []; confirm: [value: string] }>()

const value = ref(props.initialValue)
const inputEl = ref<HTMLInputElement | null>(null)

onMounted(() => {
  inputEl.value?.focus()
  inputEl.value?.select()
})

function onConfirm() {
  const trimmed = value.value.trim()
  if (trimmed) emit('confirm', trimmed)
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
  border-radius: 8px;
  padding: 20px 24px;
  width: 360px;
  box-shadow: 0 8px 32px var(--shadow-md);
}

.dialog-title {
  margin: 0 0 12px;
  font-size: 16px;
}

.text-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
}

.text-input:focus {
  outline: none;
  border-color: var(--brand);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
