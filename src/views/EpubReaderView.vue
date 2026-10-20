<template>
  <div ref="rootEl" class="reader-view" @mousemove="onMouseMove">
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
        <SelectMenu
          class="zoom-select"
          :model-value="zoomValue"
          :options="zoomOptions"
          :label="isImageLayout ? '缩放' : '字号'"
          :title="isImageLayout ? '缩放' : '字号'"
          @change="onZoomSelect"
          @open="pinBars"
          @close="unpinBars"
        />
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
        @click="requestTurn('back')"
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
        @click="requestTurn('forward')"
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
import { getEpubDiag, pushNavDiag, waitViewsSettled } from '../services/epub'
import { captureRegionToCanvas } from '../services/capture'
import type { SelectOption } from '../services/selectMenu'
import SelectMenu from '../components/ui/SelectMenu.vue'
import { BURST_SETTLE_MS, canReplayBurst, pickEpubAnimBudget, TurnPolicy } from '../services/turnPolicy'
import { cancelTurnCurl, isTurnCurlActive, playTurnCurl } from '../services/turnAnimator'

const isDev = import.meta.env?.DEV === true

const props = defineProps<{ bookId: number }>()

const route = useRoute()
const router = useRouter()
const store = useEpubReaderStore()
const library = useLibraryStore()

const barsVisible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null
/** 顶栏下拉展开期间锁定可见：鼠标在触发器上移动会反复触发 showBarsTemporarily，只清一次计时器不够 */
let barsPinned = false
const loadError = ref('')
const epubAreaEl = ref<HTMLElement | null>(null)
/** 根元素 ref：pageCurl 的 container（.reader-view 已是 position: relative） */
const rootEl = ref<HTMLElement | null>(null)

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
  openSeq++ // 作废进行中的队列消费与动画编排
  pendingDelta = 0
  clearBurstSession()
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
  // 跨书切换：作废进行中的队列消费与翻页编排并揭除冻结帧，避免旧书画面残留在新书阅读区
  openSeq++
  pendingDelta = 0
  navIndex = null
  forceSnap = false
  policy.reset()
  clearBurstSession()
  discardTurn()
  sliderDragging = false
  slideStartIndex = null
  slideStartCfi = null
  slideFromPromise = null
  unbindRenditionEvents()
  store.close() // 落盘上一本进度并销毁旧文档
  await nextTick()
  if (!epubAreaEl.value) throw new Error('阅读区未就绪')
  await store.open(id, epubAreaEl.value)
  navIndex = store.current?.index ?? 0 // 新书权威页索引
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
  requestTurn(forward ? 'forward' : 'back')
}

// —— 翻页动画编排：截图冻结帧遮盖 epub.js 重建过程 + 复用 pageCurl 卷曲层 ——
// 净位移队列：输入只累加 pendingDelta，由单一消费者串行执行，连翻合并为一次到位
let pendingDelta = 0
/** 进行中的队列消费（串行，杜绝导航重叠）；重入复用同一 Promise */
let drainPromise: Promise<void> | null = null
/** 权威页索引：由队列推演，每次导航后以 relocated 校正 */
let navIndex: number | null = null
/** 换书 / 尺寸变化 / 卸载时递增，旧流程在检查点退出 */
let openSeq = 0
/** 下一次消费强制瞬切（滑块 / Home / End 等显式跳转） */
let forceSnap = false
let freezeEl: HTMLCanvasElement | null = null
/** 连续翻页判定：连翻瞬切、停手后恢复动画 */
const policy = new TurnPolicy()
// 连翻补播会话：记录连翻序列起点与首帧快照，停手后补播唯一一次卷曲（与滑块松手补播同构）
let burstStartIndex: number | null = null
let burstStartCfi: string | null = null
let burstFromPromise: Promise<HTMLCanvasElement | null> | null = null
let burstSettleTimer: ReturnType<typeof setTimeout> | null = null

// 外部定位变化（切版式/方向/字号/缩放重分页等）时同步权威页索引；
// 队列消费期间（drainPromise 非空）由 jumpTo/animatedTurn 自行校正，避免竞态覆盖推演值
watch(
  () => store.current?.index,
  (idx) => {
    if (idx != null && drainPromise === null) navIndex = idx
  }
)

/** 双 rAF：等一帧提交后的合成输出更新（截图前瞬隐控制栏后需等它生效） */
function doubleRaf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

