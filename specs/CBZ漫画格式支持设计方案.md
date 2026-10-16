# CBZ 漫画格式支持设计方案

> 状态：设计稿（待实现）
> 目标版本：不随本次改动更新（发版由维护者自行决定；当前 package.json 版本 1.2.2）
> 范围：.zip / .cbz 漫画导入与建档、阅读顺序与封面、基于 PDF Canvas 管线的完整阅读体验（单/双页、方向、缩放、翻页动画、预取、断点续读）
> 实现约束：遵循 `ireader-dev-tasks`（任务 D/E/F 为主；无新增 IPC 通道、无 DB 迁移为有意设计）与 `ireader-code-conventions`（Result 契约、中文注释、纯逻辑可测）

## 一、需求拆解与验收标准

| # | 原始需求 | 设计落点 | 验收方式 |
|---|----------|----------|----------|
| 1 | 支持 .zip / .cbz 压缩包漫画导入（扁平结构，内含 png/jpg 图片） | `libraryService.SUPPORTED_EXTS` 扩展 + 选择对话框过滤器扩展 + `detectFormat` 归为 `'cbz'`（`BookFormat` 扩展）；打开 .zip / .cbz 均按同一格式处理 | 导入含 120 张图的 .cbz 后文库出现新书；文件夹递归扫描可收录 .zip / .cbz |
| 2 | 以图片文件名作为阅读顺序 | 主进程 `cbzService` 枚举中央目录 → 过滤图片条目（png/jpg/jpeg/webp）→ 自然排序，序号即页码 | 以 `1.png / 2.png / 10.png` 命名的包，第 2 页必须是 `2.png`；排序规则由单测锁定 |
| 3 | 排序第一的图片作为漫画封面 | 封面队列新增 cbz 分支：拉取 `ireader://cbz/{id}/1` → 缩为 480px JPEG → `cover:submit` 落盘 | 导入后封面自动出现且等于 `001.png`；失败落占位、不阻塞队列 |
| 4 | 阅读体验对齐 PDF（单/双页、方向、缩放、动画、预取、进度、快捷键） | `reader` store 引入 `PageDocument` 联合类型 + `pageRenderer` 单点分发；CBZ 只新增「单页图片绘制」实现，页组/缓存/动画/热区/滑块/预取全部复用 | 按 PDF 功能清单逐项在 cbz 上可用；翻到第 60 页退出重进回到第 60 页 |
| 5 | 页数与阅读进度正确 | 导入时主进程统计图片条目数写入 `books.total_pages`；`reading_progress` 链路零改动 | 卡片进度圆环 = page / totalPages；继续阅读定位正确 |

**核心验收口径**：导入一本 120 页 CBZ → 自动封面 = `001.png`、页数 = 120；打开后单页/双页、RTL/LTR、四档缩放、翻页动画、预取、键盘与热区翻页全部与 PDF 行为一致；`npm run typecheck`、`npm test` 通过。

## 二、非目标（本期不做）

- **不支持加密 zip / 分卷 zip**：加密条目在清单阶段整体过滤（不解密），全包加密等同「无可用图片」处理。主流 CBZ 无此形态，引入解密属于安全与复杂度双重负担。
- **不做嵌套目录的章节树概念**：扁平结构是约定形态；嵌套目录时按完整路径自然排序，仅保证页序稳定，不解析层级语义。
- **不做 CBZ 内文本检索**：图片无文本层，与 PDF 现有行为一致（PDF 当前亦无文本检索）。
- **不改动阅读内核**：`spread.ts` / `pageCache.ts` / `pageCurl.ts` 零改动（已与内容源解耦）；不改 `reading_progress` 表结构。
- **不做 DB 迁移**：`books.total_pages` 与 `reading_progress` 直接复用，`MIGRATIONS` 不追加。
- **不动 EPUB 全链路**：epubReader store、epub.ts、EpubReaderView 无任何改动。
- **不更新版本号**：`package.json` 的 `version` 保持 1.2.2，发版时机由维护者自行决定（步骤 3 已确认）。

## 三、总体设计

### 3.1 分层与数据流

