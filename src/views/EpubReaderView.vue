<template>
  <div ref="rootEl" class="reader-view" @mousemove="onMouseMove">
    <header class="top-bar" :class="{ visible: barsVisible, 'capture-hide': captureHide }">
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

    <footer class="bottom-bar" :class="{ visible: barsVisible, 'capture-hide': captureHide }">
      <span class="page-indicator">{{ locationLabel }}</span>
      <button
        class="nav-btn"
        :disabled="store.current?.index === 0 || !store.ready"
        @click="turnPage('back')"
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
        @click="turnPage('forward')"
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
import { getEpubDiag, waitViewsSettled } from '../services/epub'
import { captureRegionToCanvas } from '../services/capture'
import { playPageCurl, type PageCurlHandle } from '../services/pageCurl'

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
/** 根元素 ref：pageCurl 的 container（.reader-view 已是 position: relative） */
const rootEl = ref<HTMLElement | null>(null)
/** 翻页编排期间瞬隐控制栏（截图取干净像素 + 规避卷曲覆盖层遮栏闪断） */
const captureHide = ref(false)

/** 跟随系统「减弱动态效果」：命中时翻页直通瞬切（同 ReaderView） */
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
  discardTurn()
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
  // 跨书切换：作废进行中的翻页编排并揭除冻结帧，避免旧书画面残留在新书阅读区
  turnSeq++
  discardTurn()
  turnBusy = false
  captureHide.value = false
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
  // 方向感知（同 PDF ReaderView）：LTR 右热区 = 下一页；RTL 左热区 = 下一页
  const forward = store.direction === 'ltr' ? side === 'right' : side === 'left'
  void turnPage(forward ? 'forward' : 'back')
}

// —— 翻页动画编排：截图冻结帧遮盖 epub.js 重建过程 + 复用 pageCurl 卷曲层 ——
// turnBusy 防重入；turnSeq 世代号作废旧跨 await 流程（busy/卸载/跨书时递增）
let turnBusy = false
let turnSeq = 0
let curlHandle: PageCurlHandle | null = null
let freezeEl: HTMLCanvasElement | null = null

/** 双 rAF：等一帧提交后的合成输出更新（截图前瞬隐控制栏后需等它生效） */
function doubleRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/** 冻结帧上屏：旧画面快照绝对定位铺满 .epub-area；不拦截交互（连翻由 busy 逻辑兜底） */
function attachFreeze(area: HTMLElement, from: HTMLCanvasElement) {
  freezeEl = from
  from.style.position = 'absolute'
  from.style.left = '0'
  from.style.top = '0'
  from.style.zIndex = '1' // 高于 iframe 内容；低于控制栏 z2 与卷曲覆盖层 z5
  from.style.pointerEvents = 'none'
  area.appendChild(from)
}

function removeFreeze() {
  freezeEl?.remove()
  freezeEl = null
}

/** 取消进行中的卷曲并揭除冻结帧（作废流程后的统一清理） */
function discardTurn() {
  curlHandle?.cancel() // cancel 内部会同步触发 onDone（复位 curlHandle/冻结帧/busy）
  curlHandle = null
  removeFreeze()
}

