<template>
  <div class="collection-card" @click="$emit('open', collection.id)">
    <!-- 右侧错位叠两页纸缘：隐喻"一叠多本"，与单本漫画区分 -->
    <div class="cover-stack">
      <span class="stack-page p2" aria-hidden="true"></span>
      <span class="stack-page p1" aria-hidden="true"></span>
      <div class="cover">
        <img v-if="coverBook?.coverUrl" :src="coverBook.coverUrl" :alt="collection.title" />
        <div v-else class="cover-placeholder">{{ bookCount ? '暂无封面' : '空合集' }}</div>
        <!-- 数量徽章替代原 meta 行，保证与书卡片同构等高 -->
        <span class="count-badge">{{ bookCount }} 本</span>
      </div>
    </div>
    <div class="title" :title="collection.title">{{ collection.title }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Book, Collection } from '../../../shared/types'

const props = defineProps<{ collection: Collection; books: Book[] }>()
defineEmits<{ open: [collectionId: number] }>()

// 封面 = 集内漫画按名称升序排序的第一本；合集本身无阅读进度
const coverBook = computed(
  () =>
    [...props.books].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))[0] ?? null
)
const bookCount = computed(() => props.books.length)
</script>

<style scoped>
/* 与 BookCard 完全同构：padding 8 + 3:4 封面 + 单行标题，尺寸一致 */
.collection-card {
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  box-shadow: var(--shadow-sm);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.collection-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
  border-color: var(--text-muted);
}

.cover-stack {
  position: relative;
}

/* 纸页缘：藏在封面之后、向右错位露出，横向细纹模拟成叠纸页 */
.stack-page {
  position: absolute;
  width: 14px;
  border: 1px solid var(--border);
  border-radius: 0 4px 4px 0;
  background: repeating-linear-gradient(
    180deg,
    var(--surface) 0 3px,
    var(--surface-2) 3px 4px
  );
  box-shadow: 1px 0 3px rgba(28, 28, 26, 0.1);
}

.stack-page.p1 {
  top: 4px;
  bottom: 4px;
  right: -4px;
}

.stack-page.p2 {
  top: 8px;
  bottom: 8px;
  right: -8px;
}

.cover {
  position: relative;
  aspect-ratio: 3 / 4;
  background: var(--placeholder);
  border-radius: 4px;
  overflow: hidden;
  /* 与 BookCard 一致：封面细描边 + 轻阴影 */
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(28, 28, 26, 0.12);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.count-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 10px;
}

.title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
