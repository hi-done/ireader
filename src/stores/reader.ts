import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'
import type { Direction, ReadingMode, ZoomMode } from '../../shared/types'
import { ipc } from '../services/ipc'
import { loadPdfWithTask, type PdfDocument, type PdfLoadingTask } from '../services/pdf'
import { buildSpreads, findSpreadIndexByPage, type Spread } from '../services/spread'
import { useSettingsStore } from './settings'

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useReaderStore = defineStore('reader', () => {
  const bookId = ref<number | null>(null)
  const doc = ref<PdfDocument | null>(null)
  /** 与 doc 配套的 loadingTask，close 时销毁以释放 pdf.js worker 资源 */
  let loadingTask: PdfLoadingTask | null = null
  const numPages = ref(0)
  const mode = ref<ReadingMode>('single')
  const direction = ref<Direction>('rtl')
  const coverSinglePage = ref(true)
  const zoomMode = ref<ZoomMode>('fitHeight')
  const zoomScale = ref(1)
  const spreads = ref<Spread[]>([])
  const currentIndex = ref(0)

  function rebuildSpreads(keepPage?: number) {
    spreads.value = buildSpreads(numPages.value, {
      mode: mode.value,
      direction: direction.value,
      coverSinglePage: coverSinglePage.value,
    })
    if (keepPage !== undefined) {
      currentIndex.value = findSpreadIndexByPage(spreads.value, keepPage)
    }
  }

  async function open(id: number) {
    const settingsStore = useSettingsStore()
    if (!settingsStore.loaded) await settingsStore.load()

    const result = await ipc.reader.open(id)
    bookId.value = id
    const loaded = await loadPdfWithTask(result.pdfUrl)
    loadingTask = loaded.task
    doc.value = markRaw(loaded.doc)
    numPages.value = result.numPages || loaded.doc.numPages

    const progress = result.progress
    mode.value = progress?.mode ?? settingsStore.settings.defaultMode
    direction.value = progress?.direction ?? settingsStore.settings.defaultDirection
    coverSinglePage.value = settingsStore.settings.coverSinglePage
    zoomMode.value = progress?.zoom.mode ?? 'fitHeight'
    zoomScale.value = progress?.zoom.scale ?? 1

    rebuildSpreads(progress?.page ?? 1)
  }

  function setMode(next: ReadingMode) {
    const page = spreads.value[currentIndex.value]?.firstPage ?? 1
    mode.value = next
    rebuildSpreads(page)
    scheduleSave()
  }

  function setDirection(next: Direction) {
    const page = spreads.value[currentIndex.value]?.firstPage ?? 1
    direction.value = next
    rebuildSpreads(page) // displayOrder 依赖方向镜像，切换后必须重建
    scheduleSave()
  }

  function setZoom(nextMode: ZoomMode, scale = 1) {
    zoomMode.value = nextMode
    zoomScale.value = scale
    scheduleSave()
  }

  function goTo(index: number) {
    if (index < 0 || index >= spreads.value.length) return
    currentIndex.value = index
    scheduleSave()
  }

  function next() {
    goTo(currentIndex.value + 1)
  }

  function prev() {
    goTo(currentIndex.value - 1)
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flushProgress, 1000)
  }

  function flushProgress() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (bookId.value == null) return
    const page = spreads.value[currentIndex.value]?.firstPage ?? 1
    ipc.reader.saveProgress(bookId.value, {
      page,
      mode: mode.value,
      direction: direction.value,
      zoom: { mode: zoomMode.value, scale: zoomScale.value },
      updatedAt: Date.now(),
    })
  }

  function close() {
    flushProgress()
    void loadingTask?.destroy().catch(() => undefined)
    loadingTask = null
    doc.value = null
    bookId.value = null
    spreads.value = []
    currentIndex.value = 0
  }

  return {
    bookId,
    doc,
    numPages,
    mode,
    direction,
    coverSinglePage,
    zoomMode,
    zoomScale,
    spreads,
    currentIndex,
    open,
    setMode,
    setDirection,
    setZoom,
    goTo,
    next,
    prev,
    flushProgress,
    close,
  }
})
