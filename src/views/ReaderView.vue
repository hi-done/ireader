<template>
  <!-- 按格式分发：EPUB 走独立阅读器，PDF 走下方 Canvas 阅读器（原有逻辑不动） -->
  <EpubReaderView v-if="isEpub" :book-id="routeBookId" />
  <div
    v-else
    ref="rootEl"
    class="reader-view"
    @wheel="onWheel"
    @mousemove="onMouseMove"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
  >
    <header class="top-bar" :class="{ visible: barsVisible }">
      <button class="icon-btn" @click="goBack">← 返回</button>
      <span class="title">{{ bookTitle }}</span>
      <button
        class="book-nav"
        :disabled="prevBookId == null"
        title="上一本"
        @click="switchBook(-1)"
      >
        ‹ 上一本
      </button>
      <button
        class="book-nav"
        :disabled="nextBookId == null"
        title="下一本"
        @click="switchBook(1)"
      >
        下一本 ›
      </button>
      <div class="controls">
        <button @click="reader.setMode(reader.mode === 'single' ? 'double' : 'single')">
          {{ reader.mode === 'single' ? '单页' : '双页' }}
        </button>
        <button @click="reader.setDirection(reader.direction === 'ltr' ? 'rtl' : 'ltr')">
          {{ reader.direction === 'ltr' ? '左→右' : '右→左' }}
        </button>
        <select class="zoom-select" :value="reader.zoomMode" title="缩放" @change="onZoomSelect">
          <option value="fitWidth">适宽</option>
          <option value="fitHeight">适高</option>
          <option value="original">原始</option>
          <option v-if="reader.zoomMode === 'custom'" value="custom">
            自定义 {{ Math.round(reader.zoomScale * 100) }}%
          </option>
        </select>
        <button title="全屏（F）" @click="toggleFullscreen">⛶</button>
      </div>
    </header>

    <div ref="pageAreaEl" class="page-area">
      <div v-if="loadError" class="state-tip">
        <p>无法打开本书：{{ loadError }}</p>
        <button @click="goBack">返回文库</button>
      </div>
      <div v-else-if="!reader.doc" class="state-tip">加载中…</div>
      <template v-else>
        <!-- margin:auto：内容小于视口时居中，超出视口时可滚动到边缘 -->
        <div ref="pageContentEl" class="page-content">
          <div
            v-for="(_, i) in currentDisplayPages"
            :key="i"
            class="page-wrap"
          >
            <!-- key 用索引：单双页切换时同位置 canvas 复用同一 DOM，配合 pdf 层的自动取消正确工作 -->
            <canvas :ref="(el) => setCanvasRef(i, el)" />
          </div>
        </div>
        <div class="hotzone hotzone-left" @click="onHotzoneClick('left')" />
        <div class="hotzone hotzone-right" @click="onHotzoneClick('right')" />
      </template>
    </div>

    <footer class="bottom-bar" :class="{ visible: barsVisible }">
      <span class="page-indicator">{{ currentPageLabel }} / {{ reader.numPages }}</span>
      <button
        class="nav-btn"
        :disabled="reader.currentIndex <= 0"
        @click="reader.prev()"
      >
        ‹ 上一页
      </button>
      <input
        class="page-slider"
        type="range"
        min="0"
        :max="Math.max(0, reader.spreads.length - 1)"
        :value="reader.currentIndex"
        @input="onSlide"
        @change="onSlideEnd"
      />
      <button
        class="nav-btn"
        :disabled="reader.currentIndex >= reader.spreads.length - 1"
        @click="reader.next()"
      >
        下一页 ›
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ZoomMode } from '../../shared/types'
import { useReaderStore } from '../stores/reader'
import { useLibraryStore } from '../stores/library'
import { useSettingsStore } from '../stores/settings'
import { ipc } from '../services/ipc'
import { getFromCache, putToCache, clearCache } from '../services/pageCache'
import { playPageCurl, type PageCurlHandle } from '../services/pageCurl'
import { renderPageToCanvas, type PageDocument, type RenderPageOptions } from '../services/pageRenderer'
import { startTracking, stopTracking, setTrackingPaused } from '../services/readingTracker'
import {
  normalizeWheelDelta,
  stepShiftWheelScroll,
  stepWheelScroll,
  type WheelScrollState,
} from '../services/wheelScroll'
import EpubReaderView from './EpubReaderView.vue'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const library = useLibraryStore()
const settingsStore = useSettingsStore()

