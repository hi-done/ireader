<template>
  <div ref="cardEl" class="collection-card tilt-card" @click="$emit('open', collection.id)">
    <!-- 封面铺满整卡：书名与数量叠在封面之上，卡壳只留 1px 描边与圆角 -->
    <div class="cover">
      <!-- 视差外套：inset:-18px 预放大，媒体层最大偏移 ≈17px 不露底 -->
      <div class="cover-media" :class="{ 'is-placeholder': !coverImg }">
        <img v-if="coverImg" :src="coverImg" :alt="collection.title" />
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
          <span>{{ bookCount ? t('library.collection.noCover') : t('library.collection.emptyCover') }}</span>
        </div>
      </div>

      <!-- 底部纱罩：书名常驻叠底的对比底衬 -->
      <span class="cover-scrim" aria-hidden="true" />

      <!-- 跟随指针的封面高光：纯装饰层，不参与命中 -->
      <div class="cover-glare" aria-hidden="true" />

      <span class="count-badge cover-badge">{{ tp('common.bookCount', bookCount) }}</span>
    </div>
    <!-- 书名行：在流内占位决定卡高（与书卡同名行等高），相对定位压到封面底部；
         hover 触发提示框，浮层由 CardTip 渲染到 body -->
    <div class="card-title-row" @pointerenter="openTitleTip" @pointerleave="closeTip">
      <div class="title">{{ collection.title }}</div>
    </div>
    <CardTip
      :visible="tipAnchor !== null"
      :anchor="tipAnchor"
      :text="tipText"
      placement="above"
      align="center"
      :max-width="tipMaxWidth"
      @dismiss="closeTip"
    />
  </div>
</template>

<script setup lang="ts">
// 文库合集卡片：封面铺满整卡（集内名称升序第一本），书名与数量叠在封面之上；
// 卡高由 ::before 占位推出，与书卡外框等高（见样式注释）；
// 封面媒体层按 --par-x/--par-y 反向视差，卡框 / 徽章 / 书名保持静止；
// 倾斜由全局 .tilt-card 承载，合集卡倾角 10° + 560px 视距（比书卡深、又不糊书名）
// 对应设计文档 specs/20261105-合集卡片视差深度美化设计方案.md §4~§5
// 卡壳与倾斜基线见 specs/图书卡片交互与图标苹果风美化设计方案-20261021.md §5.3
// 书名提示走 CardTip 浮层，见 specs/图书卡片提示框苹果风美化设计方案-20261021.md §5.6
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Book, Collection } from '../../../shared/types'
import { appLocale, t, tp } from '../../i18n'
import { compareTitles } from '../../services/libraryList'
import { attachCardTilt, type CardTiltHandle } from '../../services/cardTilt'
import CardTip from '../ui/CardTip.vue'

const props = defineProps<{ collection: Collection; books: Book[] }>()
defineEmits<{ open: [collectionId: number] }>()

// 封面 = 集内漫画按当前界面语言的名称升序排序的第一本；合集本身无阅读进度
const coverBook = computed(
  () =>
    [...props.books].sort((a, b) => compareTitles(a.title, b.title, appLocale.value))[0] ?? null
)
const bookCount = computed(() => props.books.length)

/** 封面图地址：媒体层是否参与视差与 img 是否存在共用此判据，避免两处漂移 */
const coverImg = computed(() => coverBook.value?.coverUrl ?? null)

// —— 书名提示：浮层 Teleport 到 body，避开卡片 3D 倾斜造成的文字重采样 ——
const tipAnchor = ref<HTMLElement | null>(null)
const tipText = ref('')
const tipMaxWidth = ref<number | undefined>()

function openTitleTip(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const el = event.currentTarget as HTMLElement
  tipAnchor.value = el
  tipText.value = props.collection.title
  tipMaxWidth.value = el.offsetWidth
}

function closeTip() {
  tipAnchor.value = null
}

// —— 3D 倾斜跟随：与书卡片同一套接线，减弱动效 / 触屏下 attach 返回空句柄 ——
const cardEl = ref<HTMLElement | null>(null)
let tilt: CardTiltHandle | null = null

