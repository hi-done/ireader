<template>
  <!-- 覆盖层 = 页盒（同尺寸百分比定位）：单双页 / 缩放 / 方向切换后译文框自动贴回原气泡 -->
  <div
    ref="rootEl"
    class="ai-layer"
    :class="{ selecting: selectable }"
    @pointerdown="onPointerDown"
  >
    <!-- 橡皮筋：拖拽中的预览框，不接收指针事件 -->
    <div v-if="band" class="ai-band" :style="bandStyle" />

    <!-- 门控为假（翻页 / 动画 / 停留计时中）：整批框都不渲染。
         只靠父级 opacity 淡出会先画出新页框再消失，肉眼就是「闪一下」 -->
    <template v-if="visible && !ai.hiddenAll">
      <!-- 已落库译文：DOM 顺序即层叠顺序，后建的自然压在上层 -->
      <template v-for="rec in pageRecords" :key="rec.id">
        <button
          v-if="rec.collapsed"
          class="ai-ball"
          :style="ballStyle(rec.rect)"
          :aria-label="t('ai.box.expand')"
          @pointerdown.stop
          @click.stop="ai.setCollapsed(rec, false)"
        />
        <div
          v-else
          class="ai-box"
          :class="{ dragging: draggingId === rec.id, resizing: resizingId === rec.id }"
          :style="positionStyle(rec)"
          @pointerdown.stop="startMove($event, rec)"
          @wheel.stop
        >
          <div class="ai-actions" @pointerdown.stop>
            <button
              class="ai-act ai-act-min"
              :aria-label="t('ai.box.collapse')"
              :title="t('ai.box.collapse')"
              @click.stop="ai.setCollapsed(rec, true)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.4 9.8 8 6.2l3.6 3.6" />
              </svg>
            </button>
            <button
              class="ai-act ai-act-close"
              :aria-label="t('ai.box.remove')"
              :title="t('ai.box.remove')"
              @click.stop="ai.remove(rec)"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />
              </svg>
            </button>
          </div>
          <div
            class="ai-scroll"
            :ref="(el) => bindScroll(String(rec.id), el)"
            :style="{ fontSize: `${textFont(String(rec.id), fontFor(rec.fontRatio), rec.rect)}px` }"
          >
            <p class="ai-text">
              {{ rec.text }}
            </p>
          </div>
          <span
            class="ai-resize"
            :aria-label="t('ai.box.resize')"
            @pointerdown.stop="startResize($event, rec)"
          />
        </div>
      </template>

      <!-- 在途 / 未识别 / 失败：临时框，一律不落库，翻页即消失 -->
      <div
        v-for="box in pagePending"
        :key="box.key"
        class="ai-box ai-temp"
        :class="box.status"
        :style="toPercentStyle(box.rect)"
        @pointerdown.stop
        @wheel.stop
      >
        <div class="ai-actions ai-actions-pinned">
          <button
            class="ai-act ai-act-close"
            :aria-label="t('ai.box.remove')"
            :title="t('ai.box.remove')"
            @click.stop="ai.removePending(box.key)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" />
            </svg>
          </button>
        </div>
        <span v-if="box.status === 'loading'" class="ai-spinner" />
        <div
          v-else
          class="ai-scroll"
          :ref="(el) => bindScroll(box.key, el)"
          :style="{ fontSize: `${textFont(box.key, fontFor(DEFAULT_FONT_RATIO), box.rect)}px` }"
        >
          <p class="ai-text">
            {{ box.status === 'empty' ? t('ai.noText') : box.message }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// 单页 AI 覆盖层：选词捕获 + 译文框 + 折叠球 + 缩放手柄
// 对应设计文档《20261102-AI框选翻译功能设计方案》§8.4 / §9.2
// 覆盖层与页盒严格同尺寸：所有几何用归一化矩形换算百分比，字号用页高 × fontRatio
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { AiRect, AiTranslationRecord } from '../../../shared/types'
import { useAiTranslationStore } from '../../stores/aiTranslation'
import {
  DEFAULT_FONT_RATIO,
  MIN_FONT_PX,
  computeFontPx,
  moveRect,
  normalizeRect,
  resizeRect,
  toPercent,
  toPercentStyle,
} from '../../services/aiTranslation'
import { t } from '../../i18n'

const props = defineProps<{
  /** 真实页码（1 基，与 reader.spreads 口径一致） */
  page: number
  /** 书名：随翻译请求带给模型，保证同一本书的专名译法一致 */
  bookTitle: string
  /** 选词模式：为真时覆盖层接管指针，拖出矩形即发起翻译 */
  selectable: boolean
  /** 门控可见性：翻页 / 动画 / 停留计时期间为假，译文框整体不渲染 */
  visible: boolean
}>()

const ai = useAiTranslationStore()

const rootEl = ref<HTMLElement | null>(null)
/** 覆盖层 = 页盒尺寸，由 ResizeObserver 同步（缩放 / 单双页切换都会变） */
const pageSize = ref({ width: 0, height: 0 })

const pageRecords = computed(() => ai.byPage(props.page).records)
const pagePending = computed(() => ai.byPage(props.page).pending)

/** 折叠球直径（px）：与 .ai-ball 的 width/height 保持一致 */
const BALL_SIZE = 20
/** 折叠球锚点靠页边时的内收阈值（≈ 球直径 × 0.3），避免球体超出页面 */
const BALL_INSET_PX = Math.round(BALL_SIZE * 0.3)

let observer: ResizeObserver | null = null

function measure(): void {
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  pageSize.value = { width: rect.width, height: rect.height }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver === 'function' && rootEl.value) {
    observer = new ResizeObserver(measure)
    observer.observe(rootEl.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  stopDrag()
  stopResize()
  stopMove()
})

/** 字号：页显示高度 × 比例，脏数据由 computeFontPx 兜底钳制 */
function fontFor(fontRatio: number): number {
  return computeFontPx(fontRatio, pageSize.value.height)
}

// —— 字号自适应：模型给的比例只作上限，实际字号收缩到框内放得下 ——

/** 每框实测字号（键：已落库框为 rec.id，临时框为 box.key）；缺省即建议值 */
const fitted = ref<Record<string, number>>({})
const scrollEls = new Map<string, HTMLElement>()

/** 函数 ref：v-for 的滚动区挂载 / 卸载时登记，卸载传 null */
function bindScroll(key: string, el: Element | ComponentPublicInstance | null): void {
  if (el instanceof HTMLElement) scrollEls.set(key, el)
  else scrollEls.delete(key)
}

function textFont(key: string, base: number, rect: AiRect): number {
  return fitted.value[key] ?? Math.min(base, heightCap(rect))
}

/** 未实测时的兜底：不超过框高的 52%，避免展开首帧用建议字号撑满框 */
function heightCap(rect: AiRect): number {
  return Math.max(MIN_FONT_PX, Math.round(rect.h * pageSize.value.height * 0.52))
}

/**
 * 逐框收缩：当前字号下读溢出比例，等比缩小到不溢出（最多 4 轮）。
 * 直接改内联样式测量、测完还原，结果交给 textFont 渲染，避免多帧闪烁。
 */
function fitAll(): void {
  const next: Record<string, number> = {}
  const scan = (key: string, base: number): void => {
    const el = scrollEls.get(key)
    if (!el) return
    let size = base
    el.style.fontSize = `${size}px`
    for (let i = 0; i < 4; i++) {
      if (el.scrollHeight <= el.clientHeight + 1) break
      const scale = Math.max(0.6, el.clientHeight / el.scrollHeight)
      const smaller = Math.max(MIN_FONT_PX, Math.floor(size * scale * 0.97))
      if (smaller >= size) break
      size = smaller
      el.style.fontSize = `${size}px`
    }
    // 保留测量结果：交给 textFont 重渲染时写回同一值，中间不会走回建议字号
    el.style.fontSize = `${size}px`
    if (size < base) next[key] = size
  }
  for (const rec of pageRecords.value) scan(String(rec.id), fontFor(rec.fontRatio))
  for (const box of pagePending.value) scan(box.key, fontFor(DEFAULT_FONT_RATIO))
  fitted.value = next
}

// 译文 / 框尺寸 / 页尺寸 / 显隐变化后重算；flush post 保证读到的是新布局
// （visible 转真时框刚重新挂载，必须补跑一次才能量到正确字号）
watch(
  [
    pageSize,
    () => props.visible,
    () =>
      `${pageRecords.value
        .map((r) => `${r.id}:${r.text.length}:${r.rect.w.toFixed(3)}x${r.rect.h.toFixed(3)}:${r.collapsed ? 'c' : 'o'}`)
        .join('|')}#${pagePending.value
        .map((b) => `${b.key}:${b.status}:${b.message?.length ?? 0}`)
        .join('|')}#${ai.hiddenAll}`,
  ],
  () => {
    void nextTick(fitAll)
  },
  { flush: 'post', immediate: true }
)

// —— 折叠与折叠球 ——

/** 折叠球锚点为原框左上角，靠近页边时向内收，避免球体超出页面 */
function ballStyle(rect: AiRect): Record<string, string> {
  const { width, height } = pageSize.value
  const offsetX = rect.x * width < BALL_INSET_PX ? 0 : BALL_INSET_PX
  const offsetY = rect.y * height < BALL_INSET_PX ? 0 : BALL_INSET_PX
  return {
    left: `calc(${toPercent(rect.x)} - ${offsetX}px)`,
    top: `calc(${toPercent(rect.y)} - ${offsetY}px)`,
  }
}

// —— 本地预览：缩放与拖动共用同一份预览矩形，positionStyle 只有一个数据源 ——

/** 拖动阈值：位移小于该值视为单击抖动，既不进入拖动也不落库 */
const DRAG_THRESHOLD_PX = 3

const previewRect = ref<{ id: number; rect: AiRect } | null>(null)
/** 拖动中的框 id：只用于切 grabbing 光标与屏蔽框内文字拖选 */
const draggingId = ref<number | null>(null)
/** 缩放中的框 id：角标平时隐藏，缩放时即使指针移出框也要保持可见 */
const resizingId = ref<number | null>(null)
let resizeStart: { rect: AiRect; x: number; y: number } | null = null
let moveStart: { id: number; rect: AiRect; x: number; y: number; active: boolean } | null = null

function positionStyle(rec: AiTranslationRecord): Record<string, string> {
  const preview = previewRect.value
  return toPercentStyle(preview && preview.id === rec.id ? preview.rect : rec.rect)
}

// —— 拖拽改尺寸：拖动期间只改本地样式，松手落库一次 ——

function startResize(e: PointerEvent, rec: AiTranslationRecord): void {
  if (e.button !== 0) return
  e.preventDefault()
  resizeStart = { rect: { ...rec.rect }, x: e.clientX, y: e.clientY }
  resizingId.value = rec.id
  previewRect.value = { id: rec.id, rect: { ...rec.rect } }
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', onResizeEnd, { once: true })
  window.addEventListener('pointercancel', onResizeEnd, { once: true })
}

function onResizeMove(e: PointerEvent): void {
  const start = resizeStart
  if (!start || !previewRect.value) return
  const page = pageSize.value
  if (!(page.width > 0) || !(page.height > 0)) return
  previewRect.value.rect = resizeRect(
    start.rect,
    { dx: e.clientX - start.x, dy: e.clientY - start.y },
    page
  )
}

function onResizeEnd(): void {
  const pending = previewRect.value
  const rec = pending ? pageRecords.value.find((r) => r.id === pending.id) : undefined
  const rect = pending?.rect
  stopResize()
  if (!rec || !rect) return
  void ai.applyResize(rec, rect)
}

function stopResize(): void {
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', onResizeEnd)
  window.removeEventListener('pointercancel', onResizeEnd)
  previewRect.value = null
  resizingId.value = null
  resizeStart = null
}

// —— 整框拖动改位置：位置落库走同一条 rect，折叠球锚点随之跟随 ——

function startMove(e: PointerEvent, rec: AiTranslationRecord): void {
  if (e.button !== 0) return
  // Shift + 拖动退化为浏览器原生文字选择：不拦截默认行为，也不动框
  if (e.shiftKey) return
  // 按下点在滚动条上：交还给滚动区（长译文要靠它查看）
  if (isScrollbarPress(e)) return
  e.preventDefault() // 阻止拖选文字与浏览器原生拖拽
  window.getSelection()?.removeAllRanges()
  moveStart = { id: rec.id, rect: { ...rec.rect }, x: e.clientX, y: e.clientY, active: false }
  window.addEventListener('pointermove', onMoveMove)
  window.addEventListener('pointerup', onMoveEnd, { once: true })
  window.addEventListener('pointercancel', onMoveEnd, { once: true })
}

/** 位移一律相对按下点计算：丢帧或抖动不会累积误差 */
function onMoveMove(e: PointerEvent): void {
  const start = moveStart
  if (!start) return
  const dx = e.clientX - start.x
  const dy = e.clientY - start.y
  if (!start.active) {
    if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return
    start.active = true
    draggingId.value = start.id
  }
  previewRect.value = { id: start.id, rect: moveRect(start.rect, { dx, dy }, pageSize.value) }
}

/** 松手才落库一次；阈值内视为单击，不写库 */
function onMoveEnd(): void {
  const start = moveStart
  const preview = previewRect.value
  const rec = start ? pageRecords.value.find((r) => r.id === start.id) : undefined
  const rect = start?.active && preview && preview.id === start.id ? preview.rect : null
  stopMove()
  if (!rec || !rect) return
  void ai.applyMove(rec, rect)
}

function stopMove(): void {
  window.removeEventListener('pointermove', onMoveMove)
  window.removeEventListener('pointerup', onMoveEnd)
  window.removeEventListener('pointercancel', onMoveEnd)
  // 只清自己的预览：避免与缩放预览互相踩踏
  if (previewRect.value && moveStart && previewRect.value.id === moveStart.id) {
    previewRect.value = null
  }
  draggingId.value = null
  moveStart = null
}

/** 按下点落在滚动区滚动条上（padding box 之外）：让滚动条正常工作 */
function isScrollbarPress(e: PointerEvent): boolean {
  const target = e.target as HTMLElement | null
  const scroller = target?.closest('.ai-scroll')
  if (!(scroller instanceof HTMLElement)) return false
  const rect = scroller.getBoundingClientRect()
  return (
    e.clientX - rect.left >= scroller.clientWidth ||
    e.clientY - rect.top >= scroller.clientHeight
  )
}

// —— 选词：拖出矩形 → 归一化 → 发起翻译 ——

const band = ref<{ x: number; y: number; w: number; h: number } | null>(null)
let dragStart: { x: number; y: number } | null = null

const bandStyle = computed((): Record<string, string> => {
  const b = band.value
  if (!b) return {}
  return {
    left: `${b.x}px`,
    top: `${b.y}px`,
    width: `${b.w}px`,
    height: `${b.h}px`,
  }
})

function onPointerDown(e: PointerEvent): void {
  if (!props.selectable || e.button !== 0) return
  const box = rootEl.value?.getBoundingClientRect()
  if (!box) return
  e.preventDefault() // 阻止文本选择与浏览器的默认拖拽
  dragStart = { x: e.clientX - box.left, y: e.clientY - box.top }
  band.value = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd, { once: true })
}