```
┌─ 渲染层 ────────────────────────────────────────────────────────────┐
│ ReaderView.vue（Canvas 阅读器；EPUB 之外的所有格式共用）               │
│   │ reader.open(id)                                                 │
│   ▼                                                                 │
│ reader store（doc = PageDocument 联合类型：{kind:'pdf'} | {kind:'cbz'}）│
│   │ renderPageToCanvas(doc, page, opts)                             │
│   ▼                                                                 │
│ pageRenderer.ts（单点分发：按 kind 选择实现）                          │
│   ├─ pdf.ts（pdf.js 矢量渲染，既有）                                  │
│   └─ cbz.ts（fetch 单页图片 → createImageBitmap → 绘制到 canvas）      │
└───────────────┬──────────────────────────┬──────────────────────────┘
                │ ireader://pdf/{id}       │ ireader://cbz/{id}/{page}
┌─ 主进程 ──────┼──────────────────────────┼──────────────────────────┐
│ protocol.ts：pdf/epub 直出原文件；cbz 逐页解压供给单张图片             │
│   ▼                                                                 │
│ cbzService.ts（yauzl：中央目录 → 过滤 → 自然排序 → 读取第 N 个条目）    │
└─────────────────────────────────────────────────────────────────────┘

封面链路（导入后）：coverQueue cbz 分支 → 拉取 ireader://cbz/{id}/1
                    → 480px JPEG → cover:submit 落盘（页数取自导入时统计）
导入链路：library:import → libraryService 计数图片条目 → books.total_pages
```

### 3.2 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 解压位置与供给方式 | 主进程解压 + `ireader://cbz` 逐页供给 | 守住「大文件不走 IPC」与纯离线红线；渲染层不接触压缩包，只按 id + 页码取图，与 pdf/epub「按 id 分发」同一心智 |
| 格式归一 | .zip 与 .cbz 统一为 `BookFormat = 'cbz'` | 两者同为 ZIP 容器、处理完全一致；扩展名差异只影响导入识别，避免无意义的双格式分支 |
| 阅读管线复用 | 复用 PDF 的 Canvas 管线，仅新增「单页绘制」实现 | 页组/位图缓存/翻页动画/热区/快捷键/预取/计时埋点均与内容源解耦；避免第二套阅读器与重复统计 |
| 视图抽象 | `PageDocument` 联合类型 + `pageRenderer` 单点分发 | 视图层改动收敛为 import 与类型替换；未来再扩格式只扩 union 与分发器一个分支 |
| 页数口径 | 导入时主进程统计图片条目写入 `total_pages` | 进度圆环/页码/断点即刻正确；避免「封面队列未完成时打开书页数为 0」的竞态；`cover:submit` 不再是 cbz 页数来源 |
| 封面判据 | `needsCoverGeneration` 改为仅判 `!coverUrl` | cbz 导入即有页数，原「页数未知」判据使其永远不入队；现有数据 coverUrl 与 totalPages 原子写入（cover:submit），行为等价，回归面由冒烟覆盖 |
| 条目缓存 | 不缓存，每个页请求重扫中央目录 | 中央目录解析为毫秒级、单页流式解压（内存 = 单页）；换取零失效逻辑与零常驻内存。若将来万级条目包感知变慢，再评估按 mtime + size 失效的缓存 |
| 阅读顺序 | 文件名自然排序（`localeCompare` numeric） | 同时兼容零填充（001/002）与非填充（1/2/10）两种命名；顺序稳定性由单测锁定 |
| ZIP 依赖 | `yauzl` + `@types/yauzl`（步骤 3 已确认） | 中央目录随机访问、单条目按需解压、zip64 支持完善；纯 JS 无原生编译，由 Vite 打进主进程 bundle |
| 版本号 | 不随本次改动更新 | 维护者自行发版（步骤 3 已确认） |

## 四、核心算法与口径

### 4.1 条目筛选与阅读顺序（主进程，纯函数）

```ts
// electron/services/cbzService.ts
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** 判断 zip 条目是否为可阅读图片：过滤目录、隐藏文件与 macOS 资源叉 */
export function isImageEntry(entryName: string): boolean {
  if (entryName.endsWith('/')) return false // 目录条目
  const segments = entryName.split('/')
  if (segments.includes('__MACOSX')) return false // macOS 压缩工具的资源叉目录
  const base = segments[segments.length - 1]
  if (base.startsWith('.')) return false // .DS_Store、隐藏文件
  return IMAGE_EXTS.has(path.extname(base).toLowerCase())
}

/** 图片条目按文件名自然排序（数字感知），返回即阅读顺序 */
export function sortImageEntries(entryNames: string[]): string[] {
  return entryNames
    .filter(isImageEntry)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}
```

- 页码口径：第 1 页 = 排序后第 1 个条目（即需求中的「封面图」），页码 `p`（1 基）↔ 条目下标 `p - 1`。
- 嵌套目录不做语义解析，按完整路径参与自然排序（扁平结构的排序结果与按文件名相同）。

