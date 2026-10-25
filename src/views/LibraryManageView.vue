<template>
  <div class="manage-view">
    <header class="page-head">
      <button class="ghost" @click="router.push('/settings')">{{ t('common.back') }}</button>
      <h1>{{ t('manage.title') }}</h1>
      <span class="head-meta">{{ t('manage.total', { count: library.books.length }) }}</span>
    </header>

    <div class="page-body">
      <!-- 首屏加载骨架（后台 silent refresh 不触发） -->
      <template v-if="initialLoading">
        <div class="skeleton skeleton-toolbar"></div>
        <div class="skeleton skeleton-list"></div>
      </template>

      <div v-else-if="loadError" class="state-wrap">
        <p class="state-text">{{ loadError }}</p>
        <button class="primary" @click="load">{{ t('common.retry') }}</button>
      </div>

      <!-- 库空态 -->
      <div v-else-if="!library.books.length" class="state-wrap">
        <svg
          class="empty-icon"
          width="72"
          height="72"
          viewBox="0 0 48 48"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M10 14h20v24H10z" />
          <path d="M14 18h12" />
          <path d="M14 23h12" />
          <path d="M30 20h4a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H16" />
        </svg>
        <p class="state-text">{{ t('manage.empty.title') }}</p>
        <button class="primary" @click="router.push('/')">{{ t('manage.empty.action') }}</button>
      </div>

      <template v-else>
        <div class="toolbar">
          <input
            v-model="keyword"
            class="search-input"
            type="text"
            :placeholder="t('manage.searchPlaceholder')"
          />
          <SelectMenu
            v-model="collectionFilter"
            class="location-select"
            :options="LOCATION_OPTIONS"
            :label="t('manage.filter.location')"
          />
          <label class="select-all">
            <input
              type="checkbox"
              :checked="allSelected"
              :indeterminate="someSelected && !allSelected"
              :disabled="!rows.length"
              @change="toggleSelectAll"
            />
            {{ t('manage.selectAll') }}
          </label>
        </div>

        <section class="list-card">
          <div class="row-grid list-head">
            <span></span>
            <span></span>
            <span>{{ t('manage.column.title') }}</span>
            <span>{{ t('manage.column.location') }}</span>
            <span class="cell-time">{{ t('manage.column.addedAt') }}</span>
          </div>

          <!-- 整行即勾选热区：批量场景下点哪都能选中 -->
          <label
            v-for="row in rows"
            :key="row.book.id"
            class="row-grid row"
            :class="{ checked: isSelected(row.book.id) }"
          >
            <input
              type="checkbox"
              :checked="isSelected(row.book.id)"
              @change="toggleRow(row.book.id)"
            />
            <span class="thumb">
              <img v-if="row.book.coverUrl" :src="row.book.coverUrl" :alt="row.book.title" loading="lazy" />
              <svg
                v-else
                width="16"
                height="16"
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
            </span>
            <span class="cell-main">
              <span class="title" :title="row.book.title">{{ row.book.title }}</span>
              <span class="sub">
                <span>
                  {{ t('manage.meta', { format: row.book.format.toUpperCase(), pages: row.book.totalPages }) }}
                </span>
                <span v-if="row.book.missing" class="missing">{{ t('library.book.missingBadge') }}</span>
              </span>
            </span>
            <span
              class="cell-location"
              :class="{ home: !row.collectionTitle }"
              :title="row.collectionTitle ?? t('manage.location.home')"
            >
              {{ row.collectionTitle ?? t('manage.location.home') }}
            </span>
            <span class="cell-time">{{ formatAddedAt(row.book.addedAt) }}</span>
          </label>

          <p v-if="!rows.length" class="no-match">{{ t('manage.empty.noMatch') }}</p>
        </section>

        <!-- 常驻选择条：跨筛选累积时提示不可见项数量，避免误删 -->
        <div v-if="selected.length" class="selection-bar">
          <span class="selection-count">
            {{ tp('manage.selected', selected.length) }}
            <em v-if="outOfViewCount">{{ tp('manage.selectedOutOfView', outOfViewCount) }}</em>
          </span>
          <div class="selection-actions">
            <button class="ghost" @click="clearSelection">{{ t('manage.clearSelection') }}</button>
            <button class="danger-fill" @click="dialogOpen = true">
              {{ t('manage.deleteSelected') }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <BatchRemoveDialog
      v-if="dialogOpen"
      :books="selectedBooks"
      @cancel="dialogOpen = false"
      @confirm="confirmRemove"
    />

    <transition name="toast-fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup lang="ts">
// 漫画批量管理页：列表（封面 / 名称 / 所属位置 / 导入时间）+ 位置与关键字筛选 + 批量删除
// 对应设计文档 specs/漫画批量管理设计方案-20261025.md §8.3 / §9
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Book } from '../../shared/types'
import { useLibraryStore } from '../stores/library'
import { IpcError } from '../services/ipc'
import { buildManageRows, filterManageRows, formatAddedAt } from '../services/libraryManage'
import type { CollectionFilter } from '../services/libraryManage'
import { removeFromQueue } from '../services/coverQueue'
import type { SelectOption } from '../services/selectMenu'
import SelectMenu from '../components/ui/SelectMenu.vue'
import BatchRemoveDialog from '../components/library/BatchRemoveDialog.vue'
import { t, tp } from '../i18n'
import { localizeError } from '../i18n/errors'

