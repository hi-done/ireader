<template>
  <div class="reader-view" @mousemove="onMouseMove">
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
        <button @click="store.toggleSpread()">
          {{ store.spread === 'always' ? '双页' : '单页' }}
        </button>
        <button @click="store.toggleDirection()">
          {{ store.direction === 'ltr' ? '左→右' : '右→左' }}
        </button>
        <select
          class="zoom-select"
          :title="isImageLayout ? '缩放' : '字号'"
          :value="isImageLayout ? store.zoom : store.fontSize"
          @change="onZoomSelect"
        >
          <template v-if="isImageLayout">
            <option v-for="s in ZOOM_OPTIONS" :key="s" :value="s">{{ s }}%</option>
            <option v-if="!ZOOM_OPTIONS.includes(store.zoom)" :value="store.zoom">
              自定义 {{ store.zoom }}%
            </option>
          </template>
          <template v-else>
            <option v-for="s in FONT_SIZE_OPTIONS" :key="s" :value="s">{{ s }}%</option>
            <option v-if="!FONT_SIZE_OPTIONS.includes(store.fontSize)" :value="store.fontSize">
              自定义 {{ store.fontSize }}%
            </option>
          </template>
        </select>
        <button title="全屏（F）" @click="toggleFullscreen">⛶</button>
      </div>
    </header>

    <div class="page-area">
      <!-- epub.js 渲染容器：始终在布局中（打开时必须有确定宽高），加载态用提示层覆盖 -->
      <div ref="epubAreaEl" class="epub-area" />
      <div v-if="loadError" class="state-tip">
        <p>无法打开本书：{{ loadError }}</p>
        <button @click="goBack">返回文库</button>
      </div>
      <div v-else-if="!store.ready" class="state-tip">加载中…</div>
      <div
        v-if="store.ready && !loadError"
        class="hotzone hotzone-left"
        @click="onHotzoneClick('left')"
      />
      <div
        v-if="store.ready && !loadError"
        class="hotzone hotzone-right"
        @click="onHotzoneClick('right')"
      />
    </div>

    <!-- DEV 诊断面板：Ctrl+Shift+D 切换（默认隐藏，正式构建不渲染） -->
    <pre v-if="isDev && showDiag" class="debug-panel">{{ diagLines }}</pre>

    <footer class="bottom-bar" :class="{ visible: barsVisible }">
      <span class="page-indicator">{{ locationLabel }}</span>
      <button
        class="nav-btn"
        :disabled="store.current?.index === 0 || !store.ready"
        @click="store.prev()"
      >
        ‹ 上一页
      </button>
      <input
        class="page-slider"
        type="range"
        min="0"
        :max="Math.max(0, totalPages - 1)"
        :value="sliderIndex"
        :disabled="!store.locationsReady"
        title="拖动跳页"
        @input="onSlideInput"
        @change="onSlideChange"
      />
      <button
        class="nav-btn"
        :disabled="atEnd"
        @click="store.next()"
      >
        下一页 ›
      </button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Contents } from 'epubjs'
import { useEpubReaderStore } from '../stores/epubReader'
import { useLibraryStore } from '../stores/library'
import { ipc } from '../services/ipc'
import { getEpubDiag } from '../services/epub'

const isDev = import.meta.env?.DEV === true

const props = defineProps<{ bookId: number }>()

const route = useRoute()
const router = useRouter()
const store = useEpubReaderStore()
const library = useLibraryStore()

const barsVisible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
const loadError = ref('')
const epubAreaEl = ref<HTMLElement | null>(null)

// DEV 诊断面板数据（每 400ms 拉取 epub.ts 的诊断缓冲）
const diagLines = ref('')
const showDiag = ref(false)
let diagTimer: ReturnType<typeof setInterval> | null = null

const bookTitle = computed(
  () => library.books.find((b) => b.id === store.bookId)?.title ?? ''
)

const totalPages = computed(() => store.totalPages())

const locationLabel = computed(() => {
  const cur = store.current
  if (!cur) return ''
  if (store.locationsReady && totalPages.value > 0) {
    return `${cur.index + 1} / ${totalPages.value}`
  }
  return `${Math.floor(cur.percentage)}%`
})

