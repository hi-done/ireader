// epub.js 封装：EPUB 文档加载、分页渲染、页位置映射
// EPUB 分页依赖视口尺寸，渲染目标必须已挂载且有确定宽高

import ePub, {
  Book as EpubBook,
  Contents as EpubContents,
  Location as EpubLocation,
  Rendition as EpubRendition,
} from 'epubjs'

export type { EpubBook, EpubContents, EpubLocation, EpubRendition }

// —— DEV 诊断缓冲（阅读界面 debug 面板读取；仅开发模式收集）——
const diagBuffer: string[] = []
// 封面策略相关日志单独持久化：渲染日志量大，混在共用缓冲会被快速冲掉
const coverDiagBuffer: string[] = []
// 导航（next/prev）链路日志单独持久化：翻页无反应时无渲染日志，但需跨多秒保留
const navDiagBuffer: string[] = []
export function getEpubDiag(): string[] {
  return [...coverDiagBuffer, ...navDiagBuffer, ...diagBuffer.slice(-10)]
}
export function pushEpubDiag(msg: string) {
  if (import.meta.env?.DEV !== true) return
  diagBuffer.push(msg)
  if (diagBuffer.length > 120) diagBuffer.splice(0, diagBuffer.length - 120)
}
export function pushCoverDiag(msg: string) {
  if (import.meta.env?.DEV !== true) return
  coverDiagBuffer.push(msg)
  if (coverDiagBuffer.length > 30) coverDiagBuffer.splice(0, coverDiagBuffer.length - 30)
}
export function pushNavDiag(msg: string) {
  if (import.meta.env?.DEV !== true) return
  navDiagBuffer.push(msg)
  if (navDiagBuffer.length > 60) navDiagBuffer.splice(0, navDiagBuffer.length - 60)
}

/** 单页 none / 双页 always（强制双页，与 PDF 双页语义一致） */
export type EpubSpread = 'none' | 'always'
/** 翻页方向：ltr 左→右 / rtl 右→左 */
export type EpubDirection = 'ltr' | 'rtl'
/**
 * 布局：reflowable 文字流（同一 section 内分页）/ pre-paginated 固定页。
 * 图片型书（每 section 一张图）必须用 pre-paginated：epub.js 的 reflowable
 * spread 是同一 section 内分双列，图片型书会得到「一列图 + 一列空白」。
 */
export type EpubLayout = 'reflowable' | 'pre-paginated'

export interface EpubRenderOptions {
  /** 渲染区 CSS 像素宽（分页基准） */
  width: number
  /** 渲染区 CSS 像素高 */
  height: number
  /** 字号百分比（100 = 默认；仅 reflowable 生效） */
  fontSize: number
  /** 单页 / 双页 */
  spread: EpubSpread
  /** 翻页方向 */
  direction: EpubDirection
  /** 布局（图片型书用 pre-paginated） */
  layout: EpubLayout
  /** 缩放百分比（100 = 整页适合视口；仅 pre-paginated 生效） */
  zoom: number
}

/** 当前阅读位置（供 UI 指示与进度落盘） */
export interface EpubPosition {
  /** 当前 spine 页索引，从 0 起（与单/双页模式无关；locations 就绪后由 CFI 反查得到） */
  index: number
  /** 当前页 CFI 定位 */
  cfi: string
  /** 阅读进度百分比 0-100 */
  percentage: number
}

/**
 * 加载并解包 EPUB（挂起至 ready）。
 * ireader:// URL 没有 .epub 扩展名，epub.js 会按扩展名把输入误判为目录模式，
 * 因此先 fetch 成 ArrayBuffer 再交给它解包（二进制输入直接走解压路径）。
 */
export async function loadEpubBook(url: string): Promise<EpubBook> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`加载 EPUB 失败（HTTP ${res.status}）`)
  const data = await res.arrayBuffer()
  const book = ePub(data)
  await book.ready
  return book
}