/**
 * 等一次 relocated 事件（store.current 已刷新后 resolve）；超时兜底不阻断。
 * epubjs 的 next()/prev()/display() Promise 在 reportLocation 的 rAF 回调（emit relocated）
 * 之前就 resolve，await 导航返回时 store.current 仍是旧值，直接做 CFI 比对会把正常翻页
 * 误判为「无位移」而静默跳过动画——位移判定前必须先等此事件
 */
function waitNextRelocated(timeoutMs = 500): Promise<void> {
  const r = store.getRendition()
  if (!r) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      r.off('relocated', finish)
      if (timer) clearTimeout(timer)
      resolve()
    }
    timer = setTimeout(finish, timeoutMs)
    r.on('relocated', finish)
  })
}

/** 冻结帧上屏：旧画面快照绝对定位铺满 .epub-area；不拦截交互（连翻由队列兜底） */
function attachFreeze(area: HTMLElement, from: HTMLCanvasElement) {
  freezeEl = from
  from.style.position = 'absolute'
  from.style.left = '0'
  from.style.top = '0'
  from.style.zIndex = '1' // 高于 iframe 内容；低于控制栏 z2（与覆盖层同级，覆盖层后 append 故在其上）
  from.style.pointerEvents = 'none'
  area.appendChild(from)
}

function removeFreeze() {
  freezeEl?.remove()
  freezeEl = null
}

/** 取消进行中的卷曲并揭除冻结帧（作废流程后的统一清理） */
function discardTurn() {
  cancelTurnCurl() // 底层页面已是动画终点；内部同步兑现 done，唤醒等待中的队列
  removeFreeze()
}

/** 夹取到有效页范围；总页数未知（locations 未就绪）时只保证非负，边界交给 epub.js */
function clampPageIndex(index: number): number {
  const total = totalPages.value
  return total > 0 ? Math.min(Math.max(index, 0), total - 1) : Math.max(index, 0)
}

/** 翻页入口：只记账，由队列串行消费（连翻净位移合并） */
function requestTurn(dir: 'forward' | 'back'): void {
  if (!store.ready) return
  pendingDelta += dir === 'forward' ? 1 : -1
  // 新输入推迟补播：停手计时从最后一次输入重新开始（会话保留，继续累计）
  if (burstSettleTimer) clearTimeout(burstSettleTimer)
  // 卷曲在播：立即揭除（底层已是动画终点），让队列尽快消费本次输入
  if (isTurnCurlActive()) discardTurn()
  void drainTurns()
}

/** 显式跳转（滑块节流跳页 / Home / End）：并入队列串行执行且强制瞬切；返回「队列已空闲」 */
function requestJump(index: number): Promise<void> {
  if (!store.ready) return Promise.resolve()
  // 显式跳转不补播：滑块有独立会话，Home / End 直接到位
  clearBurstSession()
  const from = navIndex ?? store.current?.index ?? 0
  if (index !== from) {
    forceSnap = true
    pendingDelta = index - from
  }
  // 跳转即刻生效：揭除在播卷曲（底层已是动画终点），不等 450ms 播完
  if (isTurnCurlActive()) discardTurn()
  return drainTurns()
}

/** 串行消费队列：重入复用同一 Promise，调用方可安全 await「队列空闲」 */
function drainTurns(): Promise<void> {
  if (!drainPromise) {
    const token = openSeq
    drainPromise = doDrainTurns(token).finally(() => {
      drainPromise = null
      if (pendingDelta !== 0) void drainTurns() // 换书/尺寸抖动期间的新输入兜底，绝不丢步
    })
  }
  return drainPromise
}

