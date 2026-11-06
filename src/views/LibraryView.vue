<template>
  <div class="library-view">
    <!-- 首屏 hero：一个核心价值、一句副标题、一个主要操作 -->
    <section v-if="!activeCollection" class="hero">
      <!-- 背景图为整窗底图（.library-view 承载）；此处深色渐变保障白字可读 -->
      <div class="hero-veil" aria-hidden="true" />
      <div class="hero-inner">
        <h1 class="hero-title">{{ t('library.title') }}</h1>
        <p class="hero-sub">{{ t('library.subtitle') }}</p>
        <div class="hero-actions">
          <button class="btn-primary" @click="onImportFiles">{{ t('library.import') }}</button>
          <button class="hero-ghost" @click="onImportFolder">{{ t('library.importFolder') }}</button>
        </div>
      </div>
    </section>

    <!-- 合集视图头部：返回 / 标题 / 数量 / 重命名 / 解散 -->
    <header v-else class="collection-head">
      <button class="ghost" @click="backHome">{{ t('common.back') }}</button>
      <div class="collection-head-info">
        <h1 class="collection-title">{{ activeCollection.title }}</h1>
        <span class="collection-meta">
          {{ tp('library.collection.meta', collectionBooks.length) }}
        </span>
      </div>
      <button class="ghost head-action" @click="askRenameCollection">
        {{ t('library.collection.rename') }}
      </button>
      <button class="ghost danger-text" @click="askDissolve">
        {{ dissolveArmed ? t('library.collection.dissolveConfirm') : t('library.collection.dissolve') }}
      </button>
    </header>

    <!-- 合集视图工具行：导入直入合集 / 从主页多选添加 -->
    <div v-if="activeCollection" class="toolbar collection-toolbar">
      <button class="btn-primary" @click="onImportFiles">{{ t('library.import') }}</button>
      <button @click="onImportFolder">{{ t('library.importFolder') }}</button>
      <button @click="addFromHome = true">{{ t('library.collection.addFromHome') }}</button>
    </div>

    <!-- 工具行：搜索 / 排序 / 新建合集 / 设置 -->
    <div v-if="!activeCollection" class="toolbar">
      <input
        v-model="library.keyword"
        class="search-input"
        type="text"
        :placeholder="t('library.search.placeholder')"
      />
      <div class="toolbar-group">
        <SelectMenu
          v-model="library.sortBy"
          class="sort-select"
          :options="SORT_OPTIONS"
          :label="t('library.sort.label')"
        />
        <button class="order-btn" @click="toggleOrder">
          {{ library.sortOrder === 'asc' ? t('library.order.asc') : t('library.order.desc') }}
        </button>
        <span v-if="library.keyword" class="result-count">
          {{ resultSummary }}
        </span>
      </div>
      <button class="ghost" @click="creatingCollection = true">{{ t('library.newCollection') }}</button>
      <RouterLink class="settings-link" to="/settings">{{ t('library.settings') }}</RouterLink>
    </div>

    <section v-if="library.loading" class="state-tip">{{ t('library.loading') }}</section>

    <!-- 合集视图：左侧集内书（名称升序，× = 移出合集）+ 右侧“继续阅读”栏 -->
    <div v-else-if="activeCollection" class="collection-body">
      <div class="collection-main">
        <section class="book-grid">
          <BookCard
            v-for="book in collectionBooks"
            :key="book.id"
            :book="book"
            :remove-label="t('library.collection.removeLabel')"
            @open="openBook"
            @remove="removeFromCollection"
            @rename="askRename"
            @move="askMove"
          />
          <p v-if="!collectionBooks.length" class="empty-inline">
            {{ t('library.collection.empty') }}
          </p>
        </section>
      </div>

      <aside class="collection-side">
        <h2 class="side-title">{{ t('library.collection.sideTitle') }}</h2>
        <div class="side-center">
          <ContinueReadingBook
            v-if="sideBook"
            :book="sideBook"
            :phase="sidePhase"
            @open="openBook"
          />
          <p v-else class="side-empty">{{ t('library.collection.noBooks') }}</p>
        </div>
        <div v-if="sideBook" class="side-nav">
          <button :disabled="sideSwitching || sideIndex <= 0" @click="shiftSideBook(-1)">
            {{ t('library.collection.prev') }}
          </button>
          <button
            :disabled="sideSwitching || sideIndex >= collectionBooks.length - 1"
            @click="shiftSideBook(1)"
          >
            {{ t('library.collection.next') }}
          </button>
        </div>
      </aside>
    </div>

    <!-- 主页：合集卡片始终排在图书卡片之前，两类各自走当前排序偏好 -->
    <section
      v-else-if="ungroupedBooks.length || library.sortedCollections.length"
      class="book-grid"
    >
      <CollectionCard
        v-for="c in library.sortedCollections"
        :key="'c' + c.id"
        :collection="c"
        :books="booksInCollection(c.id)"
        @open="openCollection"
      />
      <BookCard
        v-for="book in ungroupedBooks"
        :key="book.id"
        :book="book"
        @open="openBook"
        @remove="askRemove"
        @rename="askRename"
        @move="askMove"
      />
    </section>

    <section v-else class="state-tip empty">
      <p>{{ library.keyword ? t('library.empty.noMatch') : t('library.empty.title') }}</p>
      <div v-if="!library.keyword" class="empty-actions">
        <button class="btn-primary" @click="onImportFiles">{{ t('library.importPlain') }}</button>
        <button class="ghost" @click="onImportFolder">{{ t('library.importFolder') }}</button>
      </div>
    </section>

    <footer v-if="coverQueueState.pending > 0" class="cover-progress">
      {{
        t('library.coverGenerating', {
          done: coverQueueState.done + 1,
          total: coverQueueState.total,
          title: coverQueueState.currentTitle ?? '',
        })
      }}
    </footer>

    <transition name="toast-fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>

    <RemoveConfirmDialog
      v-if="pendingRemoveBook"
      :book="pendingRemoveBook"
      @cancel="pendingRemoveBook = null"
      @confirm="confirmRemove"
    />

    <MissingFileDialog
      v-if="missingBook"
      :book="missingBook"
      @cancel="missingBook = null"
      @relink="relinkMissing"
      @remove="removeMissing"
    />

    <TextPromptDialog
      v-if="renamingBook"
      :title="t('library.rename.title')"
      :initial-value="renamingBook.title"
      :placeholder="t('library.rename.placeholder')"
      @cancel="renamingBook = null"
      @confirm="confirmRename"
    />

    <!-- 新建合集 -->
    <TextPromptDialog
      v-if="creatingCollection"
      :title="t('library.newCollection.title')"
      initial-value=""
      :placeholder="t('library.newCollection.placeholder')"
      @cancel="creatingCollection = false"
      @confirm="confirmCreateCollection"
    />

    <!-- 重命名合集：复用文本输入对话框，与新建合集同一交互 -->
    <TextPromptDialog
      v-if="renamingCollection"
      :title="t('library.collection.renameTitle')"
      :initial-value="renamingCollection.title"
      :placeholder="t('library.collection.renamePlaceholder')"
      @cancel="renamingCollection = null"
      @confirm="confirmRenameCollection"
    />

    <!-- 移入合集 -->
    <CollectionPickerDialog
      v-if="movingBook"
      :book="movingBook"
      :collections="library.collections"
      :books="library.books"
      @close="movingBook = null"
      @select="confirmMove"
      @create="confirmCreateAndMove"
    />

    <!-- 从主页多选添加到当前合集 -->
    <AddBooksDialog
      v-if="activeCollection && addFromHome"
      :books="ungroupedBooks"
      :collection-title="activeCollection.title"
      @close="addFromHome = false"
      @confirm="confirmAddFromHome"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Book, Collection, SortBy } from '../../shared/types'
