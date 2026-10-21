<template>
  <div ref="cardEl" class="collection-card tilt-card" @click="$emit('open', collection.id)">
    <!-- 右侧错位叠两页纸缘：隐喻"一叠多本"，与单本漫画区分 -->
    <div class="cover-stack">
      <span class="stack-page p2" aria-hidden="true"></span>
      <span class="stack-page p1" aria-hidden="true"></span>
      <div class="cover">
        <img v-if="coverBook?.coverUrl" :src="coverBook.coverUrl" :alt="collection.title" />
        <div v-else class="cover-placeholder">
          <svg
            class="placeholder-icon"
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M7 3.5h6.5L18 8v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
            <path d="M13.5 3.5V8H18" />
          </svg>
          <span>{{ bookCount ? '暂无封面' : '空合集' }}</span>
        </div>

        <!-- 跟随指针的封面高光：纯装饰层，不参与命中 -->
        <div class="cover-glare" aria-hidden="true" />

        <!-- 数量徽章替代原 meta 行，保证与书卡片同构等高 -->
        <span class="count-badge cover-badge">{{ bookCount }} 本</span>
      </div>
    </div>
    <div class="title" :title="collection.title">{{ collection.title }}</div>
  </div>
</template>

<script setup lang="ts">
// 文库合集卡片：封面 = 集内名称升序第一本，右侧纸页缘隐喻"一叠多本"；
// 卡壳与 3D 倾斜由全局 .tilt-card 承载
// 对应设计文档 specs/图书卡片交互与图标苹果风美化设计方案-20261021.md §5.3
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Book, Collection } from '../../../shared/types'
import { attachCardTilt, type CardTiltHandle } from '../../services/cardTilt'

const props = defineProps<{ collection: Collection; books: Book[] }>()
defineEmits<{ open: [collectionId: number] }>()

// 封面 = 集内漫画按名称升序排序的第一本；合集本身无阅读进度
const coverBook = computed(
  () =>
    [...props.books].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))[0] ?? null
)
const bookCount = computed(() => props.books.length)

// —— 3D 倾斜跟随：与书卡片同一套接线，减弱动效 / 触屏下 attach 返回空句柄 ——
const cardEl = ref<HTMLElement | null>(null)
let tilt: CardTiltHandle | null = null

onMounted(() => {
  if (cardEl.value) tilt = attachCardTilt(cardEl.value)
})

onBeforeUnmount(() => {
  tilt?.detach()
  tilt = null
})
</script>

<style scoped>
/* 卡壳（背景 / 边框 / 圆角 / 阴影 / 倾斜）由全局 .tilt-card 提供，此处只留内容布局 */
.collection-card {
  padding: 8px;
}

.cover-stack {
  position: relative;
}

/* 纸页缘：藏在封面之后、向右错位露出，横向细纹模拟成叠纸页 */
.stack-page {
  position: absolute;
  width: 14px;
  border: 1px solid var(--border);
  border-radius: 0 var(--card-cover-radius) var(--card-cover-radius) 0;
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
  border-radius: var(--card-cover-radius);
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.cover-placeholder svg {
  color: var(--text-faint);
}

/* 材质由全局 .cover-badge 提供，此处只定位 */
.count-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
}

.title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
