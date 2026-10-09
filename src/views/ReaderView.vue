<template>
  <div ref="rootEl" class="reader-view" @wheel="onWheel" @mousemove="onMouseMove" @mousedown="onMouseDown" @mouseup="onMouseUp">
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
import { renderPageToCanvas, type PdfDocument, type RenderPageOptions } from '../services/pdf'

const route = useRoute()
const router = useRouter()
const reader = useReaderStore()
const library = useLibraryStore()
const settingsStore = useSettingsStore()

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
  if (!settingsStore.loaded) await settingsStore.load()
  await openBook(Number(route.params.bookId))
})

// 同一组件内切换书籍（上一本/下一本）：路由仅参数变化、组件复用，需重新加载；
// 返回文库时参数消失，不触发重载（组件随即卸载，由 onBeforeUnmount 收尾）
watch(
  () => route.params.bookId,
  (id) => {
    const nid = Number(id)
    if (!Number.isFinite(nid) || nid === reader.bookId) return
    void openBook(nid)
  }
)

/** 按 bookId 打开（可重入：上一本/下一本切换走同一路由不同参数）。首调时 close 为空操作 */
async function doOpen(id: number) {
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
  openChain = openChain.then(() => doOpen(id))
  void openChain
    .then(async () => {
      await nextTick()
      await renderCurrentSpread()
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

  // 翻页：先截取旧画面快照，供卷曲动画使用
  let fromSnap: HTMLCanvasElement | null = null
  if (isPageTurn && !reducedMotion) {
    curlHandle?.cancel() // 连续翻页时立即揭除上一次动画
    fromSnap = snapshotVisible()
  }

  await nextTick()
  await renderCurrentSpread()

  // 新组渲染完成后，用旧/新快照播放纸张翻页动画（覆盖层，结束后底下已是新页）
  if (fromSnap && rootEl.value && pageContentEl.value) {
    const toSnap = snapshotVisible()
    if (toSnap) {
      const fromRight = (turnDir === 'forward') === (reader.direction === 'ltr')
      curlHandle = playPageCurl({
        container: rootEl.value,
        target: pageContentEl.value,
        from: fromSnap,
        to: toSnap,
        fromRight,
      })
    }
  }
})

/** 将当前显示中的页面位图按布局横向拼接为一张快照（双页时含两页，含 dpr 物理像素） */
function snapshotVisible(): HTMLCanvasElement | null {
  const list = currentDisplayPages.value
    .map((_, i) => canvasEls.value[i])
    .filter((c): c is HTMLCanvasElement => !!c && c.width > 0)
  if (!list.length) return null

  const GAP = 0 // 双页对页紧贴
  const dpr = window.devicePixelRatio || 1
  const cssWidths = list.map((c) => parseFloat(c.style.width) || c.width)
  const cssHeights = list.map((c) => parseFloat(c.style.height) || c.height)
  const cssW = cssWidths.reduce((a, b) => a + b, 0) + GAP * (list.length - 1)
  const cssH = Math.max(...cssHeights)

  const snap = document.createElement('canvas')
  snap.width = Math.max(1, Math.round(cssW * dpr))
  snap.height = Math.max(1, Math.round(cssH * dpr))
  snap.style.width = `${cssW}px`
  snap.style.height = `${cssH}px`
  const sctx = snap.getContext('2d')
  if (!sctx) return null

  let x = 0
  list.forEach((c, i) => {
    // 与 page-content 的 align-items: center 一致，页面垂直居中排布
    sctx.drawImage(
      c,
      x * dpr,
      ((cssH - cssHeights[i]) / 2) * dpr,
      cssWidths[i] * dpr,
      cssHeights[i] * dpr
    )
    x += cssWidths[i] + GAP
  })
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
  doc: PdfDocument,
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
  if (!reader.doc) return
  const seq = ++renderSeq
  const doc = reader.doc as PdfDocument
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
async function prefetchNeighbors(doc: PdfDocument): Promise<void> {
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
    // 记录瞬切前画面与方向，供松手时播放唯一一次动画
    slideDir = idx > reader.currentIndex ? 'forward' : 'back'
    slideFromSnap = snapshotVisible() ?? slideFromSnap
    sliderActive = true
    sliderUntil = Date.now() + 1000 // 兜底：change 丢失时 1s 后恢复动画
    reader.goTo(idx)
  }
}

function onSlideEnd() {
  const fromSnap = slideFromSnap
  const dir = slideDir
  slideFromSnap = null
  slideDir = null
  if (!sliderActive) return
  if (!fromSnap || !dir || reducedMotion || !rootEl.value || !pageContentEl.value) {
    sliderActive = false
    sliderUntil = 0
    return
  }
  void finishSlideWithCurl(fromSnap, dir)
}

/** 松手收尾：先等目标组渲染完成（仍处拖动态、贴图无淡入），再播唯一一次卷曲动画。
 *  若不等渲染就播动画，揭层后 blit 又更新内容，看起来像动画播了多次 */
async function finishSlideWithCurl(fromSnap: HTMLCanvasElement, dir: 'forward' | 'back') {
  const idx = reader.currentIndex
  await renderCurrentSpread() // 序号机制会作废拖动中遗留的旧渲染循环
  if (reader.currentIndex !== idx) return // 期间用户又拖动，交给新一轮流程
  sliderActive = false
  sliderUntil = 0
  if (!rootEl.value || !pageContentEl.value) return
  const toSnap = snapshotVisible()
  if (!toSnap) return
  curlHandle?.cancel()
  const fromRight = (dir === 'forward') === (reader.direction === 'ltr')
  curlHandle = playPageCurl({
    container: rootEl.value,
    target: pageContentEl.value,
    from: fromSnap,
    to: toSnap,
    fromRight,
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
  if (wheelLock || Math.abs(e.deltaY) < 20) return
  wheelLock = true
  setTimeout(() => (wheelLock = false), 250)
  e.deltaY > 0 ? reader.next() : reader.prev()
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

.page-wrap canvas {
  max-height: calc(100vh - 24px);
  max-width: 100vw;
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