import { useLibraryStore } from '../stores/library'
import { IpcError, ipc } from '../services/ipc'
import { coverQueueState, enqueueCovers, removeFromQueue } from '../services/coverQueue'
import type { SelectOption } from '../services/selectMenu'
import SelectMenu from '../components/ui/SelectMenu.vue'
import BookCard from '../components/library/BookCard.vue'
import ContinueReadingBook from '../components/library/ContinueReadingBook.vue'
import CollectionCard from '../components/library/CollectionCard.vue'
import CollectionPickerDialog from '../components/library/CollectionPickerDialog.vue'
import AddBooksDialog from '../components/library/AddBooksDialog.vue'
import RemoveConfirmDialog from '../components/library/RemoveConfirmDialog.vue'
import MissingFileDialog from '../components/library/MissingFileDialog.vue'
import TextPromptDialog from '../components/library/TextPromptDialog.vue'
import { appLocale, t, tp } from '../i18n'
import { localizeError } from '../i18n/errors'
import { compareTitles } from '../services/libraryList'
import { SIDE_CLOSE_MS, SIDE_ENTER_MS, type SideBookPhase } from '../services/sideBookTransition'

const library = useLibraryStore()
const router = useRouter()
const route = useRoute()

// 排序下拉选项：value 与 SortBy 对齐，SelectMenu 泛型据此推断
const SORT_OPTIONS = computed<SelectOption<SortBy>[]>(() => [
  { value: 'lastOpenedAt', label: t('library.sort.recent') },
  { value: 'addedAt', label: t('library.sort.added') },
  { value: 'title', label: t('library.sort.title') },
])