/** 当前路由书 id（NaN 表示无有效参数，仅在 reader 路由下有意义） */
const routeBookId = computed(() => Number(route.params.bookId))
/** 当前书是否为 EPUB（据此切换阅读器组件） */
const isEpub = computed(
  () => library.books.find((b) => b.id === routeBookId.value)?.format === 'epub'
)

const barsVisible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
const loadError = ref('')
/** 与 currentDisplayPages 按索引一一对应的 canvas 引用 */
const canvasEls = ref<(HTMLCanvasElement | null)[]>([])
/** 渲染序号：翻页时递增，旧的异步渲染循环据此自我中止 */
let renderSeq = 0
/** 预取序号：翻页后作废旧的邻组预取循环 */
let prefetchSeq = 0
const pageAreaEl = ref<HTMLElement | null>(null)
/** 滚轮手势状态：纵向与 Shift 共用；横向纯移动不写入该状态 */
let wheelScrollState: WheelScrollState = {
  edgeAccum: 0,
  turnedInGesture: false,
  lastEventAt: 0,
  lastDir: 0,
}

// —— 翻页动画（仿真纸张卷曲，pageCurl.ts）——
/** 'forward'/'back' 为阅读流方向；null 表示本次重渲染不是翻页（模式/方向切换等），不播动画 */
let turnDir: 'forward' | 'back' | null = null
let lastAnimFirstPage = 0
let curlHandle: PageCurlHandle | null = null
const rootEl = ref<HTMLElement | null>(null)
const pageContentEl = ref<HTMLElement | null>(null)

const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const bookTitle = computed(
  () => library.books.find((b) => b.id === reader.bookId)?.title ?? ''
)

const currentDisplayPages = computed(
  () => reader.spreads[reader.currentIndex]?.displayOrder ?? []
)

const currentPageLabel = computed(
  () => reader.spreads[reader.currentIndex]?.firstPage ?? 0
)

onMounted(async () => {
  // 键盘监听挂 window：绑在 div 上的 keydown 需要焦点，页面刚打开时焦点在 body ，会导致按键全部失效
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  // 阅读计时从进入阅读页开始（PDF/EPUB 共用此路由视图，仅此一处埋点防双计）
  startTracking(routeBookId.value)
  if (!settingsStore.loaded) await settingsStore.load()
  // 直达路由（冷启动）时文库可能未加载，先静默刷新以判断格式
  if (library.books.length === 0) {
    try {
      await library.refresh({ silent: true })
    } catch {
      // 文库刷新失败不阻断阅读：按 PDF 路径走，失败由 reader.open 报错
    }
  }
  if (isEpub.value) return // EPUB 由 EpubReaderView 自行打开
  await openBook(routeBookId.value)
})

// 切换到 EPUB 时收尾 PDF 阅读器（落盘进度、销毁文档、清缓存），
// 防止 v-else 分支销毁后旧 PDF 文档仍占用资源/进度未落盘
watch(isEpub, (now) => {
  if (now) {
    reader.close()
    clearCache()
    curlHandle?.cancel()
    loadError.value = ''
  }
})

// 同一组件内切换书籍（上一本/下一本）：路由仅参数变化、组件复用，需重新加载；
// 返回文库时参数消失，不触发重载（组件随即卸载，由 onBeforeUnmount 收尾）
watch(
  () => route.params.bookId,
  (id) => {
    const nid = Number(id)
    if (!Number.isFinite(nid) || nid === reader.bookId) return
    startTracking(nid) // 换书切段：Timer 内部先结算旧书再开始新书
    void openBook(nid)
  }
)

// 加载失败（错误页停留）不计入阅读时长；恢复后按可见性重新评估
watch(loadError, (e) => setTrackingPaused(Boolean(e)))

/** 按 bookId 打开（可重入：上一本/下一本切换走同一路由不同参数）。首调时 close 为空操作 */
async function doOpen(id: number) {
  if (isEpub.value) return // EPUB 不经过 PDF 打开链
  loadError.value = ''
  reader.close() // 落盘上一本进度（flushProgress）并销毁旧 PDF 文档
  clearCache() // 位图缓存属于上一本书
  curlHandle?.cancel()
  await reader.open(id)
}

/** 打开串行化：快速连点「下一本」时，后一次 open 必须等前一次完成再 close/open，
 *  否则前一本书的进度落盘与文档销毁会丢失，且并发 open 完成顺序颠倒会停在错误的书上 */
