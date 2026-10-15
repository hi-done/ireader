<template>
  <div class="empty-card">
    <svg class="empty-art" viewBox="0 0 220 150" aria-hidden="true">
      <!-- 打开的书 -->
      <path
        d="M110 116 C88 103 60 102 44 109 L44 46 C60 39 88 40 110 53 C132 40 160 39 176 46 L176 109 C160 102 132 103 110 116 Z"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linejoin="round"
      />
      <path d="M110 53 L110 116" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      <!-- 行文线 -->
      <path
        d="M58 63 C70 60 84 60 96 65 M58 77 C70 74 84 74 96 79 M124 65 C136 60 150 60 162 63 M124 79 C136 74 150 74 162 77"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        opacity="0.45"
      />
      <!-- 时钟（品牌色点缀） -->
      <circle cx="180" cy="32" r="20" fill="var(--surface)" stroke="var(--brand)" stroke-width="3" />
      <path
        d="M180 21 L180 32 L188 37"
        fill="none"
        stroke="var(--brand)"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <!-- 星光点缀 -->
      <circle cx="40" cy="28" r="2.5" fill="currentColor" opacity="0.35" />
      <circle cx="56" cy="17" r="1.8" fill="currentColor" opacity="0.25" />
      <circle cx="28" cy="46" r="1.8" fill="currentColor" opacity="0.25" />
    </svg>

    <p class="empty-title">还没有阅读记录</p>
    <p class="empty-sub">打开一本书，阅读时长会自动记录在这里</p>
    <button class="primary" @click="router.push('/')">去书架看看</button>
  </div>
</template>

<script setup lang="ts">
// 统计页空态：无任何阅读数据时的引导
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.empty-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: 800px;
  margin: 48px auto 0;
  padding: 56px 40px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.empty-art {
  width: 190px;
  margin-bottom: 12px;
  color: var(--text-faint);
}

.empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.empty-sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--text-muted);
}
</style>