### 4.2 单页读取流程（`readPage`）

```ts
// 每次请求独立 open/close，不驻留 fd，天然无失效逻辑
async function readPage(filePath, page /* 1 基 */) {
  const zipfile = await openZip(filePath)              // yauzl.open({ lazyEntries: true })
  try {
    const entries = await collectEntries(zipfile)      // 遍历中央目录；跳过 encrypted（bit0）与目录条目
    const names = sortImageEntries(entries.map(e => e.fileName))
    const name = names[page - 1]
    if (!name) return null                             // 越界 → 协议层 404
    const data = await readEntryBuffer(zipfile, entriesByName.get(name)) // openReadStream → concat
    return { data, contentType: contentTypeOf(name) }  // png / jpeg / webp 映射
  } finally {
    zipfile.close()
  }
}
```

- `countPages(filePath)` 复用同一次中央目录遍历，仅返回 `sortImageEntries(names).length`（导入时一次调用）。
- 加密条目（`generalPurposeBitFlag & 0x1`）在收集阶段整体丢弃：页面清单与页数只统计可读条目。

### 4.3 渲染层尺寸口径（与 pdf.js 语义一致）

```ts
// src/services/cbz.ts（纯函数，可单测）
export function computeCbzPageSize(
  naturalWidth: number, naturalHeight: number,
  options: Pick<RenderPageOptions, 'targetWidth' | 'targetHeight'>,
  dpr: number
): { cssWidth: number; cssHeight: number; pixelWidth: number; pixelHeight: number } {
  let scale = 1
  if (options.targetWidth) scale = options.targetWidth / naturalWidth  // 适宽：宽度精确等于目标宽
  else if (options.targetHeight) scale = options.targetHeight / naturalHeight // 适高：高度精确等于目标高
  // original：不传目标尺寸，scale = 1，CSS 像素 = 原图像素（与 PDF original 语义一致）
  const cssWidth = naturalWidth * scale
  const cssHeight = naturalHeight * scale
  return {
    cssWidth, cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * dpr)),
    pixelHeight: Math.max(1, Math.round(cssHeight * dpr)),
  }
}
```

`ReaderView.zoomRenderOptions()` 无需任何改动：适宽（双页取半宽）、适高、原始、自定义（以适高为基准 × scale）四种模式对 CBZ 自动生效。

### 4.4 边界场景防护清单

| 场景 | 行为 |
|------|------|
| 压缩包内无图片条目 | 导入成功（total_pages = 0）；封面生成失败落占位并在每次启动重试（与损坏 PDF 一致）；打开显示「压缩包中没有可识别的图片」错误页 |
| 压缩包损坏 / 中央目录不可读 | 导入时计数失败记 warn、total_pages = 0；页请求返回 500 → 渲染层 console 留痕，不崩溃 |
| 加密 zip（zipcrypto / AES） | 加密条目在清单阶段过滤（不解密，见 §二）；全包加密等同「无可用图片」 |
| 文件名非零填充（1 / 2 / 10.png） | 自然排序保证 1 → 2 → 10 的人类顺序 |
| 文件名非 UTF-8 编码 | 按 yauzl 解码结果排序，顺序仍确定稳定（仅影响极端命名） |
| 隐藏文件 / `__MACOSX` / `.DS_Store` | 清单过滤，不计入页码 |
| zip64（>4GB 或 >65535 条目） | yauzl 原生支持 |
| 文件被外部替换（页数变化） | 越界页请求 404 → 单页报错；重新导入恢复正常（与 PDF 替换同类边界） |
| 单页图片解码失败 | 该页 throw → `paintPage` catch 记 console，其余页正常（单页失败不拖垮整组） |

## 五、数据模型

**无 schema 变更，零迁移**：`MIGRATIONS` 数组不追加（避免无意义的版本号推进）。

- `books.total_pages`：CBZ 在**导入时**写入图片条目数（PDF 在封面生成后经 `cover:submit` 写入、EPUB 恒为 0 走 percentage，三格式口径互不影响）。
- `books.file_path` 扩展名即格式来源：`detectFormat` 派生，无需存储 format 列。
- `reading_progress`：page 语义与 PDF 完全一致（页组第一页，1 基），复用全部既有链路。

`booksRepo.insert` 扩展（`electron/db/repos/booksRepo.ts`）：