async function doDrainTurns(token: number): Promise<void> {
  while (pendingDelta !== 0 && token === openSeq) {
    const delta = pendingDelta
    pendingDelta = 0
    const snapOnce = forceSnap // 逐次消费：中途的新输入不再继承强制瞬切
    forceSnap = false
    const from = navIndex ?? store.current?.index ?? 0
    const target = clampPageIndex(from + delta)
    const effective = target - from
    navIndex = target
    if (effective === 0) continue // 首/尾页：不导航、不动画

    const decision = snapOnce
      ? { mode: 'snap' as const, burst: false }
      : policy.decide({
          now: performance.now(),
          isPageTurn: true,
          indexDelta: effective,
          animating: isTurnCurlActive(),
          reducedMotion,
          dragging: sliderDragging,
        })
    if (decision.mode === 'animate' && Math.abs(effective) === 1) {
      // 恢复正常单次翻页：上一段连翻序列已结束，残留会话不得跨段生效
      clearBurstSession()
      try {
        await animatedTurn(effective, token)
      } catch (e) {
        // 单轮动画/导航异常不拖垮队列：清理覆盖层并以引擎实际落点校正后继续消费
        discardTurn()
        if (token === openSeq) navIndex = store.current?.index ?? navIndex
        console.error('[epub] 动画翻页失败', e)
      }
    } else {
      discardTurn()
      // 连翻首帧：记录起点并异步截取起点画面（与跳页并行，不阻塞连翻）
      if (decision.burst && !snapOnce) beginBurstSession(from)
      try {
        await jumpTo(target, effective, token)
      } catch (e) {
        if (token === openSeq) navIndex = store.current?.index ?? navIndex
        console.error('[epub] 跳页失败', e)
      }
      // 每轮连翻瞬切后重置停手计时；到期且队列空闲才补播唯一一次卷曲
      if (decision.burst) scheduleBurstSettle(token)
    }
  }
}

/** 连翻会话首帧：记录起点并把起点画面截图挂到后台（不 await，与跳页并行） */
function beginBurstSession(startIndex: number): void {
  if (burstStartIndex != null) return
  burstStartIndex = startIndex
  burstStartCfi = store.current?.cfi ?? null
  const area = epubAreaEl.value
  if (!area || reducedMotion) return
  const rect = area.getBoundingClientRect()
  burstFromPromise = captureRegionToCanvas({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  }).catch(() => null)
}

/** 停手计时：每次连翻瞬切后重置；到期且队列空闲才补播（新输入会再次重置） */
function scheduleBurstSettle(token: number): void {
  if (burstSettleTimer) clearTimeout(burstSettleTimer)
  burstSettleTimer = setTimeout(() => {
    burstSettleTimer = null
    if (token !== openSeq || burstStartIndex == null) {
      clearBurstSession()
      return
    }
    // 仍在连翻 / 拖动：本次不补，等最后一轮消费重新计时
    if (pendingDelta !== 0 || drainPromise !== null || isTurnCurlActive() || sliderDragging) return
    void finishBurstCurl()
  }, BURST_SETTLE_MS)
}

/** 停手补播：用连翻首帧卷到最终页（不导航；页面已在瞬切阶段到位） */
async function finishBurstCurl(): Promise<void> {
  const startIndex = burstStartIndex
  const startCfi = burstStartCfi
  const fromPromise = burstFromPromise
  const token = openSeq
  burstStartIndex = null
  burstStartCfi = null
  burstFromPromise = null
  if (startIndex == null || !fromPromise) return
  const from = await fromPromise // 截图通常已就绪；未就绪则等它，期间新输入由闸门拦截
  // 等待期间又开始了新的连翻序列：旧会话首帧已过期，交给新序列补播
  if (burstStartIndex != null) return
  const area = epubAreaEl.value
  const root = rootEl.value
  const finalIndex = navIndex ?? store.current?.index ?? 0
  if (
    !from ||
    !area ||
    !root ||
    !store.current ||
    !canReplayBurst({
      tokenValid: token === openSeq,
      reducedMotion,
      hasSnapshot: true,
      startIndex,
      finalIndex,
      startCfi,
      finalCfi: store.current.cfi,
      queueBusy: drainPromise !== null,
      pendingDelta,
      curlActive: isTurnCurlActive(),
      dragging: sliderDragging,
    })
  ) {
    pushNavDiag('[curl] burst skip')
    return
  }
  const dir: 'forward' | 'back' = finalIndex > startIndex ? 'forward' : 'back'
  const fromRight = (dir === 'forward') === (store.direction === 'ltr')
  pushNavDiag(`[curl] burst play ${dir} from=${startIndex} to=${finalIndex}`)
  // 补播卷曲归单例管理：期间的新输入会揭除它并让队列继续消费
  await playTurnCurl({ container: root, target: area, from, fromRight, zIndex: 1 }).done
}

/** 清空连翻补播会话（换书 / 尺寸变化 / 滑块接管 / 卸载） */
function clearBurstSession(): void {
  if (burstSettleTimer) {
    clearTimeout(burstSettleTimer)
    burstSettleTimer = null
  }
  burstStartIndex = null
  burstStartCfi = null
  burstFromPromise = null
}

