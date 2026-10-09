<template>
  <div class="library-view">
    <!-- 首屏 hero：一个核心价值、一句副标题、一个主要操作 -->
    <section v-if="!activeCollection" class="hero">
      <!-- 背景图为整窗底图（.library-view 承载）；此处深色渐变保障白字可读 -->
      <div class="hero-veil" aria-hidden="true" />
      <div class="hero-inner">
        <h1 class="hero-title">漫画文库</h1>
        <p class="hero-sub">本地离线阅读，随时接续上次的进度</p>
        <div class="hero-actions">
          <button class="btn-primary" @click="onImportFiles">＋ 导入漫画</button>
          <button class="hero-ghost" @click="onImportFolder">导入文件夹</button>
        </div>
      </div>
    </section>

    <!-- 合集视图头部：返回 / 标题 / 数量 / 解散 -->
    <header v-else class="collection-head">
      <button class="ghost" @click="backHome">← 返回</button>
      <div class="collection-head-info">
        <h1 class="collection-title">{{ activeCollection.title }}</h1>
        <span class="collection-meta">合集 · {{ collectionBooks.length }} 本 · 按名称排序</span>
      </div>
      <button class="ghost danger-text" @click="askDissolve">
        {{ dissolveArmed ? '确认解散？' : '解散合集' }}
      </button>
    </header>

    <!-- 合集视图工具行：导入直入合集 / 从主页多选添加 -->
    <div v-if="activeCollection" class="toolbar collection-toolbar">
      <button class="btn-primary" @click="onImportFiles">＋ 导入漫画</button>
      <button @click="onImportFolder">导入文件夹</button>
      <button @click="addFromHome = true">从主页添加</button>
    </div>

    <!-- 工具行：搜索 / 排序 / 新建合集 / 设置 -->
    <div v-if="!activeCollection" class="toolbar">
      <input
        v-model="library.keyword"
        class="search-input"
        type="text"
        placeholder="搜索书名…"
      />
      <div class="toolbar-group">
        <select v-model="library.sortBy" class="sort-select" title="排序方式">
          <option value="lastOpenedAt">最近阅读</option>
          <option value="addedAt">添加时间</option>
          <option value="title">书名</option>
        </select>
        <button class="order-btn" @click="toggleOrder">
          {{ library.sortOrder === 'asc' ? '↑ 升序' : '↓ 降序' }}
        </button>
        <span v-if="library.keyword" class="result-count">
          {{ library.filteredBooks.length }} 本
        </span>
      </div>
      <button class="ghost" @click="creatingCollection = true">＋ 新建合集</button>
      <RouterLink class="settings-link" to="/settings">设置</RouterLink>
    </div>

    <section v-if="library.loading" class="state-tip">加载中…</section>

    <!-- 合集视图：左侧集内书（名称升序，× = 移出合集）+ 右侧“继续阅读”栏 -->
    <div v-else-if="activeCollection" class="collection-body">
      <div class="collection-main">
        <section class="book-grid">
          <BookCard
            v-for="book in collectionBooks"
            :key="book.id"
            :book="book"
            remove-label="移出合集"
            @open="openBook"
            @remove="removeFromCollection"
            @rename="askRename"
            @move="askMove"
          />
          <p v-if="!collectionBooks.length" class="empty-inline">
            合集还是空的，回主页把漫画移进来吧
          </p>
        </section>
      </div>

      <aside class="collection-side">
        <h2 class="side-title">继续阅读</h2>
        <div class="side-center">
          <template v-if="sideBook">
            <div
              class="book-3d"
              :title="`打开《${sideBook.title}》`"
              @click="openBook(sideBook.id)"
            >
              <img
                v-if="sideBook.coverUrl"
                class="book-3d-cover"
                :src="sideBook.coverUrl"
                :alt="sideBook.title"
              />
              <div v-else class="book-3d-cover book-3d-placeholder">无封面</div>
              <!-- 书页厚度（右 + 底），营造立体感 -->
              <div class="book-3d-pages" aria-hidden="true" />
            </div>
            <p class="book-3d-name" :title="sideBook.title">{{ sideBook.title }}</p>
          </template>
          <p v-else class="side-empty">合集中还没有漫画</p>
        </div>
        <div v-if="sideBook" class="side-nav">
          <button :disabled="sideIndex <= 0" @click="shiftSideBook(-1)">‹ 上一本</button>
          <button
            :disabled="sideIndex >= collectionBooks.length - 1"
            @click="shiftSideBook(1)"
          >
            下一本 ›
          </button>
        </div>
      </aside>
    </div>

    <!-- 主页：合集卡片（名称升序）+ 未分组书（当前排序） -->
    <section v-else-if="ungroupedBooks.length || visibleCollections.length" class="book-grid">
      <CollectionCard
        v-for="c in visibleCollections"
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
      <p>{{ library.keyword ? '没有匹配的书' : '文库还是空的' }}</p>
      <div v-if="!library.keyword" class="empty-actions">
        <button class="btn-primary" @click="onImportFiles">导入漫画</button>
        <button class="ghost" @click="onImportFolder">导入文件夹</button>
      </div>
    </section>

    <footer v-if="coverQueueState.pending > 0" class="cover-progress">
      封面生成中 {{ coverQueueState.done + 1 }} / {{ coverQueueState.total }}：{{
        coverQueueState.currentTitle
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
      title="重命名"
      :initial-value="renamingBook.title"
      placeholder="输入新的书名"
      @cancel="renamingBook = null"
      @confirm="confirmRename"
    />

    <!-- 新建合集 -->
    <TextPromptDialog
      v-if="creatingCollection"
      title="新建合集"
      initial-value=""
      placeholder="输入合集名称"
      @cancel="creatingCollection = false"
      @confirm="confirmCreateCollection"
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
import type { Book } from '../../shared/types'
import { useLibraryStore } from '../stores/library'
import { ipc } from '../services/ipc'
import { coverQueueState, enqueueCovers, removeFromQueue } from '../services/coverQueue'
import BookCard from '../components/library/BookCard.vue'
import CollectionCard from '../components/library/CollectionCard.vue'
import CollectionPickerDialog from '../components/library/CollectionPickerDialog.vue'
import AddBooksDialog from '../components/library/AddBooksDialog.vue'
import RemoveConfirmDialog from '../components/library/RemoveConfirmDialog.vue'
import MissingFileDialog from '../components/library/MissingFileDialog.vue'
import TextPromptDialog from '../components/library/TextPromptDialog.vue'

const library = useLibraryStore()
const router = useRouter()
const route = useRoute()

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
})