/**
 * 检测是否为图片型 EPUB（前几个 spine section 主体是一张图、几乎无文本）。
 * 图片型书在双页模式下若走 reflowable 布局会「一列图 + 一列空白」，
 * 需改用 pre-paginated 布局才能相邻两页并排（见 EpubLayout 注释）。
 */
export async function detectImageBasedBook(book: EpubBook): Promise<boolean> {
  let checked = 0
  let imageSections = 0
  for (let i = 0; i < 3; i++) {
    const section = book.spine.get(i)
    if (!section) break
    checked++
    try {
      const doc = await Promise.resolve(section.load(book.load.bind(book)))
      const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, '')
      const images = doc.querySelectorAll('img').length
      if (images >= 1 && bodyText.length < 100) imageSections++
      section.unload()
    } catch {
      // 单个 section 加载失败按非图片页计（保守，避免误切布局）
    }
  }
  if (checked === 0) return false
  return imageSections / checked >= 2 / 3
}

/** 创建分页渲染（单页/双页按选项），字号应用到全部视图；
 *  方向先走构造参数，再显式调用 direction() 覆盖书籍元数据里的方向 */
export function renderEpub(book: EpubBook, element: HTMLElement, options: EpubRenderOptions): EpubRendition {
  const rendition = book.renderTo(element, {
    width: options.width,
    height: options.height,
    flow: 'paginated',
    layout: options.layout,
    spread: options.spread,
    defaultDirection: options.direction,
  })
  rendition.direction(options.direction)
  // 显式设置 spread：双页传 min=0 强制生效——epub.js 默认 minSpreadWidth=800，
  // 且构造期 settings.minSpreadWidth || 800 会吞掉 0，只能运行时用 layout.spread(spread, 0) 覆盖
  rendition.spread(options.spread, options.spread === 'always' ? 0 : undefined)
  rendition.themes.fontSize(`${options.fontSize}%`)
  hardenRenditionQueue(rendition)
  return rendition
}

/** 水平对齐：center 居中（单页）/ left、right 贴左、贴右（双页贴中线用） */
export type EpubFitAlign = 'center' | 'left' | 'right'

/**
 * 把一页内容缩放到视口（pre-paginated 图片型书专用）。
 * epub.js 官方 fit() 用书的 <meta viewport> 计算 scale，无 viewport 的书（如
 * 每页一张大图的漫画）会得到 NaN → transform 失效，图片按原始尺寸溢出视口。
 *
 * 实现：以图片固有尺寸计算 fit 尺寸后，**直接以视觉尺寸渲染主体元素**（不缩放
 * 外层容器），再用 CSS flex 对齐（单页居中；双页左容器贴右、右容器贴左）。
 * 不用 transform：transform 的 translate 会被 scale 乘算，与布局盒不一致时产生
 * 黑缝/偏移且随窗口漂移；直接设置渲染尺寸则所见即所得，无换算误差。
 */
