# EPUB 翻页动画与 PDF 对齐设计方案

> **状态**：设计稿（待确认）
> **目标版本**：不修改 `package.json` version（版本号由用户发版时自行升级）
> **范围**：EPUB 阅读器补齐与 PDF 一致的仿真纸张卷曲翻页动画（含新增 `window:captureRegion` IPC）；翻页交互语义（热区方向感知、滑块松手补播）同步对齐
> **实现约束**：遵循 ireader-dev-tasks（任务 A 端到端 IPC 六步链路 / 任务 E 阅读器行为 / 任务 F 验证流程）与 ireader-code-conventions（Result 契约、纯离线红线、中文注释）

---

## 一、需求拆解与验收标准

| 原始需求 | 设计落点 | 验收方式 |
|---|---|---|
| EPUB 翻页呈现与 PDF 一致的纸张卷曲动画 | 新增 `src/services/capture.ts` 截图冻结帧 + 复用 `playPageCurl`（`src/services/pageCurl.ts`）；`EpubReaderView.vue` 新增统一入口 `turnPage(dir)` 做时序编排 | 同机同模式下，热区点击 EPUB 翻页，动画时长（450ms）、折缝推进轨迹、光影与 PDF 肉眼无差异 |
| 键盘 / 滚轮 / 底栏按钮触发同样动画 | 全部触发方式改走 `turnPage` 统一入口（键盘语义不变，与 PDF 相同） | 四种触发方式各验一次，均播放卷曲动画 |
| 热区交互语义与 PDF 一致 | `onHotzoneClick` 改用 PDF 同款方向感知公式（ReaderView.vue L527：LTR 右热区=下一页 / RTL 左热区=下一页） | RTL 下点左热区=下一页；LTR 下点右热区=下一页；与 PDF 行为完全一致 |
| 滑块松手补播一次卷曲 | 改造 `onSlideInput`/`onSlideChange`（EpubReaderView.vue L337-359）：拖动期间瞬切（保留 200ms 节流），松手后从拖动开始画面补播一次卷曲 | 拖动跟手瞬切、松手播放唯一一次卷曲；与 PDF `finishSlideWithCurl`（L563-581）行为一致 |
| 翻页过程无白屏 / 闪跳（epub.js 重建视图过程不可见） | 截图冻结帧覆盖 `.epub-area`，卷曲首帧画出后揭除 | 图片型与文字型书翻页全程无重建过程露出 |
| 快速连翻不吃操作、不叠影 | busy 降级：连翻时取消当前动画 + 本次瞬切；序号（seq）作废旧编排 | 连按 PageDown 10 次：无冻结帧残留、无重复跳页、最终位置正确 |
| 跟随系统减弱动态效果 | `reducedMotion` 判定（对齐 ReaderView.vue L149-151），命中时瞬切 | 开启系统「减弱动态效果」后翻页瞬切 |

**核心验收口径**：同一台机器上，EPUB 与 PDF 的翻页动画时长（450ms）、视觉轨迹（折缝推进 + 旧页原样平移 + 投影光影）无法肉眼分辨差异；连续翻页 10 次无冻结帧残留、无重复跳页、无白屏闪跳；动画首帧延迟（操作 → 卷曲开始）文字型书 ≤ 150ms、图片型书 ≤ 300ms。

---

## 二、非目标（本期不做）

1. **不修改 epub.js 引擎与分页/渲染逻辑**：动画只在视图外层编排，`epub.ts` 的既有补丁（pre-paginated 直通导航、fit 逻辑）不动。
2. **跨书切换、单双页/方向/字号/缩放切换不加动画**：PDF 侧同类操作亦无动画，仅「翻页」动作对齐。
3. **不为 EPUB 增加缩放后拖拽平移等新交互能力**：与本次对齐目标无关。
4. **不新增 npm 依赖**：`webContents.capturePage` 与结构化克隆均为 Electron / Chromium 内置能力。
5. **不涉及数据库与设置项**：无迁移、无新设置；减弱动态效果跟随系统媒体查询，不落设置项。
6. **不改变进度保存链路**：CFI 断点定位与 percentage 保存逻辑零改动。

---

## 三、总体设计

### 3.1 分层数据流