let openChain: Promise<void> = Promise.resolve()
function openBook(id: number) {
  if (isEpub.value) return // EPUB 由 EpubReaderView 处理，不进 PDF 链
  openChain = openChain.then(() => doOpen(id))
  void openChain
    .then(async () => {
      await nextTick()
      await renderCurrentSpread()
      resetPageScroll('top') // 新书/切换书籍从页首开始，避免复用组件残留旧滚动位置
      showBarsTemporarily()
    })
    .catch((e) => {
      loadError.value = e instanceof Error ? e.message : String(e)
    })
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  if (hideTimer) clearTimeout(hideTimer)
  curlHandle?.cancel()
  clearCache()
  stopTracking() // 结算并停止阅读计时
  reader.close()
})

// —— 上一本 / 下一本：沿打开时的书单顺序切换 ——
// 主页打开 = 未分组书按文库排序偏好（与主页网格一致，含搜索过滤）；
// 合集内打开 = 该合集的书按名称升序（与合集视图一致）
const contextBooks = computed(() => {
  const cid = route.query.cid
  if (typeof cid === 'string' && cid) {
    return [...library.books]
      .filter((b) => b.collectionId === Number(cid))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
  }
  return library.filteredBooks.filter((b) => !b.collectionId)
})

const contextIndex = computed(() =>
  reader.bookId == null ? -1 : contextBooks.value.findIndex((b) => b.id === reader.bookId)
)

const prevBookId = computed(() => {
  const i = contextIndex.value
  return i > 0 ? contextBooks.value[i - 1].id : null
})

const nextBookId = computed(() => {
  const i = contextIndex.value
  return i >= 0 && i < contextBooks.value.length - 1 ? contextBooks.value[i + 1].id : null
})

function switchBook(delta: 1 | -1) {
  const id = delta === 1 ? nextBookId.value : prevBookId.value
  if (id == null) return
  // 保留 query（cid）：切换后「返回」仍能回到原合集；当前书进度由 openBook 里的 close 落盘
  router.push({ name: 'reader', params: { bookId: id }, query: { ...route.query } })
}

// 监听显示页序列而非 currentIndex：模式/方向切换可能保持索引不变，但 displayOrder 已变；
// 仅当页组确实前进/后退（firstPage 变化）时播翻页动画
watch(currentDisplayPages, async () => {
  const firstPage = reader.spreads[reader.currentIndex]?.firstPage ?? 0
  const isPageTurn =
    firstPage !== lastAnimFirstPage &&
    lastAnimFirstPage !== 0 &&
    !sliderActive && // 拖动期间无条件瞬切，不播动画
    Date.now() > sliderUntil // 兜底窗口（change 丢失时恢复）
  turnDir = isPageTurn ? (firstPage > lastAnimFirstPage ? 'forward' : 'back') : null
  lastAnimFirstPage = firstPage

  // 拖动中零渲染：整组缓存命中才贴图（邻页微调仍实时跟随），否则保持当前画面。
  // 跨多页拖动时每轮目标组全缓存 miss，若照常渲染会堆积大量无法取消的
  // pdf.js 渲染任务（每次都用新建离屏 canvas，重入取消永不触发），导致长时间卡顿
  if (sliderActive) {
    const bookId = reader.bookId
    if (bookId != null) {
      const sig = cacheSignature()
      const snaps = currentDisplayPages.value.map((p) => getFromCache(bookId, p, sig))
      if (snaps.every(Boolean)) {
        snaps.forEach((s, i) => {
          const d = canvasEls.value[i]
          if (d && s) blit(s, d)
        })
      }
    }
    return
  }

  // 翻页：先截取旧画面快照，供卷曲动画使用。
  // 旧页纵向溢出时用可视区快照：完整内容快照从页首绘制，用户在页底时动画会错位
  let fromSnap: HTMLCanvasElement | null = null
  let viewportSnap = false
  if (isPageTurn && !reducedMotion) {
    curlHandle?.cancel() // 连续翻页时立即揭除上一次动画
    viewportSnap = isVerticallyScrollable()
    fromSnap = snapshotForTurn(viewportSnap)
  }

  await nextTick()
  await renderCurrentSpread()

  // 翻页落点：前进置顶、后退置底；模式/方向切换不改变当前滚动位置
  if (isPageTurn) resetPageScroll(turnDir === 'back' ? 'bottom' : 'top')

  // 新组渲染完成后，用旧/新快照播放纸张翻页动画（覆盖层，结束后底下已是新页）
  if (fromSnap && rootEl.value) {
    const toSnap = snapshotForTurn(viewportSnap)
    const target = viewportSnap ? pageAreaEl.value : pageContentEl.value
    if (toSnap && target) {
      const fromRight = (turnDir === 'forward') === (reader.direction === 'ltr')
      curlHandle = playPageCurl({
        container: rootEl.value,
        target,
        from: fromSnap,
        to: toSnap,
        fromRight,
        zIndex: 1, // 低于控制栏（z2）：翻页动画不遮挡顶部/底部工具栏
      })
    }
  }
})