// —— 导入（主页导入到未分组；合集视图内导入直接归属当前合集） ——
async function onImportFiles() {
  const paths = await ipc.dialog.pickPdfFiles()
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
  showToast(
    `已导入 ${result.added.length} 本${target ? `至「${target.title}」` : ''}${
      result.skipped ? `，跳过 ${result.skipped} 本（已存在）` : ''
    }`
  )
}

// —— 从主页多选添加到当前合集 ——
const addFromHome = ref(false)

async function confirmAddFromHome(bookIds: number[]) {
  addFromHome.value = false
  const collection = activeCollection.value
  if (!collection || !bookIds.length) return
  await library.moveToCollection(bookIds, collection.id)
  showToast(`已添加 ${bookIds.length} 本至「${collection.title}」`)
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
  showToast(deleteFile ? `已移除并删除《${book.title}》` : `已移除《${book.title}》`)
}

// —— 缺失重定位（§8.2：重新定位/移除/取消）——
const missingBook = ref<Book | null>(null)

async function relinkMissing() {
  const book = missingBook.value
  missingBook.value = null
  if (!book) return
  const paths = await ipc.dialog.pickPdfFiles()
  if (!paths?.length) return
  await library.relink(book.id, paths[0])
  showToast(`已重新定位《${book.title}》`)
}