onMounted(() => {
  // 倾角 10°（demo 是 15°，实机验收后下调：13px 书名在 15° 重采样下偏虚）；书卡仍用默认 6°
  if (cardEl.value) tilt = attachCardTilt(cardEl.value, { maxDeg: 10 })
})

onBeforeUnmount(() => {
  tilt?.detach()
  tilt = null
})
</script>

<style scoped>
/* 尺寸与书卡逐像素对齐：书卡 = 8+8 内边距 + 3:4 封面 + 6 间距 + 书名行；
   合集卡无内边距，用 ::before 撑出同等封面高（卡宽多 16px，封面自然高多 16×4/3 ≈ 21.3px），
   书名行照常占位后再用负边距抵掉自身底部内边距，总高与书卡相差 <1px */
.collection-card {
  gap: 0;
  /* 深度与 demo 一致：demo 用 240px 卡宽配 800px 视距，
     按比例换算到本卡约 560px，同等倾角下透视收缩才一致 */
  --card-perspective: 560px;
}

/* 占位撑高：只提供高度，不参与绘制与命中 */
.collection-card::before {
  content: '';
  width: 100%;
  aspect-ratio: 3 / 4;
  /* 抵掉书名行 10px 底部内边距（见 .card-title-row） */
  margin-bottom: -10px;
}

/* —— 视差层 1：封面画面（反向滞后，比例同 demo 的 ±20px：横 8.33%、纵 6.25%；
   外套预放大 18px 兜住露底）—— */
.cover-media {
  position: absolute;
  inset: -18px;
  transform: translate3d(calc(var(--par-x) * -8.333%), calc(var(--par-y) * -6.25%), 0);
  transition: transform 0.45s cubic-bezier(0.22, 0.8, 0.24, 1);
}

/* 占位态没有「画面」：图标随指针漂移会显得廉价，不参与视差 */
.cover-media.is-placeholder {
  transform: none;
  transition: none;
}

.cover-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 指针跟随期间切到 80ms 线性，与 .tilt-card 的跟手过渡同拍 */
.tilt-card.is-tilting .cover-media {
  transition: transform 0.08s linear;
  will-change: transform;
}

/* 封面铺满整张卡（含底部书名行所占空间），圆角对齐卡壳内沿（外半径 12px − 描边 1px）；
   卡高由 ::before 决定，故封面自身绝对定位 */
.cover {
  position: absolute;
  inset: 0;
  background: var(--placeholder);
  border-radius: calc(var(--card-radius) - 1px);
  overflow: hidden;
}

/* 底部纱罩：书名常驻叠底的对比底衬（不再随 hover 显隐） */
.cover-scrim {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 52%;
  pointer-events: none;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.68) 0%,
    rgba(0, 0, 0, 0.4) 38%,
    rgba(0, 0, 0, 0) 100%
  );
}

/* hover 发丝内框：inset 1px 贴边，框住整张封面 */
.cover::after {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: calc(var(--card-radius) - 2px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;
}

.collection-card:hover .cover::after {
  opacity: 1;
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

/* 材质由全局 .cover-badge 提供，此处只定位：移到左上，给底部书名让位 */
.count-badge {
  position: absolute;
  top: 8px;
  left: 8px;
}

/* 书名叠在封面底部：在流内占位（高度与书卡书名行一致），相对定位压到封面之上 */
.card-title-row {
  position: relative;
  z-index: 1;
  padding: 0 10px 10px;
}

.title {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 铺满封面的合集卡投影比单本更重一档（特异性 0,3,0 压过全局 .tilt-card:hover） */
.collection-card.tilt-card:hover {
  box-shadow: var(--card-shadow-lift-strong);
}

/* 减弱动态效果：视差归零、去掉位移过渡；内框只保留显隐 */
@media (prefers-reduced-motion: reduce) {
  .cover-media {
    transform: none;
    transition: none;
  }

  .cover::after {
    transition: none;
  }
}
</style>