/** 将当前显示画面合成为一张快照。
 *  viewport=true：以 .page-area 可视区为裁剪框，只保留当前可见切片（含滚动偏移），黑底填充；
 *  viewport=false：沿用 .page-content 显示盒坐标系（双页含两页，含 dpr 物理像素）。
 *  几何取自各 canvas 的实际显示矩形（getBoundingClientRect）而非 style 尺寸——
 *  快照必须复刻“用户实际看到的画面”，CSS 居中/滚动等布局结果都被如实包含 */
function snapshotForTurn(viewport: boolean): HTMLCanvasElement | null {
  const frame = viewport ? pageAreaEl.value : pageContentEl.value
  if (!frame) return null
  // 遍历当前仍挂载的 canvas，而不是按新页组长度索引：页组数量变化时旧 DOM 仍在
  const list = canvasEls.value.filter(
    (c): c is HTMLCanvasElement => !!c && c.isConnected && c.width > 0
  )
  if (!list.length) return null

  const dpr = window.devicePixelRatio || 1
  const frameRect = frame.getBoundingClientRect()
  const cssW = frameRect.width
  const cssH = frameRect.height

  const snap = document.createElement('canvas')
  snap.width = Math.max(1, Math.round(cssW * dpr))
  snap.height = Math.max(1, Math.round(cssH * dpr))
  snap.style.width = `${cssW}px`
  snap.style.height = `${cssH}px`
  const sctx = snap.getContext('2d')
  if (!sctx) return null

  if (viewport) {
    // 阅读区背景为黑色：横向留白不透出新页内容
    sctx.fillStyle = '#000'
    sctx.fillRect(0, 0, snap.width, snap.height)
  }

  // 每页按其实际显示矩形贴入（相对裁剪框坐标）：越界部分由画布自动裁剪
  for (const c of list) {
    const rect = c.getBoundingClientRect()
    sctx.drawImage(
      c,
      (rect.left - frameRect.left) * dpr,
      (rect.top - frameRect.top) * dpr,
      rect.width * dpr,
      rect.height * dpr
    )
  }
  return snap
}

// 缩放变化（含 Ctrl+滚轮/快捷键步进）不改变页组，需要独立触发重渲染
watch(
  () => [reader.zoomMode, reader.zoomScale] as const,
  async () => {
    await nextTick()
    renderCurrentSpread()
  }
)

function setCanvasRef(i: number, el: unknown) {
  canvasEls.value[i] = el as HTMLCanvasElement | null
}

/** 当前缩放模式下的渲染目标尺寸（original 返回空对象即 100%）。
 *  不留边距：适高填满视口高度，适宽填满视口宽度，页面贴边 100% 显示 */
function zoomRenderOptions(): Pick<RenderPageOptions, 'targetWidth' | 'targetHeight'> {
  const vw = window.innerWidth
  const vh = window.innerHeight
  switch (reader.zoomMode) {
    case 'fitWidth':
      // 双页取两页合并宽度平分给每页（对页紧贴，无间隙补偿）
      return {
        targetWidth: reader.mode === 'double' ? Math.floor(vw / 2) : vw,
      }
    case 'original':
      return {}
    case 'custom':
      // 自定义以适高为基准缩放（scale 25%–400%）
      return { targetHeight: Math.round(vh * reader.zoomScale) }
    case 'fitHeight':
    default:
      return { targetHeight: vh }
  }
}

// 滑块拖动状态（声明在 blit 之前供其读取）：拖动期间贴图跳过淡入，避免高频闪烁
let sliderActive = false
let sliderUntil = 0
let slideFromSnap: HTMLCanvasElement | null = null
let slideDir: 'forward' | 'back' | null = null
/** 起点快照是否用了视口裁剪：决定松手后 to 快照与卷曲目标 */
let slideFromViewport = false