```
渲染层（src/views/EpubReaderView.vue）
  用户操作：热区 / 键盘 / 滚轮 / 底栏按钮 / 滑块松手
        │
        ▼
  turnPage(dir)  ── 统一入口：busy 降级、seq 作废、reduced-motion 直通
        │
        ├─(1) captureHide=true → 双 rAF（瞬隐控制栏，取干净像素）
        ├─(2) captureRegionToCanvas(rect)            [src/services/capture.ts]
        │        → ipc.window.captureRegion ──────────────┐
        ├─(3) 冻结帧(from)覆盖 .epub-area                  │
        ├─(4) store.next()/prev()  → epub.js 重建 iframe 视图
        ├─(5) waitViewsSettled(rendition, 800)      [src/services/epub.ts]
        │        等图片加载 + 双 rAF，超时兜底
        ├─(6) playPageCurl({ from, to: 省略, fromRight }) [src/services/pageCurl.ts]
        │        透明区透出实时新视图；首帧后揭除冻结帧
        └─(7) 卷曲结束 onDone：揭除覆盖层、释放 busy
                                                   │
主进程（electron/ipc/handlers.ts）                  │
  ipcMain.handle('window:captureRegion')  ◄─────────┘
        → getWin().webContents.capturePage(rect)
        → NativeImage.toPNG() → Uint8Array（结构化克隆回渲染层）
```

### 3.2 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 动画实现路线 | 主进程 `capturePage` 截图 + 复用 `playPageCurl` | EPUB 正文在 iframe 内，渲染层任何 canvas 手段都无法 `drawImage` 取得其像素；`capturePage` 捕获合成输出（含 iframe），是唯一高保真路径；纯本地能力，无网络依赖（用户已确认新增此 IPC） |
| 新页底图（`to`）处理 | **不捕获新页**，`PageCurlOptions.to` 改为可选，省略时覆盖层透明区透出实时视图 | 若先捕获新页再播动画，揭层瞬间实时 DOM 与位图交接会产生一次白色/闪烁揭示；且二次截图多一次 IPC 往返（PDF 因同屏 canvas 可即时合成才采用双快照，EPUB 无条件） |
| 视图重建过程遮盖 | 捕获旧画面作「冻结帧」覆盖 `.epub-area`，卷曲首帧画出后揭除 | `rendition.next()/prev()` 会 clear + 重排 iframe，不加遮盖会直接露出重建过程（白屏/闪跳） |
| 快速连翻 | busy 期间：取消当前动画 + seq 作废旧流程，本次请求瞬切（无动画） | 覆盖层/冻结帧在屏时再截图会把覆盖层像素拍进冻结帧（污染）；EPUB 无法像 PDF 那样「cancel 后立即重拍」 |
| 热区语义 | 与 PDF 完全一致的方向感知公式 | 用户已确认全对齐范围 |
| 滑块 | 拖动瞬切（保持 200ms 节流）+ 松手补播一次卷曲 | 与 PDF 唯一一次动画语义一致（L531-581） |
| 控制栏处理 | 截图前瞬时隐藏（无过渡），隐藏状态维持到卷曲结束（onDone 后淡入恢复） | 冻结帧必须是干净页面像素；覆盖层 z-index 5 高于控制栏 z-index 2，中途恢复会被不透明像素遮盖产生「闪断」，贯穿整段翻页隐藏可避免幽灵栏与闪断（典型场景控制栏本已自动隐藏，影响可忽略） |
| 版本号 | 不修改 `package.json` | 用户明确表示发版时自行升级 |

---

## 四、核心算法与边界防护

### 4.1 turnPage 编排（TS 伪代码）

