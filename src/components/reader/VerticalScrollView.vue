<template>
  <div
    ref="scrollEl"
    class="v-scroll"
    @scroll.passive="onScroll"
    @pointerdown="onPointerDown"
    @click="onClick"
  >
    <div
      class="v-space"
      :style="{ height: `${metrics.totalHeight}px`, width: `${metrics.contentWidth}px` }"
    >
      <div v-for="i in visibleRows" :key="i" class="v-row" :style="rowStyle(i)">
        <div v-for="(page, j) in rows[i].pages" :key="page" class="v-page" :style="pageStyle(i, j)">
          <canvas :ref="(el) => setCanvasRef(page, el)" @click="onCanvasClick(page, $event)" />
          <span v-if="failedSet.has(page)" class="v-fail">{{ page }} ↻</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 纵向连续滚动视图：行盒布局 + 窗口化挂载 + 渲染队列 + 滚动定位 + 测量校正 + 进度上报
// 对应设计文档 specs/阅读方向上至下连续滚动设计方案-20261023.md §4 / §6.2
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  buildMetrics,
  computePageBox,
  estimateRatio,
  findRowByPage,
  mapAnchorToRow,
  restoreAnchor,
  rowAtOffset,
  VERTICAL_ROW_GAP,
  visibleRange,
  type PageBox,
  type VerticalMetrics,
  type VerticalPageSource,
  type VerticalRow,
  type VerticalSizing,
} from '../../services/verticalLayout'

const props = withDefaults(
  defineProps<{
    rows: VerticalRow[]
    initialPage: number
    sizing: VerticalSizing
    source: VerticalPageSource
    gap?: number
  }>(),
  { gap: VERTICAL_ROW_GAP }
)

const emit = defineEmits<{
  'page-change': [page: number]
  /** 纵向热区点击（左=-1、右=+1）；覆盖层会挡住原生滚动，故由视图内部判定 */
  turn: [delta: number]
}>()

/** 同时渲染的页面数上限：约两屏，兼顾快速滚动与内存 */
const RENDER_CONCURRENCY = 2

const rows = computed(() => props.rows)
const scrollEl = ref<HTMLElement | null>(null)
const viewport = ref({ width: 0, height: 0 })
const metrics = ref<VerticalMetrics>(buildMetrics([], props.gap, 0))
const rowBoxes = ref<PageBox[][]>([])
const visibleRows = ref<number[]>([])
/** 渲染失败页（点击占位重试） */
const failedSet = ref<Set<number>>(new Set())

/** 已测页纵横比（height / width），用于推算行高 */
const measuredRatio = new Map<number, number>()
/** original 模式下的实测自然尺寸 */
const measuredSize = new Map<number, PageBox>()
/** 页 id → 当前布局下的目标盒（渲染时取目标尺寸） */
const pageToBox = new Map<number, PageBox>()
/** 页 id → 当前挂载的 canvas */
const canvasMap = new Map<number, HTMLCanvasElement>()
/** 当前布局下已完成的页 */
const painted = new Set<number>()
/** 进行中的渲染：page → 本次渲染令牌（旧任务收尾不得误删新任务的登记） */
const inflight = new Map<number, number>()
/** 渲染令牌：每次入队自增，用于判断「完成任务」是否仍是当前那一次 */
let renderToken = 0

/** 布局世代：尺寸/缩放/页表变化时递增，旧渲染回来不再写状态 */
let renderEpoch = 0
let initialLocated = false
/** 已上报给父组件的顶部页 id，避免重复 emit */
let lastReported: number | null = null
let rafPending = false
let observer: ResizeObserver | null = null
let downX = 0
let downY = 0

const estimatedRatio = (): number => estimateRatio([...measuredRatio.values()])

/** 单页在行内的目标盒：original 用实测自然尺寸，其余按纵横比推导 */
function pageBox(page: number, cols: number): PageBox {
  if (props.sizing.mode === 'original') {
    const size = measuredSize.get(page)
    if (size) return size
    // 首次按满行宽估计，渲染返回实际尺寸后回填
    return computePageBox(estimatedRatio(), viewport.value, { mode: 'widthScale', scale: 1 }, cols)
  }
  const ratio = measuredRatio.get(page) ?? estimatedRatio()
  return computePageBox(ratio, viewport.value, props.sizing, cols)
}