export function fitPrePaginatedContents(
  contents: EpubContents,
  viewWidth: number,
  viewHeight: number,
  zoomPercent: number,
  align: EpubFitAlign = 'center'
): {
  naturalW: number
  naturalH: number
  scale: number
  fittedW: number
  fittedH: number
} | null {
  const doc = contents.document
  const body = doc?.body
  const html = doc?.documentElement
  if (!html || !body) return null
  // 以首图固有尺寸为基准：scrollWidth/scrollHeight 会被 iframe 视口尺寸污染
  // （图窄于视口时 clientWidth 顶掉真实内容宽），导致缩放与居中偏移。
  // 图片未加载（naturalWidth=0）或 svg 封面无 img 时回退 viewBox / body 包围盒。
  const img = doc.querySelector('img') as HTMLImageElement | null
  const svg = doc.querySelector('svg') as SVGSVGElement | null
  let naturalW = img?.naturalWidth || 0
  let naturalH = img?.naturalHeight || 0
  if (!naturalW || !naturalH) {
    const vb = svg?.viewBox?.baseVal
    if (vb && vb.width > 0 && vb.height > 0) {
      naturalW = vb.width
      naturalH = vb.height
    }
  }
  if (!naturalW) naturalW = Math.max(1, body.scrollWidth || 1)
  if (!naturalH) naturalH = Math.max(1, body.scrollHeight || 1)
  const zoom = Math.min(3, Math.max(0.1, zoomPercent / 100))
  const scale = Math.min(viewWidth / naturalW, viewHeight / naturalH) * zoom
  const fittedW = Math.max(1, Math.round(naturalW * scale))
  const fittedH = Math.max(1, Math.round(naturalH * scale))

  // 布局：html/body 铺满 iframe，flex 对齐主体（div 包 img 时同步透传对齐）
  html.style.width = '100%'
  html.style.height = '100%'
  html.style.margin = '0'
  html.style.padding = '0'
  body.style.width = '100%'
  body.style.height = '100%'
  body.style.margin = '0'
  body.style.padding = '0'
  body.style.display = 'flex'
  body.style.flexDirection = 'column'
  body.style.overflow = 'hidden'
  body.style.transform = 'none'
  const cross = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'
  body.style.justifyContent = 'center'
  body.style.alignItems = cross

  const target = (img ?? svg ?? null) as HTMLElement | null
  if (target) {
    const wrap = target.parentElement
    if (wrap && wrap !== body && wrap !== html) {
      wrap.style.width = '100%'
      wrap.style.height = '100%'
      wrap.style.margin = '0'
      wrap.style.padding = '0'
      wrap.style.display = 'flex'
      wrap.style.flexDirection = 'column'
      wrap.style.justifyContent = 'center'
      wrap.style.alignItems = cross
    }
    target.style.width = fittedW + 'px'
    target.style.height = fittedH + 'px'
    target.style.maxWidth = 'none'
    target.style.maxHeight = 'none'
  }

  return { naturalW, naturalH, scale, fittedW, fittedH }
}

/**
 * 每次视图渲染后执行自适应缩放（pre-paginated 图片型书）。
 * 双页模式下两页分别贴向中线（消除中间空隙），单页模式居中。
 * 图片异步加载完成后内容尺寸会变化，因此对每张图挂 load 监听重 fit 一次。
 *
 * prev 翻页是 prepend 模式：先渲染的 view 当时是容器中唯一元素（offsetLeft=0，
 * 按左容器对齐），随后更早的 view 插入把它挤到右侧，其对齐已不再正确。因此
 * 每次渲染后对所有仍挂载在 DOM 中的视图按最终几何位置重对齐。
 */
