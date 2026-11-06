<template>
  <!-- 整块 stage 是 hover 命中区：书体翻开后会右移并缩小，命中区必须保持不动，
       否则指针瞬间离开元素会导致翻开 / 合上反复抖动 -->
  <div class="book-stage" :class="`is-${phase}`">
    <div
      class="book-book"
      role="button"
      tabindex="0"
      :aria-label="t('library.openBook', { title: book.title })"
      @click="emit('open', book.id)"
      @keydown.enter.prevent="emit('open', book.id)"
      @keydown.space.prevent="emit('open', book.id)"
    >
      <!-- 结构与角度照搬 demos/CodePen Home CSS Animated books：硬壳封面（正面 + 内侧）、
           5 张纸页、硬壳封底、书脊。合上时封面斜 34° 压在纸页堆上，右缘露出层叠的纸页边 -->
      <figure class="book">
        <ul class="hardcover_front">
          <li class="cover-face">
            <img v-if="hasCover" :src="book.coverUrl!" :alt="book.title" @error="onCoverError" />
            <span v-else class="cover-placeholder">{{ t('common.noCover') }}</span>
            <!-- 降级出口：减弱动效 / 无 hover 时内页永远不可见，进度改叠在封面 -->
            <span v-if="percent !== null" class="cover-progress">{{ percent }}%</span>
          </li>
          <!-- 封面内侧：翻开后只是一块空白衬板，衬在翻过去那叠纸页背后 -->
          <li class="cover-inside" aria-hidden="true"></li>
        </ul>

        <!-- 纸页：第 2 张就是右页（ltr 放下一页，rtl 放先读的当前页），合上时被封面压住 -->
        <ul class="page">
          <li></li>
          <li class="page-right">
            <img v-if="rightUrl" :src="rightUrl" alt="" @error="onRightError" />
            <span v-else-if="pendingRight" class="page-loading" aria-hidden="true" />
          </li>
          <!-- 左页 = 第 3 张纸页（ltr 放当前页，rtl 放下一页）：翻开时它翻得最少、深度上离观众
               最近，整张纸面看得全；li:4 / li:5 更大的角度扇在它外侧。它也是合上时最浅的那张，
               角度从 -32° 单调续到 -118°，三张纸途中不会互换前后 -->
          <li class="page-left">
            <img v-if="leftUrl" :src="leftUrl" alt="" @error="onLeftError" />
            <span v-else-if="pendingLeft" class="page-loading" aria-hidden="true" />
          </li>
          <li></li>
          <li></li>
        </ul>

        <ul class="hardcover_back">
          <li></li>
          <li></li>
        </ul>
        <ul class="book_spine">
          <li></li>
          <li></li>
        </ul>
      </figure>
    </div>
    <p class="book-name" :title="book.title">{{ book.title }}</p>
  </div>
</template>

<script setup lang="ts">
// 合集侧栏「继续阅读」的翻开书：合上是一本斜放 34° 的硬皮书（结构与角度照搬
// demos/CodePen Home CSS Animated books），悬停时封面绕书脊扇到 -145°、右页翻到 -35°，
// 后三张纸页 -118°/-130°/-140° 扇开，整本右移缩小一档「后退」；露出的两面按本书阅读方向排内容：
// rtl（日漫）右先读 → 右面当前页、左面下一页；ltr（韩漫）反之。左面内容挂在扇面里
// 深度最前的那张纸页（li:3，-118°）上，不是封面内侧；扇面比封面慢开，不会抢在封面之前摊开。
// 设计文档：specs/20261105-合集继续阅读栏3D硬皮书设计方案.md §4.2 / §5
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { Book } from '../../../shared/types'
import { t } from '../../i18n'
import { progressPercentOf } from '../../services/bookProgress'
import { getPdfPageThumb, resolvePageThumb, type PageThumb } from '../../services/pageThumbnail'
import type { SideBookPhase } from '../../services/sideBookTransition'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps<{ book: Book; /** 换书过渡阶段，由父级状态机推进 */ phase: SideBookPhase }>()
const emit = defineEmits<{ open: [bookId: number] }>()