/** 拖到页外也继续跟随：坐标夹到页盒内，橡皮筋不会画到邻页 */
function onDragMove(e: PointerEvent): void {
  const box = rootEl.value?.getBoundingClientRect()
  if (!box || !dragStart) return
  const x = Math.min(Math.max(e.clientX - box.left, 0), box.width)
  const y = Math.min(Math.max(e.clientY - box.top, 0), box.height)
  band.value = {
    x: Math.min(dragStart.x, x),
    y: Math.min(dragStart.y, y),
    w: Math.abs(x - dragStart.x),
    h: Math.abs(y - dragStart.y),
  }
}

function onDragEnd(): void {
  const box = rootEl.value?.getBoundingClientRect()
  const dragged = band.value
  stopDrag()
  if (!box || !dragged) return
  // 误触过滤在纯逻辑里：小于 24×16px 直接返回 null
  const rect = normalizeRect(dragged, { width: box.width, height: box.height })
  if (!rect) return
  // 裁图取位图（不是屏幕截图）：canvas 是 .page-wrap 的兄弟节点
  const canvas = rootEl.value?.parentElement?.querySelector('canvas')
  if (!canvas) return
  void ai.selectRect({
    page: props.page,
    rect,
    canvas,
    bookTitle: props.bookTitle,
  })
  // 一次框选只做一次翻译：提交后立刻退出选词，十字光标与热区翻页恢复常态
  ai.endSelect()
}