```ts
// 状态：turnBusy 防重入；turnSeq 世代号作废跨 await 的旧流程（同 PDF renderCurrentSpread 序号思路）
let turnBusy = false
let turnSeq = 0
let curlHandle: PageCurlHandle | null = null
let freezeEl: HTMLCanvasElement | null = null

async function turnPage(dir: 'forward' | 'back'): Promise<void> {
  if (!store.ready) return
  const plain = () => (dir === 'forward' ? store.next() : store.prev())

  // 快速连翻：作废进行中的编排 + 揭除动画 + 释放 busy，本次瞬切（不截图，避免拍到覆盖层）
  if (turnBusy) {
    turnSeq++
    discardTurn()          // curlHandle?.cancel() + removeFreeze()
    turnBusy = false
    captureHide.value = false   // 旧流程已作废不会自行释放，这里统一复位
    void plain()
    return
  }
  if (reducedMotion) return void plain()

  const area = epubAreaEl.value
  const root = rootEl.value
  if (!area || !root) return void plain()

  turnBusy = true
  const seq = ++turnSeq
  try {
    // 1. 瞬隐控制栏 → 双 rAF → 捕获干净旧画面
    captureHide.value = true
    await doubleRaf()
    if (seq !== turnSeq) return
    let from: HTMLCanvasElement | null = null
    try {
      const rect = area.getBoundingClientRect()
      from = await captureRegionToCanvas({
        x: rect.left, y: rect.top, width: rect.width, height: rect.height,
      })
    } catch { from = null }        // capture 失败：降级无动画
    // 控制栏维持隐藏至卷曲结束（onDone / 提前返回的 finally 复位），避免覆盖层遮栏闪断
    if (seq !== turnSeq) return

    // 2. 冻结帧先上屏（此刻实时画面仍是旧页，视觉无缝），再驱动 epub.js 重建视图
    //    位移判定用 CFI：文字型书 index 是 location 块索引（约 1024 字符/块），一屏翻页可能仍在同块内
    const prevCfi = store.current?.cfi
    if (from) attachFreeze(area, from)
    await plain()
    if (seq !== turnSeq) return   // 已被连翻流程接替，冻结帧已由 discardTurn 揭除

    // 3. 未发生位移（首/尾页）：仅揭除冻结帧
    if (!from || !store.current || store.current.cfi === prevCfi) { removeFreeze(); return }

    // 4. 等新视图稳定后播卷曲；省略 to：透明区透出实时新视图，随动画推进自然揭示
    const rendition = store.getRendition()
    if (rendition) await waitViewsSettled(rendition, 800)
    if (seq !== turnSeq) return
    const fromRight = (dir === 'forward') === (store.direction === 'ltr')  // 同 PDF L325/L573
    curlHandle = playPageCurl({
      container: root,
      target: area,
      from,
      fromRight,
      onDone: () => { curlHandle = null; removeFreeze(); turnBusy = false; captureHide.value = false },
    })
    // 卷曲首帧已画出旧页全幅 → 双 rAF 后揭除冻结帧（无缝）
    void doubleRaf().then(() => { if (seq === turnSeq) removeFreeze() })
  } finally {
    // 提前返回的路径（未进入卷曲）释放 busy 并恢复控制栏；卷曲路径由 onDone 释放
    if (seq === turnSeq && !curlHandle) {
      turnBusy = false
      captureHide.value = false
    }
  }
}

/** 冻结帧：from 快照（物理像素 + CSS style 尺寸）绝对定位铺满 .epub-area；
 *  不拦截交互（pointer-events: none），连翻请求由 busy 逻辑兜底 */
function attachFreeze(area: HTMLElement, from: HTMLCanvasElement) {
  freezeEl = from
  from.style.position = 'absolute'
  from.style.left = '0'
  from.style.top = '0'
  from.style.zIndex = '1'          // 高于 iframe 与其它 z-auto 子节点；低于控制栏 z2 与覆盖层 z5
  from.style.pointerEvents = 'none'
  area.appendChild(from)
}
```

### 4.2 waitViewsSettled（epub.ts 新增）

```ts
/** 等待当前视图稳定：全部 <img> 加载/失败 + 双 rAF；超时兜底不阻断（供翻页动画揭层前调用） */
export async function waitViewsSettled(rendition: EpubRendition, timeoutMs = 800): Promise<void> {
  const waits: Promise<void>[] = []
  for (const contents of rendition.getContents()) {
    const doc = contents.document
    if (!doc) continue
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      if (img.complete) continue
      waits.push(new Promise((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      }))
    }
  }
  await Promise.race([
    Promise.allSettled(waits),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
  await doubleRaf()
}
```

注：若 `EpubRendition` 类型声明缺少 `getContents`，按 epub.ts 现有 `as unknown as {...}` 收窄写法处理（L287-288 先例）。

### 4.3 边界场景防护