```ts
export interface NewBookInput {
  // ...既有字段
  /** 导入时已知的总页数（CBZ 图片条目数）；缺省 0，由既有 cover:submit 流程回填 */
  totalPages?: number
}

// INSERT 中 total_pages 由字面量 0 改为占位符 @totalPages
.prepare(`INSERT INTO books (title, file_path, file_size, total_pages, cover_path, added_at, last_opened_at, collection_id)
          VALUES (@title, @filePath, @fileSize, @totalPages, NULL, @addedAt, NULL, @collectionId)`)
.run({ totalPages: 0, collectionId: null, ...input })
```

## 六、IPC 与协议契约

### 6.1 共享类型变更（`shared/types.ts`）

```ts
export type BookFormat = 'pdf' | 'epub' | 'cbz' // 'cbz' 同时覆盖 .zip 与 .cbz 两种扩展名

export interface ReaderOpenResult {
  format: BookFormat
  /** ireader://pdf/{id}、ireader://epub/{id}（直出原文件）或 ireader://cbz/{id}（逐页地址前缀） */
  fileUrl: string
  numPages: number
  progress: ReadingProgress | null
}
```

### 6.2 通道变更：零新增

- **不新增任何 IPC 通道**：导入走既有 `library:import`、封面走既有 `cover:submit`、阅读走既有 `reader:open` / `reader:saveProgress`、页数据走协议——preload.ts 与 src/services/ipc.ts **零改动**。
- `library:import` 的 handler 由 `wrap` 换 `wrapAsync`（`importPaths` 因 CBZ 计数变为 async；对 preload/渲染层的 Promise 签名透明）。
- `dialog:pickBookFiles` 过滤器扩展：`extensions: ['pdf', 'epub', 'zip', 'cbz']`，名称由「电子书」改为「书籍与漫画」。

### 6.3 `ireader://cbz` 协议契约

| URL | 响应 | 说明 |
|-----|------|------|
| `ireader://cbz/{bookId}/{page}` | 200 + 图片二进制，`Content-Type: image/png \| image/jpeg \| image/webp` | `page` 为 1 基阅读页码 |
| 非法 URL（不匹配 `/^\/(\d+)\/(\d+)$/`） | 400 | 与既有 `/^\//` 数字解析分支并列，须在通用 bookId 解析**之前**分流 |
| 书不存在 / 非 cbz 格式 / 文件缺失 / 页码越界 | 404 | 渲染层 fetch 失败 → 单页报错 |
| 压缩包损坏（解压抛错） | 500 + 主进程日志留痕 | 渲染层 console 留痕 |

所有响应经既有 `withCors()` 附加 `Access-Control-Allow-Origin: *`（与 pdf/epub/cover 一致）。`ireader://cbz/{id}`（无页码）不提供直出，仅作为 `ReaderOpenResult.fileUrl` 的前缀形态。

## 七、主进程实现

### 7.1 cbzService（新建 `electron/services/cbzService.ts`）

职责：zip 条目枚举、图片筛选、自然排序、单页读取、导入时页数统计。仅依赖 `node:fs` / `node:path` / `yauzl`（不 import electron 与 logger，保证 vitest 可直接单测）。

```ts
/** 扫描中央目录后的可读图片条目，按阅读顺序排列（yauzl lazyEntries 模式） */
export async function listImageEntries(filePath: string): Promise<string[]>
/** 导入时页数统计（listImageEntries().length；压缩包不可读时抛出，由调用方容错） */
export async function countPages(filePath: string): Promise<number>
/** 读取第 page 个阅读页（1 基）；越界返回 null；解压失败抛出 */
export async function readPage(
  filePath: string, page: number
): Promise<{ data: Buffer; contentType: string } | null>
```

实现要点：

- `yauzl.open(filePath, { lazyEntries: true }, cb)` → 循环 `readEntry()` 收集条目，`end` 事件结束（yauzl 必须完整遍历中央目录，无法按下标跳读，这是「每请求重扫」的成本来源，见 §3.2 取舍）。
- 单页读取：按名字找到条目 → `openReadStream` 收集 chunks → `Buffer.concat` → `finally` 中 `zipfile.close()`。
- 条目名解码：yauzl 默认 `decodeStrings`，UTF-8 标志位缺失时按 cp437 解码（顺序仍确定，见 §4.4）。
- Content-Type 映射：`.png` → `image/png`；`.webp` → `image/webp`；其余（jpg/jpeg）→ `image/jpeg`。

### 7.2 protocol（`electron/services/protocol.ts`）

在 `kind === 'pdfjs'` 分流之后、通用 `bookId` 解析之前，新增 `cbz` 分支（通用解析 `Number(pathname)` 对 `/123/45` 会得 NaN，必须提前分流）：