async function removeMissing() {
  const book = missingBook.value
  missingBook.value = null
  if (!book) return
  removeFromQueue(book.id)
  await library.remove(book.id)
  showToast(`已移除《${book.title}》`)
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
  showToast(`已重命名为《${title}》`)
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

/** 主页展示的合集卡：按名称升序，不参与书的排序偏好 */
const visibleCollections = computed(() =>
  [...library.collections].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
)

/** 主页网格中的书：仅未分组，走用户排序偏好（filteredBooks 已排序） */
const ungroupedBooks = computed(() => library.filteredBooks.filter((b) => !b.collectionId))

/** 合集视图内的书：固定名称升序（与封面取书规则一致） */
const collectionBooks = computed(() =>
  library.books
    .filter((b) => b.collectionId === activeCollectionId.value)
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'))
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

function shiftSideBook(delta: 1 | -1) {
  const next = sideIndex.value + delta
  if (next < 0 || next >= collectionBooks.value.length) return
  sideCursor.value = next
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
  showToast(`已创建合集「${title}」`)
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
  showToast(
    collectionId === null
      ? `已将《${book.title}》移回未分组`
      : `已将《${book.title}》移入「${library.collections.find((c) => c.id === collectionId)?.title ?? '合集'}」`
  )
}

/** 对话框内“新建并移入”：先建合集再移动，一步完成 */
async function confirmCreateAndMove(title: string) {
  const book = movingBook.value
  movingBook.value = null
  if (!book) return
  const created = await library.createCollection(title)
  await library.moveToCollection([book.id], created.id)
  showToast(`已创建合集「${title}」并移入《${book.title}》`)
}

// —— 合集视图内移出（轻操作，不弹确认） ——
async function removeFromCollection(bookId: number) {
  const book = library.books.find((b) => b.id === bookId)
  if (!book) return
  await library.moveToCollection([bookId], null)
  showToast(`已将《${book.title}》移回未分组`)
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
    showToast(`已解散合集「${collection.title}」，成员已移回未分组`)
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

/* 书籍立体感：封面 + 右侧/底部书页厚度 + 左书脊暗带 + 整体投影 */
.book-3d {
  position: relative;
  width: 176px;
  /* 右页厚（10px）与投影使视觉重心右偏约 5px，左移补偿让封面+页厚的合成视觉居中 */
  margin-left: -5px;
  cursor: pointer;
  /* 整体投影跟随封面与页厚的合成轮廓 */
  filter: drop-shadow(8px 12px 12px rgba(28, 28, 26, 0.3));
  transition:
    transform 0.18s ease,
    filter 0.18s ease;
}

.book-3d:hover {
  transform: translateY(-4px);
  filter: drop-shadow(10px 18px 16px rgba(28, 28, 26, 0.36));
}

.book-3d-cover {
  position: relative;
  z-index: 2;
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: 3px 5px 5px 3px;
  /* 封底贴页缘的接触影（书脊与边缘光影由 .book-3d::before 蒙层统一绘制） */
  box-shadow: -2px 0 4px -2px rgba(28, 28, 26, 0.25);
}

/* 封面光影蒙层：左书脊弧形暗带 + 顶部受光 + 右/底缘搭在页缘上的压影，
   把封面与页缘粘合成一本真书（img 无法挂伪元素，故挂在 .book-3d 上覆盖封面区） */
.book-3d::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border-radius: 3px 5px 5px 3px;
  background:
    linear-gradient(
      to right,
      rgba(20, 18, 14, 0.42) 0,
      rgba(20, 18, 14, 0.18) 5px,
      rgba(20, 18, 14, 0) 14px
    ),
    linear-gradient(to bottom, rgba(255, 255, 255, 0.12) 0, rgba(255, 255, 255, 0) 12px),
    linear-gradient(to left, rgba(20, 18, 14, 0.3) 0, rgba(20, 18, 14, 0) 7px),
    linear-gradient(to top, rgba(20, 18, 14, 0.32) 0, rgba(20, 18, 14, 0) 7px);
}

.book-3d-placeholder {
  background: var(--placeholder);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
}

/* 书页厚度：右侧竖页缘 + 底部横页缘。
   固定纸张米色（书页就是纸，深浅主题下都应有纸感，主题灰会导致层次隐形）；
   右条全高顶满封面右缘，底条斜切平行四边形从左下角铺到右条外底角，两处无缝衔接 */
.book-3d-pages {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.book-3d-pages::before {
  content: '';
  position: absolute;
  top: 0;
  right: -11px;
  width: 11px;
  height: calc(100% + 11px);
  /* 平行四边形：左竖边贴封面右缘，右竖边整体下移 11px（厚度向量 (11,11)），
     底斜边与底部页缘的右斜边共享同一条棱 C→C'，两页缘才真正拼接 */
  clip-path: polygon(0 0, 0 calc(100% - 11px), 100% 100%, 100% 11px);
  background:
    linear-gradient(to right, rgba(20, 18, 14, 0.16) 0, rgba(20, 18, 14, 0) 4px),
    linear-gradient(to right, rgba(20, 18, 14, 0) 55%, rgba(20, 18, 14, 0.24) 100%),
    repeating-linear-gradient(to bottom, #f4f1e8 0 2px, #d5cfc0 2px 3px);
}

.book-3d-pages::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -11px;
  width: calc(100% + 11px);
  height: 11px;
  background: repeating-linear-gradient(
    to right,
    #eae6da 0 2px,
    #c9c3b4 2px 3px
  );
  /* 平行四边形：上沿从封面左下角水平到封面右下角，右斜边落至右条外底角 */
  clip-path: polygon(0 0, calc(100% - 11px) 0, 100% 100%, 11px 100%);
  filter: brightness(0.94);
}

.book-3d-name {
  /* 顶部留白为底部页厚让位 */
  margin: 20px 0 0;
  max-width: 100%;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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

/* —— 合集视图头部 —— */
.collection-head {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 40px;
  background: var(--surface-alpha);
  backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid var(--border);
}

.collection-head-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.collection-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
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
  min-width: 108px;
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