const percent = computed(() => progressPercentOf(props.book))

/**
 * 左右两面取图口径：CBZ / MOBI / EPUB 直给逐页图片地址，PDF 异步渲染；
 * 无进度从第 1 页起，取不到图回落封面。页序方向跟本书阅读方向，未读过的书用全局默认方向。
 */
const settingsStore = useSettingsStore()
const source = computed(() => resolvePageThumb(props.book, settingsStore.settings.defaultDirection))
/**
 * 页序方向：rtl（日漫）右先读 —— 当前页在右、下一页在左；ltr（韩漫）反之。
 * 封面恒从右侧向左翻，所以两种方向下动画不用镜像，只换两面内容。
 */
const pageOrder = computed(() => source.value.order)
/** 左页：ltr 放先读的当前页，rtl 放后读的下一页 */
const leftSource = computed(() => (pageOrder.value === 'rtl' ? source.value.next : source.value.current))
/** 右页：rtl 放先读的当前页 */
const rightSource = computed(() => (pageOrder.value === 'rtl' ? source.value.current : source.value.next))

/** 异步页源：只有 PDF 需要离屏渲染；CBZ / MOBI / EPUB / 回落封面都是同步地址 */
const asyncLeft = ref<string | null>(null)
const asyncRight = ref<string | null>(null)
/** 左页取图失败 */
const leftFailed = ref(false)
/** 右页取图失败 */
const rightFailed = ref(false)
/** 封面也失败 → 落纸色占位，避免 error 循环 */
const coverFailed = ref(false)

/** 主面在左（ltr）：主面 = 先读到的那一页，取不到图时回落封面，辅面留白 */
const primaryOnLeft = computed(() => pageOrder.value === 'ltr')

/** 是否属于需要异步取图的页源（拿图前先铺纸色底纹，避免闪「无封面」） */
function isAsyncThumb(s: PageThumb | null): boolean {
  return s?.kind === 'pdf'
}

/** 发起单面取图：失败由 watch 统一置失败态 */
function loadAsyncThumb(s: PageThumb | null): Promise<string> | null {
  if (s?.kind === 'pdf') return getPdfPageThumb(s.bookId, s.page)
  return null
}

/** 封面可用：封面图缺失或加载失败后不再重试 */
const hasCover = computed(() => Boolean(props.book.coverUrl) && !coverFailed.value)

/** 异步取图中：先铺纸色底纹，避免闪「无封面」 */
const pendingLeft = computed(
  () => !leftFailed.value && isAsyncThumb(leftSource.value) && asyncLeft.value === null
)
const pendingRight = computed(
  () => !rightFailed.value && isAsyncThumb(rightSource.value) && asyncRight.value === null
)

/** 单面图片地址：先读面取图失败才回落封面，后读面（辅面）直接留白 */
function urlOf(
  s: PageThumb | null,
  failed: boolean,
  isPrimary: boolean,
  asyncUrl: string | null,
  fallbackCover: string | null | undefined
): string | null {
  if (failed) {
    if (!isPrimary) return null
    return coverFailed.value ? null : (fallbackCover ?? null)
  }
  if (!s) return null
  if (s.kind === 'image') return s.url
  if (s.kind === 'cover') return s.url
  return asyncUrl
}

/** 左页图片地址 */
const leftUrl = computed<string | null>(() =>
  urlOf(
    leftSource.value,
    leftFailed.value,
    primaryOnLeft.value,
    asyncLeft.value,
    props.book.coverUrl
  )
)

/** 右页图片地址 */
const rightUrl = computed<string | null>(() =>
  urlOf(
    rightSource.value,
    rightFailed.value,
    !primaryOnLeft.value,
    asyncRight.value,
    props.book.coverUrl
  )
)