function stopDrag(): void {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  band.value = null
  dragStart = null
}

// 拖拽中退出选词（Esc / 再次点按钮）：立即取消橡皮筋，避免松手还发起一次翻译
watch(
  () => props.selectable,
  (on) => {
    if (!on) stopDrag()
  }
)
</script>

<style scoped>
/* 覆盖层铺满页盒：常态不吃指针（热区翻页 / 拖拽平移照旧），选词态才接管 */
.ai-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

.ai-layer.selecting {
  pointer-events: auto;
  cursor: crosshair;
}

.ai-band {
  position: absolute;
  z-index: 3;
  border: 1.5px dashed rgba(255, 255, 255, 0.85);
  border-radius: 4px;
  background: rgba(10, 132, 255, 0.18);
  pointer-events: none;
}

/* —— 译文框：阅读区恒为黑底，白框对比最强，不随主题变化 —— */
.ai-box {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  /* 不留内边距：操作条与缩放手柄钉在框体四角 */
  padding: 0;
  /* 常态无边框：描边只在悬浮 / 聚焦时淡入，用来提示「可按住拖动」 */
  border: 1px solid transparent;
  border-radius: 6px;
  background: #fff;
  color: #1d1d1f;
  /* 常态无阴影：静默态尽量淡化框的存在，只有悬浮 / 聚焦才浮起 */
  box-shadow: none;
  pointer-events: auto;
  /* 整框可拖：光标即操作提示 */
  cursor: grab;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  animation: ai-pop-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
}