export function installPrePaginatedFit(
  rendition: EpubRendition,
  getters: {
    getZoom: () => number
    getSpread: () => EpubSpread
    /** spine 页总数（用于真单页判定） */
    getTotalPages: () => number
    /** 全局设置：双页模式封面是否单独成页 */
    getCoverSingle: () => boolean
  }
): void {
  interface ViewLike {
    element?: HTMLElement | null
    width: () => number
    height: () => number
    contents?: EpubContents | null
  }
  const fitted = new Map<number, ViewLike>()

  rendition.on('rendered', (_section: unknown, view: ViewLike) => {
    const index = (_section as { index?: number } | null)?.index
    if (index != null) fitted.set(index, view)
    refitAll()
    pushEpubDiag(
      `rendered idx=${index} views=${fitted.size} spread=${getters.getSpread()} ` +
        `left=${view.element?.offsetLeft} w=${view.element?.offsetWidth}`
    )
    const doc = view?.contents?.document
    if (doc) {
      Array.from(doc.querySelectorAll('img')).forEach((img) => {
        img.addEventListener('load', refitAll, { once: true })
      })
    }
  })

  function refitAll() {
    // 先统一清理已移出 DOM 的视图（翻页销毁），避免残留条目干扰单页判定
    for (const [index, view] of Array.from(fitted.entries())) {
      if (!view.element?.isConnected) fitted.delete(index)
    }
    const lastIdx = fitted.size > 0 ? Math.max(...Array.from(fitted.keys())) : -1
    // 双页模式下「真单页」仅两种：封面（设置开启时）或奇数页数的尾页。
    // 双页翻页是 clear 后先 append 第 1 页、再异步 append 第 2 页的两段式：
    // 第一个 view 完成时视口确实只有一页，但那只是渲染中转瞬态——若按单页
    // 撑宽，随后插入的相邻页会被挤出容器，视图位置错乱、容器滚动宽度异常。
    const total = getters.getTotalPages()
    const coverSingle = getters.getCoverSingle()
    const trueSingle =
      lastIdx >= 0 && ((lastIdx === 0 && coverSingle) || (total % 2 === 1 && lastIdx === total - 1))
    const singlePage = getters.getSpread() === 'always' && fitted.size === 1 && trueSingle
    // 对照值：epubjs 当前实际挂载的视图数（诊断用）
    const liveViews =
      (rendition as unknown as { manager?: { views?: { length?: number } | null } | null })
        .manager?.views?.length ?? -1
    for (const [index, view] of Array.from(fitted.entries())) {
      if (!view.contents) continue
      const containerW = view.element?.parentElement?.clientWidth ?? 0
      const doubleW = view.width() * 2
      const full = singlePage && doubleW <= containerW
      if (view.element) {
        // 单页时把 view 撑到全宽：epub.js 把封面放在左容器（半屏宽）且 iframe 宽
        // 固定 = columnWidth，内容（body 100%）跟随 iframe 视口，仅撑外层 element
        // 无效；须同时撑 iframe 宽，居中对齐才能以整屏为基准。
        // 双页时必须显式写半宽而不能清空内联（''）：element 初始内联宽为 0px，
        // 清空后回落 auto，display:block 会被内容撑开甚至占满容器，把
        // container.scrollWidth 撑到 2528，破坏 next/prev 的滚动判定（翻页无反应）。
        view.element.style.width = full ? `${doubleW}px` : `${view.width()}px`
        // marginLeft 一律清除：epub.js 对带 page-spread-right 的 section 用
        // forceRight 写 marginLeft 推移，而 margin 计入 flex 布局宽度，会把
        // container.scrollWidth 撑大（1264 → 1896+），破坏 next/prev 的滚动
        // 判定（next 永远走 scrollBy 分支换不了 section，页面无反应；prev 先
        // 滚回 0 后才正常，造成「上一页有效、下一页失效」）。pre-paginated 双页
        // 靠 flex 顺序自然排布，marginLeft 无意义。
        view.element.style.marginLeft = '0px'
        const iframeEl = view.element.querySelector('iframe')
        if (iframeEl) {
          iframeEl.style.width = full ? `${doubleW}px` : `${view.width()}px`
        }
      }
      const align = computeFitAlign(view, singlePage)
      // 单页按整屏宽计算 contain 缩放（封面撑大居中）；双页按半屏宽
      const fitWidth = full ? doubleW : view.width()
      const diag = fitPrePaginatedContents(view.contents, fitWidth, view.height(), getters.getZoom(), align)
      pushEpubDiag(
        `fit idx=${index} left=${view.element?.offsetLeft} align=${align} views=${fitted.size} ` +
          `live=${liveViews} single=${singlePage}` +
          (diag ? ` img=${diag.naturalW}x${diag.naturalH}->${diag.fittedW}x${diag.fittedH} scale=${diag.scale.toFixed(3)}` : ' no-img')
      )
      // eslint-disable-next-line no-console
      if (diag && import.meta.env?.DEV) {
        console.log('[epub-fit]', {
          index,
          offsetLeft: view.element?.offsetLeft,
          offsetWidth: view.element?.offsetWidth,
          spread: getters.getSpread(),
          align,
          viewW: view.width(),
          viewH: view.height(),
          ...diag,
        })
      }
    }
  }

  /**
   * 双页：按 view 在 stage 中的几何位置贴中线（与阅读方向无关）；单页居中。
   * offsetLeft=0 的容器靠左 → 贴右边界（中线）；offsetLeft>0 的容器靠右 → 贴左边界（中线）。
   */
  function computeFitAlign(
    view: { element?: HTMLElement | null },
    singlePage: boolean
  ): EpubFitAlign {
    if (getters.getSpread() !== 'always') return 'center'
    // 双页模式下视口中只有一页（封面单独成页、奇数页数的尾页）→ 居中
    if (singlePage) return 'center'
    const left = view?.element?.offsetLeft ?? 0
    return left > 0 ? 'left' : 'right'
  }
}