/** 重排：行高取行内最高页、行宽为各页宽之和；keepAnchor 时回报应恢复的滚动位置 */
function relayout(keepAnchor: boolean): number | null {
  const { width: vw, height: vh } = viewport.value
  if (props.rows.length === 0) {
    metrics.value = buildMetrics([], props.gap, 0)
    rowBoxes.value = []
    pageToBox.clear()
    return null
  }
  if (vw <= 0 || vh <= 0) return null

  const boxes: PageBox[][] = []
  const heights: number[] = []
  let maxRowWidth = 0
  for (const row of props.rows) {
    const cols = row.pages.length
    const list = row.pages.map((p) => pageBox(p, cols))
    boxes.push(list)
    heights.push(list.reduce((m, b) => Math.max(m, b.height), 0))
    maxRowWidth = Math.max(maxRowWidth, list.reduce((s, b) => s + b.width, 0))
  }

  const prev = metrics.value
  const next = buildMetrics(heights, props.gap, Math.max(vw, maxRowWidth))
  metrics.value = next
  rowBoxes.value = boxes
  pageToBox.clear()
  props.rows.forEach((row, i) => {
    row.pages.forEach((p, j) => pageToBox.set(p, boxes[i][j]))
  })

  // 新高度要等 DOM 落地才能安全写入 scrollTop，故只回报目标位置，由调用方滚动
  if (!keepAnchor || prev.tops.length === 0) return null
  return restoreAnchor(prev, next, scrollEl.value?.scrollTop ?? 0)
}

function rowStyle(i: number): Record<string, string> {
  return {
    top: `${metrics.value.tops[i] ?? 0}px`,
    width: `${metrics.value.contentWidth}px`,
    height: `${metrics.value.heights[i] ?? 0}px`,
  }
}

function pageStyle(i: number, j: number): Record<string, string> {
  const box = rowBoxes.value[i]?.[j]
  return {
    width: `${box?.width ?? 0}px`,
    height: `${box?.height ?? 0}px`,
  }
}

/** 渲染目标尺寸：确定的一边才传，另一边按页面纵横比推导 */
function renderTarget(box: PageBox): { width?: number; height?: number } {
  switch (props.sizing.mode) {
    case 'original':
      return {}
    case 'widthScale':
      return { width: Math.max(1, Math.round(box.width)) }
    default:
      return { height: Math.max(1, Math.round(box.height)) }
  }
}

function setCanvasRef(page: number, el: unknown): void {
  const canvas = el as HTMLCanvasElement | null
  if (canvas) {
    const prev = canvasMap.get(page)
    // 同一页换成了新 canvas（行盒重挂）：旧位图已随元素丢失，必须重渲
    if (prev && prev !== canvas) painted.delete(page)
    canvasMap.set(page, canvas)
    pump()
    return
  }
  const old = canvasMap.get(page)
  if (!old) return
  props.source.cancel?.(old)
  canvasMap.delete(page)
  painted.delete(page)
  inflight.delete(page)
}