/* 悬浮 / 聚焦才显边框与投影：淡蓝描边 + 3px 光晕环 */
.ai-box:not(.ai-temp):hover,
.ai-box:not(.ai-temp):focus-within {
  border-color: rgba(10, 132, 255, 0.45);
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.35),
    0 0 0 3px rgba(10, 132, 255, 0.16);
}

/* 拖动中：光标收拢、描边加深，并屏蔽框内文字拖选 */
.ai-box.dragging {
  border-color: rgba(10, 132, 255, 0.6);
  cursor: grabbing;
  user-select: none;
}

.ai-scroll {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 文本内边距给在滚动区：长译文滚动时内容不贴边 */
  padding: 6px 8px;
  overflow: auto;
  /* 细滚动条：长译文可滚，不遮挡文字 */
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.28) transparent;
}

.ai-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.ai-scroll::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.28);
}

.ai-text {
  /* margin:auto 而非 flex 居中：长译文溢出时顶部不被裁剪，且短文本仍居中 */
  margin: auto;
  line-height: 1.35;
  text-align: center;
  word-break: break-word;
  /* 保留模型返回的换行（多气泡合并按行分隔） */
  white-space: pre-wrap;
}

/* —— 左上角操作条：折叠（浅蓝）/ 删除（浅红）圆点，悬停浮现、hover 单点高亮 —— */
.ai-actions {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 1;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

/* 按钮贴框内：鼠标从框内移向按钮时 hover 不断链 */
.ai-box:hover .ai-actions,
.ai-box:focus-within .ai-actions,
.ai-actions-pinned {
  opacity: 1;
}

.ai-act {
  position: relative;
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease;
}

/* 命中区外扩 4px：视觉是 14px 圆点，实际可点 22px */
.ai-act::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}

