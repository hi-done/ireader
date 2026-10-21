<template>
  <div ref="rootEl" class="select-menu">
    <button
      ref="triggerEl"
      type="button"
      class="select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="activeDescendant"
      :aria-label="t('common.labelValue', { label, value: selectedLabel })"
      :disabled="disabled"
      @click="toggle"
      @keydown="onTriggerKeydown"
      @pointerenter="onTriggerEnter"
      @pointerleave="onTriggerLeave"
      @focus="onTriggerEnter"
      @blur="onTriggerLeave"
    >
      <span class="select-value">{{ selectedLabel }}</span>
      <!-- macOS 弹出按钮的 chevron.up.chevron.down 双箭头 -->
      <svg class="select-chevron" width="9" height="12" viewBox="0 0 9 12" aria-hidden="true">
        <path
          d="M1.5 4.5 4.5 1.5 7.5 4.5M1.5 7.5 4.5 10.5 7.5 7.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <!-- 弹层 Teleport 到 body：文库工具栏的 backdrop-filter 会成为 fixed 包含块，留在原地会坐标错位 -->
    <Teleport to="body">
      <Transition name="select-pop">
        <ul
          v-if="open"
          ref="menuEl"
          :id="listId"
          class="select-pop"
          role="listbox"
          :aria-label="label"
          :style="menuStyle"
          @pointerdown.prevent
        >
          <li
            v-for="(option, index) in options"
            :id="optionId(index)"
            :key="option.value"
            role="option"
            class="select-option"
            :class="{ 'is-selected': option.value === modelValue, 'is-active': index === activeIndex }"
            :aria-selected="option.value === modelValue"
            @mouseenter="activeIndex = index"
            @pointerdown.prevent
            @click="commit(option)"
          >
            <!-- 勾选槽位常驻占位，避免选中态文字左右跳动 -->
            <svg class="select-check" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2.5 7.5 5.5 10.5 11.5 3.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="select-option-label">{{ option.label }}</span>
          </li>
        </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<script lang="ts">
// 模块级自增序号：<script setup> 顶层代码按实例执行，计数器放模块作用域才能保证同页多个下拉 id 唯一
let menuIdSeed = 0

function nextMenuId(): string {
  return `select-${++menuIdSeed}`
}
</script>

<script setup lang="ts" generic="T extends string | number">
// 通用自绘下拉：完全受控（modelValue + emit），不访问 IPC / store，设置页 / 文库页 / 阅读页共用
// 对应设计文档《设置页与文库下拉菜单苹果风格美化设计方案》§5.1 / §6
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { t } from '../../i18n'
import {
  clampMenuLeft,
  initialActiveIndex,
  moveActiveIndex,
  resolveMenuPlacement,
  type SelectOption,
} from '../../services/selectMenu'
import { shouldShowTip } from '../../services/cardTip'

const props = defineProps<{
  modelValue: T
  options: SelectOption<T>[]
  /** 读屏名称：行内可见标签不属于按钮文本，需显式提供 */
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: T]
  change: [value: T]
  /** 展开 / 收起：宿主可据此暂停自动隐藏工具栏等定时逻辑 */
  open: []
  close: []
  /** 触发器悬停 / 聚焦：透出锚点元素，宿主据此展示自定义提示框 */
  'trigger-enter': [anchor: HTMLElement]
  /** 触发器移出 / 失焦 / 菜单展开：宿主收起提示框 */
  'trigger-leave': []
}>()

/** 触发器与弹层间距 */
const TRIGGER_GAP = 6
/** 弹层与视口的安全边距 */
const VIEWPORT_MARGIN = 8

const uid = nextMenuId()
const listId = `${uid}-listbox`

const rootEl = ref<HTMLDivElement | null>(null)
const triggerEl = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLUListElement | null>(null)

const open = ref(false)
const activeIndex = ref(-1)
const menuStyle = ref<Record<string, string>>({})

const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? String(props.modelValue)
)
const activeDescendant = computed(() =>
  open.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined
)

function optionId(index: number): string {
  return `${uid}-option-${index}`
}

function toggle() {
  if (open.value) close()
  else void openMenu()
}

async function openMenu() {
  if (props.disabled || !props.options.length) return
  // 下拉弹层紧贴触发器下方（gap 6px），提示框必须立即收起，避免两者叠在一起
  emit('trigger-leave')
  activeIndex.value = initialActiveIndex(props.options, props.modelValue)
  open.value = true
  emit('open')
  await nextTick()
  // 打开后立刻关闭（快速连点）时不再挂监听，避免泄漏
  if (!open.value) return
  updatePosition()
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
}