| 场景 | 防护 |
|---|---|
| `captureRegion` 失败 / 窗口不可用 | 跳过动画，正常完成本次翻页（冻结帧不上屏） |
| 首/尾页翻页未发生位移（CFI 不变；不用 index，文字型书一屏可能不足一个 location 块） | 不动画，仅揭除冻结帧 |
| 截图期间 / 卷曲中再次翻页（busy） | 取消动画 + seq 作废 + 本次瞬切（降级，见风险表） |
| 滑块拖动中 | `sliderDragging` 期间不触发卷曲（只有松手补播一次） |
| 松手后未发生位移 | 不播动画（CFI 不变判定，语义对齐 PDF L537 的 `idx !== currentIndex`） |
| 拖动开始时截图未就绪 | 松手流程 await 该 promise；失败则跳过动画 |
| 滑块拖动开始时截图（控制栏可见） | 快照含控制栏像素：卷曲期间滑块 thumb 冻结约 450ms，结束后恢复真实状态（接受） |
| reduced-motion | 全局直通瞬切（含滑块补播） |
| 动画期间窗口 resize | `onResize` 防抖回调里检测 busy → 取消动画并揭除冻结帧 |
| 组件卸载 | `onBeforeUnmount` 追加 `discardTurn()`（cancel + 揭除冻结帧） |
| 跨书切换（上一本/下一本/路由跳转） | `doOpen` 开头：`turnSeq++` + `discardTurn()` + busy/captureHide 复位（防旧书冻结帧残留新书阅读区） |
| 未 ready / 加载失败态 | `turnPage` 入口 guard 直接 return |

---

## 五、IPC 契约

### 5.1 shared/types.ts 新增类型

```ts
/** 窗口内容区截图矩形（CSS/DIP 像素，相对页面内容区左上角；EPUB 翻页冻结帧用） */
export interface CaptureRegionRect {
  x: number
  y: number
  width: number
  height: number
}
```

错误码复用现有 `INVALID_PARAMS` / `UNKNOWN`（shared/types.ts L64-73），不新增 ErrorCode。

### 5.2 通道表

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `window:captureRegion` | `CaptureRegionRect` | `Uint8Array`（PNG 字节） | 截取窗口内容区指定矩形（含 iframe 合成输出）；纯本地、无网络 |

### 5.3 调用链（任务 A 六步）

1. `shared/types.ts`：新增 `CaptureRegionRect`（如上）。
2. `electron/preload.ts`：`window` 域（L98-101）追加——
   `captureRegion: (rect: CaptureRegionRect): Promise<Result<Uint8Array>> => ipcRenderer.invoke('window:captureRegion', rect)`。
3. `electron/ipc/handlers.ts`：`window:setFullscreen`（L229-234）之后追加 handler（见 §六）。
4. `src/services/ipc.ts`：`window` 域（L87-89）镜像——
   `captureRegion: (rect: CaptureRegionRect) => unwrap(api().window.captureRegion(rect))`。
5. 消费方：`src/services/capture.ts` 调用 `ipc.window.captureRegion`，失败抛 `IpcError` 由调用方捕获降级。
6. 无书库数据变更，不需要 `notifyLibraryChanged`。

### 5.4 服务层校验规则

- `rect` 四个字段任一非有限数字 → `throw { code: 'INVALID_PARAMS', message: '截图区域参数无效' }`。
- 窗口不存在或 `webContents` 已销毁 → `throw { code: 'UNKNOWN', message: '窗口不可用，无法截图' }`。
- 矩形按 `win.getContentSize()` 钳制到窗口内容区（宽高最小 1），防止越界截图返回空图。
- 返回图 `isEmpty()` → `throw { code: 'UNKNOWN', message: '截图失败：未取到画面' }`。

---

## 六、主进程实现

单文件改动，handler 内联薄逻辑（对齐 `window:setFullscreen` 既有形态），使用 `wrapAsync`（handlers.ts L42-56）：