/* 符号：8px 深灰描边，随按钮一起出现 */
.ai-act svg {
  width: 8px;
  height: 8px;
  fill: none;
  stroke: rgba(0, 0, 0, 0.6);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  transition: opacity 0.12s ease, stroke 0.15s ease;
}

.ai-box:hover .ai-act svg,
.ai-box:focus-within .ai-act svg,
.ai-actions-pinned .ai-act svg {
  opacity: 1;
}

/* 常态浅色圆点：折叠浅蓝 / 删除浅红 */
.ai-act-min {
  background: #a8cffc;
}

.ai-act-close {
  background: #ffb6b1;
}

/* hover 时对应圆点饱和高亮，符号反白 */
.ai-act-min:hover {
  background: #007aff;
}

.ai-act-close:hover {
  background: #ff3b30;
}

.ai-act:hover {
  transform: scale(1.12);
}

.ai-act:hover svg {
  stroke: #fff;
}

.ai-act:active {
  transform: scale(0.9);
}

/* —— 折叠球：20px 立体玻璃球，锚点为原框左上角 —— */
.ai-ball {
  position: absolute;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  /* 球面：左上高光 + 中段浅蓝 + 边缘深蓝，叠一层白光晕做出湿润感 */
  background:
    radial-gradient(
      circle at 34% 26%,
      rgba(255, 255, 255, 0.95) 0 10%,
      rgba(255, 255, 255, 0.42) 32%,
      rgba(255, 255, 255, 0) 56%
    ),
    radial-gradient(circle at 50% 46%, #a7d4ff 0 18%, #5aa2f2 58%, #1f6fd0 100%);
  backdrop-filter: blur(6px) saturate(150%);
  /* 三组内阴影定明暗（边缘折射 / 顶部亮边 / 底部反光）+ 双层投影落地 */
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.5),
    inset 0 2px 2px rgba(255, 255, 255, 0.55),
    inset 0 -2px 3px rgba(8, 44, 93, 0.35),
    0 1px 2px rgba(0, 0, 0, 0.35),
    0 5px 12px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.16s ease;
  animation: ai-pop-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
}