/**
 * 给 epub.js 的渲染队列打韧性补丁。
 * epub.js 0.3 的 Queue.run 中 `this.dequeue().then(...)` 没有失败回调：
 * 任一渲染任务 reject 后队列永久停摆，翻页/跳页/滑块全部静默失效。
 * 在实例级包装 dequeue：任务失败记日志并继续，避免死锁。
 */
export function hardenRenditionQueue(rendition: EpubRendition): void {
  const q = (rendition as unknown as { q?: { dequeue: () => Promise<unknown> } }).q
  if (!q || typeof q.dequeue !== 'function') return
  const origDequeue = q.dequeue.bind(q)
  q.dequeue = () =>
    origDequeue().catch((e) => {
      console.error('[epub] 渲染任务失败（已跳过，避免队列停摆）', e)
      return undefined
    })
}

/** epub.js 默认管理器的最小结构（仅声明封面策略 patch 用到的成员） */
type EpubManagerLike = {
  layout?: { name?: string; divisor?: number; delta?: number } | null
  settings?: { direction?: string; axis?: string; rtlScrollType?: string } | null
  container?: { scrollWidth?: number; scrollLeft?: number; offsetWidth?: number } | null
  views?: {
    length?: number
    first(): { section?: { index?: number; prev?: () => unknown; next?: () => unknown } | null } | null
    last(): { section?: { index?: number; prev?: () => unknown; next?: () => unknown } | null } | null
    show(): void
  } | null
  clear?(): void
  updateLayout?(): void
  append?(section: unknown): Promise<unknown>
  prepend?(section: unknown): Promise<unknown>
  scrollTo?(x: number, y: number, immediate?: boolean): void
  isPaginated?: boolean
  next?: () => unknown
  handleNextPrePaginated?: (
    forceRight?: boolean,
    section?: { index?: number; next?: () => ({ properties?: string[]; index?: number } | null) },
    action?: (next?: unknown) => unknown
  ) => unknown
  prev?: () => unknown
}

/**
 * 应用「双页模式封面单独成页」设置（仅 pre-paginated 图片型书）。
 * epub.js 对 pre-paginated 硬编码「spine 第 0 项（封面）单独显示」；关闭该设置时
 * 封面与第 1 页按普通跨页并排，需 patch 两条路径：
 * - handleNextPrePaginated：display/下一页时不再对 index===0 特判
 * - prev：上一页到封面时不再 forceRight 单页，改为 append [封面, 第1页] 并排
 */