// —— 通知条 ——
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
function showToast(message: string) {
  toast.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3500)
}

/** 刷新后把待生成封面的书加入队列（同时覆盖启动时上次未完成的生成） */
async function refreshAndQueueCovers() {
  await library.refresh()
  enqueueCovers(library.books)
}

onMounted(() => {
  void refreshAndQueueCovers()
  library.subscribeChanges()
  // 从 URL 恢复合集视图：阅读器返回时携带 ?collection=<id>（阅读器 goBack 写入）
  const q = route.query.collection
  if (typeof q === 'string' && q && Number.isFinite(Number(q))) {
    activeCollectionId.value = Number(q)
  }
})

onUnmounted(() => {
  library.unsubscribeChanges()
  clearSideTimers()
})

// —— 导入（主页导入到未分组；合集视图内导入直接归属当前合集） ——
async function onImportFiles() {
  const paths = await ipc.dialog.pickBookFiles()
  if (paths && paths.length) await importAndReport(paths, activeCollectionId.value)
}

async function onImportFolder() {
  const dir = await ipc.dialog.pickFolder()
  if (dir) await importAndReport([dir], activeCollectionId.value)
}

async function importAndReport(paths: string[], collectionId: number | null = null) {
  const result = await library.importPaths(paths, collectionId)
  enqueueCovers(result.added)
  const target = collectionId !== null ? library.collections.find((c) => c.id === collectionId) : null
  const count = result.added.length
  // 四组合：是否指定合集 × 是否有跳过
  if (target) {
    showToast(
      result.skipped
        ? tp('library.toast.importedToSkipped', count, { title: target.title, skipped: result.skipped })
        : tp('library.toast.importedTo', count, { title: target.title })
    )
    return
  }
  showToast(
    result.skipped
      ? tp('library.toast.importedSkipped', count, { skipped: result.skipped })
      : tp('library.toast.imported', count)
  )
}

// —— 从主页多选添加到当前合集 ——
const addFromHome = ref(false)

async function confirmAddFromHome(bookIds: number[]) {
  addFromHome.value = false
  const collection = activeCollection.value
  if (!collection || !bookIds.length) return
  await library.moveToCollection(bookIds, collection.id)
  showToast(tp('library.toast.addedToCollection', bookIds.length, { title: collection.title }))
}

// —— 打开（缺失拦截）——
function openBook(bookId: number) {
  const book = library.books.find((b) => b.id === bookId)
  if (book?.missing) {
    missingBook.value = book
    return
  }
  // 携带来源合集：返回时能回到合集视图而非主页
  router.push({
    path: `/reader/${bookId}`,
    query:
      activeCollectionId.value != null
        ? { cid: String(activeCollectionId.value) }
        : {},
  })
}

// —— 移除（二次确认，§6.2 deleteFile 需前端确认）——
const pendingRemoveBook = ref<Book | null>(null)

function askRemove(bookId: number) {
  pendingRemoveBook.value = library.books.find((b) => b.id === bookId) ?? null
}

async function confirmRemove(deleteFile: boolean) {
  const book = pendingRemoveBook.value
  pendingRemoveBook.value = null
  if (!book) return
  removeFromQueue(book.id)
  await library.remove(book.id, deleteFile)
  showToast(t(deleteFile ? 'library.toast.removedWithFile' : 'library.toast.removed', { title: book.title }))
}