```ts
if (kind === 'cbz') {
  const m = /^\/(\d+)\/(\d+)$/.exec(url.pathname)
  if (!m) return new Response('Invalid cbz url', { status: 400 })
  const bookId = Number(m[1]); const page = Number(m[2])
  const row = booksRepo.findById(bookId)
  if (!row || detectFormat(row.file_path) !== 'cbz' || !fs.existsSync(row.file_path)) {
    return new Response('Not Found', { status: 404 })
  }
  try {
    const p = await cbzService.readPage(row.file_path, page)
    if (!p) return new Response('Not Found', { status: 404 })
    return withCors(new Response(p.data, { headers: { 'Content-Type': p.contentType } }))
  } catch (e) {
    logger.error(`[protocol] cbz 解压失败 bookId=${bookId} page=${page}: ${e}`)
    return new Response('Bad cbz archive', { status: 500 })
  }
}
```

文件头注释与 `detectFormat` 引入（`import { detectFormat } from './libraryService'`；无循环依赖：libraryService 不 import protocol）。

### 7.3 libraryService（`electron/services/libraryService.ts`）

```ts
const SUPPORTED_EXTS = ['.pdf', '.epub', '.zip', '.cbz']

/** 按扩展名派生书格式（未知扩展名按 PDF 处理，兼容旧数据） */
export function detectFormat(filePath: string): Book['format'] {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.epub') return 'epub'
  if (ext === '.zip' || ext === '.cbz') return 'cbz'
  return 'pdf'
}
```

- `importPaths` 改为 **async**（返回 `Promise<{ added, skipped }>`）：循环内 `detectFormat(filePath) === 'cbz'` 时 `try { totalPages = await cbzService.countPages(filePath) } catch { logger.warn(...); totalPages = 0 }`，计入 `booksRepo.insert`。
- 计数失败不中止导入：书仍入库（total_pages = 0），后续由封面队列与打开时错误页兜底（与损坏 PDF 的既有语义一致）。
- `rowToBook` / 去重 / 合集归属等逻辑不变；JSDoc 更新为「PDF/EPUB/CBZ」。

### 7.4 handlers（`electron/ipc/handlers.ts`）

- `dialog:pickBookFiles`：`filters: [{ name: '书籍与漫画', extensions: ['pdf', 'epub', 'zip', 'cbz'] }]`。
- `library:import`：`wrap` → `wrapAsync`（其余编排与 `notifyLibraryChanged` 广播不变）。

## 八、渲染层实现

### 8.1 cbz 渲染器（新建 `src/services/cbz.ts`）

职责：拉取单页图片并绘制到 canvas；与 pdf.ts 相同的重入取消语义与 DPR 口径。

```ts
/** 纯函数：见 §4.3，独立单测 */
export function computeCbzPageSize(...): { cssWidth; cssHeight; pixelWidth; pixelHeight }

/** 渲染第 page 页到 canvas；同 canvas 重入时取消上一次绘制（WeakMap 标记，迟到结果不上屏） */
export function renderCbzPageToCanvas(
  bookId: number, pageNumber: number, options: RenderPageOptions
): Promise<void>
```

实现要点：

- `fetch('ireader://cbz/{bookId}/{pageNumber}')` → `!res.ok` 抛 `加载漫画第 N 页失败（HTTP xxx）`；`new Blob([buf], { type: res.headers.get('Content-Type') ?? '' })` → `createImageBitmap`（Chromium 离主线程解码；Electron 42 内置支持）。
- 按 §4.3 计算尺寸 → 设置 `canvas.width/height` 物理像素与 `style.width/height` CSS 像素 → `drawImage(bitmap, 0, 0, pixelWidth, pixelHeight)` → `bitmap.close()` 释放。
- 取消语义对照 pdf.ts：`WeakMap<HTMLCanvasElement, { cancelled }>`，`await` 解码期间被新渲染重入则标记取消，醒来后只跳过绘制（不做解码中止，成本可忽略）。
- 与 pdf.ts 的差异：无 loadingTask/文档对象生命周期（CBZ 无长生命周期句柄，`reader.close()` 无需销毁动作）。

### 8.2 渲染分发器（新建 `src/services/pageRenderer.ts`）

```ts
// src/services/pageRenderer.ts
export type PageDocument =
  | { kind: 'pdf'; pdf: PdfDocument }
  | { kind: 'cbz'; bookId: number }

export function renderPageToCanvas(
  doc: PageDocument, pageNumber: number, options: RenderPageOptions
): Promise<void> {
  return doc.kind === 'cbz'
    ? renderCbzPageToCanvas(doc.bookId, pageNumber, options)
    : renderPdfPageToCanvas(doc.pdf, pageNumber, options) // pdf.ts 现有实现重命名导入
}

export type { RenderPageOptions } from './pdf'
```