const router = useRouter()
const library = useLibraryStore()

/** 关键字只用于本页（不复用 library.keyword，避免污染文库主页搜索） */
const keyword = ref('')
const collectionFilter = ref<CollectionFilter>('all')
const selected = ref<number[]>([])
const dialogOpen = ref(false)
const initialLoading = ref(true)
const loadError = ref('')
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

/** 位置下拉：全部 / 主页 / 各合集；文案随语言与合集列表变化 */
const LOCATION_OPTIONS = computed<SelectOption<CollectionFilter>[]>(() => [
  { value: 'all', label: t('manage.filter.all') },
  { value: 'ungrouped', label: t('manage.filter.ungrouped') },
  ...library.collections.map((c) => ({ value: c.id, label: c.title })),
])

const allRows = computed(() => buildManageRows(library.books, library.collections))
const rows = computed(() => filterManageRows(allRows.value, keyword.value, collectionFilter.value))

const isSelected = (id: number) => selected.value.includes(id)

const allSelected = computed(
  () => rows.value.length > 0 && rows.value.every((row) => isSelected(row.book.id))
)
const someSelected = computed(() => rows.value.some((row) => isSelected(row.book.id)))

/** 已选但不在当前筛选结果中的数量（跨筛选保留选择时提示用） */
const outOfViewCount = computed(() => {
  const visible = new Set(rows.value.map((row) => row.book.id))
  return selected.value.filter((id) => !visible.has(id)).length
})

/** 弹窗入参：按勾选顺序取书对象，过滤已被删除的 id */
const selectedBooks = computed(() => {
  const byId = new Map(library.books.map((book) => [book.id, book]))
  return selected.value.map((id) => byId.get(id)).filter((book): book is Book => Boolean(book))
})

function toggleRow(id: number) {
  selected.value = isSelected(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}

/** 全选 / 反选只作用于当前筛选结果 */
function toggleSelectAll() {
  const ids = rows.value.map((row) => row.book.id)
  if (allSelected.value) {
    selected.value = selected.value.filter((id) => !ids.includes(id))
  } else {
    selected.value = [...new Set([...selected.value, ...ids])]
  }
}

function clearSelection() {
  selected.value = []
}

function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3500)
}

async function load() {
  loadError.value = ''
  try {
    await library.refresh()
  } catch (e) {
    loadError.value = t('manage.loadFailed', { message: localizeError(e) })
  } finally {
    initialLoading.value = false
  }
}

async function confirmRemove(deleteFile: boolean) {
  dialogOpen.value = false
  const ids = selectedBooks.value.map((book) => book.id)
  if (!ids.length) return
  try {
    for (const id of ids) removeFromQueue(id) // 取消仍在排队的封面生成
    const removed = await library.removeMany(ids, deleteFile)
    selected.value = []
    if (removed.length) {
      showToast(tp(deleteFile ? 'manage.toast.removedWithFile' : 'manage.toast.removed', removed.length))
    }
  } catch (e) {
    selected.value = []
    showToast(e instanceof IpcError ? localizeError(e) : t('error.UNKNOWN'))
  }
}