/** 缓存签名：视口/模式/缩放任一变化都会使旧位图自然失效。
 *  v2 前缀：渲染尺寸去掉 MARGIN 边距后与旧位图不兼容，前缀变更使旧缓存整体失效 */
function cacheSignature(): string {
  return `v2:${window.innerWidth}x${window.innerHeight}:${reader.mode}:${reader.zoomMode}:${reader.zoomScale}`
}

/** 将已渲染好的位图同步贴到显示 canvas；贴图时重播短淡入，柔和化慢路径渲染的突现感。
 *  滑块拖动期间跳过淡入：高频页组切换 × 每次淡入 = 内容反复透明渐显的闪烁 */
function blit(src: HTMLCanvasElement, dst: HTMLCanvasElement): void {
  dst.width = src.width
  dst.height = src.height
  dst.style.width = src.style.width
  dst.style.height = src.style.height
  dst.getContext('2d')?.drawImage(src, 0, 0)
  if (sliderActive) return
  dst.style.animation = 'none'
  void dst.offsetWidth // 强制 reflow 以重启动画
  dst.style.animation = ''
}

/** 渲染单页：缓存命中直接贴图（≤100ms 上屏），未命中渲染到离屏 canvas 后入缓存。
 *  seq 作废检查必须覆盖慢路径贴图：被新渲染循环作废的旧循环，其迟到渲染
 *  只入缓存、不得贴图——否则旧页内容会在松手动画前后覆盖新页，看起来像动画反复播放 */
async function paintPage(
  doc: PageDocument,
  page: number,
  display: HTMLCanvasElement,
  seq: number
): Promise<void> {
  const bookId = reader.bookId
  if (bookId == null) return
  const sig = cacheSignature()
  const cached = getFromCache(bookId, page, sig)
  if (cached) {
    if (seq === renderSeq) blit(cached, display)
    return
  }
  const offscreen = document.createElement('canvas')
  await renderPageToCanvas(doc, page, { canvas: offscreen, ...zoomRenderOptions() })
  putToCache(bookId, page, sig, offscreen)
  if (seq === renderSeq) blit(offscreen, display)
}

async function renderCurrentSpread() {
  const doc = reader.doc
  if (!doc) return
  const seq = ++renderSeq
  // 双页并行渲染：松手后的等待时间近似减半；作废检查在 paintPage 内部按 seq 拦截
  await Promise.all(
    currentDisplayPages.value.map((page, i) => {
      const display = canvasEls.value[i]
      if (!display) return Promise.resolve()
      return paintPage(doc, page, display, seq).catch((e) => {
        // 单页损坏不拖垮整组
        console.error(`[reader] 渲染第 ${page} 页失败`, e)
      })
    })
  )
  if (seq === renderSeq) void prefetchNeighbors(doc)
}

/** 当前组渲染完成后，异步预取后续页组与前一页组（数量取设置 preloadSpreads，0–4） */
async function prefetchNeighbors(doc: PageDocument): Promise<void> {
  const count = settingsStore.settings.preloadSpreads
  if (count <= 0 || reader.bookId == null) return
  const bookId = reader.bookId
  const token = ++prefetchSeq

  const order: number[] = []
  for (let s = reader.currentIndex + 1; s <= reader.currentIndex + count; s++) {
    order.push(...(reader.spreads[s]?.pages ?? []))
  }
  const prev = reader.spreads[reader.currentIndex - 1]
  if (prev) order.push(...prev.pages)

  for (const page of order) {
    if (token !== prefetchSeq) return // 已翻页，作废旧预取
    if (getFromCache(bookId, page, cacheSignature())) continue
    const offscreen = document.createElement('canvas')
    try {
      await renderPageToCanvas(doc, page, { canvas: offscreen, ...zoomRenderOptions() })
    } catch {
      continue // 预取失败静默，翻到时再按未命中处理
    }
    if (token !== prefetchSeq) return
    putToCache(bookId, page, cacheSignature(), offscreen)
  }
}

function goBack() {
  // 从合集视图进入时携带 ?cid=<id>：返回到该合集视图而非主页
  const cid = route.query.cid
  if (typeof cid === 'string' && cid) {
    router.push({ path: '/', query: { collection: cid } })
  } else {
    router.push('/')
  }
}