/**
 * 关闭弹层。
 * @param restoreFocus 提交 / Esc 时把焦点还给触发器；外部点击与 Tab 不抢焦点
 */
function close(restoreFocus = false) {
  if (!open.value) return
  open.value = false
  removeListeners()
  emit('close')
  if (restoreFocus) triggerEl.value?.focus()
}

function onTriggerLeave() {
  emit('trigger-leave')
}

/**
 * 触发器悬停 / 聚焦：菜单展开中或不可见焦点不上报。
 * 触屏由 shouldShowTip 过滤；透传元素而不是事件对象，避免宿主依赖原生派发的 currentTarget 时序。
 */
function onTriggerEnter(event: PointerEvent | FocusEvent) {
  const trigger = triggerEl.value
  if (open.value || !trigger) return
  const visible = shouldShowTip({
    type: event.type,
    pointerType: event instanceof PointerEvent ? event.pointerType : undefined,
    focusVisible: event.type === 'focus' ? trigger.matches(':focus-visible') : undefined,
  })
  if (visible) emit('trigger-enter', trigger)
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Node)) return
  // 弹层已 Teleport 到 body，不再位于 rootEl 内，需单独判定
  if (rootEl.value?.contains(target) || menuEl.value?.contains(target)) return
  close()
}

function removeListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
}

/** 测量触发器与弹层几何，写入 fixed 坐标；滚动 / 缩放时复用 */
function updatePosition() {
  const trigger = triggerEl.value
  const menu = menuEl.value
  if (!trigger || !menu) return

  const rect = trigger.getBoundingClientRect()
  const menuHeight = menu.offsetHeight
  const menuWidth = menu.offsetWidth
  const placement = resolveMenuPlacement({
    triggerTop: rect.top,
    triggerBottom: rect.bottom,
    menuHeight,
    viewportHeight: window.innerHeight,
    gap: TRIGGER_GAP,
    margin: VIEWPORT_MARGIN,
  })

  const top =
    placement === 'below' ? rect.bottom + TRIGGER_GAP : rect.top - TRIGGER_GAP - menuHeight
  // 右边缘对齐触发器，并收敛在视口安全边距内
  const left = clampMenuLeft(
    rect.right - menuWidth,
    menuWidth,
    document.documentElement.clientWidth,
    VIEWPORT_MARGIN
  )

  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    transformOrigin: placement === 'below' ? 'top right' : 'bottom right',
    // 进入位移方向跟随翻转：向下展开从上方滑入，向上展开从下方滑入
    '--select-pop-shift': placement === 'below' ? '-2px' : '2px',
  }
}

/** 消费按键：阻止默认行为并停止冒泡——阅读页在 window 上监听方向键 / Enter 翻页，触发器按键不能穿透 */
function consume(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      consume(event)
      void openMenu()
    }
    return
  }

  switch (event.key) {
    case 'ArrowDown':
      consume(event)
      moveActive(1)
      break
    case 'ArrowUp':
      consume(event)
      moveActive(-1)
      break
    case 'Home':
      consume(event)
      setActive(0)
      break
    case 'End':
      consume(event)
      setActive(props.options.length - 1)
      break
    case 'Enter':
    case ' ':
      consume(event)
      commitActive()
      break
    case 'Escape':
      consume(event)
      close(true)
      break
    case 'Tab':
      // 不拦截焦点移动，弹层只做关闭
      close()
      break
  }
}

function moveActive(delta: -1 | 1) {
  setActive(moveActiveIndex(activeIndex.value, delta, props.options.length))
}

function setActive(index: number) {
  if (!props.options.length) return
  activeIndex.value = Math.min(Math.max(index, 0), props.options.length - 1)
  // 键盘移动时保证高亮项在弹层内可见（当前选项很少，为后续扩展兜底）
  void nextTick(() => {
    const option = menuEl.value?.children[activeIndex.value] as HTMLElement | undefined
    option?.scrollIntoView({ block: 'nearest' })
  })
}

function commitActive() {
  const option = props.options[activeIndex.value]
  if (option) commit(option)
}