// 合集被解散后当前筛选值失效：回退「全部」，避免下拉显示空白且列表恒空
watch(
  () => library.collections,
  (list) => {
    if (
      typeof collectionFilter.value === 'number' &&
      !list.some((c) => c.id === collectionFilter.value)
    ) {
      collectionFilter.value = 'all'
    }
  }
)

// 书被别处删除（含本次删除触发的 library:changed 刷新）后剔除失效的已选 id
watch(
  () => library.books,
  (books) => {
    const alive = new Set(books.map((book) => book.id))
    if (selected.value.some((id) => !alive.has(id))) {
      selected.value = selected.value.filter((id) => alive.has(id))
    }
  }
)

onMounted(() => {
  void load()
  library.subscribeChanges()
})

onUnmounted(() => {
  library.unsubscribeChanges()
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<style scoped>
.manage-view {
  height: 100vh;
  overflow-y: auto;
  background: var(--page-veil), url('/bg001.jpg') center / cover no-repeat, var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
}

/* 内容区撑满页头以下高度，选择条用 margin-top:auto 贴底（sticky 保持滚动时可见） */
.page-body {
  box-sizing: border-box;
  width: 100%;
  max-width: 880px;
  min-height: calc(100vh - 72px);
  /* 不参与收缩：本页滚动源是 .manage-view，页体一旦被 flex 压到视口高度，
     下面的 .list-card（overflow: hidden，自动最小尺寸为 0）也会被压扁并把行裁掉，
     整页既看不见剩余行、也没有可滚动高度（书多时列表无法下滑） */
  flex-shrink: 0;
  margin: 0 auto;
  padding: 20px 40px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.head-meta {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

/* —— 工具栏 —— */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.search-input {
  flex: 1;
  max-width: 320px;
}

.location-select {
  /* 触发器的 min-width 由组件读取该变量（默认 160px），略放宽以容纳长合集名 */
  --select-min-width: 168px;
}

.select-all {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

/* 行内 checkbox 样式与 AddBooksDialog / 设置页保持一致 */
.select-all input,
.row input[type='checkbox'] {
  accent-color: var(--brand);
  margin: 0;
  flex-shrink: 0;
}

/* —— 列表 —— */
.list-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
}

.row-grid {
  display: grid;
  grid-template-columns: 28px 40px minmax(0, 1fr) 140px 132px;
  gap: 14px;
  align-items: center;
}

.list-head {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.row {
  box-sizing: border-box;
  min-height: 76px;
  padding: 10px 16px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.row:not(:last-child) {
  border-bottom: 1px solid var(--border);
}

.row:hover {
  background: var(--surface-2);
}

/* 选中行：先写兜底色，再由 color-mix 叠品牌色（不支持时回退上一行声明） */
.row.checked {
  background: var(--surface-2);
  background: color-mix(in srgb, var(--brand) 8%, transparent);
}

.thumb {
  width: 40px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--placeholder);
  color: var(--text-muted);
  overflow: hidden;
}

.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cell-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.title {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
}

.missing {
  color: var(--danger);
}

.cell-location {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-location.home {
  color: var(--text-muted);
}

.cell-time {
  font-size: 12.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.no-match {
  margin: 0;
  padding: 32px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-muted);
}

/* —— 选择条 —— */
.selection-bar {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: var(--surface-alpha);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-sm);
}

.selection-count {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.selection-count em {
  margin-left: 8px;
  font-style: normal;
  color: var(--text-muted);
}

.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* —— 状态位 —— */
.state-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding-bottom: 80px;
}

.state-text {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.empty-icon {
  color: var(--text-faint);
}

/* —— 骨架屏（pulse 为组件内 keyframes，不跨 scoped 复用） —— */
.skeleton {
  background: var(--surface-2);
  border: 1px solid var(--border);
  animation: pulse 1.4s ease-in-out infinite;
}

.skeleton-toolbar {
  height: 56px;
  border-radius: 14px;
}

.skeleton-list {
  height: 380px;
  border-radius: 14px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
  }
}

/* —— 通知条 —— */
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 200;
  padding: 10px 18px;
  border-radius: var(--radius);
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: 13px;
  box-shadow: var(--shadow-md);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
}
</style>