async function toggleFullscreen() {
  const next = !document.fullscreenElement
  if (next) await document.documentElement.requestFullscreen()
  else await document.exitFullscreen()
  ipc.window.setFullscreen(next)
}

function onHotzoneClick(side: 'left' | 'right') {
  if (suppressClick) {
    suppressClick = false
    return
  }
  const forward = reader.direction === 'ltr' ? side === 'right' : side === 'left'
  forward ? reader.next() : reader.prev()
}

// 滑块交互：拖动期间（input）无条件瞬切跟随，不叠动画；松手（change）后重演一次
// 从最后瞬切前画面到目标画面的翻页动画——全程只有松手这一次动画。
// 状态声明在 blit 之前；sliderActive 是精确状态而非时间窗：慢速拖动间隔再长也不会漏出动画；
// sliderUntil 仅作 change 意外丢失时的兜底恢复
function onSlide(e: Event) {
  const idx = Number((e.target as HTMLInputElement).value)
  if (idx !== reader.currentIndex) {
    // 记录瞬切前画面、方向与快照模式，供松手时播放唯一一次动画
    slideDir = idx > reader.currentIndex ? 'forward' : 'back'
    const viewport = isVerticallyScrollable()
    const snap = snapshotForTurn(viewport)
    if (snap) {
      slideFromSnap = snap
      slideFromViewport = viewport
    }
    sliderActive = true
    sliderUntil = Date.now() + 1000 // 兜底：change 丢失时 1s 后恢复动画
    reader.goTo(idx)
  }
}

function onSlideEnd() {
  const fromSnap = slideFromSnap
  const dir = slideDir
  const viewport = slideFromViewport
  slideFromSnap = null
  slideDir = null
  if (!sliderActive) return
  void finishSlide(fromSnap, dir, viewport)
}

/** 松手收尾：先等目标组渲染完成（仍处拖动态、贴图无淡入），再复位落点并播唯一一次卷曲。
 *  即使没有起点快照或系统减弱动态效果，也必须完成渲染与复位，不能停留在旧页/旧滚动位置 */
async function finishSlide(
  fromSnap: HTMLCanvasElement | null,
  dir: 'forward' | 'back' | null,
  viewport: boolean
) {
  const idx = reader.currentIndex
  await renderCurrentSpread() // 序号机制会作废拖动中遗留的旧渲染循环
  if (reader.currentIndex !== idx) return // 期间用户又拖动，交给新一轮流程
  sliderActive = false
  sliderUntil = 0
  resetPageScroll(dir === 'back' ? 'bottom' : 'top')
  if (!fromSnap || !dir || reducedMotion || !rootEl.value) return
  const target = viewport ? pageAreaEl.value : pageContentEl.value
  if (!target) return
  const toSnap = snapshotForTurn(viewport)
  if (!toSnap) return
  curlHandle?.cancel()
  const fromRight = (dir === 'forward') === (reader.direction === 'ltr')
  curlHandle = playPageCurl({
    container: rootEl.value,
    target,
    from: fromSnap,
    to: toSnap,
    fromRight,
    zIndex: 1, // 低于控制栏（z2）：翻页动画不遮挡顶部/底部工具栏
  })
}

let wheelLock = false
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    // Ctrl/Cmd+滚轮：缩放步进（阻止浏览器页缩放）
    e.preventDefault()
    stepZoom(e.deltaY < 0 ? 0.1 : -0.1)
    return
  }
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
    return // 滑块、缩放下拉等控件保留自己的滚轮行为
  }

  const area = pageAreaEl.value
  if (!area) return
  const delta = normalizeWheelDelta(e, area.clientHeight)
  if (Math.abs(delta) < 0.5) return // 触控板噪声

  const hScrollable = isHorizontallyScrollable()
  const vScrollable = isVerticallyScrollable()

  // Shift+滚轮：横向优先，到左/右缘后转为上/下移动；横向无溢出时等同普通滚轮
  if (e.shiftKey && (hScrollable || vScrollable)) {
    e.preventDefault()
    const r = stepShiftWheelScroll(wheelScrollState, {
      delta,
      scrollLeft: area.scrollLeft,
      scrollWidth: area.scrollWidth,
      clientWidth: area.clientWidth,
      scrollTop: area.scrollTop,
      scrollHeight: area.scrollHeight,
      clientHeight: area.clientHeight,
      now: performance.now(),
    })
    wheelScrollState = r.state
    area.scrollLeft = r.scrollLeft
    area.scrollTop = r.scrollTop
    if (r.turn === 'next') reader.next()
    else if (r.turn === 'prev') reader.prev()
    return
  }

  // 无 Shift 的横向滚轮/触控板横滑：保留原生横向滚动
  if (!e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return

  if (vScrollable) {
    e.preventDefault()
    const r = stepWheelScroll(wheelScrollState, {
      deltaY: delta,
      scrollTop: area.scrollTop,
      scrollHeight: area.scrollHeight,
      clientHeight: area.clientHeight,
      now: performance.now(),
    })
    wheelScrollState = r.state
    area.scrollTop = r.scrollTop
    if (r.turn === 'next') reader.next()
    else if (r.turn === 'prev') reader.prev()
    return
  }

  // 页面无可滚动内容：保留原翻页逻辑（20px 阈值 + 250ms 冷却）
  if (wheelLock || Math.abs(delta) < 20) return
  wheelLock = true
  setTimeout(() => (wheelLock = false), 250)
  delta > 0 ? reader.next() : reader.prev()
}