// —— 缺失重定位（§8.2：重新定位/移除/取消）——
const missingBook = ref<Book | null>(null)

async function relinkMissing() {
  const book = missingBook.value
  missingBook.value = null
  if (!book) return
  const paths = await ipc.dialog.pickBookFiles()
  if (!paths?.length) return
  await library.relink(book.id, paths[0])
  showToast(t('library.toast.relinked', { title: book.title }))
}

async function removeMissing() {
  const book = missingBook.value
  missingBook.value = null
  if (!book) return
  removeFromQueue(book.id)
  await library.remove(book.id)
  showToast(t('library.toast.removed', { title: book.title }))
}

// —— 重命名 ——
const renamingBook = ref<Book | null>(null)

function askRename(bookId: number) {
  renamingBook.value = library.books.find((b) => b.id === bookId) ?? null
}

async function confirmRename(title: string) {
  const book = renamingBook.value
  renamingBook.value = null
  if (!book) return
  await library.rename(book.id, title)
  showToast(t('library.toast.renamed', { title }))
}

// —— 排序方向 ——
function toggleOrder() {
  library.sortOrder = library.sortOrder === 'asc' ? 'desc' : 'asc'
}

// —— 合集视图与主页派生数据 ——
const activeCollectionId = ref<number | null>(null)
const activeCollection = computed(
  () => library.collections.find((c) => c.id === activeCollectionId.value) ?? null
)

/** 主页网格中的书：仅未分组，走用户排序偏好（filteredBooks 已排序） */
const ungroupedBooks = computed(() => library.filteredBooks.filter((b) => !b.collectionId))

/** 搜索态结果提示：合集数 + 全库命中书数（含合集内），为零的侧不显示 */
const resultSummary = computed(() => {
  const parts: string[] = []
  const collectionCount = library.sortedCollections.length
  const bookCount = library.filteredBooks.length
  if (collectionCount) parts.push(tp('common.collectionCount', collectionCount))
  if (bookCount) parts.push(tp('common.bookCount', bookCount))
  return parts.length ? parts.join(' · ') : t('library.result.none')
})

/** 合集视图内的书：固定名称升序（与封面取书规则一致） */
const collectionBooks = computed(() =>
  library.books
    .filter((b) => b.collectionId === activeCollectionId.value)
    .sort((a, b) => compareTitles(a.title, b.title, appLocale.value))
)

// —— 右侧“继续阅读”栏：默认显示合集内最近阅读的一本，
//    可用上一本/下一本在名称升序书单中移动焦点 ——
const sideCursor = ref<number | null>(null) // null = 跟随「最近阅读」

const sideDefaultIndex = computed(() => {
  let best = 0
  let bestAt = -1
  collectionBooks.value.forEach((b, i) => {
    if (b.lastOpenedAt != null && b.lastOpenedAt > bestAt) {
      bestAt = b.lastOpenedAt
      best = i
    }
  })
  return best
})

const sideIndex = computed(() => sideCursor.value ?? sideDefaultIndex.value)

const sideBook = computed(() => collectionBooks.value[sideIndex.value] ?? null)

// —— 换书过渡：旧书合上下沉 → 换焦点 → 新书上浮入场（组件只消费阶段） ——
const sidePhase = ref<SideBookPhase>('idle')
const sideSwitching = ref(false)

/** 一次性判定：与 CardTilt / StatCard / ReaderView 一致，不监听媒体变化 */
const reducedMotion =
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 过渡计时器：卸载时统一清空，避免销毁后仍写 ref */
const sideTimers = new Set<ReturnType<typeof setTimeout>>()

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sideTimers.delete(timer)
      resolve()
    }, ms)
    sideTimers.add(timer)
  })
}

function clearSideTimers(): void {
  for (const timer of sideTimers) clearTimeout(timer)
  sideTimers.clear()
}

async function shiftSideBook(delta: 1 | -1) {
  if (sideSwitching.value) return // 连点合并，避免动画堆叠
  const next = sideIndex.value + delta
  if (next < 0 || next >= collectionBooks.value.length) return
  if (reducedMotion) {
    sideCursor.value = next
    return
  }
  sideSwitching.value = true
  sidePhase.value = 'closing'
  await wait(SIDE_CLOSE_MS)
  sideCursor.value = next
  sidePhase.value = 'entering'
  await wait(SIDE_ENTER_MS)
  sidePhase.value = 'idle'
  sideSwitching.value = false
}