export async function applyCoverSinglePage(
  rendition: EpubRendition,
  coverSinglePage: boolean
): Promise<void> {
  if (coverSinglePage) return
  // rendition.manager 由 start() 创建，而 start() 排在渲染队列（requestAnimationFrame）
  // 中异步执行：renderTo 返回时 manager 尚未创建，直接同步取会得到 undefined，
  // 导致 patch 静默未安装。先等 started 完成再 patch。
  await (rendition as unknown as { started?: Promise<unknown> }).started
  const manager = (rendition as unknown as { manager?: EpubManagerLike | null }).manager
  if (!manager) {
    pushCoverDiag('[cover] manager missing after started')
    return
  }

  const layout = manager.layout
  // 不能在此检查 divisor：open 阶段 layout.calculate 尚未执行，divisor 还是构造默认值 1，
  // 检查会误判导致 patch 永不生效。divisor 的判断放在 patch 函数体内（调用时已计算）。
  pushCoverDiag(`[cover] setting=${coverSinglePage} layout=${layout?.name} divisor=${layout?.divisor}`)
  if (layout?.name !== 'pre-paginated') return

  if (typeof manager.handleNextPrePaginated === 'function') {
    manager.handleNextPrePaginated = (_forceRight, section, action) => {
      const l = manager.layout
      pushCoverDiag(
        `[cover] next enter idx=${section?.index} name=${l?.name} divisor=${l?.divisor}`
      )
      if (!(l?.name === 'pre-paginated' && l.divisor! > 1)) return
      // 用户关闭「封面单独成页」：无条件与下一页并排——无视 forceRight 与
      // page-spread-left（很多固定布局书第 1 页 itemref 带 page-spread-left，
      // 命中即不并排，表现为设置无效）。设置优先于 EPUB 元数据声明。
      const next = section?.next?.()
      pushCoverDiag(`[cover] next append idx=${section?.index} next=${next?.index ?? 'none'}`)
      if (next) {
        return action?.call(manager, next)
      }
      return undefined
    }
  }

  if (typeof manager.prev === 'function') {
    const origPrev = manager.prev.bind(manager)
    manager.prev = () => {
      const l = manager.layout
      const first = manager.views?.first()
      const section = first?.section
      const prev = section?.prev?.() as {
        index?: number
        prev?: () => unknown
        next?: () => unknown
      } | null | undefined
      // 封面是 spine 第 0 项，其 prev() 返回 null（Section.prev 方法本身总是函数，
      // 不能用 typeof 判断）。原生 prev 到此会把封面单独 prepend；关闭设置时改为
      // [封面, 第1页] 并排（append 顺序即 DOM 顺序）。
      const prevPrev = (prev && typeof prev.prev === 'function' ? prev.prev() : undefined) as
        | { index?: number }
        | null
        | undefined
      pushCoverDiag(
        `[cover] prev enter firstIdx=${section?.index} prev=${prev?.index ?? 'none'} ` +
          `prevPrev=${prevPrev?.index ?? 'none'} name=${l?.name} divisor=${l?.divisor}`
      )
      if (l?.name === 'pre-paginated' && l.divisor! > 1 && prev && !prevPrev) {
        pushCoverDiag(`[cover] prev trigger firstIdx=${section?.index} -> cover`)
        // 上一页到封面：与第 1 页并排显示 [封面, 第1页]（append 顺序即 DOM 顺序）
        manager.clear?.()
        manager.updateLayout?.()
        const firstAppend = manager.append?.(prev) ?? Promise.resolve()
        return firstAppend
          .then(() => {
            const next = prev.next?.()
            if (next) return manager.append?.(next) ?? Promise.resolve()
            return undefined
          })
          .then(() => {
            if (manager.isPaginated && manager.settings?.axis === 'horizontal') {
              if (manager.settings.direction === 'rtl') {
                if (manager.settings.rtlScrollType === 'default') {
                  manager.scrollTo?.(0, 0, true)
                } else {
                  manager.scrollTo?.((manager.container?.scrollWidth ?? 0) * -1 + (l.delta ?? 0), 0, true)
                }
              } else {
                manager.scrollTo?.((manager.container?.scrollWidth ?? 0) - (l.delta ?? 0), 0, true)
              }
            }
            manager.views?.show()
          })
      }
      return origPrev()
    }
  }
}

/**
 * DEV 导航链路插桩：包装 manager.next/prev，在调用前后记录内部状态快照
 * （视图数、容器滚动状态、布局 delta/divisor），用于定位「翻页无反应但跳页正常」。
 * 须等 rendition.started（manager 异步创建）后再安装；仅开发模式收集。
 */