/** 提交选项：与原生 change 一致，重复选择当前项只关闭、不触发保存 */
function commit(option: SelectOption<T>) {
  close(true)
  if (option.value === props.modelValue) return
  // 先更新父级绑定值（v-model），再通知 change 保存
  emit('update:modelValue', option.value)
  emit('change', option.value)
}

onBeforeUnmount(removeListeners)
</script>

<style scoped>
.select-menu {
  display: inline-flex;
}

/* 触发器：对齐 macOS 弹出按钮——32px 高、7px 圆角、浅描边 + 极轻阴影。
   外观可定制变量（括号内为默认值），阅读页深色顶栏由 .zoom-select 覆盖为透明底白描边：
   --select-height(32px) --select-min-width(160px) --select-radius(7px) --select-padding(0 10px 0 12px)
   --select-font-size(13.5px) --select-bg(--surface) --select-color(--text) --select-border(--border)
   --select-shadow(--shadow-sm) --select-hover-bg(--surface-2) --select-hover-border(--text-muted)
   --select-open-bg(--surface) --select-focus-border(--brand) --select-focus-ring(--brand-soft)
   --select-chevron(--text-muted) --select-chevron-strong(--text-secondary) */
.select-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: var(--select-min-width, 160px);
  height: var(--select-height, 32px);
  box-sizing: border-box;
  padding: var(--select-padding, 0 10px 0 12px);
  font-size: var(--select-font-size, 13.5px);
  font-weight: 400;
  color: var(--select-color, var(--text));
  background: var(--select-bg, var(--surface));
  border: 1px solid var(--select-border, var(--border));
  border-radius: var(--select-radius, 7px);
  box-shadow: var(--select-shadow, var(--shadow-sm));
  transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

/* 全局 button:hover 只改底色，这里补触发器描边加深 */
.select-trigger:hover:not(:disabled) {
  background: var(--select-hover-bg, var(--surface-2));
  border-color: var(--select-hover-border, var(--text-muted));
}

/* 展开态：品牌描边 + 柔光环，同时覆盖全局悬停底色 */
.select-trigger[aria-expanded='true'],
.select-trigger[aria-expanded='true']:hover {
  background: var(--select-open-bg, var(--surface));
  border-color: var(--select-focus-border, var(--brand));
  box-shadow: 0 0 0 3px var(--select-focus-ring, var(--brand-soft));
}

/* 展开态已用描边 + 柔光环表达焦点，取消全局 focus ring 避免双环 */
.select-trigger[aria-expanded='true']:focus-visible {
  outline: none;
}

.select-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.select-chevron {
  flex: 0 0 auto;
  color: var(--select-chevron, var(--text-muted));
  transition: color 0.15s ease;
}

.select-trigger:hover:not(:disabled) .select-chevron,
.select-trigger[aria-expanded='true'] .select-chevron {
  color: var(--select-chevron-strong, var(--text-secondary));
}

/* 弹层：fixed 定位避开 .settings-view 滚动裁切，坐标由脚本写入 */
.select-pop {
  position: fixed;
  z-index: 50;
  box-sizing: border-box;
  min-width: 160px;
  max-height: 280px;
  margin: 0;
  padding: 5px;
  overflow-y: auto;
  list-style: none;
  background: var(--surface-alpha);
  backdrop-filter: blur(30px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--menu-shadow);
}

.select-option {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13.5px;
  color: var(--text);
  cursor: default;
  user-select: none;
}

.select-option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 勾选槽位常驻占位，未选中时隐藏，避免选中态文字左右跳动 */
.select-check {
  flex: 0 0 14px;
  color: var(--brand);
  opacity: 0;
}

.select-option.is-selected .select-check {
  opacity: 1;
}

/* 悬停 / 键盘高亮：macOS 菜单的品牌蓝圆角填充 */
.select-option.is-active {
  background: var(--brand);
  color: #fff;
}

.select-option.is-active .select-check {
  color: #fff;
}

/* 开合动效：从触发器一侧缩放淡入（transform-origin 由脚本按翻转方向写入） */
.select-pop-enter-active,
.select-pop-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.select-pop-enter-from,
.select-pop-leave-to {
  opacity: 0;
  /* 位移方向由脚本按翻转结果写入（见 updatePosition） */
  transform: scale(0.97) translateY(var(--select-pop-shift, -2px));
}

@media (prefers-reduced-motion: reduce) {
  .select-pop-enter-active,
  .select-pop-leave-active {
    transition: none;
  }
}
</style>
