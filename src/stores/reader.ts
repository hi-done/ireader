import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'
import type { Direction, ReadingMode, ZoomMode } from '../../shared/types'
import { ipc } from '../services/ipc'
import { t } from '../i18n'
import { loadPdfWithTask, type PdfLoadingTask } from '../services/pdf'
import type { PageDocument } from '../services/pageRenderer'
import { buildSpreads, findSpreadIndexByPage, type Spread } from '../services/spread'
import { useSettingsStore } from './settings'

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useReaderStore = defineStore('reader', () => {
  const bookId = ref<number | null>(null)
  // shallowRef：ref 的 UnwrapRef 会深度展开 pdf 文档对象并丢失类私有字段，_value 与 PageDocument 不再兼容
  const doc = shallowRef<PageDocument | null>(null)
  /** PDF 文档配套的 loadingTask，close 时销毁以释放 pdf.js worker 资源；CBZ 无长生命周期句柄故恒为 null */
  let loadingTask: PdfLoadingTask | null = null
  const numPages = ref(0)
  const mode = ref<ReadingMode>('single')
  const direction = ref<Direction>('rtl')
  const coverSinglePage = ref(true)
  const zoomMode = ref<ZoomMode>('fitHeight')
  const zoomScale = ref(1)
  const spreads = ref<Spread[]>([])
  const currentIndex = ref(0)
  /** 翻页导航序号：仅 goTo 递增；模式/方向切换直接改 currentIndex，不递增 */
  const navCount = ref(0)

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
    if (result.format === 'cbz') {
      // 页数来自导入时的图片条目统计；为 0 说明压缩包不可用，与 PDF 加载失败同样进错误页
      if (result.numPages <= 0) throw new Error(t('reader.zipNoImages'))
      doc.value = markRaw({ kind: 'cbz' as const, bookId: id })
      numPages.value = result.numPages
    } else {
      const loaded = await loadPdfWithTask(result.fileUrl)
      loadingTask = loaded.task
      doc.value = markRaw({ kind: 'pdf' as const, pdf: loaded.doc })
      numPages.value = result.numPages || loaded.doc.numPages
    }

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
    navCount.value++
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
    navCount,
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