export async function instrumentNavigation(rendition: EpubRendition): Promise<void> {
  if (import.meta.env?.DEV !== true) return
  await (rendition as unknown as { started?: Promise<unknown> }).started
  const manager = (rendition as unknown as { manager?: EpubManagerLike | null }).manager
  if (!manager) return

  function snap(action: string): string {
    const l = manager!.layout
    const c = manager!.container as HTMLElement | null | undefined
    return (
      `[nav] ${action} views=${manager!.views?.length ?? '?'} ` +
      `scrollL=${c?.scrollLeft ?? '?'} scrollW=${c?.scrollWidth ?? '?'} ` +
      `offW=${c?.offsetWidth ?? '?'} delta=${l?.delta ?? '?'} ` +
      `divisor=${l?.divisor ?? '?'} name=${l?.name ?? '?'} paginated=${manager!.isPaginated ?? '?'}`
    )
  }

  for (const name of ['next', 'prev'] as const) {
    const orig = manager[name]
    if (typeof orig !== 'function') continue
    ;(manager as unknown as Record<string, unknown>)[name] = function (this: unknown) {
      pushNavDiag(snap(`${name} enter`))
      let result: unknown
      try {
        result = orig.call(this)
      } catch (e) {
        pushNavDiag(`[nav] ${name} throw ${e instanceof Error ? e.message : String(e)}`)
        throw e
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        ;(result as Promise<unknown>).then(
          () => pushNavDiag(snap(`${name} done`)),
          (e: unknown) =>
            pushNavDiag(`[nav] ${name} reject ${e instanceof Error ? e.message : String(e)}`)
        )
      } else {
        pushNavDiag(snap(`${name} done sync`))
      }
      return result
    }
  }

  // 原生 next/prev 的 then 错误回调是 `(err) => { return err; }`，会把 append/render
  // 失败吞掉：翻页静默无反应、页面不变。包装 append 单独记录失败原因。
  const origAppend = manager.append
  if (typeof origAppend === 'function') {
    manager.append = function (this: unknown, section: unknown): Promise<unknown> {
      const idx = (section as { index?: number } | null)?.index
      pushNavDiag(`[nav] append enter idx=${idx ?? '?'} views=${manager!.views?.length ?? '?'}`)
      let result: unknown
      try {
        result = origAppend.call(this, section)
      } catch (e) {
        pushNavDiag(`[nav] append throw idx=${idx ?? '?'} ${e instanceof Error ? e.message : String(e)}`)
        return Promise.reject(e)
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (v) => {
            pushNavDiag(`[nav] append done idx=${idx ?? '?'}`)
            return v
          },
          (e: unknown) => {
            pushNavDiag(`[nav] append reject idx=${idx ?? '?'} ${e instanceof Error ? e.message : String(e)}`)
            throw e
          }
        )
      }
      return Promise.resolve(result)
    }
  }
  pushNavDiag('[nav] instrument installed')
}

/**
 * pre-paginated 翻页直通补丁：每 section 一页，不存在页内滚动，next/prev 直接换
 * section。原生 next/prev 依赖容器滚动位置判定（scrollLeft/scrollWidth 与
 * ltr/rtl 语义），会被外部布局干预（撑宽、margin 清理等）与 RTL 滚动实现差异
 * 污染，出现「滑块有效、翻页无反应」的静默失效，故完全绕开。
 * 封面场景（prev 的 prevPrev 为空）与书末（next 为空）仍回退原生/封面 patch。
 */