/** 单面失败：主面先回落封面，封面也失败则留白；辅面直接留白 */
function markFailed(failed: Ref<boolean>, isPrimary: boolean): void {
  if (!isPrimary) {
    failed.value = true
    return
  }
  if (failed.value) coverFailed.value = true
  else failed.value = true
}

function onLeftError(): void {
  markFailed(leftFailed, primaryOnLeft.value)
}

function onRightError(): void {
  markFailed(rightFailed, !primaryOnLeft.value)
}

function onCoverError(): void {
  coverFailed.value = true
}

/** 侧栏在 ≤860px 被父级 display: none 隐藏，此时不发起 PDF 解析 */
function shouldRenderThumb(): boolean {
  return typeof window === 'undefined' || window.innerWidth > 860
}

/** 跟随窗口断点：侧栏从隐藏变可见时才重新取图，避免窄窗口白跑 pdf.js */
const sideVisible = ref(shouldRenderThumb())

function onWindowResize(): void {
  sideVisible.value = shouldRenderThumb()
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
})

/** 单页取图标识：格式 / 页码 / 封面归属任一变化都要重新取图 */
function sourceKey(s: PageThumb | null): string {
  if (!s) return '-'
  if (s.kind === 'image') return `image:${s.url}`
  if (s.kind === 'pdf') return `pdf:${s.bookId}:${s.page}`
  return `cover:${props.book.id}`
}

/** 左右两面都进 key：切书或翻页后任一变化都要重新取图并重置失败态 */
const loadKey = computed(() => {
  if (!sideVisible.value) return 'hidden'
  return `${sourceKey(leftSource.value)}|${sourceKey(rightSource.value)}`
})

let loadToken = 0
let disposed = false