```ts
ipcMain.handle(
  'window:captureRegion',
  wrapAsync(async (rect: CaptureRegionRect) => {
    const win = getWin()
    if (!win || win.webContents.isDestroyed()) {
      throw { code: 'UNKNOWN', message: '窗口不可用，无法截图' }
    }
    if (!rect || [rect.x, rect.y, rect.width, rect.height].some((n) => !Number.isFinite(n))) {
      throw { code: 'INVALID_PARAMS', message: '截图区域参数无效' }
    }
    const [cw, ch] = win.getContentSize()
    const x = Math.max(0, Math.min(Math.round(rect.x), cw - 1))
    const y = Math.max(0, Math.min(Math.round(rect.y), ch - 1))
    const width = Math.max(1, Math.min(Math.round(rect.width), cw - x))
    const height = Math.max(1, Math.min(Math.round(rect.height), ch - y))
    const image = await win.webContents.capturePage({ x, y, width, height })
    if (image.isEmpty()) {
      throw { code: 'UNKNOWN', message: '截图失败：未取到画面' }
    }
    return image.toPNG()
  })
)
```

要点：
- 坐标即渲染层 `getBoundingClientRect()` 的 CSS 像素（内容区左上角原点，缩放因子 1 时 DIP 与 CSS 等值）。
- `toPNG()` 返回 `Buffer`，经结构化克隆到渲染层为 `Uint8Array`。
- 无广播、无 DB 交互；不新增 service 文件。

---

## 七、渲染层实现

### 7.1 新增 `src/services/capture.ts`