/** 渲染队列：按距视口中心距离升序，最多 RENDER_CONCURRENCY 个并发 */
function pump(): void {
  if (inflight.size >= RENDER_CONCURRENCY || metrics.value.tops.length === 0) return
  const center = (scrollEl.value?.scrollTop ?? 0) + viewport.value.height / 2
  const candidates: { page: number; dist: number }[] = []
  for (const i of visibleRows.value) {
    const row = props.rows[i]
    if (!row) continue
    const mid = (metrics.value.tops[i] ?? 0) + (metrics.value.heights[i] ?? 0) / 2
    for (const page of row.pages) {
      if (painted.has(page) || inflight.has(page) || failedSet.value.has(page)) continue
      if (!canvasMap.has(page) || !pageToBox.has(page)) continue
      candidates.push({ page, dist: Math.abs(mid - center) })
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)

  for (const c of candidates) {
    if (inflight.size >= RENDER_CONCURRENCY) break
    const token = ++renderToken
    inflight.set(c.page, token)
    void renderPage(c.page, renderEpoch, token)
  }
}

/** 布局世代切换前取消在飞渲染：被取消的渲染会静默返回空结果，不必等它跑完 */
function abortRenders(): void {
  for (const canvas of canvasMap.values()) props.source.cancel?.(canvas)
}

async function renderPage(page: number, epoch: number, token: number): Promise<void> {
  const canvas = canvasMap.get(page)
  const box = pageToBox.get(page)
  if (!canvas || !box) {
    inflight.delete(page)
    return
  }
  try {
    const actual = await props.source.render(page, canvas, renderTarget(box))
    if (epoch !== renderEpoch) return
    // 渲染期间该页已被卸载/换了 canvas：被取消的渲染会「成功」返回但不落像素，
    // 此时登记已渲染会让重挂后的同一页永远空白
    if (canvasMap.get(page) !== canvas) return
    if (!(actual.width > 0) || !(actual.height > 0)) {
      // 仍附着却拿不到尺寸：按失败处理（占位可点击重试），避免队列空转
      failedSet.value = new Set(failedSet.value).add(page)
      return
    }
    painted.add(page)
    onMeasured(page, actual)
  } catch (e) {
    if (epoch !== renderEpoch) return
    console.error(`[vertical] 渲染第 ${page} 页失败`, e)
    failedSet.value = new Set(failedSet.value).add(page)
  } finally {
    if (inflight.get(page) === token) inflight.delete(page)
    if (epoch === renderEpoch) pump()
  }
}

/** 比例回填：与排版口径偏差超过 0.5% 时重排并让该页按新尺寸重渲一次 */
function onMeasured(page: number, actual: PageBox): void {
  if (!(actual.width > 0) || !(actual.height > 0)) return

  if (props.sizing.mode === 'original') {
    const prev = measuredSize.get(page)
    if (
      prev &&
      Math.abs(prev.width - actual.width) < 1 &&
      Math.abs(prev.height - actual.height) < 1
    ) {
      return
    }
    measuredSize.set(page, actual)
    reflowKeepingAnchor()
    return
  }

  const ratio = actual.height / actual.width
  const prev = measuredRatio.get(page)
  measuredRatio.set(page, ratio)
  if (prev !== undefined && Math.abs(prev - ratio) <= prev * 0.005) return
  painted.delete(page)
  reflowKeepingAnchor()
}

/**
 * 测量回填后重排：保持顶部行与屏内偏移，并重算渲染窗口。
 * 行高变化会让视口下的行整块移动，不重算窗口就会出现「视野里有行没挂载」的空白。
 */
function reflowKeepingAnchor(): void {
  settleLayout(relayout(true))
}

/**
 * 重排后收尾：有目标位置就等 DOM 落地后滚过去（由 syncScroll 重建窗口）；
 * 无需移动则直接按当前滚动位置重算窗口。先建窗口再定位会闪一帧错页。
 */
function settleLayout(anchor: number | null): void {
  if (anchor != null) {
    void scrollAfterLayout(anchor)
    return
  }
  updateWindow()
  pump()
}

/** 渲染窗口内可见行；DOM 增删由 canvas ref 回调收尾渲染任务 */
function updateWindow(): void {
  const el = scrollEl.value
  if (!el || metrics.value.tops.length === 0) {
    if (visibleRows.value.length) visibleRows.value = []
    return
  }
  const [from, to] = visibleRange(metrics.value, el.scrollTop, viewport.value.height)
  const next: number[] = []
  for (let i = from; i <= to; i++) next.push(i)
  const prev = visibleRows.value
  if (prev.length !== next.length || prev.some((v, k) => v !== next[k])) visibleRows.value = next
}

/** 滚动同步：更新窗口、上报顶部行首页、补给渲染队列 */
function syncScroll(): void {
  const el = scrollEl.value
  if (!el || metrics.value.tops.length === 0) return
  updateWindow()
  const row = rowAtOffset(metrics.value, el.scrollTop + 1)
  const page = props.rows[row]?.firstPage
  if (page != null && page !== lastReported) {
    lastReported = page
    emit('page-change', page)
  }
  pump()
}

function onScroll(): void {
  if (rafPending) return
  rafPending = true
  requestAnimationFrame(() => {
    rafPending = false
    syncScroll()
  })
}

function onPointerDown(e: PointerEvent): void {
  downX = e.clientX
  downY = e.clientY
}

/** 左右 1/3 热区翻行；拖动滚动（位移 > 8px）不算点击 */
function onClick(e: MouseEvent): void {
  const el = scrollEl.value
  if (!el) return
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) return
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left
  if (x < rect.width / 3) emit('turn', -1)
  else if (x > (rect.width * 2) / 3) emit('turn', 1)
}

/** 失败占位点击重试（阻止冒泡触发热区翻行） */
function onCanvasClick(page: number, e: MouseEvent): void {
  if (!failedSet.value.has(page)) return
  e.stopPropagation()
  const next = new Set(failedSet.value)
  next.delete(page)
  failedSet.value = next
  pump()
}

/** 定位序号：连续多次定位时只让最后一次生效 */
let scrollSeq = 0

/**
 * 布局表更新后滚动定位。
 * Vue 的 DOM 更新晚于本轮同步代码，立即写 scrollTop 会被「旧的 .v-space 高度」夹取
 * （内容变高时夹到 0、变矮时夹到旧上限），因此等一次 DOM 落地再写，并夹到真实可滚范围。
 */
async function scrollAfterLayout(top: number): Promise<void> {
  const seq = ++scrollSeq
  await nextTick()
  if (seq !== scrollSeq) return
  const el = scrollEl.value
  if (!el) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  el.scrollTop = Math.min(Math.max(0, top), max)
  syncScroll()
}