/** 纵向是否有可滚动余量（1px 内视为舍入误差） */
function isVerticallyScrollable(): boolean {
  const area = pageAreaEl.value
  return !!area && area.scrollHeight > area.clientHeight + 1
}

function isHorizontallyScrollable(): boolean {
  const area = pageAreaEl.value
  return !!area && area.scrollWidth > area.clientWidth + 1
}

/** 翻页后的落点：前进置顶、后退置底；横向统一回左缘，避免残留旧平移 */
function resetPageScroll(anchor: 'top' | 'bottom'): void {
  const area = pageAreaEl.value
  if (!area) return
  area.scrollTop = anchor === 'bottom' ? area.scrollHeight : 0 // 浏览器自动夹取到最大值
  area.scrollLeft = 0
}

function stepZoom(delta: number) {
  const next = Math.min(4, Math.max(0.25, Math.round((reader.zoomScale + delta) * 10) / 10))
  if (next !== reader.zoomScale) reader.setZoom('custom', next)
}

function onZoomSelect(e: Event) {
  const mode = (e.target as HTMLSelectElement).value as ZoomMode
  reader.setZoom(mode, 1)
}

function showBarsTemporarily(ms = 3000) {
  barsVisible.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => (barsVisible.value = false), ms)
}

function onMouseMove(e: MouseEvent) {
  const edge = 64
  if (e.clientY < edge || e.clientY > window.innerHeight - edge) {
    showBarsTemporarily(1500)
  }
  if (panning && pageAreaEl.value) {
    const dx = e.clientX - panStartX
    const dy = e.clientY - panStartY
    if (!panMoved && Math.abs(dx) + Math.abs(dy) > 4) {
      panMoved = true
      document.body.classList.add('panning')
    }
    if (panMoved) {
      pageAreaEl.value.scrollLeft = scrollStartX - dx
      pageAreaEl.value.scrollTop = scrollStartY - dy
    }
  }
}

// —— 拖拽平移（缩放超出可视区时容器可滚动，按住拖动即可平移）——
let panning = false
let panMoved = false
let panStartX = 0
let panStartY = 0
let scrollStartX = 0
let scrollStartY = 0
/** 拖拽结束后的首次 click 不应触发热区翻页 */
let suppressClick = false

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0 || !pageAreaEl.value) return
  const area = pageAreaEl.value
  if (area.scrollWidth <= area.clientWidth && area.scrollHeight <= area.clientHeight) return
  panning = true
  panMoved = false
  panStartX = e.clientX
  panStartY = e.clientY
  scrollStartX = area.scrollLeft
  scrollStartY = area.scrollTop
}