const atEnd = computed(() => {
  if (!store.ready) return true
  if (store.locationsReady && totalPages.value > 0) return store.atEnd
  return false
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
  if (isDev) {
    diagTimer = setInterval(() => {
      // 封面策略日志（[cover]/open 行）在前，需全部显示，仅截掉过多的通用渲染日志
      diagLines.value = getEpubDiag().join('\n')
    }, 400)
  }
  void openBook(props.bookId)
})

watch(
  () => props.bookId,
  (id) => {
    void openBook(id)
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
  if (diagTimer) clearInterval(diagTimer)
  if (hideTimer) clearTimeout(hideTimer)
  unbindRenditionEvents()
  store.close()
})

// —— 打开串行化（同 PDF 阅读器：快速连点时后一次 open 等前一次完成）——
let openChain: Promise<void> = Promise.resolve()
function openBook(id: number | string) {
  // 路由参数是字符串（vue-router params 会字符串化），统一归一为 number；
  // 否则 store.bookId 存字符串，与书库 id 的严格比较失败，上一本/下一本按钮会常灰
  const numId = Number(id)
  if (!Number.isFinite(numId)) return
  openChain = openChain.then(() => doOpen(numId))
  void openChain
    .then(() => showBarsTemporarily())
    .catch((e) => {
      loadError.value = e instanceof Error ? e.message : String(e)
    })
}

async function doOpen(id: number) {
  loadError.value = ''
  unbindRenditionEvents()
  store.close() // 落盘上一本进度并销毁旧文档
  await nextTick()
  if (!epubAreaEl.value) throw new Error('阅读区未就绪')
  await store.open(id, epubAreaEl.value)
  bindRenditionEvents()
}

// —— iframe 内事件转发 ——
// 键盘：epub.js 将 contents 的 keydown 自动 re-emit 到 rendition（passEvents）；
// 滚轮不在其转发列表，需在每次渲染后手动挂到 iframe window 上
let lastWheelWindow: Window | null = null

function onFrameWheel(e: WheelEvent) {
  onWheel(e)
}

function onFrameKeydown(e: KeyboardEvent) {
  onKeydown(e)
}

function onFrameMousemove(e: MouseEvent) {
  onMouseMove(e)
}

function onFrameRendered(_section: unknown, view: { contents?: Contents } | null | undefined) {
  const win = view?.contents?.window
  if (!win || win === lastWheelWindow) return
  lastWheelWindow = win
  win.addEventListener('wheel', onFrameWheel, { passive: true })
}

function bindRenditionEvents() {
  const r = store.getRendition()
  if (!r) return
  r.on('keydown', onFrameKeydown)
  r.on('mousemove', onFrameMousemove)
  r.on('rendered', onFrameRendered)
}

function unbindRenditionEvents() {
  const r = store.getRendition()
  if (!r) return
  r.off('keydown', onFrameKeydown)
  r.off('mousemove', onFrameMousemove)
  r.off('rendered', onFrameRendered)
  lastWheelWindow = null
}

// —— 上一本 / 下一本：与 PDF 阅读器同规则（主页=未分组按排序偏好，合集内=名称升序）——
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
  store.bookId == null ? -1 : contextBooks.value.findIndex((b) => b.id === store.bookId)
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
  router.push({ name: 'reader', params: { bookId: id }, query: { ...route.query } })
}

function goBack() {
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
  const forward = side === 'right'
  forward ? store.next() : store.prev()
}

/** 字号档位（与 PDF 顶栏缩放 select 同位置；Ctrl+滚轮可调出档位外的自定义值） */
const FONT_SIZE_OPTIONS = [80, 90, 100, 110, 120, 130, 140, 160, 180, 200]
/** 图片型书缩放档位（100 = 整页适合视口） */
const ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200]

/** 图片型书（pre-paginated）顶栏下拉框为缩放，文字型书为字号 */
const isImageLayout = computed(() => store.layout === 'pre-paginated')

function onZoomSelect(e: Event) {
  const value = Number((e.target as HTMLSelectElement).value)
  if (!Number.isFinite(value)) return
  if (store.layout === 'pre-paginated') store.setZoom(value)
  else store.setFontSize(value)
}