### 8.3 reader store（`src/stores/reader.ts`）

- `doc` 类型改为 `shallowRef<PageDocument | null>(null)`（实施修正：`ref` 经 Pinia 的 UnwrapRef 深度结构展开会把 `pdf: PDFDocumentProxy` 变为丢失类私有字段 `#private` 的结构类型，导致 `reader.doc` 不能赋给 `PageDocument`（既有代码靠 `as PdfDocument` 强转绕过）；`shallowRef` 不做深度展开，从而兑现去掉强转的目标）；`open()` 按 `result.format` 分支：

```ts
const result = await ipc.reader.open(id)
bookId.value = id
if (result.format === 'cbz') {
  // 页数来自导入时条目统计；为 0 说明压缩包不可用，与 PDF 加载失败同样进错误页
  if (result.numPages <= 0) throw new Error('压缩包中没有可识别的图片')
  doc.value = markRaw({ kind: 'cbz', bookId: id })
  numPages.value = result.numPages
} else {
  const loaded = await loadPdfWithTask(result.fileUrl)
  loadingTask = loaded.task
  doc.value = markRaw({ kind: 'pdf', pdf: loaded.doc })
  numPages.value = result.numPages || loaded.doc.numPages
}
// 进度回退与 rebuildSpreads 逻辑完全不变（mode/direction/zoom/coverSinglePage）
```

- `close()`：`loadingTask?.destroy()` 对 cbz 自然为 null 空操作，其余不变。

### 8.4 ReaderView.vue 接缝

| 位置 | 变更 |
|------|------|
| import | `renderPageToCanvas / RenderPageOptions / PdfDocument` 来源由 `../services/pdf` 换成 `../services/pageRenderer`（`PageDocument`） |
| `paintPage(doc: PdfDocument…)` | 形参类型换为 `PageDocument`（函数体零改动） |
| `renderCurrentSpread()` / `prefetchNeighbors()` | `const doc = reader.doc as PdfDocument` 改为本地取用 `const doc = reader.doc; if (!doc) return`（联合类型自然收窄，去 cast） |
| 其余全部 | 模板、热区、滑块、键盘、滚轮、拖拽平移、翻页动画、showBars、缩放菜单——**零改动** |

`isEpub` 分发逻辑不变：EPUB 走 EpubReaderView，pdf 与 cbz 走同一 Canvas 分支。

### 8.5 封面队列（`src/services/coverQueue.ts`）

- 判据调整（§3.2）：`needsCoverGeneration` 改为 `!book.coverUrl`（入参类型保留 `totalPages` 字段，兼容既有调用方与测试字面量透传，但不再参与判断）。
- 新增 `renderCbzCoverJpeg(url)`：`fetch` → `createImageBitmap` → 缩至宽 480（只缩不放）→ `toBlob('image/jpeg', 0.8)`，结构对照既有 `renderEpubCoverJpeg`。
- `processOne` 入参由 `(bookId, title, format)` 扩展为携带 `totalPages` 的队列项；cbz 分支提交封面时沿用导入时的页数：

```ts
if (format === 'cbz') {
  const image = await renderCbzCoverJpeg(`ireader://cbz/${bookId}/1`)
  await ipc.cover.submit(bookId, image, totalPages) // 页数已在导入时入库，此处回写同值
  return
}
```

### 8.6 自动继承、零新增代码的既有能力

| 能力 | 来源 |
|------|------|
| 单/双页、封面单独成页、RTL/LTR | `buildSpreads` + store（不变） |
| 位图 LRU 缓存、翻页动画、滑块拖动、预取 | `pageCache` / `pageCurl` / `ReaderView`（不变） |
| 键盘、滚轮、热区、拖拽平移、全屏、上一本/下一本 | `ReaderView`（不变） |
| 阅读计时与统计 | `readingTracker`（ReaderView 单点埋点，不变） |
| 断点续读、进度圆环、缺失检测、合集归属、重命名、重新定位 | `reading_progress` / `libraryService`（不变） |

## 九、页面与交互

无新路由、无新页面、无新组件；变更集中在既有界面文案与状态：

| 位置 | 变更 |
|------|------|
| 导入选择框（系统对话框） | 过滤器名称「书籍与漫画」，可选 .pdf / .epub / .zip / .cbz |
| 阅读页加载态 | 沿用「加载中…」；CBZ 打开时流程同 PDF |
| 阅读页错误态 | 无图片/损坏包 → 既有「无法打开本书：…」错误页 + 返回文库按钮，文案见 §8.3 |
| BookCard | 零改动（封面、进度圆环、文件缺失徽标按既有字段自动适配） |

## 十、文件变更清单

**主进程（electron/）**

| 文件 | 变更 |
|------|------|
| `services/cbzService.ts` | 新建：条目枚举/筛选/自然排序/单页读取（§4.1、§4.2、§7.1） |
| `services/cbzService.test.ts` | 新建：筛选与排序单测（§11.1） |
| `services/protocol.ts` | 新增 `ireader://cbz` 分支（§7.2） |
| `services/libraryService.ts` | SUPPORTED_EXTS / detectFormat / importPaths 计数（§7.3） |
| `db/repos/booksRepo.ts` | insert 支持 totalPages 入参（§5） |
| `ipc/handlers.ts` | library:import → wrapAsync；dialog 过滤器扩展（§7.4） |

