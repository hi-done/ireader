import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Book, Collection, SortBy, SortOrder } from '../../shared/types'
import { ipc } from '../services/ipc'

const SORT_PREF_KEY = 'ireader.sort'
const SORT_BY_VALUES: SortBy[] = ['lastOpenedAt', 'addedAt', 'title']

/** 从 localStorage 恢复上次排序设置（损坏/缺失时回退默认） */
function loadSortPref(): { sortBy: SortBy; sortOrder: SortOrder } {
  try {
    const raw = localStorage.getItem(SORT_PREF_KEY)
    if (raw) {
      const p = JSON.parse(raw) as { sortBy?: SortBy; sortOrder?: SortOrder }
      return {
        sortBy: SORT_BY_VALUES.includes(p.sortBy as SortBy)
          ? (p.sortBy as SortBy)
          : 'lastOpenedAt',
        sortOrder: p.sortOrder === 'asc' ? 'asc' : 'desc',
      }
    }
  } catch {
    // 解析失败回退默认
  }
  return { sortBy: 'lastOpenedAt', sortOrder: 'desc' }
}

export const useLibraryStore = defineStore('library', () => {
  const books = ref<Book[]>([])
  const collections = ref<Collection[]>([])
  const keyword = ref('')
  const sortPref = loadSortPref()
  const sortBy = ref<SortBy>(sortPref.sortBy)
  const sortOrder = ref<SortOrder>(sortPref.sortOrder)
  const loading = ref(false)
  let unsubscribe: (() => void) | null = null

  // 排序设置变化时持久化，下次启动恢复（v-model 直改 store ref 也走这里）
  watch([sortBy, sortOrder], () => {
    try {
      localStorage.setItem(
        SORT_PREF_KEY,
        JSON.stringify({ sortBy: sortBy.value, sortOrder: sortOrder.value })
      )
    } catch {
      // 写入失败不影响功能
    }
  })

  const filteredBooks = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    let list = kw ? books.value.filter((b) => b.title.toLowerCase().includes(kw)) : books.value
    list = [...list].sort((a, b) => {
      const dir = sortOrder.value === 'asc' ? 1 : -1
      if (sortBy.value === 'title') return a.title.localeCompare(b.title) * dir
      if (sortBy.value === 'addedAt') return (a.addedAt - b.addedAt) * dir
      return ((a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0)) * dir
    })
    return list
  })

  /** silent=true 时不触发整页 loading（用于后台事件驱动的刷新） */
  async function refresh(options: { silent?: boolean } = {}) {
    if (!options.silent) loading.value = true
    try {
      books.value = await ipc.library.list()
      collections.value = await ipc.collection.list()
    } finally {
      if (!options.silent) loading.value = false
    }
  }

  // —— 合集 ——
  async function createCollection(title: string): Promise<Collection> {
    const created = await ipc.collection.create(title)
    collections.value = [created, ...collections.value]
    return created
  }

  /** 解散合集：成员书移回未分组，本地同步更新书的归属 */
  async function dissolveCollection(id: number) {
    await ipc.collection.remove(id)
    books.value = books.value.map((b) =>
      b.collectionId === id ? { ...b, collectionId: null } : b
    )
    collections.value = collections.value.filter((c) => c.id !== id)
  }

  /** 移动书至合集（collectionId = null 移回未分组），本地同步 */
  async function moveToCollection(bookIds: number[], collectionId: number | null) {
    await ipc.library.moveToCollection(bookIds, collectionId)
    const idSet = new Set(bookIds)
    books.value = books.value.map((b) =>
      idSet.has(b.id) ? { ...b, collectionId } : b
    )
  }

  async function importPaths(paths: string[], collectionId?: number | null) {
    const result = await ipc.library.import(paths, collectionId)
    await refresh()
    return result
  }

  async function remove(bookId: number, deleteFile = false) {
    await ipc.library.remove(bookId, deleteFile)
    books.value = books.value.filter((b) => b.id !== bookId)
  }

  async function rename(bookId: number, title: string) {
    const updated = await ipc.library.rename(bookId, title)
    const idx = books.value.findIndex((b) => b.id === bookId)
    if (idx !== -1) books.value[idx] = updated
  }

  async function relink(bookId: number, newPath: string) {
    const updated = await ipc.library.relink(bookId, newPath)
    const idx = books.value.findIndex((b) => b.id === bookId)
    if (idx !== -1) books.value[idx] = updated
  }

  function subscribeChanges() {
    if (unsubscribe) return
    unsubscribe = ipc.library.onChanged(() => {
      void refresh({ silent: true })
    })
  }

  function unsubscribeChanges() {
    unsubscribe?.()
    unsubscribe = null
  }

  return {
    books,
    collections,
    keyword,
    sortBy,
    sortOrder,
    loading,
    filteredBooks,
    refresh,
    importPaths,
    remove,
    rename,
    relink,
    createCollection,
    dissolveCollection,
    moveToCollection,
    subscribeChanges,
    unsubscribeChanges,
  }
})