/** 净位移一次到位：图片型书或 locations 就绪时直接 goTo，否则逐页回退；落点以 relocated 为准 */
async function jumpTo(target: number, delta: number, token: number): Promise<void> {
  // relocated 监听须先于导航挂上：导航 Promise 早于 relocated 事件 resolve（详见 waitNextRelocated）
  const relocated = waitNextRelocated()
  if (store.layout === 'pre-paginated' || (store.locationsReady && totalPages.value > 0)) {
    await store.goTo(target)
  } else {
    for (let i = 0; i < Math.abs(delta); i++) {
      await (delta > 0 ? store.next() : store.prev())
    }
  }
  await relocated
  // 以引擎实际落点校正推演值（文字型 location 边界）；换书后旧流程不写新书的索引
  if (token === openSeq) navIndex = store.current?.index ?? navIndex
}

/** 单页动画翻页：截图 → 冻结帧 → 导航 → 等 relocated/图片 → 卷曲；队列有新输入即降级瞬切 */
async function animatedTurn(delta: number, token: number): Promise<void> {
  const dir: 'forward' | 'back' = delta > 0 ? 'forward' : 'back'
  const area = epubAreaEl.value
  const root = rootEl.value
  const target = navIndex ?? 0
  // 容器缺失 / 减弱动态 / 截图前已有新输入：不截图不占主线程，直接瞬切
  if (!area || !root || reducedMotion || pendingDelta !== 0) {
    discardTurn()
    await jumpTo(target, delta, token)
    return
  }

  const t0 = performance.now() // 分段耗时埋点：cap（截图）/ nav（epubjs 重建）/ img（等图）三段
  // 大面积视口（全屏/高 DPI）截图往返成本显著上升：按面积放宽播前预算，
  // 否则每次翻页都会在播前检查处被整体耗时静默跳过（连翻仍由 pendingDelta 兜底瞬切）
  const dpr = window.devicePixelRatio || 1
  const viewportPixels = window.innerWidth * window.innerHeight * dpr * dpr
  const budget = pickEpubAnimBudget(viewportPixels)
  let from: HTMLCanvasElement | null = null
  try {
    // 1. 截图不隐藏控制栏（与 PDF 一致）：覆盖层 z1 低于工具栏 z2，
    //    快照里的工具栏像素始终被真实工具栏盖住；工具栏全程可见，也省去两帧等待
    if (token !== openSeq) return
    if (pendingDelta !== 0) {
      // 进入本函数后来了新输入：放弃动画，队列接管（此时尚未截图，代价最小）
      discardTurn()
      await jumpTo(target, delta, token)
      return
    }
    // 截图区域取 .epub-area 当前 bbox；重试时重新取，避免尺寸变化后沿用旧矩形
    const shot = () => {
      const rect = area.getBoundingClientRect()
      return captureRegionToCanvas({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    try {
      from = await shot()
    } catch {
      // 全屏 capturePage 偶发空图/失败：立即重试一次，仍失败才降级为无动画瞬切
      pushNavDiag('[curl] capture fail → 重试一次')
      try {
        from = await shot()
      } catch {
        from = null
        pushNavDiag('[curl] capture fail → 无动画')
      }
    }
    const tCap = performance.now()
    if (token !== openSeq) return
    if (pendingDelta !== 0) {
      // 截图期间来了新输入：此时再上屏冻结帧会拍到旧像素，交给队列瞬切
      discardTurn()
      await jumpTo(target, delta, token)
      return
    }

    // 2. 冻结帧先上屏（实时画面仍是旧页，视觉无缝），再驱动 epub.js 重建视图
    const prevCfi = store.current?.cfi
    if (from) attachFreeze(area, from)
    const relocated = waitNextRelocated()
    if (store.layout === 'pre-paginated' || (store.locationsReady && totalPages.value > 0)) {
      await store.goTo(target)
    } else {
      await (delta > 0 ? store.next() : store.prev())
    }
    // 图片等待与 relocated 通报并行（都只依赖导航完成）；限时 250ms：
    // 卷曲透明区从自由边渐进揭示（缓动下前段揭示面小），图片解码与动画前段重叠，
    // 超时即开动画不阻塞——仅慢盘/超大图可能动画中段短暂微露白
    const rendition = store.getRendition()
    // 视图已被销毁时 getContents 可能抛错：吞掉，等图失败不阻断翻页
    const settled = rendition
      ? waitViewsSettled(rendition, 250).catch(() => undefined)
      : Promise.resolve()
    await relocated
    const tNav = performance.now()
    if (token !== openSeq) return // 已被换书/尺寸变化作废（冻结帧已由 discardTurn 揭除）
    navIndex = store.current?.index ?? navIndex

    // 3. 未发生位移（首/尾页）：不播动画，仅揭除冻结帧。
    //    用 CFI 而非 index 判定：文字型书的 index 是 location 块索引，一屏翻页可能仍在同一块内
    if (!from || !store.current || store.current.cfi === prevCfi) {
      pushNavDiag(`[curl] no-move skip from=${from ? 'ok' : 'null'} d=${Math.round(tNav - t0)}ms`)
      removeFreeze()
      return
    }

    // 4. 等新视图稳定（多数情况在等 relocated 期间已就绪）后播卷曲；省略 to：透出实时新视图
    await settled
    if (token !== openSeq) return
    // 播前再查：期间的新输入 / 正在拖动 / 超预算 → 不播迟到动画（页面已上屏，直接揭除）
    const elapsed = performance.now() - t0
    if (pendingDelta !== 0 || sliderDragging || elapsed > budget) {
      pushNavDiag(
        `[curl] skip play pending=${pendingDelta} drag=${sliderDragging} ` +
          `d=${Math.round(elapsed)}ms budget=${budget}`
      )
      discardTurn()
      return
    }
    const fromRight = (dir === 'forward') === (store.direction === 'ltr') // 同 PDF
    const tPlay = performance.now()
    pushNavDiag(
      `[curl] play ${dir} fromRight=${fromRight} full=${document.fullscreenElement ? 1 : 0} ` +
        `shot=${from.width}x${from.height} budget=${budget} d=${Math.round(tPlay - t0)}ms ` +
        `cap=${Math.round(tCap - t0)} nav=${Math.round(tNav - tCap)} img=${Math.round(tPlay - tNav)}`
    )
    const handle = playTurnCurl({
      container: root,
      target: area,
      from,
      fromRight,
      zIndex: 1, // 低于控制栏 z2：卷曲期间工具栏保持叠在动画之上，不再遮挡
      onDone: removeFreeze,
    })
    // 卷曲首帧已画出旧页全幅 → 双 rAF 后揭除冻结帧（无缝）；仅移除本次自己贴上的那份
    void doubleRaf().then(() => {
      if (freezeEl === from) removeFreeze()
    })
    await handle.done // 等到卷曲结束或被新输入揭除，队列才继续消费下一轮
  } finally {
    // throw / 提前返回兜底：只揭除本轮贴上的冻结帧，避免误删后续流程的快照
    if (freezeEl === from) removeFreeze()
  }
}

/** 字号档位（与 PDF 顶栏缩放 select 同位置；Ctrl+滚轮可调出档位外的自定义值） */
const FONT_SIZE_OPTIONS = [80, 90, 100, 110, 120, 130, 140, 160, 180, 200]
/** 图片型书缩放档位（100 = 整页适合视口） */
const ZOOM_OPTIONS = [50, 75, 100, 125, 150, 200]

/** 图片型书（pre-paginated）顶栏下拉框为缩放，文字型书为字号 */
const isImageLayout = computed(() => store.layout === 'pre-paginated')

/** 顶栏下拉当前值：图片型书取缩放，文字型书取字号（百分比整数） */
const zoomValue = computed(() => (isImageLayout.value ? store.zoom : store.fontSize))

/** 顶栏下拉选项：预置档位 + Ctrl+滚轮调出的档位外自定义值 */
const zoomOptions = computed<SelectOption<number>[]>(() => {
  const presets = isImageLayout.value ? ZOOM_OPTIONS : FONT_SIZE_OPTIONS
  const options: SelectOption<number>[] = presets.map((value) => ({ value, label: `${value}%` }))
  if (!presets.includes(zoomValue.value)) {
    options.push({ value: zoomValue.value, label: `自定义 ${zoomValue.value}%` })
  }
  return options
})

function onZoomSelect(value: number) {
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
    // 拖动接管：连翻补播会话作废，松手只补播滑块自己的那一次
    clearBurstSession()
    slideStartIndex = navIndex ?? store.current?.index ?? idx
    slideStartCfi = store.current?.cfi ?? null
    // 拖动即作废在飞动画，并以当前页为基准重建队列推演（避免继承连翻期间的净位移）
    discardTurn()
    pendingDelta = 0
    forceSnap = false
    navIndex = store.current?.index ?? slideStartIndex
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
  // 拖动过程密集触发 input：节流跳页，队列串行执行且强制瞬切，避免整页重渲染任务积压而“没反应”
  if (slideTimer) clearTimeout(slideTimer)
  slideTimer = setTimeout(() => {
    void requestJump(idx)
  }, 200)
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

/** 滑块松手收尾：等队列把最终页上屏后，用拖动起始快照补播唯一一次卷曲（不再自行导航） */
async function finishSlideCurl(finalIndex: number): Promise<void> {
  const startIndex = slideStartIndex
  const startCfi = slideStartCfi
  const fromPromise = slideFromPromise
  slideStartIndex = null
  slideStartCfi = null
  slideFromPromise = null
  const token = openSeq
  await requestJump(finalIndex) // 串行：与在飞导航合并，最终页上屏后才补播
  if (reducedMotion || !store.ready || startIndex == null || !fromPromise || token !== openSeq) return
  // 期间又来了新的翻页/跳页或已有卷曲在播：不再补播，避免用旧快照盖住新页面
  if (drainPromise !== null || pendingDelta !== 0 || navIndex !== finalIndex || isTurnCurlActive()) {
    return
  }
  const from = await fromPromise
  const area = epubAreaEl.value
  const root = rootEl.value
  if (!from || !area || !root || !store.current) return
  // 未发生位移：不播（保留现有 CFI 判重）
  if (store.current.cfi === startCfi) {
    pushNavDiag('[curl] slide no-move skip')
    return
  }
  const dir: 'forward' | 'back' = finalIndex > startIndex ? 'forward' : 'back'
  const fromRight = (dir === 'forward') === (store.direction === 'ltr') // 同 PDF
  pushNavDiag(`[curl] slide play ${dir}`)
  // 补播卷曲归单例管理：期间的新翻页会揭除它并让队列继续消费
  // zIndex 1 同主翻页：低于控制栏 z2，底栏保持叠在动画之上
  await playTurnCurl({ container: root, target: area, from, fromRight, zIndex: 1 }).done
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
  requestTurn(e.deltaY > 0 ? 'forward' : 'back')
}

function showBarsTemporarily(ms = 3000) {
  barsVisible.value = true
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  // 下拉展开期间只保持可见、不启动隐藏计时：鼠标在触发器附近移动会反复调用本函数
  if (barsPinned) return
  hideTimer = setTimeout(() => (barsVisible.value = false), ms)
}

/** 下拉展开：锁定顶栏可见 */
function pinBars() {
  barsPinned = true
  showBarsTemporarily()
}

/** 下拉收起：解除锁定，重新开始自动隐藏 */
function unpinBars() {
  barsPinned = false
  showBarsTemporarily()
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
    // 尺寸变化令进行中的翻页编排失效（截图/冻结帧按旧尺寸）：作废队列消费并揭除冻结帧
    openSeq++
    pendingDelta = 0
    forceSnap = false
    clearBurstSession()
    discardTurn()
    navIndex = store.current?.index ?? null
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
      requestTurn('forward')
      break
    case 'ArrowLeft':
      requestTurn('back')
      break
    case 'ArrowDown':
      requestTurn('forward')
      break
    case 'ArrowUp':
      requestTurn('back')
      break
    case ' ':
      requestTurn(e.shiftKey ? 'back' : 'forward')
      break
    case 'PageDown':
      requestTurn('forward')
      break
    case 'PageUp':
      requestTurn('back')
      break
    case 'Home':
      void requestJump(0)
      break
    case 'End':
      void requestJump(Math.max(0, totalPages.value - 1))
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
  /* 深色顶栏变体：透明底 + 半透明白描边，尺寸对齐相邻 .controls button */
  --select-height: 26px;
  --select-min-width: 96px;
  --select-radius: 4px;
  --select-padding: 0 6px;
  --select-bg: transparent;
  --select-color: #fff;
  --select-border: rgba(255, 255, 255, 0.4);
  --select-shadow: none;
  --select-hover-bg: rgba(255, 255, 255, 0.1);
  --select-hover-border: rgba(255, 255, 255, 0.65);
  --select-open-bg: rgba(255, 255, 255, 0.1);
  --select-focus-border: rgba(255, 255, 255, 0.85);
  --select-focus-ring: rgba(255, 255, 255, 0.18);
  --select-chevron: rgba(255, 255, 255, 0.7);
  --select-chevron-strong: #fff;
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