function booksInCollection(collectionId: number): Book[] {
  return library.books.filter((b) => b.collectionId === collectionId)
}

function openCollection(collectionId: number) {
  activeCollectionId.value = collectionId
  dissolveArmed.value = false
  sideCursor.value = null // 回到「最近阅读」焦点
  router.push({ query: { collection: String(collectionId) } })
}

function backHome() {
  activeCollectionId.value = null
  dissolveArmed.value = false
  router.push({ query: {} })
}

// —— 新建合集 ——
const creatingCollection = ref(false)

async function confirmCreateCollection(title: string) {
  creatingCollection.value = false
  await library.createCollection(title)
  showToast(t('library.toast.collectionCreated', { title }))
}

// —— 重命名合集（只改名称，成员与封面不受影响） ——
const renamingCollection = ref<Collection | null>(null)

function askRenameCollection() {
  renamingCollection.value = activeCollection.value
}

async function confirmRenameCollection(title: string) {
  const collection = renamingCollection.value
  renamingCollection.value = null
  if (!collection) return
  try {
    await library.renameCollection(collection.id, title)
    showToast(t('library.toast.collectionRenamed', { title }))
  } catch (e) {
    // 极端场景：对话框打开期间合集已在别处被解散，主进程回 INVALID_PARAMS
    showToast(e instanceof IpcError ? localizeError(e) : t('error.UNKNOWN'))
  }
}

// —— 移入合集 ——
const movingBook = ref<Book | null>(null)

function askMove(bookId: number) {
  movingBook.value = library.books.find((b) => b.id === bookId) ?? null
}

async function confirmMove(collectionId: number | null) {
  const book = movingBook.value
  movingBook.value = null
  if (!book) return
  await library.moveToCollection([book.id], collectionId)
  if (collectionId === null) {
    showToast(t('library.toast.movedToUngrouped', { title: book.title }))
    return
  }
  const target = library.collections.find((c) => c.id === collectionId)
  showToast(t('library.toast.movedToCollection', { title: book.title, collection: target?.title ?? '' }))
}

/** 对话框内“新建并移入”：先建合集再移动，一步完成 */
async function confirmCreateAndMove(title: string) {
  const book = movingBook.value
  movingBook.value = null
  if (!book) return
  const created = await library.createCollection(title)
  await library.moveToCollection([book.id], created.id)
  showToast(t('library.toast.createdAndMoved', { title, book: book.title }))
}

// —— 合集视图内移出（轻操作，不弹确认） ——
async function removeFromCollection(bookId: number) {
  const book = library.books.find((b) => b.id === bookId)
  if (!book) return
  await library.moveToCollection([bookId], null)
  showToast(t('library.toast.movedToUngrouped', { title: book.title }))
}

// —— 解散合集（成员回未分组；二次点击确认防误触） ——
const dissolveArmed = ref(false)
let dissolveTimer: ReturnType<typeof setTimeout> | null = null

function askDissolve() {
  if (!dissolveArmed.value) {
    dissolveArmed.value = true
    if (dissolveTimer) clearTimeout(dissolveTimer)
    dissolveTimer = setTimeout(() => (dissolveArmed.value = false), 3000)
    return
  }
  if (dissolveTimer) clearTimeout(dissolveTimer)
  const collection = activeCollection.value
  const id = activeCollectionId.value
  dissolveArmed.value = false
  activeCollectionId.value = null
  router.push({ query: {} })
  if (collection && id !== null) {
    void library.dissolveCollection(id)
    showToast(t('library.toast.dissolved', { title: collection.title }))
  }
}
</script>

<style scoped>
.library-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  /* 整窗背景：主题纱罩 + bg001.jpg 铺满 + 底色兜底（阅读页不受影响，自覆恒黑） */
  background: var(--page-veil), url('/bg001.jpg') center / cover no-repeat, var(--bg);
  color: var(--text);
}

/* —— hero：核心价值区（固定高度；背景图为整窗底图，此处叠深色渐变保障白字） —— */
.hero {
  position: relative;
  overflow: hidden;
  padding: 52px 40px 44px;
}