export async function installPaginatedNavigation(rendition: EpubRendition): Promise<void> {
  await (rendition as unknown as { started?: Promise<unknown> }).started
  const manager = (rendition as unknown as { manager?: EpubManagerLike | null }).manager
  if (!manager) return
  if (manager.layout?.name !== 'pre-paginated') return

  const origNext = manager.next
  if (typeof origNext === 'function') {
    manager.next = function (this: unknown) {
      const last = manager!.views?.last()?.section as
        | { index?: number; next?: () => ({ index?: number } | null) | null }
        | null
        | undefined
      const next = last?.next?.()
      if (!next) return origNext.call(this) // 书末：走原生（触发 atEnd 等）
      manager!.clear?.()
      manager!.updateLayout?.()
      return Promise.resolve(manager!.append?.(next))
        .then(() => manager!.handleNextPrePaginated?.(false, next, manager!.append))
        .then(() => manager!.views?.show())
    }
  }

  const origPrev = manager.prev
  if (typeof origPrev === 'function') {
    manager.prev = function (this: unknown) {
      const first = manager!.views?.first()?.section as
        | {
            index?: number
            prev?: () => ({ index?: number; prev?: () => unknown } | null) | null
          }
        | null
        | undefined
      const prev = first?.prev?.()
      if (!prev) return origPrev.call(this) // 已在第一页
      const prevPrev = prev.prev?.()
      // 封面场景（prev 的前一页为空）：交给封面单独成页 patch/原生处理
      if (!prevPrev) return origPrev.call(this)
      manager!.clear?.()
      manager!.updateLayout?.()
      // prepend 是 insertBefore(容器首子元素)，因此必须「先后页再前页」：
      // 先 prepend(prev) 得 [prev]，再 prepend(prevPrev) 得 [prevPrev, prev]，
      // 视觉顺序才是 prevPrev 左、prev 右（与原生 prev 一致）。顺序颠倒会得
      // [prev, prevPrev]，scrollTo 滚到末尾只露出右半边一页——症状即「上一页只翻一页」。
      return Promise.resolve(manager!.prepend?.(prev))
        .then(() => manager!.prepend?.(prevPrev))
        .then(() => {
          if (manager!.isPaginated && manager!.settings?.axis === 'horizontal') {
            if (manager!.settings.direction === 'rtl') {
              if (manager!.settings.rtlScrollType === 'default') {
                manager!.scrollTo?.(0, 0, true)
              } else {
                manager!.scrollTo?.(
                  (manager!.container?.scrollWidth ?? 0) * -1 + (manager!.layout?.delta ?? 0),
                  0,
                  true
                )
              }
            } else {
              manager!.scrollTo?.(
                (manager!.container?.scrollWidth ?? 0) - (manager!.layout?.delta ?? 0),
                0,
                true
              )
            }
          }
          manager!.views?.show()
        })
    }
  }
  pushCoverDiag('[cover] paginated nav installed')
}

/** 生成全部页定位点（CFI 列表），返回数组；length = 总页数 */
export function generateLocations(book: EpubBook): Promise<string[]> {
  return book.locations.generate(1024)
}

/** 从 relocated 事件提取归一化位置。
 *  index 优先用 CFI 反查的 spine 页索引（与单/双页模式无关）；
 *  locations 未就绪时该值缺失（-1），回退到 displayed 屏序号 */
export interface EpubLocationLike {
  cfi: string
  percentage: number
  /** spine 页索引（epub.js 由 CFI 反查；locations 未生成时为 -1） */
  location?: number | null
  displayed?: { page?: number; total?: number } | null
}

export function positionFromLocation(location: EpubLocationLike): EpubPosition {
  const loc = location.location
  const index =
    typeof loc === 'number' && loc >= 0
      ? loc
      : Math.max(0, (location.displayed?.page ?? 1) - 1)
  return {
    index,
    cfi: location.cfi,
    percentage: Math.round((location.percentage ?? 0) * 1000) / 10,
  }
}

/** 跳转到指定页索引（0 起；要求 locations 已生成） */
export async function displayPageIndex(
  book: EpubBook,
  rendition: EpubRendition,
  index: number
): Promise<void> {
  const total = book.locations.length()
  if (index < 0 || index >= total) return
  const cfi = book.locations.cfiFromLocation(index)
  await rendition.display(cfi)
}