/** 首次定位到 initialPage 所在行顶部（之后由滚动与测量接管） */
function locateInitial(): void {
  if (!scrollEl.value || metrics.value.tops.length === 0 || initialLocated) return
  const row = findRowByPage(props.rows, props.initialPage)
  if (row < 0) return
  initialLocated = true
  // 先登记上报页，避免定位落地后的 syncScroll 重复上报/回写进度
  lastReported = props.rows[row]?.firstPage ?? null
  void scrollAfterLayout(metrics.value.tops[row] ?? 0)
}

/** 尺寸变化：清空已渲染标记后整体重排重渲（锚点基于旧布局保持） */
function handleResize(): void {
  const el = scrollEl.value
  if (!el) return
  const width = el.clientWidth
  const height = el.clientHeight
  if (width <= 0 || height <= 0) return
  if (width === viewport.value.width && height === viewport.value.height) return

  viewport.value = { width, height }
  abortRenders()
  renderEpoch++
  painted.clear()
  inflight.clear()
  failedSet.value = new Set()
  const anchor = relayout(initialLocated)
  if (!initialLocated) {
    // 首次定位要等 DOM 落地（见 scrollAfterLayout），定位完成后由 syncScroll 建窗口
    locateInitial()
    return
  }
  settleLayout(anchor)
}

// 缩放切换：清空已渲染标记，保持顶部行与屏内偏移
watch(
  () => props.sizing,
  () => {
    if (viewport.value.width <= 0) return
    abortRenders()
    renderEpoch++
    painted.clear()
    inflight.clear()
    failedSet.value = new Set()
    measuredSize.clear() // original 的自然尺寸按新渲染重新测量
    settleLayout(relayout(true))
  }
)

// 单双页切换：行表重建后按「顶部行 + 行内相对位移」重新定位
watch(
  () => props.rows,
  (next) => {
    const anchorPage = lastReported ?? props.initialPage
    const prevMetrics = metrics.value
    const prevTop = scrollEl.value?.scrollTop ?? 0
    abortRenders()
    renderEpoch++
    painted.clear()
    inflight.clear()
    failedSet.value = new Set()
    // 行索引已将内容换成新的页组：先卸空窗口，避免用旧索引挂载出“错页”一帧
    visibleRows.value = []
    relayout(false)
    const row = findRowByPage(next, anchorPage)
    if (row >= 0 && metrics.value.tops.length > 0) {
      lastReported = next[row]?.firstPage ?? lastReported
      settleLayout(mapAnchorToRow(prevMetrics, metrics.value, prevTop, row))
      return
    }
    settleLayout(null)
  }
)

defineExpose({
  /** 滚到页所在行顶部（进度恢复 / 滑块跳转） */
  scrollToPage,
  /** 顶部行 ±delta（键盘 / 热区 / 上下页按钮） */
  step,
  /** 当前顶部行索引 */
  currentRow,
})

function scrollToPage(page: number): void {
  const row = findRowByPage(props.rows, page)
  const el = scrollEl.value
  if (row < 0 || !el) return
  el.scrollTop = metrics.value.tops[row] ?? 0
  syncScroll()
}

function step(delta: number): void {
  const el = scrollEl.value
  if (!el || props.rows.length === 0 || metrics.value.tops.length === 0) return
  const current = rowAtOffset(metrics.value, el.scrollTop + 1)
  const target = Math.min(Math.max(current + delta, 0), props.rows.length - 1)
  el.scrollTop = metrics.value.tops[target] ?? 0
  syncScroll()
}

function currentRow(): number {
  return rowAtOffset(metrics.value, scrollEl.value?.scrollTop ?? 0)
}

onMounted(() => {
  observer = new ResizeObserver(() => handleResize())
  if (scrollEl.value) observer.observe(scrollEl.value)
  void nextTick(() => handleResize())
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  renderEpoch++
  for (const canvas of canvasMap.values()) props.source.cancel?.(canvas)
  canvasMap.clear()
  painted.clear()
  inflight.clear()
})
</script>

<style scoped>
.v-scroll {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #000;
  /* 深色阅读区的细滚动条：与横向阅读器的隐藏滚动条区分，纵向必须有位置反馈 */
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
}

.v-scroll::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.v-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.28);
  border-radius: 4px;
}

.v-space {
  position: relative;
  margin: 0 auto;
}

.v-row {
  position: absolute;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.v-page {
  position: relative;
  flex: none;
  line-height: 0;
}

.v-page canvas {
  display: block;
}

.v-fail {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  color: #888;
  font-size: 14px;
  line-height: 1;
  border: 1px dashed #444;
  cursor: pointer;
}
</style>