// —— 滑块 ——
// 用本地状态驱动 thumb（拖动即时跟手）；store.current 更新时（翻页/跳页后）再同步回来。
// 若直接绑定 store.current：拖动中任何重渲染（如底栏自动隐藏）都会把 thumb 写回旧值，表现成“拖不动”。
const sliderIndex = ref(0)
let sliderDragging = false

watch(
  () => store.current?.index,
  (idx) => {
    if (idx != null && !sliderDragging) sliderIndex.value = idx
  }
)

watch(
  () => store.bookId,
  () => {
    sliderIndex.value = 0
    sliderDragging = false
  }
)

let slideTimer: ReturnType<typeof setTimeout> | null = null
function onSlideInput(e: Event) {
  const idx = Number((e.target as HTMLInputElement).value)
  sliderDragging = true
  sliderIndex.value = idx
  // 拖动过程密集触发 input：节流跳页，避免整页重渲染任务在队列积压而“没反应”
  if (slideTimer) clearTimeout(slideTimer)
  slideTimer = setTimeout(() => store.goTo(idx), 200)
}

function onSlideChange(e: Event) {
  const idx = Number((e.target as HTMLInputElement).value)
  if (slideTimer) {
    clearTimeout(slideTimer)
    slideTimer = null
  }
  // 松手立即跳到最终位置，避免只依赖节流定时器
  store.goTo(idx)
  setTimeout(() => {
    sliderDragging = false
    sliderIndex.value = store.current?.index ?? idx
  }, 400)
}

let wheelLock = false
function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    // Ctrl/Cmd+滚轮：图片型书缩放 / 文字型书字号步进（阻止浏览器页缩放）
    e.preventDefault()
    const delta = e.deltaY < 0 ? 10 : -10
    if (store.layout === 'pre-paginated') store.setZoom(store.zoom + delta)
    else store.setFontSize(store.fontSize + delta)
    return
  }
  if (wheelLock || Math.abs(e.deltaY) < 20) return
  wheelLock = true
  setTimeout(() => (wheelLock = false), 250)
  e.deltaY > 0 ? store.next() : store.prev()
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
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null
function onResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  // 防抖后按新视口重排分页
  resizeTimer = setTimeout(() => {
    if (epubAreaEl.value) {
      const rect = epubAreaEl.value.getBoundingClientRect()
      store.resize(rect.width, rect.height)
    }
  }, 200)
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
    return // 滑块等控件聚焦时让方向键留给控件自身
  }
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
    e.preventDefault()
    showDiag.value = !showDiag.value
    return
  }
  switch (e.key) {
    case 'ArrowRight':
      store.next()
      break
    case 'ArrowLeft':
      store.prev()
      break
    case 'ArrowDown':
      store.next()
      break
    case 'ArrowUp':
      store.prev()
      break
    case ' ':
      e.shiftKey ? store.prev() : store.next()
      break
    case 'PageDown':
      store.next()
      break
    case 'PageUp':
      store.prev()
      break
    case 'Home':
      store.goTo(0)
      break
    case 'End':
      store.goTo(Math.max(0, totalPages.value - 1))
      break
    case '=':
    case '+':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (store.layout === 'pre-paginated') store.setZoom(store.zoom + 10)
        else store.setFontSize(store.fontSize + 10)
      }
      break
    case '-':
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        if (store.layout === 'pre-paginated') store.setZoom(store.zoom - 10)
        else store.setFontSize(store.fontSize - 10)
      }
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

.debug-panel {
  position: fixed;
  right: 8px;
  bottom: 8px;
  z-index: 9999;
  max-width: 640px;
  margin: 0;
  padding: 6px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.72);
  color: #7fdbca;
  font: 11px/1.5 Consolas, monospace;
  pointer-events: none;
  white-space: pre-wrap;
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
  position: relative;
  width: 100%;
  height: 100%;
}

.epub-area {
  position: absolute;
  inset: 0;
}

.state-tip {
  position: absolute;
  inset: 0;
  color: #888;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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
