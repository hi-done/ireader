import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ipc } from '../services/ipc'
import { t } from '../i18n'
import {
  applyCoverSinglePage,
  detectImageBasedBook,
  displayPageIndex,
  generateLocations,
  installPrePaginatedFit,
  installPaginatedNavigation,
  instrumentNavigation,
  loadEpubBook,
  positionFromLocation,
  pushCoverDiag,
  pushNavDiag,
  renderEpub,
  type EpubBook,
  type EpubDirection,
  type EpubLayout,
  type EpubLocation,
  type EpubPosition,
  type EpubRendition,
  type EpubSpread,
} from '../services/epub'
import {
  alignPrePaginatedPage,
  buildPrePaginatedSpreads,
  stepPrePaginatedPage,
  type EpubSpineItem,
} from '../services/epubSpread'
import { useSettingsStore } from './settings'

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useEpubReaderStore = defineStore('epubReader', () => {
  const bookId = ref<number | null>(null)
  // book/rendition 是 epubjs 类实例：不能放进 Vue ref（UnwrapRef 会抹掉类私有成员），
  // 也不需要响应式，用闭包变量持有即可
  let book: EpubBook | null = null
  let rendition: EpubRendition | null = null
  /** 首次 display 完成，阅读区可见 */
  const ready = ref(false)
  /** locations 已生成，页码指示与滑块可用 */
  const locationsReady = ref(false)
  /** 当前阅读位置（relocated 事件驱动） */
  const current = ref<EpubPosition | null>(null)
  /** 单页 none / 双页 always */
  const spread = ref<EpubSpread>('none')
  /** 翻页方向：ltr 左→右 / rtl 右→左 */
  const direction = ref<EpubDirection>('ltr')
  /**
   * 当前布局：图片型书 pre-paginated（页 = spine section，相邻页并排）；
   * 文字型书 reflowable（同一 section 内分页/双列）
   */
  const layout = ref<EpubLayout>('reflowable')
  /** 已到末屏（由 epub.js relocated 的 atEnd 判定，双页时比页索引可靠） */
  const atEnd = ref(false)
  const fontSize = ref(100)
  /** 图片型书（pre-paginated）缩放百分比：100 = 整页适合视口；文字型书不使用 */
  const zoom = ref(100)
  /** 总页数（响应式）：图片型书 = spine section 数；文字型书 = locations 长度（就绪后） */
  const totalPages = ref(0)
  /**
   * 跨页组表：仅图片型书构建（open 时一次性生成）。
   * 双页一屏实际覆盖两个 spine section，翻页/定位都必须按组而不是按 section 推演，
   * 否则会把当前右页翻成左页（视觉只翻一页）。
   */
  let preSpreads: number[][] = []

  function onRelocated(location: EpubLocation) {
    applyStart(location.start)
    atEnd.value = location.atEnd
    scheduleSave()
  }

  /**
   * 把 relocated/currentLocation 的起点归一化为阅读位置。
   * 图片型书：epub.js 的 locations 按文本节点分块，图片页无文本导致 locations 缺失，
   * 改用 spine 索引作页、自行计算百分比。
   */
  function applyStart(start: { index: number; cfi: string; percentage: number }) {
    if (layout.value === 'pre-paginated') {
      const total = spinePageCount()
      const index = Math.max(0, start.index ?? 0)
      current.value = {
        index,
        cfi: start.cfi,
        percentage: total > 0 ? Math.round((index / total) * 1000) / 10 : 0,
      }
    } else {
      current.value = positionFromLocation(start)
    }
  }

  /**
   * 打开 EPUB 并渲染到指定元素（元素须已挂载且有确定宽高）。
   * 断点续读优先级：cfi → percentage → 开头。
   */
  async function open(id: number | string, element: HTMLElement) {
    const settingsStore = useSettingsStore()
    if (!settingsStore.loaded) await settingsStore.load()

    // 归一为 number：路由参数/组件 prop 可能是字符串，若不归一，
    // 视图里 b.id === store.bookId 严格比较失败，上一本/下一本按钮会常灰
    const numId = Number(id)
    if (!Number.isFinite(numId)) throw new Error(t('reader.invalidBookId', { id: String(id) }))
    const result = await ipc.reader.open(numId)
    bookId.value = numId
    fontSize.value = settingsStore.settings.epubFontSize

    // 断点进度优先；首次打开（无进度）时回退到全局阅读偏好（与 PDF 一致）
    const progress = result.progress
    const spreadValue: EpubSpread =
      (progress?.mode ?? settingsStore.settings.defaultMode) === 'double' ? 'always' : 'none'
    const directionValue: EpubDirection =
      (progress?.direction ?? settingsStore.settings.defaultDirection) === 'rtl' ? 'rtl' : 'ltr'
    spread.value = spreadValue
    direction.value = directionValue
    // 图片型书缩放存于 progress.zoom.scale（1 = 100% 适合视口）
    zoom.value = Math.round((progress?.zoom?.scale ?? 1) * 100)

    const b = await loadEpubBook(result.fileUrl)
    book = b

    // 图片型书（每 section 一张图）用 pre-paginated 布局，双页才能相邻两页并排；
    // 文字型书保持 reflowable，spread 是同一 section 内分双列
    const detectedLayout: EpubLayout = (await detectImageBasedBook(b)) ? 'pre-paginated' : 'reflowable'
    layout.value = detectedLayout

    const rect = element.getBoundingClientRect()
    const r = renderEpub(b, element, {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontSize: fontSize.value,
      spread: spreadValue,
      direction: directionValue,
      layout: detectedLayout,
      zoom: zoom.value,
    })
    rendition = r
    // 组表只依赖 spine 元数据与封面设置，在首次 display 前建好供定位对齐使用
    rebuildPreSpreads(settingsStore.settings.coverSinglePage)
    r.on('relocated', onRelocated)
    // DEV 导航插桩：包装 manager.next/prev 记录内部状态快照（等 started 后安装）
    void instrumentNavigation(r)
    if (detectedLayout === 'pre-paginated') {
      // 图片型书：每页渲染后按视口自适应缩放（epub.js fit 对无 viewport 的书失效）；
      // 双页贴中线消间隙、单页居中
      installPrePaginatedFit(r, {
        getZoom: () => zoom.value,
        getSpread: () => spread.value,
        getTotalPages: () => spinePageCount(),
        getCoverSingle: () => settingsStore.settings.coverSinglePage,
      })
      // 全局设置：双页模式封面是否单独成页（内部等待 rendition.started 后 patch）
      await applyCoverSinglePage(r, settingsStore.settings.coverSinglePage)
      // pre-paginated 翻页直通：绕开依赖容器滚动位置的 next/prev 判定
      await installPaginatedNavigation(r)
      pushCoverDiag(
        `open cover=${settingsStore.settings.coverSinglePage} spread=${spreadValue} dir=${directionValue}`
      )
    }

    if (detectedLayout === 'pre-paginated') {
      // 图片型书：CFI 可能落在组内第二页（重开时配对错位），locations 对图片页也无效。
      // 统一按 page / 百分比还原 spine 索引，再对齐到跨页组首页
      const total = spinePageCount()
      let index = 0
      if (progress?.page != null) index = progress.page - 1
      else if (progress?.percentage != null) index = Math.floor((progress.percentage / 100) * total)
      const bounded = Math.min(Math.max(index, 0), Math.max(0, total - 1))
      const aligned = alignToSpread(bounded)
      pushNavDiag(
        `[spread] open page=${progress?.page ?? 'none'} align=${aligned} groups=${preSpreads.length}`
      )
      await r.display(b.spine.get(aligned)?.href ?? undefined)
    } else if (progress?.cfi) {
      await r.display(progress.cfi)
    } else if (progress?.percentage != null) {
      await r.display(progress.percentage / 100)
    } else {
      await r.display()
    }
    ready.value = true
    pushCoverDiag(
      `[open] id=${numId} layout=${detectedLayout} spread=${spreadValue} dir=${directionValue} ` +
        `cover=${settingsStore.settings.coverSinglePage} pct=${progress?.percentage ?? 'none'} ` +
        `cfi=${progress?.cfi ? 'yes' : 'no'}`
    )

    if (detectedLayout === 'pre-paginated') {
      // 图片型书每 section 一页：无需文本分块 locations，页码指示/滑块直接可用
      locationsReady.value = true
      totalPages.value = spinePageCount()
      syncCurrentFromRendition()
    } else {
      // 后台生成全部页定位点：完成后页码指示/滑块生效，并校正当前页索引
      void generateLocations(b)
        .then(() => {
          locationsReady.value = true
          totalPages.value = b.locations.length()
          syncCurrentFromRendition()
        })
        .catch((e) => {
          console.error('[epub] locations 生成失败', e)
        })
    }
  }

  /** 用 rendition 当前定位刷新 current（displayed.page 此时才可靠） */
  function syncCurrentFromRendition() {
    if (!rendition) return
    const location = rendition.currentLocation()
    if (location) applyStart(location)
  }

  /** spine section 数量（图片型书的页数） */
  function spinePageCount(): number {
    if (!book) return 0
    let count = 0
    for (let i = 0; ; i++) {
      if (!book.spine.get(i)) break
      count++
    }
    return count
  }

  /**
   * 构建图片型书的跨页组表（open 时调用一次）。
   * 单/双页切换、缩放重渲染复用同一份；非图片型书清空退化为按页步进。
   */
  function rebuildPreSpreads(coverSinglePage: boolean): void {
    preSpreads = []
    if (!book || layout.value !== 'pre-paginated') return
    const items: EpubSpineItem[] = []
    for (let i = 0; ; i++) {
      const section = book.spine.get(i)
      if (!section) break
      items.push({
        index: i,
        properties: section.properties ?? [],
        linear: section.linear,
      })
    }
    preSpreads = buildPrePaginatedSpreads(items, coverSinglePage)
  }

  /** 图片型 + 双页 + 组表可用：跨页组语义生效 */
  function isDoubleImageLayout(): boolean {
    return layout.value === 'pre-paginated' && spread.value === 'always' && preSpreads.length > 0
  }

  /** 对齐到跨页组首页；非双页图片型 / 组表为空时原样返回 */
  function alignToSpread(index: number): number {
    if (!isDoubleImageLayout()) return index
    return alignPrePaginatedPage(preSpreads, index)
  }

  /** 供视图绑定 rendition 级事件（iframe 内键盘/滚轮），不入响应式 */
  function getRendition(): EpubRendition | null {
    return rendition
  }

  /** 总页数（图片型书 = spine section 数；文字型书 = locations 长度，就绪后有效） */
  function totalPagesValue(): number {
    return totalPages.value
  }

  /** 下一页；返回导航完成 Promise，供视图等待新视图稳定后再播卷曲动画 */
  function next(): Promise<void> {
    const r = rendition
    if (!r) {
      pushNavDiag('[nav] store.next no rendition')
      return Promise.resolve()
    }
    pushNavDiag('[nav] store.next enter')
    return r.next()
      .then(() => pushNavDiag('[nav] store.next ok'))
      .catch((e) => {
        pushNavDiag(`[nav] store.next error ${e instanceof Error ? e.message : String(e)}`)
        console.error('[epub] 下一页失败', e)
      })
  }

  /** 上一页；返回导航完成 Promise（同 next） */
  function prev(): Promise<void> {
    const r = rendition
    if (!r) {
      pushNavDiag('[nav] store.prev no rendition')
      return Promise.resolve()
    }
    pushNavDiag('[nav] store.prev enter')
    return r.prev()
      .then(() => pushNavDiag('[nav] store.prev ok'))
      .catch((e) => {
        pushNavDiag(`[nav] store.prev error ${e instanceof Error ? e.message : String(e)}`)
        console.error('[epub] 上一页失败', e)
      })
  }

  /** 跳转到指定 spine 页索引；返回导航完成 Promise（同 next） */
  function goTo(index: number): Promise<void> {
    if (!book || !rendition) return Promise.resolve()
    if (layout.value === 'pre-paginated') {
      // 图片型书：页 = spine section，直接按 href 定位（locations 对图片页无效）。
      // 先夹取再对齐组首：display 从组内第二页开始会渲染成 [第二页, 下一页]，配对错位
      const total = spinePageCount()
      const bounded = Math.min(Math.max(index, 0), Math.max(0, total - 1))
      const aligned = alignToSpread(bounded)
      pushNavDiag(`[spread] goTo index=${index} align=${aligned} groups=${preSpreads.length}`)
      const section = book.spine.get(aligned)
      if (section) {
        return rendition.display(section.href).catch((e) => console.error('[epub] 跳页失败', e))
      }
      return Promise.resolve()
    }
    return displayPageIndex(book, rendition, index).catch((e) =>
      console.error('[epub] 跳页失败', e)
    )
  }

  /**
   * 翻页推演：图片型双页按跨页组步进，其余按页步进。
   * 图片型用 spine 数、文字型用 locations 数夹取；总数未知时只保证非负，边界交给 epub.js。
   */
  function turnTarget(from: number, delta: number): number {
    if (isDoubleImageLayout()) return stepPrePaginatedPage(preSpreads, from, delta)
    const total = layout.value === 'pre-paginated' ? spinePageCount() : totalPages.value
    if (total <= 0) return Math.max(0, from + delta)
    return Math.min(Math.max(from + delta, 0), total - 1)
  }

  /**
   * 执行一次翻页。图片型双页的单步交给引擎直通 next/prev（配对规则由 epubjs 负责，
   * 与组表一致）；连翻/单页走 goTo 一次到位；文字型保持逐次 next/prev 以匹配 CFI 分页。
   */
  async function turnTo(target: number, delta: number): Promise<void> {
    if (layout.value === 'pre-paginated') {
      if (spread.value === 'always' && Math.abs(delta) === 1) {
        await (delta > 0 ? next() : prev())
        return
      }
      await goTo(target)
      return
    }
    for (let i = 0; i < Math.abs(delta); i++) {
      await (delta > 0 ? next() : prev())
    }
  }

  /** 切换单页/双页（epub.js 会按新 spread 自动重排分页） */
  function toggleSpread() {
    const next: EpubSpread = spread.value === 'none' ? 'always' : 'none'
    spread.value = next
    const r = rendition
    if (!r) return
    // 双页传 min=0：无视默认 800px 最小宽度门槛，强制双页
    r.spread(next, next === 'always' ? 0 : undefined)
    // 同一 section 已显示时 manager 只滚动不重建视图：先 clear 再重新 display，
    // 否则切双页后仍停留在旧单页视图上
    const target =
      layout.value === 'pre-paginated'
        ? book?.spine.get(alignToSpread(current.value?.index ?? 0))?.href
        : current.value?.cfi
    r.clear()
    if (target) void r.display(target).catch((e) => console.error('[epub] 切换双页失败', e))
    else void r.display().catch((e) => console.error('[epub] 切换双页失败', e))
  }

  /** 切换翻页方向（左→右 / 右→左） */
  function toggleDirection() {
    const next: EpubDirection = direction.value === 'ltr' ? 'rtl' : 'ltr'
    direction.value = next
    rendition?.direction(next)
  }

  /** 调整字号并持久化到全局设置（epub.js 内部 ResizeObserver 自动重排分页） */
  function setFontSize(percent: number) {
    const next = Math.min(200, Math.max(60, Math.round(percent / 10) * 10))
    fontSize.value = next
    rendition?.themes.fontSize(`${next}%`)
    const settingsStore = useSettingsStore()
    void settingsStore.patch({ epubFontSize: next })
  }

  /**
   * 调整图片型书缩放（100 = 整页适合视口）。
   * 当前视图重建触发 rendered 后按新 zoom 重新 fit，改动立即生效。
   */
  function setZoom(percent: number) {
    if (layout.value !== 'pre-paginated') return
    const next = Math.min(300, Math.max(50, Math.round(percent / 10) * 10))
    if (next === zoom.value) return
    zoom.value = next
    const target = book?.spine.get(alignToSpread(current.value?.index ?? 0))?.href
    if (target) void rendition?.display(target).catch((e) => console.error('[epub] 缩放重渲染失败', e))
    scheduleSave()
  }

  function resize(width: number, height: number) {
    rendition?.resize(Math.round(width), Math.round(height))
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
    if (bookId.value == null || !current.value) return
    ipc.reader.saveProgress(bookId.value, {
      page: current.value.index + 1,
      cfi: current.value.cfi,
      percentage: current.value.percentage,
      // 保存真实排版状态，重开时恢复单/双页与方向；
      // zoom.scale 复用于图片型书缩放（1 = 100%），PDF 书不走本 store
      mode: spread.value === 'always' ? 'double' : 'single',
      direction: direction.value,
      zoom: { mode: zoom.value === 100 ? 'fitHeight' : 'custom', scale: zoom.value / 100 },
      updatedAt: Date.now(),
    })
  }

  function close() {
    flushProgress()
    rendition?.off('relocated', onRelocated)
    rendition?.destroy()
    book?.destroy()
    rendition = null
    book = null
    bookId.value = null
    current.value = null
    preSpreads = []
    atEnd.value = false
    ready.value = false
    locationsReady.value = false
    totalPages.value = 0
    zoom.value = 100
  }

  return {
    bookId,
    ready,
    locationsReady,
    current,
    spread,
    direction,
    layout,
    atEnd,
    fontSize,
    zoom,
    open,
    getRendition,
    totalPages: totalPagesValue,
    next,
    prev,
    goTo,
    isDoubleImageLayout,
    alignToSpread,
    turnTarget,
    turnTo,
    toggleSpread,
    toggleDirection,
    setFontSize,
    setZoom,
    resize,
    flushProgress,
    close,
  }
})