watch(
  loadKey,
  async () => {
    asyncLeft.value = null
    asyncRight.value = null
    leftFailed.value = false
    rightFailed.value = false
    coverFailed.value = false
    if (!sideVisible.value) return
    const token = ++loadToken

    const leftTask = loadAsyncThumb(leftSource.value)
    if (leftTask) {
      try {
        const url = await leftTask
        // 切书 / 卸载后迟到的结果直接丢弃
        if (disposed || token !== loadToken) return
        asyncLeft.value = url
      } catch {
        if (disposed || token !== loadToken) return
        leftFailed.value = true
      }
    }

    const rightTask = loadAsyncThumb(rightSource.value)
    if (rightTask) {
      try {
        const url = await rightTask
        if (disposed || token !== loadToken) return
        asyncRight.value = url
      } catch {
        if (disposed || token !== loadToken) return
        rightFailed.value = true
      }
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  disposed = true
  loadToken++
})
</script>

<style scoped>
/* —— 几何：书 138×190，是 demos/CodePen Home CSS Animated books（160×220）的 0.8625 倍，
      下面所有 translateZ / 偏移量都按同一系数换算过。合上时封面斜视 34°、右缘与下方露出层叠的
      纸页边；翻开时封面扇到 145°、右页翻到 35°，后三张纸页 -118°/-130°/-140° 扇成左页，
      整本右移 53px、缩到 0.9「后退」一档，半开姿态 222px 宽稳落在 260px 的侧栏内容里 —— */
.book-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.book-book {
  flex: 0 0 auto;
  cursor: pointer;
}

/* 鼠标点击不留焦点环，键盘 Tab 过来才显形 */
.book-book:focus-visible .book {
  outline: 2px solid var(--text-muted);
  outline-offset: 6px;
  border-radius: 4px;
}

/* 透视挂在书上：合上与翻开共用同一台相机，缩小就等于后退 */
.book {
  position: relative;
  width: 138px;
  height: 190px;
  margin: 0;
  padding: 0;
  perspective: 860px;
  transform-style: preserve-3d;
  /* +5px：斜视下书体偏左、纸页边在右，合起来才是视觉居中 */
  transform: translateX(5px);
  /* 合上时的接地投影；翻开时换成更铺开的一档（见文件末尾 hover 块） */
  --book-lift: 7px 2px 34px 10px var(--book-shadow);
  transition: transform 0.75s cubic-bezier(0.45, 0.15, 0.25, 1);
}

.book ul,
.book li {
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ===== 底色与厚度面：整段照搬 demo ===== */
/* 封面正面吃 backface-visibility: hidden，背面朝观众时自动隐身；封面内侧同理，
   所以合上时看不到内页，翻开后它转成朝观众的那块空白衬板 */
.hardcover_front li:first-child { background-color: #eee; backface-visibility: hidden; }
.hardcover_front li:last-child { background: #fffbec; backface-visibility: hidden; }
.hardcover_back li:first-child { background: #fffbec; }
.hardcover_back li:last-child { background: #fffbec; }
.book_spine li:first-child { background: #eee; }
.book_spine li:last-child { background: #333; }

/* 12 片 #999 厚度面：硬壳与书脊的断面，合上时它们就是封面四周那圈灰黑硬边 */
.hardcover_front li:first-child::after,
.hardcover_front li:first-child::before,
.hardcover_front li:last-child::after,
.hardcover_front li:last-child::before,
.hardcover_back li:first-child::after,
.hardcover_back li:first-child::before,
.hardcover_back li:last-child::after,
.hardcover_back li:last-child::before,
.book_spine li:first-child::after,
.book_spine li:first-child::before,
.book_spine li:last-child::after,
.book_spine li:last-child::before {
  content: '';
  background: #999;
}

/* 纸页：左缘靠书脊压暗、右缘是切边，所以只有右侧带圆角 */
.page > li {
  background: linear-gradient(to right, #e1ddd8 0%, #fffbf6 100%);
  box-shadow: inset 0 -1px 2px rgba(50, 50, 50, 0.1), inset -1px 0 1px rgba(150, 150, 150, 0.2);
  border-radius: 0 4px 4px 0;
}

/* ===== 合上：封面 34°、封底 15°、纸页 28~36°，原样照搬 demo ===== */
.hardcover_front { transform: rotateY(-34deg) translateZ(7px); z-index: 100; }
.hardcover_back { transform: rotateY(-15deg) translateZ(-7px); }
.page li:nth-child(1) { transform: rotateY(-28deg); }
.page li:nth-child(2) { transform: rotateY(-30deg); }
.page li:nth-child(3) { transform: rotateY(-32deg); }
.page li:nth-child(4) { transform: rotateY(-34deg); }
.page li:nth-child(5) { transform: rotateY(-36deg); }

/* ===== 定位与过渡：合上 / 翻开共用同一套几何，只换角度 ===== */
.hardcover_front,
.hardcover_back,
.book_spine,
.hardcover_front li,
.hardcover_back li,
.book_spine li {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

/* 转轴恒在左下角：封面绕它向左扇开，封底原地摊平 */
.hardcover_front,
.hardcover_back {
  transform-origin: 0% 100%;
}

.hardcover_front {
  transition: all 0.8s ease, z-index 0.6s;
}

.hardcover_back {
  transition: all 0.8s ease;
}

/* 封面正面 / 内侧、封底两面各退 1.75px：硬壳才有 3.5px 厚的板 */
.hardcover_front li:first-child { transform: translateZ(1.75px); }
.hardcover_front li:last-child { transform: rotateY(180deg) translateZ(1.75px); }
.hardcover_back li:first-child { transform: translateZ(1.75px); }
.hardcover_back li:last-child { transform: translateZ(-1.75px); }

/* 厚度面：挂到各自板边，合上时它们就是封面四周那圈灰黑硬边 */
.hardcover_front li:first-child::after,
.hardcover_front li:first-child::before,
.hardcover_front li:last-child::after,
.hardcover_front li:last-child::before,
.hardcover_back li:first-child::after,
.hardcover_back li:first-child::before,
.hardcover_back li:last-child::after,
.hardcover_back li:last-child::before,
.book_spine li:first-child::after,
.book_spine li:first-child::before,
.book_spine li:last-child::after,
.book_spine li:last-child::before {
  position: absolute;
  top: 0;
  left: 0;
}

/* 封面：书脊侧 + 书口侧两条竖边 */
.hardcover_front li:first-child::after,
.hardcover_front li:first-child::before {
  width: 3.5px;
  height: 100%;
}

.hardcover_front li:first-child::after {
  transform: rotateY(90deg) translateZ(-1.75px) translateX(1.75px);
}

.hardcover_front li:first-child::before {
  transform: rotateY(90deg) translateZ(136.25px) translateX(1.75px);
}

/* 封面内侧：上下两条横边，长度 = 书宽 138 */
.hardcover_front li:last-child::after,
.hardcover_front li:last-child::before {
  width: 3.5px;
  height: 138px;
}

.hardcover_front li:last-child::after {
  transform: rotateX(90deg) rotateZ(90deg) translateZ(69px) translateX(-1.75px) translateY(-67.25px);
}

.hardcover_front li:last-child::before {
  box-shadow: 0 0 18px 3px rgba(0, 0, 0, 0.3);
  transform: rotateX(90deg) rotateZ(90deg) translateZ(-121px) translateX(-1.75px) translateY(-67.25px);
}

/* 封底：同封面一套，只是左右偏移镜像 */
.hardcover_back li:first-child::after,
.hardcover_back li:first-child::before {
  width: 3.5px;
  height: 100%;
}

.hardcover_back li:first-child::after {
  transform: rotateY(90deg) translateZ(-1.75px) translateX(1.75px);
}

.hardcover_back li:first-child::before {
  transform: rotateY(90deg) translateZ(136.25px) translateX(1.75px);
}

.hardcover_back li:last-child::after,
.hardcover_back li:last-child::before {
  width: 3.5px;
  height: 138px;
}

.hardcover_back li:last-child::after {
  transform: rotateX(90deg) rotateZ(90deg) translateZ(69px) translateX(1.75px) translateY(-67.25px);
}

/* demo 是 10px -1px 80px 20px #666：在纯白侧栏上会铺满 260px 像一道脏带，收窄到 1/3 */
.hardcover_back li:last-child::before {
  box-shadow: var(--book-lift);
  transform: rotateX(90deg) rotateZ(90deg) translateZ(-121px) translateX(1.75px) translateY(-67.25px);
}

/* —— 书脊：14px 宽、斜 60° 藏在封面左侧。合上时是硬壳的左端面，
      翻开后翻到中缝处只剩共面碎条，整体淡出 —— */
.book_spine {
  transform: rotateY(60deg) translateX(-4.3px) translateZ(-10.4px);
  width: 14px;
  z-index: 0;
  transition: opacity 0.35s ease;
}

.book_spine li:first-child { transform: translateZ(1.75px); }
.book_spine li:last-child { transform: translateZ(-1.75px); }

.book_spine li:first-child::after,
.book_spine li:first-child::before {
  width: 3.5px;
  height: 100%;
}

.book_spine li:first-child::after {
  transform: rotateY(90deg) translateZ(-1.75px) translateX(1.75px);
}

.book_spine li:first-child::before {
  transform: rotateY(-90deg) translateZ(-10.4px);
}

.book_spine li:last-child::after,
.book_spine li:last-child::before {
  width: 3.5px;
  height: 14px;
}

.book_spine li:last-child::after {
  transform: rotateX(90deg) rotateZ(90deg) translateZ(7px) translateX(1.75px) translateY(-5.25px);
}

.book_spine li:last-child::before {
  box-shadow: 3px -1px 30px 10px rgba(0, 0, 0, 0.14);
  transform: rotateX(90deg) rotateZ(90deg) translateZ(-181px) translateX(1.75px) translateY(-5.25px);
}

/* —— 纸页：left 必须贴 0，demo 的 3% 会在中缝留一道 4px 裂缝 —— */
.page,
.page > li {
  position: absolute;
  top: 0;
  left: 0;
  transform-style: preserve-3d;
}

.page {
  width: 100%;
  height: 98%;
  top: 1%;
  left: 0;
  z-index: 10;
}

/* 逐页错开时长，翻开时像依次被拨过去，而不是五张纸同时倒 */
.page > li {
  width: 100%;
  height: 100%;
  transform-origin: left center;
  transition-property: transform;
  transition-timing-function: ease;
}

.page > li:nth-child(1) { transition-duration: 0.6s; }
.page > li:nth-child(2) { transition-duration: 0.6s; }
.page > li:nth-child(3) { transition-duration: 0.4s; }
.page > li:nth-child(4) { transition-duration: 0.5s; }
.page > li:nth-child(5) { transition-duration: 0.6s; }

/* —— 封面正面：书皮图 —— */
/* 不能给这两块板加 overflow: hidden —— 挂在它们身上的厚度面伪元素会被一并裁掉 */
.cover-face {
  background-color: #eee;
  /* 右缘小圆角 = 切边，左缘直角 = 书脊侧，硬皮书的固定形制 */
  border-radius: 0 4px 4px 0;
}

.cover-face img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* —— 封面内侧 = 翻开后衬在左页背后的空白硬板。板面本身转了 180°，加封面 -145° 后净角只剩 35°，
      仍朝向观众，所以这里**不能**再加 scaleX(-1) —— */
.cover-inside {
  background: #fffbec;
  /* 顺时针转 180°：元素右侧的圆角落在屏幕左侧，正好是左页的外切口 */
  border-radius: 0 4px 4px 0;
}

/* —— 两面内容：铺满整张纸、等比缩放（漫画页是整页图，contain 才能完整入框）。
      右页得先压住：合上时 li:2 比封面宽，会在封面右侧露出约 10px，翻开后再淡入；
      左页在 li:3 上，图在纸的背面，合上态被纸面自己挡着 —— */
.page-right img,
.page-left img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #f7f4ec;
}

.page-right img {
  opacity: 0;
  transition: opacity 0.18s ease;
}

/* 左页那张纸翻到 -118°，看到的是它的**背面**：直接铺图会左右镜像（漫画页字是反的）。
   给图再绕自身竖轴转 180°，镜像抵消；translateZ 微推 0.5px，图就落在纸背面那一侧 ——
   纸页没转过 90° 时正面朝人，图被纸面整个挡在后面（不需要再加任何 opacity 门控）；
   转过 90° 图才露出来。backface-visibility 兜的是接近 90° 时那 1px 侧边（实测 -85° 会从
   纸缘漏出一道红线，加上就没了）。图与纸共用同一个 3D 上下文，中间不能插不带
   preserve-3d 的包裹元素，否则图会被压平到纸面上、在 -75° 附近反着露出来 —— */
.page-left img {
  transform: rotateY(180deg) translateZ(0.5px);
  backface-visibility: hidden;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  background: var(--placeholder);
  color: var(--text-muted);
  font-size: 11px;
}

/* 降级进度胶囊：仅减弱动效 / 无 hover 时显示 */
.cover-progress {
  position: absolute;
  right: 5px;
  bottom: 5px;
  /* 抬到封面图之上 */
  z-index: 1;
  display: none;
  align-items: center;
  padding: 1px 5px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.42);
  -webkit-backdrop-filter: blur(10px) saturate(180%);
  backdrop-filter: blur(10px) saturate(180%);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* PDF 渲染中：纸色斜纹底，避免出现闪烁骨架块 */
.page-loading {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(to bottom, rgba(20, 18, 14, 0.03) 0 6px, transparent 6px 12px),
    #faf7ef;
}

/* 书名：底部留白为页缘让位 */
.book-name {
  margin: 20px 0 0;
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* —— 翻开：照搬 demo —— 封面绕左下角扇到 -145°、右页 -30°/-35°、后三张纸页
      -118°/-130°/-140° 扇成左页（比封面慢，先荡封面再开扇面），封底保持合上时的 -15° 不动。
      整本右移 53px 并缩到 0.9：半开姿态左到封面内板 113px、右到封底 133px，展宽 246px，
      视觉中心比书体中心偏左 59px，右移 59 × 0.9 ≈ 53 才在侧栏里居中；缩完 222px 宽、左右各留 19px —— */
@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .book-stage:is(:hover, :focus-within) .book {
    transform: translateX(53px) scale(0.9);
    /* 摊开后书离桌面更近，底影要跟着铺开一点，否则整本像贴在卡片上的纸片 */
    --book-lift: 6px 3px 30px 12px rgba(0, 0, 0, 0.2);
  }

  .book-stage:is(:hover, :focus-within) .hardcover_front {
    transform: rotateY(-145deg) translateZ(0);
  }

  /* 右页：demo 是 -30° / -35°，只比合上时多翻几度，半开的书口才立得住 */
  .book-stage:is(:hover, :focus-within) .page li:nth-child(1) { transform: rotateY(-30deg); transition-duration: 0.7s; }
  .book-stage:is(:hover, :focus-within) .page li:nth-child(2) { transform: rotateY(-35deg); transition-duration: 0.8s; }
  /* 翻过去那叠（左页）：照 demo 的 -118° / -130° / -140° **正序**分配 —— li:3 翻得最少、
     自由边深度 z = 138·sinθ 最大，也就是扇面里离观众最近、投影最宽的那张（138·cos62° ≈ 65px），
     带缩略图的必须是它。角度从合上时的 -32°/-34°/-36° 单调续下去，三张纸途中不会互换前后。
     时长照 demo 比封面慢一档（0.9~1.2s，demo 是 1.2/1.4/1.6）：封面先荡过去，扇面再跟上，
     纸页若跑得比封面快（之前 0.6~0.8s）会在封面还在立着时就把扇面摊开，看着像穿透封面 —— */
  .book-stage:is(:hover, :focus-within) .page li:nth-child(3) { transform: rotateY(-118deg); transition-duration: 1.2s; }
  .book-stage:is(:hover, :focus-within) .page li:nth-child(4) { transform: rotateY(-130deg); transition-duration: 1.05s; }
  .book-stage:is(:hover, :focus-within) .page li:nth-child(5) { transform: rotateY(-140deg); transition-duration: 0.9s; }

  /* 书脊翻到中缝处只剩几片共面碎条，还带着 30px 的大模糊阴影，整体淡出 */
  .book-stage:is(:hover, :focus-within) .book_spine {
    opacity: 0;
  }

  /* 右页内容跟着翻开动作走：起步就给（微量延迟避开合上态），纸页转到哪内容就在哪 */
  .book-stage:is(:hover, :focus-within) .page-right img {
    opacity: 1;
    transition-delay: 0.05s;
  }

  /* 左页内容不加任何时间门控：图在纸的背面、比纸面退 0.5px，纸还没转过 90° 时被纸自己挡着，
     转过 90° 才露出来 —— 出现在哪一刻由几何决定，与翻转同步，没有“延迟显形”这回事 —— */
}

/* —— 换书过渡：closing 淡出，entering 上浮入场 —— */
.book-stage.is-closing .book-book {
  opacity: 0.35;
}

.book-stage.is-entering .book-book {
  animation: book-enter 0.32s ease-out;
}

@keyframes book-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* —— 减弱动效 / 无 hover 设备：不翻开，进度改由封面胶囊承担 —— */
@media (prefers-reduced-motion: reduce), (hover: none) {
  .book,
  .hardcover_front,
  .hardcover_back,
  .book_spine,
  .page > li,
  .page-right img {
    transition: none;
  }

  .book-stage.is-entering .book-book {
    animation: none;
  }

  .cover-progress {
    display: inline-flex;
  }
}
</style>