function onMouseUp() {
  if (!panning) return
  panning = false
  document.body.classList.remove('panning')
  if (panMoved) suppressClick = true
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null
function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  // 防抖：连续拖拽窗口只重渲最后一帧；缓存签名含视口尺寸，旧位图自动失效
  resizeTimer = setTimeout(() => void renderCurrentSpread(), 200)
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
    return // 滑块等控件聚焦时让方向键留给控件自身
  }
  // 左右键固定语义（左=上一页、右=下一页），不随 RTL 翻转：
  // 通用操作习惯优先于阅读方向的几何隐喻
  switch (e.key) {
    case 'ArrowRight':
      reader.next()
      break
    case 'ArrowLeft':
      reader.prev()
      break
    case 'ArrowDown':
      // 上下方向键同样翻页（阅读器为页组制，无垂直浏览滚动冲突）
      reader.next()
      break
    case 'ArrowUp':
      reader.prev()
      break
    case ' ':
      e.shiftKey ? reader.prev() : reader.next()
      break
    case 'PageDown':
      reader.next()
      break
    case 'PageUp':
      reader.prev()
      break
    case 'Home':
      reader.goTo(0)
      break
    case 'End':
      reader.goTo(reader.spreads.length - 1)
      break
    case '=':
    case '+':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        stepZoom(0.1)
      }
      break
    case '-':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        stepZoom(-0.1)
      }
      break
    case 'd':
    case 'D':
      reader.setMode(reader.mode === 'single' ? 'double' : 'single')
      break
    case 'r':
    case 'R':
      reader.setDirection(reader.direction === 'ltr' ? 'rtl' : 'ltr')
      break
    case 'f':
    case 'F':
      toggleFullscreen()
      break
    case 'Escape':
      if (document.fullscreenElement) document.exitFullscreen()
      else goBack()
      break
  }
}
</script>

<style scoped>
.reader-view {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
  outline: none;
}

.top-bar,
.bottom-bar {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  /* macOS 深色 vibrant 材质：半透明深灰 + 高斯模糊 */
  background: rgba(28, 28, 30, 0.6);
  backdrop-filter: blur(20px) saturate(180%);
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 2;
}

.top-bar {
  top: 0;
  /* 返回按钮水平落点对齐设置页页头：非 mac 左 40px；mac 由全局 .platform-mac .top-bar 覆盖为 84px */
  padding: 8px 40px;
}

.bottom-bar {
  bottom: 0;
}

.top-bar.visible,
.bottom-bar.visible {
  opacity: 1;
}

.book-nav {
  font-size: 12px;
  padding: 4px 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

.book-nav:disabled {
  opacity: 0.35;
  cursor: default;
}

.title {
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.icon-btn,
.controls button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: #fff;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.zoom-select {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: #fff;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
}

.zoom-select option {
  color: #000;
}

.page-area {
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  /* 隐藏滚动条（双页适高时水平滚动条白色轨道横在底部，影响阅读）：
     滚动能力保留，用拖拽平移 / 滚轮 / 方向键导航 */
  scrollbar-width: none;
}

.page-area::-webkit-scrollbar {
  display: none;
}

.page-wrap {
  /* canvas 是 inline 元素：行内基线的 descender 会在底部留出缝隙，必须块化消除 */
  display: block;
  line-height: 0;
}

.page-content {
  margin: auto;
  display: flex;
  align-items: center;
  /* 双页对页紧贴，不留间隙；无内边距，页面贴满视口 */
  gap: 0;
  padding: 0;
}

/* —— 翻页动画：纸张卷曲由 pageCurl.ts 覆盖层绘制，此处仅保留位图上屏的短淡入 —— */
.page-wrap canvas {
  animation: canvas-in 160ms ease-out;
}

@keyframes canvas-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 系统开启“减弱动态效果”时关闭动画 */
@media (prefers-reduced-motion: reduce) {
  .page-wrap canvas {
    animation: none;
  }
}

/* 尺寸完全由渲染层决定（style.width/height 即渲染目标尺寸），不做 CSS 钳制：
   钳制会让静态显示盒小于渲染尺寸，与快照/翻页动画的坐标系不一致，翻页时出现伸缩/缩放感；
   内容超出视口时由 .page-area 滚动 / 拖拽平移承接 */
.page-wrap canvas {
  display: block;
}

.state-tip {
  margin: auto;
  color: #888;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.state-tip button {
  padding: 6px 16px;
  border: 1px solid #555;
  border-radius: 4px;
  background: transparent;
  color: #ccc;
  cursor: pointer;
}

.hotzone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 33%;
  z-index: 1;
}

.hotzone-left {
  left: 0;
}

.hotzone-right {
  right: 0;
}

.page-indicator {
  min-width: 80px;
}

.nav-btn {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: #fff;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 4px;
  white-space: nowrap;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.page-slider {
  flex: 1;
}
</style>

<style>
/* 拖拽平移中的全局反馈（非 scoped，作用于 body） */
body.panning {
  cursor: grabbing !important;
  user-select: none;
}
</style>