**共享（shared/）**

| 文件 | 变更 |
|------|------|
| `types.ts` | BookFormat +'cbz'；ReaderOpenResult 注释更新（§6.1） |

**渲染层（src/）**

| 文件 | 变更 |
|------|------|
| `services/cbz.ts` | 新建：单页渲染 + 尺寸纯函数（§4.3、§8.1） |
| `services/cbz.test.ts` | 新建：尺寸计算单测（§11.1） |
| `services/pageRenderer.ts` | 新建：PageDocument 分发器（§8.2） |
| `stores/reader.ts` | open 分支 + doc 联合类型（§8.3） |
| `views/ReaderView.vue` | 渲染分发接入（§8.4，仅 import/类型级改动） |
| `services/coverQueue.ts` | 判据调整 + cbz 封面分支（§8.5） |
| `services/coverQueue.test.ts` | 断言更新（§11.1） |

**工程与文档**

| 文件 | 变更 |
|------|------|
| `package.json` | dependencies + `yauzl`、devDependencies + `@types/yauzl`（version 不更新） |
| `readme.md` | 收尾更新：格式说明与功能列表补充 CBZ/ZIP（可选，不影响功能验收） |

不改动：`db/database.ts`（零迁移）、`db/repos/progressRepo.ts`、`preload.ts`、`electron-env.d.ts`、`src/services/ipc.ts`、`spread.ts`、`pageCache.ts`、`pageCurl.ts`、`pdf.ts`（仅重命名导入消费方）、EPUB 全链路（`epubReader.ts` / `epub.ts` / `EpubReaderView.vue`）、`readingTracker.ts`、`statsService.ts`、`vite.config.ts`。

## 十一、测试计划

### 11.1 单元测试（Vitest，随实现同步补）

`electron/services/cbzService.test.ts`（纯函数，node 环境）：

| 用例 | 断言 |
|------|------|
| 目录条目被过滤 | `ch01/` 等以 `/` 结尾的名字不入选 |
| 非图片扩展名被过滤 | `.txt` / `.xml`（comicinfo）不入选 |
| 隐藏文件与 `__MACOSX` 被过滤 | `.DS_Store`、`__MACOSX/._001.png` 不入选 |
| 零填充文件名保持字典序 | 001…120 排序结果与原顺序一致 |
| 非零填充按数字序 | `1.png / 2.png / 10.png` → `1 → 2 → 10` |
| 大小写扩展名兼容 | `.PNG` / `.JPG` 入选 |
| 嵌套路径按完整路径排序 | `ch01/001.png` 排在 `ch02/001.png` 前 |

`src/services/cbz.test.ts`（纯函数）：

| 用例 | 断言 |
|------|------|
| 适宽：宽度等于目标宽，高度按比例 | `computeCbzPageSize(1000, 2000, { targetWidth: 500 }, 1)` → css 500×1000 |
| 适高：高度等于目标高，宽度按比例 | `{ targetHeight: 800 }` → css 400×800 |
| 原始：CSS 尺寸等于原图像素 | 无目标尺寸 → css 1000×2000 |
| DPR 乘算进物理像素 | dpr = 2 → pixel 尺寸为 css 的 2 倍 |

`src/services/coverQueue.test.ts`（更新既有断言）：

| 用例 | 断言 |
|------|------|
| 无封面则生成（与页数无关） | `{ coverUrl: null, totalPages: 128 }` → true（原「页数已知则不需要」用例按新语义翻转） |
| 已有封面不生成 | 不变 |
| pickPendingCoverIds 保持顺序 | `[3, 2, 4]`（含「页数已知但无封面」的新增项） |