```ts
// 窗口区域截图（渲染层）：经 window:captureRegion 取 PNG 像素 → 合成 canvas 快照
export async function captureRegionToCanvas(rect: CaptureRegionRect): Promise<HTMLCanvasElement> {
  const bytes = await ipc.window.captureRegion(rect)
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width            // 物理像素（= CSS × 显示缩放）
    canvas.height = bitmap.height
    canvas.style.width = `${rect.width}px`  // 快照约定：style 为逻辑尺寸（同 PDF snapshotVisible）
    canvas.style.height = `${rect.height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.drawImage(bitmap, 0, 0)
    return canvas
  } finally {
    bitmap.close()
  }
}
```

### 7.2 `src/services/pageCurl.ts`

- `PageCurlOptions.to` 改为 `to?: HTMLCanvasElement | null`（L13 附近）。
- `frame()` 中 `drawBmp(to)`（L92）改为 `if (to) drawBmp(to)`。
- PDF 侧两个调用点（ReaderView.vue L326-332、L574-580）继续传 `to`，行为零变化。

### 7.3 `src/services/epub.ts`

- 新增 `waitViewsSettled`（§4.2），复用现有 `doubleRaf` 思路（若文件内已有类似工具则复用）。
- `EpubRendition` / `EpubContents` 类型经 L11 统一再导出，直接使用。

### 7.4 `src/stores/epubReader.ts`

- `next()`（L219-232）、`prev()`（L234-247）：返回值从 `void` 改为 `Promise<void>`——`return r.next().then(...).catch(...)`（吞错后 resolve，保留现有 `pushNavDiag` 日志与 console.error）。
- `goTo()`（L249-262）：同样返回 `Promise<void>`（两分支的 `rendition.display` / `displayPageIndex` 均 `.catch` 后 resolve）。
- 公开对象返回不变（L357-382 的导出自然携带新签名）。

### 7.5 `src/views/EpubReaderView.vue`（主场改动，任务 E 归属）

| 接缝点 | 现有位置 | 改动 |
|---|---|---|
| 根元素 ref | L2 `<div class="reader-view">` | 追加 `ref="rootEl"`（pageCurl 的 container，L468-475 已是 `position: relative`） |
| 控制栏瞬隐 | L3 / L75 `:class="{ visible: barsVisible }"` | 追加 `'capture-hide': captureHide`；CSS 新增 `.capture-hide { opacity: 0 !important; transition: none !important; }`；隐藏状态从截图前维持到卷曲 onDone（提前返回路径在 finally 复位），结束后随 0.2s 过渡淡入 |
| 热区 | L296-299 `onHotzoneClick` | 改方向感知（PDF L527 公式）并走 `turnPage`：`const forward = store.direction === 'ltr' ? side === 'right' : side === 'left'` |
| 底栏按钮 | L77-83 / L95-101 | `@click` 改 `turnPage('back')` / `turnPage('forward')` |
| 键盘 | L402-464 | 各 `case` 内 `store.next()/prev()` 改 `void turnPage(...)`（语义不变） |
| 滚轮 | L361-375 | 末行改 `void turnPage(e.deltaY > 0 ? 'forward' : 'back')` |
| 滑块 | L337-359 | `onSlideInput`：首次输入记录 `slideStartIndex` 并发起一次 `captureRegionToCanvas`（挂 promise）；`onSlideChange`：保留即时 `goTo`，追加 `void finishSlideCurl()`（等 settle → `playPageCurl({ from: 拖动开始快照, to: 省略 })`，`fromRight` 同公式） |
| 卸载 | L174-181 | 追加 `discardTurn()` |
| 跨书打开 | `doOpen`（L198） | 开头 `turnSeq++` + `discardTurn()` + busy/captureHide 复位（防旧书冻结帧残留） |
| 缩放/尺寸 | L390-400 | 防抖回调中检测 busy：取消动画 + 揭除冻结帧 |
| 新增状态 | — | `rootEl`、`captureHide`、`turnBusy`、`turnSeq`、`curlHandle`、`freezeEl`、`reducedMotion`（对齐 ReaderView.vue L149-151 写法）、`doubleRaf`/`attachFreeze`/`removeFreeze`/`discardTurn`/`turnPage` 函数 |

---

## 八、交互对齐清单（改动后 EPUB vs PDF）

| 行为 | PDF 现状 | EPUB 现状 | 本方案后 |
|---|---|---|---|
| 热区翻页 | 方向感知（L527） | 固定右=下一页 | 方向感知（改） |
| 键盘 | 固定语义（右=下一页，不随 RTL 翻转） | 相同 | 相同，仅加动画 |
| 滚轮 | `deltaY > 0` = 下一页 | 相同 | 相同，仅加动画 |
| 底栏按钮 | 上一页 / 下一页 | 相同 | 相同，仅加动画 |
| 滑块 | 拖动瞬切 + 松手补播一次卷曲（L531-581） | 拖动节流瞬切 + 松手瞬切 | 拖动节流瞬切 + 松手补播一次卷曲（改） |
| 翻页期间控制栏 | 保持显示（覆盖层透明区透出） | 无动画 | 整段翻页期间隐藏、结束后淡入（规避覆盖层遮栏残影，可接受差异） |
| 快速连翻 | `cancel` 后立即重播新卷曲（L314） | 无动画 | 取消 + 瞬切降级（受限，见风险表） |
| reduced-motion | 跳过动画（L149-151） | 无动画本就瞬切 | 显式跳过 |
| 动画参数 | `playPageCurl` 默认 450ms easeInOutCubic | 无 | 复用同一函数默认值 |

---

## 九、文件变更清单

| 文件 | 变更 |
|---|---|
| `shared/types.ts` | 新增 `CaptureRegionRect` 接口 |
| `electron/preload.ts` | `window` 域新增 `captureRegion`（L98-101 区域） |
| `electron/ipc/handlers.ts` | 新增 `window:captureRegion` handler（`window:setFullscreen` 之后） |
| `src/services/ipc.ts` | `window` 域镜像 `captureRegion`（L87-89 区域） |
| `src/services/capture.ts` | **新建**：`captureRegionToCanvas` |
| `src/services/pageCurl.ts` | `PageCurlOptions.to` 改为可选；省略时不绘底图（L92） |
| `src/services/epub.ts` | 新增 `waitViewsSettled` |
| `src/stores/epubReader.ts` | `next` / `prev` / `goTo` 返回 `Promise<void>` |
| `src/views/EpubReaderView.vue` | turnPage 编排、冻结帧、控制栏瞬隐、滑块改造、触发点统一、卸载/尺寸清理 |

**不改动**：`electron/db/**`（无迁移）、`electron/main.ts`、`src/views/ReaderView.vue`、`src/stores/reader.ts`、`src/services/pageCache.ts` / `spread.ts` / `coverQueue.ts`、`shared/types.ts` 的 ErrorCode、设置项与进度保存链路。

---

## 十、测试计划

### 10.1 命令验证

1. `npm run typecheck` —— 类型错误清零。
2. `npm test` —— 现有全部用例通过（本次无新增可独立测试的纯逻辑：capture 为 IPC/DOM 集成、卷曲为 canvas 动画，依据 ireader-code-conventions 不纳入 Vitest）。
3. `npm run dev` —— 手工冒烟（10.2）。

### 10.2 手工冒烟清单

| # | 步骤 | 预期 |
|---|---|---|
| 1 | EPUB 图片型书：点左/右热区 | 播放卷曲 450ms，无白屏、无闪跳 |
| 2 | 键盘 ArrowRight/Left/Down/Up/Space/PageDown/PageUp | 均播放卷曲，语义不变 |
| 3 | 滚轮上/下 | 均播放卷曲 |
| 4 | 底栏「上一页/下一页」按钮 | 均播放卷曲 |
| 5 | 顶栏切「右→左」后点左热区 | 下一页（与 PDF 一致）；切「左→右」后点右热区=下一页 |
| 6 | 滑块慢拖（跟手瞬切）→ 松手 | 松手后补播唯一一次卷曲 |
| 7 | 连按 PageDown 10 次 | 无冻结帧残留、无重复跳页、最终位置正确 |
| 8 | 首/尾页继续翻 | 不动画、无异常 |
| 9 | 系统开启「减弱动态效果」后翻页 | 瞬切无动画 |
| 10 | 鼠标移至窗口上/下边缘呼出控制栏后立即翻页 | 卷曲期间无「幽灵控制栏」残影 |
| 11 | PDF 书翻开翻页 + 退出重进恢复进度 | 动画无回归；EPUB/PDF 进度恢复均正常 |

---

## 十一、实施顺序（里程碑）

| 里程碑 | 内容 | 完成标准 |
|---|---|---|
| M1 IPC 能力落地 | `shared/types.ts` → `preload.ts` → `handlers.ts` → `src/services/ipc.ts` → 新建 `capture.ts` | `npm run typecheck` 通过；dev 下经 M2 联调验证截图返回 PNG 且坐标对齐 |
| M2 动画编排 | `pageCurl.ts`（to 可选）、`epub.ts`（waitViewsSettled）、`EpubReaderView.vue`（turnPage + 冻结帧 + 控制栏瞬隐 + 四种触发点接线） | 热区/键盘/滚轮/按钮均播放卷曲；图片型 + 文字型书无白屏闪跳 |
| M3 交互对齐与边界 | 热区方向感知、滑块补播、busy 降级 + seq 作废、reduced-motion、resize/卸载清理 | 冒烟清单 1-11 全过；`npm run typecheck` + `npm test` 全过 |

---

## 十二、风险与取舍记录

| 项 | 取舍 | 影响与备注 |
|---|---|---|
| 截图与样式变更的合成竞态 | 瞬隐控制栏后等双 rAF 再截图 | 极小概率截到未更新的合成帧（冻结帧含控制栏一条），下次翻页自然消除，不阻断 |
| 快速连翻无动画（降级瞬切） | 正确性优先于全对齐 | 覆盖层在屏期间无法再截图；与 PDF「cancel 后重播」存在细微体验差，属可接受降级 |
| 翻页期间控制栏隐藏（EPUB） | PDF 保持显示，EPUB 整段隐藏后淡入 | 规避覆盖层不透明像素遮栏造成的闪断/幽灵残影；典型场景控制栏自动隐藏中，感知极小；滑块路径快照含控制栏，thumb 冻结约 450ms |
| capturePage 单次成本（IPC + PNG 编解码约 10-40ms） | 接受 | 在动画首帧延迟预算内（文字型 ≤150ms / 图片型 ≤300ms）；若后续感知明显，可扩展为位图传输或截图尺寸缩减（保留扩展点） |
| 非整数显示缩放（如 125%）下物理像素与 CSS 尺寸比例 | 接受 | `pageCurl.drawBmp` 已按覆盖层尺寸归一化（前次修复），天然免疫比例偏差 |
| 极端连打时个别帧可能捕获到既有导航的过渡画面 | 接受 | 表现为一次轻微画面异样、自动恢复；不产生残留 |
| 动画期间 resize | 取消动画 | 极少见组合场景，取消优于残缺动画 |
| 含动图（gif）的 EPUB 内容在冻结帧中静止 | 接受 | 漫画/电子书场景无此类内容 |
| waitViewsSettled 800ms 超时后照常播动画 | 接受 | 超大图片页可能揭层略早，表现为轻微加载感，不阻断 |