/* 命中区外扩 4px：视觉是 20px 球，实际可点 28px */
.ai-ball::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
}

/* 镜面高光点：左上方一小片白色椭圆，补第三层明暗 */
.ai-ball::after {
  content: '';
  position: absolute;
  left: 26%;
  top: 18%;
  width: 5px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  filter: blur(0.5px);
}

.ai-ball:hover:not(:disabled) {
  transform: scale(1.08);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.6),
    inset 0 2px 2px rgba(255, 255, 255, 0.65),
    inset 0 -2px 3px rgba(8, 44, 93, 0.35),
    0 2px 4px rgba(0, 0, 0, 0.35),
    0 8px 18px rgba(0, 0, 0, 0.26);
}

.ai-ball:active:not(:disabled) {
  transform: scale(0.94);
}

/* —— 右下角缩放手柄：拖动期间实时改样式，松手才落库 —— */
.ai-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
  /* 静默态不显示角标：与操作条同口径，悬浮 / 聚焦才浮现 */
  opacity: 0;
  transition: opacity 0.15s ease;
  /* 两条 45° 短线：白色框上的浅灰角标 */
  background: linear-gradient(
    135deg,
    transparent 0 45%,
    rgba(0, 0, 0, 0.3) 45% 55%,
    transparent 55% 72%,
    rgba(0, 0, 0, 0.3) 72% 82%,
    transparent 82%
  );
}

.ai-box:hover .ai-resize,
.ai-box:focus-within .ai-resize,
.ai-box.resizing .ai-resize {
  opacity: 1;
}

/* —— 临时框（加载 / 兜底 / 错误）：尺寸与加载态一致，不与原图错位 —— */
/* 临时框不落库也不可拖动：光标与悬浮描边都不做可拖暗示 */
.ai-temp {
  cursor: default;
}

.ai-temp.loading {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(10px) saturate(160%);
  box-shadow: none;
  color: #fff;
}

.ai-temp.empty .ai-text {
  color: var(--text-faint);
}

.ai-temp.error .ai-text {
  color: var(--danger);
}

.ai-spinner {
  width: 18px;
  height: 18px;
  margin: auto;
  border-radius: 50%;
  /* conic-gradient 双色圆环：不受边框宽度影响，缩放后仍然圆 */
  background: conic-gradient(from 0deg, rgba(255, 255, 255, 0.2) 0 25%, #fff 75% 100%);
  mask: radial-gradient(circle, transparent 0 5px, #000 5.5px);
  -webkit-mask: radial-gradient(circle, transparent 0 5px, #000 5.5px);
  animation: ai-spin 1s linear infinite;
}

@keyframes ai-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes ai-pop-in {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes ai-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 系统开启“减弱动态效果”：去掉缩放，只留淡入；加载环改静态圆点 */
@media (prefers-reduced-motion: reduce) {
  .ai-box,
  .ai-ball,
  .ai-temp {
    animation: ai-fade-in 180ms ease;
  }

  .ai-spinner {
    animation: none;
    opacity: 0.5;
  }

  /* 折叠球只留阴影变化，不做缩放 */
  .ai-ball:hover:not(:disabled),
  .ai-ball:active:not(:disabled) {
    transform: none;
  }
}
</style>