### 11.2 冒烟与手工验证清单

1. `npm run typecheck`、`npm test` 通过。
2. 构造测试包：用脚本生成 120 张图（含零填充与非零填充各一组、混合 png/jpg）打包为 `测试.cbz` 与 `测试2.zip`。
3. `npm run dev`：导入 `测试.cbz` → 文库出现新书、封面 = 第一张图、页数 120。
4. 打开：单页适高 → 切双页（封面单页居中）、RTL/LTR、四档缩放、Ctrl+滚轮步进、拖拽平移。
5. 翻页动画（点热区/滚轮/方向键/空格/滑块拖动）逐项与 PDF 对照一致。
6. 翻到第 60 页返回 → 卡片圆环约 50% → 重开回到第 60 页。
7. 文件夹递归导入（子目录含 .cbz / .zip）→ 全部收录；非零填充包第 2 页为 `2.png`。
8. 损坏 zip / 无图 zip：导入成功、占位封面、打开显示错误页，应用不崩溃。
9. 阅读统计回归：CBZ 读 2 分钟 → 统计页今日与排行正确计入。
10. PDF / EPUB 回归：各读一本验证封面队列（谓词变更影响面）、进度、翻页无回归。
11. 数据库抽查：`ELECTRON_RUN_AS_NODE=1 npx electron <脚本>` 查看 `books.total_pages = 120`。
12. 发版前（可选）：`npm run build` 打包安装后，在安装版中重复步骤 3、4（验证 yauzl 打入 bundle 后运行正常）。

## 十二、实施顺序（里程碑）

| 里程碑 | 内容 | 完成标准 |
|--------|------|----------|
| M1 主进程解压与导入 | 安装 yauzl + @types/yauzl → cbzService（+单测）→ booksRepo.insert → libraryService → handlers → protocol 分支 | typecheck / test 绿；dev 下导入 cbz 后 DB total_pages 正确；临时 fetch `ireader://cbz/{id}/{n}` 可取到图片 |
| M2 阅读链路 | cbz.ts（+尺寸单测）→ pageRenderer → reader store → ReaderView 接入 | 打开 cbz 可翻页/双页/方向/缩放/动画；PDF 阅读无回归 |
| M3 封面与入库体验 | coverQueue 判据调整 + cbz 分支 + 测试更新 | 导入即自动出封面；进度圆环按页数正确 |
| M4 回归与收尾 | §11.2 全量冒烟 + README 更新 + 打包冒烟（可选） | 核心验收口径（§一）全部满足；PDF/EPUB 回归通过 |

## 十三、风险与取舍记录

| 项 | 取舍 | 影响与备注 |
|----|------|------------|
| 不缓存条目清单 | 每页请求重扫中央目录 | 毫秒级成本（单页解压仍流式）；避免失效逻辑与常驻内存。万级条目包若感知变慢，扩展点：按 mtime + size 失效的内存缓存 |
| 加密 / 分卷 zip 不支持 | 分别过滤条目与打开报错 | 非目标；如未来有需求，yauzl 支持 zipcrypto 解密的扩展空间存在（需密码输入交互，属新需求） |
| 封面判据改为 `!coverUrl` | 影响面覆盖 PDF/EPUB 队列行为 | 现有数据 coverUrl 与 totalPages 由 cover:submit 原子写入，行为等价；测试断言随语义更新，冒烟步骤 10 专项回归 |
| `library:import` 变 async | handler 换 wrapAsync | 对 preload/渲染层签名透明；importPaths 的两个既有调用方（LibraryView.importAndReport、合集内导入）已 await |
| 自然排序依赖 ICU locale | 单测锁定顺序 | Electron 内置完整 ICU，行为跨平台稳定；极端非 UTF-8 命名仅影响顺序观感，不影响可用性 |
| yauzl 打进主进程 bundle | 与 better-sqlite3（external）不同路径 | yauzl 为纯 JS 无原生编译，Vite 打包无风险；若打包后出现 CJS/ESM 互操作问题，退路是加入 vite.config.ts external（生产依赖由 electron-builder 自动打包，参照 better-sqlite3 先例） |
| 页数随文件外部替换失真 | 与 PDF 替换同类边界 | 越界页报错、重新导入恢复；不做文件 mtime 监控（YAGNI） |
| 单页内存峰值 = 解码后位图 | 大扫描件与 PDF 渲染同量级 | pageCache 12 张上限不变；`bitmap.close()` 及时释放中间对象 |