async function turnPage(dir: 'forward' | 'back'): Promise<void> {
  if (!store.ready) return
  const plain = () => (dir === 'forward' ? store.next() : store.prev())

  // 快速连翻：作废进行中的编排并清理（覆盖层/冻结帧在屏时再截图会拍到旧像素），本次瞬切
  if (turnBusy) {
    turnSeq++
    discardTurn()
    turnBusy = false // 旧流程被 seq 作废可能不会自行释放（如卡在 await plain），这里统一复位
    captureHide.value = false
    void plain()
    return
  }
  if (reducedMotion) {
    void plain()
    return
  }

  const area = epubAreaEl.value
  const root = rootEl.value
  if (!area || !root) {
    void plain()
    return
  }

  turnBusy = true
  const seq = ++turnSeq
  try {
    // 1. 瞬隐控制栏 → 双 rAF → 捕获干净旧画面；控制栏维持隐藏至卷曲结束（避免覆盖层遮栏闪断）
    captureHide.value = true
    await doubleRaf()
    if (seq !== turnSeq) return
    let from: HTMLCanvasElement | null = null
    try {
      const rect = area.getBoundingClientRect()
      from = await captureRegionToCanvas({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    } catch {
      from = null // 截图失败：降级为无动画瞬切
    }
    if (seq !== turnSeq) return

    // 2. 冻结帧先上屏（实时画面仍是旧页，视觉无缝），再驱动 epub.js 重建视图
    const prevCfi = store.current?.cfi
    if (from) attachFreeze(area, from)
    await plain()
    if (seq !== turnSeq) return // 已被连翻流程接替（冻结帧已由 discardTurn 揭除）

    // 3. 未发生位移（首/尾页）：不播动画，仅揭除冻结帧。
    //    用 CFI 而非 index 判定：文字型书的 index 是 location 块索引，一屏翻页可能仍在同一块内
    if (!from || !store.current || store.current.cfi === prevCfi) {
      removeFreeze()
      return
    }

    // 4. 等新视图稳定后播卷曲；省略 to：覆盖层透明区透出实时新视图
    const rendition = store.getRendition()
    if (rendition) await waitViewsSettled(rendition, 800)
    if (seq !== turnSeq) return
    const fromRight = (dir === 'forward') === (store.direction === 'ltr') // 同 PDF
    curlHandle = playPageCurl({
      container: root,
      target: area,
      from,
      fromRight,
      onDone: () => {
        curlHandle = null
        removeFreeze()
        turnBusy = false
        captureHide.value = false
      },
    })
    // 卷曲首帧已画出旧页全幅 → 双 rAF 后揭除冻结帧（无缝）
    void doubleRaf().then(() => {
      if (seq === turnSeq) removeFreeze()
    })
  } finally {
    // 提前返回路径（未进入卷曲）释放 busy 并恢复控制栏；卷曲路径由 onDone 释放
    if (seq === turnSeq && !curlHandle) {
      turnBusy = false
      captureHide.value = false
    }
  }
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
/** 拖动会话语境：起始索引/CFI + 拖动开始画面快照 Promise（松手后补播唯一一次卷曲） */
let slideStartIndex: number | null = null
let slideStartCfi: string | null = null
let slideFromPromise: Promise<HTMLCanvasElement | null> | null = null

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
    slideStartIndex = null
    slideStartCfi = null
    slideFromPromise = null
  }
)

let slideTimer: ReturnType<typeof setTimeout> | null = null
function onSlideInput(e: Event) {
  const idx = Number((e.target as HTMLInputElement).value)
  const sessionStart = slideStartIndex == null
  sliderDragging = true
  sliderIndex.value = idx
  // 拖动会话首帧：记录起始索引并异步捕获起始画面（含控制栏；thumb 冻结约 450ms 可接受）
  if (sessionStart) {
    slideStartIndex = store.current?.index ?? idx
    slideStartCfi = store.current?.cfi ?? null
    const area = epubAreaEl.value
    if (area && !reducedMotion) {
      const rect = area.getBoundingClientRect()
      slideFromPromise = captureRegionToCanvas({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }).catch(() => null)
    }
  }
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
  void finishSlideCurl(idx) // 松手立即跳到最终位置，并补播唯一一次卷曲
  setTimeout(() => {
    sliderDragging = false
    sliderIndex.value = store.current?.index ?? idx
  }, 400)
}

/** 滑块松手收尾：等最终跳页与视图稳定后，从拖动开始画面补播一次卷曲（对齐 PDF finishSlideWithCurl） */
async function finishSlideCurl(finalIndex: number): Promise<void> {
  const startIndex = slideStartIndex
  const startCfi = slideStartCfi
  const fromPromise = slideFromPromise
  slideStartIndex = null
  slideStartCfi = null
  slideFromPromise = null
  const nav = store.goTo(finalIndex)
  if (reducedMotion || turnBusy || startIndex == null || !fromPromise) return
  const area = epubAreaEl.value
  const root = rootEl.value
  if (!area || !root) return

  // 补播沿用 busy/seq：期间热区/键盘的翻页请求走瞬切降级并作废本流程
  turnBusy = true
  const seq = ++turnSeq
  try {
    const from = await fromPromise
    if (seq !== turnSeq) return
    if (from) attachFreeze(area, from)
    await nav
    if (seq !== turnSeq) return
    // 未发生位移：不播动画，仅揭除冻结帧（CFI 判定，同 turnPage）
    if (!from || !store.current || store.current.cfi === startCfi) {
      removeFreeze()
      return
    }
    const rendition = store.getRendition()
    if (rendition) await waitViewsSettled(rendition, 800)
    if (seq !== turnSeq) return
    const dir: 'forward' | 'back' = finalIndex > startIndex ? 'forward' : 'back'
    const fromRight = (dir === 'forward') === (store.direction === 'ltr') // 同 PDF
    curlHandle = playPageCurl({
      container: root,
      target: area,
      from,
      fromRight,
      onDone: () => {
        curlHandle = null
        removeFreeze()
        turnBusy = false
      },
    })
    void doubleRaf().then(() => {
      if (seq === turnSeq) removeFreeze()
    })
  } finally {
    if (seq === turnSeq && !curlHandle) turnBusy = false
  }
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
  void turnPage(e.deltaY > 0 ? 'forward' : 'back')
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
    // 尺寸变化令进行中的翻页编排失效（截图/冻结帧按旧尺寸），取消动画并揭除冻结帧
    if (turnBusy) {
      turnSeq++
      discardTurn()
      turnBusy = false
      captureHide.value = false
    }
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
      void turnPage('forward')
      break
    case 'ArrowLeft':
      void turnPage('back')
      break
    case 'ArrowDown':
      void turnPage('forward')
      break
    case 'ArrowUp':
      void turnPage('back')
      break
    case ' ':
      void turnPage(e.shiftKey ? 'back' : 'forward')
      break
    case 'PageDown':
      void turnPage('forward')
      break
    case 'PageUp':
      void turnPage('back')
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

/* 翻页编排期间瞬隐控制栏：截图取干净像素 + 规避卷曲覆盖层（z5）遮栏闪断；!important 压过 .visible */
.top-bar.capture-hide,
.bottom-bar.capture-hide {
  opacity: 0 !important;
  transition: none !important;
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