/* 深色渐变遮罩层：保障 hero 白字可读 */
.hero-veil {
  position: absolute;
  inset: 0;
  background: var(--hero-veil);
  pointer-events: none;
}

.hero-inner {
  position: relative;
  z-index: 1;
}

.hero-title {
  font-size: 30px;
  letter-spacing: 0.5px;
  color: #fff;
}

.hero-sub {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.78);
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}

.hero-ghost {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.35);
  color: rgba(255, 255, 255, 0.88);
}

.hero-ghost:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.55);
  color: #fff;
}

/* —— 合集视图两栏布局：左网格 + 右“继续阅读”栏 ——
   book-grid 原先直接是 .library-view 的 flex 子项（flex:1 占满视口剩余并自滚动）；
   插入 body/main 两层后必须把 flex 高度链逐层传下去（flex:1 + min-height:0），
   否则网格的 flex:1 失去参照而坍缩，一本书都看不见 */
.collection-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.collection-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.collection-side {
  width: 260px;
  flex-shrink: 0;
  padding: 20px 24px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.side-title {
  align-self: flex-start;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* 中间区：立体书 + 书名垂直居中 */
.side-center {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* 立体书的视觉与交互已迁至 components/library/ContinueReadingBook.vue
   （3D 硬皮封面 + 内页当前阅读页缩略图），此处只保留版式容器 */

.side-nav {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 0;
  flex-shrink: 0;
}

.side-nav button {
  font-size: 12.5px;
  padding: 5px 12px;
  white-space: nowrap;
}

.side-nav button:disabled {
  opacity: 0.4;
  cursor: default;
}

.side-empty {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

/* 窄屏让位给书网格 */
@media (max-width: 860px) {
  .collection-side {
    display: none;
  }
}

/* —— 合集视图头部：布局与标题字号走全局 .collection-head / .collection-title（style.css），
   此处只保留合集页独有的元素排版差异 —— */
.collection-head-info {
  flex: 1;
  min-width: 0;
  display: flex;
  /* meta 与标题垂直中心对齐（参考设置页页头元素的对齐方式），不再按基线对齐 */
  align-items: center;
  gap: 12px;
}

.collection-title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-meta {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.danger-text {
  color: var(--danger);
  flex-shrink: 0;
}

/* 页头右侧动作按钮：与标题争空间时不被压缩变形，间距由 .collection-head 的 gap 统一控制 */
.head-action {
  flex-shrink: 0;
}

.danger-text:hover {
  color: var(--danger-hover);
}

.collection-toolbar {
  border-bottom: 1px solid var(--border);
}

/* —— 工具行 —— */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 40px;
  background: var(--surface-alpha);
  backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
}

.search-input {
  flex: 1;
  max-width: 420px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.sort-select {
  /* 触发器的 min-width 由组件读取该变量（默认 160px），工具栏保持紧凑 */
  --select-min-width: 108px;
}

.order-btn {
  font-size: 12.5px;
  padding: 6px 10px;
  color: var(--text-secondary);
}

.result-count {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 40px;
}

.settings-link {
  font-size: 13.5px;
  color: var(--text-secondary);
  text-decoration: none;
  padding: 7px 12px;
  border-radius: var(--radius);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.settings-link:hover {
  background: var(--surface-2);
  color: var(--text);
}

/* —— 状态与网格 —— */
.state-tip {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.state-tip p {
  margin: 0;
}

.empty-actions {
  display: flex;
  gap: 10px;
}

.book-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
  padding: 24px 40px;
  /* 卡片按自身内容高度排列，避免同行等高拉伸出底部空白 */
  align-items: start;
  /* 容器被 flex:1 撑满视口高度时，默认 align-content:stretch 会把多余空间
     摊给每条行轨道，行高被拉长、卡片停在行顶，视觉上像行间距巨大；
     改为 start 让行轨道只占内容高度，从顶部紧密排列 */
  align-content: start;
}

.cover-progress {
  padding: 8px 40px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface);
  border-top: 1px solid var(--border);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-inline {
  grid-column: 1 / -1;
  margin: 0;
  padding: 48px 0;
  text-align: center;
  font-size: 14px;
  color: var(--text-muted);
}

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
