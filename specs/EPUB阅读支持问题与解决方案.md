# EPUB 阅读支持开发总结

> 本文档记录 IReader 接入 EPUB 格式（epubjs 0.3.93）过程中踩过的坑与最终解决方案，供后续开发与维护借鉴。所有结论均经过源码验证与多轮冒烟测试。

## 一、架构概览

- **渲染引擎**：epubjs 0.3.93（futurepress），渲染进程侧运行，自带 TS 类型声明。
- **格式分发**：`ReaderView.vue` 按书籍 format 字段分发——EPUB 挂载 `EpubReaderView.vue` + `epubReader` store；PDF 保持原有 canvas 阅读器。
- **文件暴露**：主进程注册 `ireader://epub/{id}` 自定义协议；因该 URL 无 `.epub` 扩展名会被 epubjs 误判为目录模式，实际加载改为 `fetch → ArrayBuffer → ePub(data)`。
- **布局分流**：图片型书（每 section 一张图，如漫画）用 `pre-paginated` 布局（页 = spine section）；文字型书用 `reflowable`（页 = CFI 定位点）。
- **图片型书检测**：`detectImageBasedBook()`——前 3 个 spine section 中「有 img 且正文 <100 字符」占比 ≥2/3 判定为图片型书。
- **进度持久化**：复用 `reading_progress` 表；EPUB 增加 cfi/percentage 字段；图片型书缩放存 `zoom.scale`。

## 二、epubjs 引擎陷阱（必须读源码才能发现）

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | 打开书报目录模式错误 | epubjs 按 URL 扩展名判定输入类型，`ireader://epub/1` 无 `.epub` 后缀 | fetch 取 ArrayBuffer 后 `ePub(data)` 走二进制解压路径 |
| 2 | 双页模式只显示一页 | `layout.calculate` 有 `minSpreadWidth=800` 门槛，且构造期 `settings.minSpreadWidth \|\| 800` 会吞掉传入的 0 | 运行时 `rendition.spread(spread, 0)` 覆盖；spread 切换后必须 `r.clear() + r.display(cfi)` 重建视图（manager.display 对已在视口的 section 只滚动不重建） |
| 3 | 图片型书双页半屏空白 | reflowable 的 spread 是对同一 section 内 CSS 双列分栏，每 section 一张图的漫画书另一列必然空白 | 检测为图片型书后改用 pre-paginated 布局（相邻两页并排） |
| 4 | 翻页按钮/滑块失效 | `locations.generate` 按文本节点分块，纯图片页无文本 → locations 为空 → 滑块 max=0、cfiFromLocation 越界 | 图片型书页数 = spine section 数，跳页用 `rendition.display(section.href)` 而非 CFI，跳过 generateLocations |
| 5 | 任一渲染任务失败后翻页/跳页全部静默失效 | `Queue.run` 的 `dequeue().then()` 无 catch，单点 reject 后队列永久停摆 | `hardenRenditionQueue()`：实例级包装 dequeue 加 catch 自愈；所有 display/next/prev 调用链补 catch |
| 6 | 图片过大且百分比下拉框无效 | 漫画书 section 无 `<meta viewport>`，官方 fit() 解析 NaN 失效；`themes.fontSize()` 对图片无效 | 自实现 `fitPrePaginatedContents()`：`img.naturalWidth/naturalHeight` 计算 contain 缩放；顶栏下拉框按布局分流为缩放档位（50%~200%） |
| 7 | **封面相关 patch 静默失效（本轮最终根因）** | `Rendition` 构造时 `this.q.enqueue(this.start)`——manager 由 start() 创建，在渲染队列（requestAnimationFrame）中**异步执行**；`renderTo` 返回时 `rendition.manager` 仍是 undefined | patch 前先 `await rendition.started`（start() 完成后 resolve 的 promise），再取 manager |
| 8 | **翻页无反应但滑块有效**（症状：`next` 同步返回、`prev` 有效） | 原生 next/prev 依赖容器滚动位置判定；双页渲染中两个 view 的 element 宽度被撑大/被 margin 污染 → `container.scrollWidth` 从 1264 暴涨到 1896+/2528 → next 判定恒走 `scrollBy` 分支（overflow hidden 下无视觉变化、同步返回）；prev 先滚回 0 再换 section 所以正常 | 见第九节：布局干预收敛 + `installPaginatedNavigation` 直通补丁绕开滚动判定 |
| 9 | 双页翻页后缝隙变大/布局错乱 | 双页 next 是 clear + 两段式 append（先渲染第 1 页、再异步插入第 2 页），第一个 view 完成瞬间视口只有一页，若据此判定「单页」并撑宽会破坏 flex row 布局 | 单页判定不能用自维护渲染集合大小，须用 `manager.views.length`；仅封面单独成页的封面、奇数页数尾页是真单页才撑宽 |

## 三、封面单独成页设置的根因链（多轮修复）

需求：全局设置「双页模式封面单独成页」控制封面是否与第 1 页并排。epubjs 对 pre-paginated 硬编码「spine 第 0 项（封面）单独显示」，关闭设置需 monkey-patch manager 的 `handleNextPrePaginated` 与 `prev`。

修复过程中连续踩到的坑（**每一层都表现为"设置无效"**）：

1. **安装期 divisor 检查恒真短路**：Layout 构造时 divisor 默认为 1，渲染 resize 时 `calculate()` 才变 2。安装期用 `if (layout.divisor <= 1) return` 做守卫导致 patch 永不应用。→ 此类依赖渲染后状态的检查必须放进 patch 函数体**运行时**执行。
2. **typeof 判定写错**：`typeof prev.prev !== 'function'` 恒为 false（Section 实例总有 prev 方法）。正确判定是调用结果是否为空：`prev.prev() == null`（封面是 spine 第 0 项，prev() 返回 undefined）。
3. **page-spread-left 检查误伤**：很多固定布局书第 1 页 itemref 带 `page-spread-left` 属性，命中即不并排。→ 用户设置优先于 EPUB 元数据声明，关闭设置时无条件并排。
4. **manager 异步创建（真正的元凶）**：见上表 #7。前三轮修复全部被 `if (!manager) return` 提前短路，且该 return 在诊断日志 push 之前，导致面板里看不到任何 `[cover]` 行、纯源码推导多轮无法收敛。→ `await rendition.started` 后再 patch。

**通用教训**：给 epubjs 内部方法（handleNextPrePaginated/prev/display）打 monkey-patch 前，必须先读 `node_modules/epubjs/src/managers/default/index.js` 原生实现确认调用路径、参数语义与字段初始化时机；凭 TS 结构化类型推断补齐的接口签名可以编译通过、单测全绿，但运行时静默失效。

## 四、视觉布局与对齐

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | 单页偏左、双页缝隙随窗口大小漂移 | `transform: scale(s) translate(ox)` 中 translate 被 scale 乘算，视觉位移 = s×ox；库方法 scaler() 对负偏移不生成 translate | 见 #3，最终放弃 transform 方案 |
| 2 | 点"上一页"后双页缝隙更大 | prev() 走 prepend 路径：先渲染的页当时是容器中唯一元素被判为左容器贴右，后被挤到右容器不重算 | 缓存全部已渲染视图（Map），每次 rendered 后按最终 offsetLeft 全量重对齐（`refitAll`），isConnected 失效条目清理 |
| 3 | 双页中间黑色间隔 | transform scale+translate 在 iframe 真实渲染中定位不可靠（诊断日志数学正确但实际呈现为居中效果） | **放弃 transform**：直接设置 img/svg 的 CSS width/height 为视觉尺寸，body flex 布局 + alignItems 对齐（双页左页贴右、右页贴左，单页居中）；无换算误差 |
| 4 | 封面（单页）显示在左半边而非屏幕正中 | spread=always 下单独显示的封面其 view.element 仍是 columnWidth 半宽容器，且 **iframe 宽度也固定为 columnWidth**（内容 body 100% 跟随 iframe 视口）；forceRight 还会加 marginLeft 推移 | 单页时（双页模式下视口只有 1 页）：外层 element + iframe 都撑到整屏宽、清除 marginLeft，再居中；fit 缩放基准同步改用整屏宽。双页（size≥2）时恢复半屏宽 |

**其他关键事实**（读源码验证）：
- stage 的 container 为 flex row，view.element 是直接子元素且 flex:none 固定宽 = columnWidth；`offsetLeft` 可判定左右容器归属（0=左，columnWidth=右）。
- iframe view 在 forceRight 场景用 `element.style.marginLeft = width` 推移，margin 不计入 offsetLeft。
- `scrollWidth/scrollHeight` 会被 iframe 视口尺寸污染（内容窄于视口时返回视口宽），不能用作图片固有尺寸，必须用 `img.naturalWidth/naturalHeight`。

## 五、全局设置接入

- **默认阅读模式/方向**：PDF 初始化是 `progress?.mode ?? settings.defaultMode`（断点进度优先）；EPUB 此前只读 progress 无回退 → open() 中 spreadValue/directionValue 补相同 fallback。
- **「预加载页组数」仅对 PDF 生效**：epubjs 按需渲染、无页组预取概念，不接入。
- 设置只在 `store.open()` 时读取，改动设置后需重新打开书才生效（验证时注意断点进度会跳过封面，需翻回开头）。

## 六、UI 交互

| # | 问题 | 根因 | 解决方案 |
|---|------|------|----------|
| 1 | 滑块"拖不动" | 受控 `:value` 绑定 store.current，异步跳页期间任一重渲染把 thumb 弹回旧值 | 本地 `sliderIndex` 状态跟手 + 拖动节流 + change 松手立即跳页；非拖动时同步 store 值；totalPages 用响应式 ref |
| 2 | 「上一本/下一本」按钮恒灰/无效 | vue-router params 会把 bookId 字符串化：store.bookId 存成 "10" 后与书库 number id 严格比较恒 false（contextIndex=-1 → disabled）；且 `Number.isFinite("10")` = false 使 watch 不触发重开 | openBook / store.open 入口统一 `Number(id)` 归一（PDF 视图靠 `routeBookId = Number(route.params.bookId)` 规避） |

## 七、调试与验证方法论（本轮重要收获）

1. **纯理论推导连续多轮失败的教训**：视觉/运行时问题（对齐、缝隙、patch 失效）不能只靠读源码与数学推导定案——本项目曾出现"计算参数全部正确但实际渲染仍错位"和"patch 代码正确但 manager 还是 undefined"两种情况，推导方向反复摇摆。
2. **DEV 屏幕诊断面板**：在渲染层加诊断缓冲（`getEpubDiag()`），阅读界面右下角显示关键状态（rendered/fit 摘要、setting 值、patch 各分支入口）。要点：
   - **默认隐藏**，用快捷键（Ctrl+Shift+D）开关，避免污染阅读区；
   - **分类缓冲**：高频渲染日志与低频关键日志（封面策略 `[cover]` 行、`open` 行）分开放，关键日志独立持久化不被冲掉；
   - 面板截图回传即可一轮定位（比 DevTools 快）。
3. **手工验证指令三要素**：极简步骤清单 + 逐条观察点 + 一条后备诊断指令（如何开面板/日志）。用户明确表示桌面自动化实测"太慢"时，应优先请用户自己配合验证（十几秒完成），自动化仅作兜底。
4. **Electron 无菜单栏时 F12 失效**：主进程 `Menu.setApplicationMenu(null)` 移除了菜单，打开 DevTools 需 `--remote-debugging-port=9222` + `--remote-allow-origins=*` 走 CDP。

## 八、翻页导航的滚动判定污染与直通补丁

**症状链**：「从第 N 本书开始」点热区/按钮/键盘/滚轮翻页完全无反应，但底部滑块跳页正常；进一步观察发现「滑块拖到后部后，上一页有效、下一页失效」。

**根因链（层层叠加的 scrollWidth 污染）**：

1. **forceRight 的 marginLeft 污染**：display 带 `page-spread-right` 属性的 section 时 epubjs 写 `element.style.marginLeft = width`，margin **计入 flex 布局宽度**，把 scrollWidth 撑到 1896+。
2. **element 内联宽度清空的污染**：view.element 初始内联宽为 `0px`，由 expand() 写死为 columnWidth。二次布局干预时若把内联宽清空（`''`），display:block 回落 auto 被 iframe 内容撑开甚至占满容器，scrollWidth 进一步暴涨（截图实测 2528）。
3. **原生 next/prev 的滚动判定被污染数据骗过去**：ltr 判定 `scrollLeft + offsetWidth + delta <= scrollWidth` 恒真 → next 永远走 `scrollBy` 分支（overflow hidden 下无视觉变化、同步返回）；prev 先 `scrollBy(-delta)` 滚回 0 后正常换 section → 「上一页有效、下一页失效」。RTL 书（漫画常见）还有 `rtlScrollType` 探测值（default/negative）两套公式，同样会被撑大的 scrollWidth 带进打转。
4. 「从第 N 本开始」：断点恢复位置恰好落在带 `page-spread-right` 的页，触发 forceRight 污染才暴露。滑块不受影响（`display(href)` 不依赖滚动判定）。

**修复（三层收敛 + 治本直通）**：

- refitAll 中 marginLeft **一律清除为 0px**（pre-paginated 双页靠 flex 顺序自然排布，margin 无意义）；
- 双页时 element 宽度**显式写半宽**（`view.width()`）而非清空内联；
- **`installPaginatedNavigation()` 直通补丁（治本）**：pre-paginated 每 section 一页、不存在页内滚动，next/prev 直接 `clear + updateLayout + append/prepend 相邻 section`，完全绕开依赖容器滚动位置的判定。封面场景（prev 的前一页为空）与书末（next 为空）回退原逻辑。

**通用教训**：pre-paginated 布局里「滚动」不是翻页概念，任何依赖 scrollWidth/scrollLeft 的原生判定都应绕开；对容器做的每个样式干预（width/margin/flex）都要想到它会计入 scrollWidth 反馈到滚动判定。

---

## 九、TL;DR 关键教训清单

1. monkey-patch epubjs 内部方法前必读 `node_modules/epubjs/src` 源码（调用路径、字段初始化时机、参数语义），不要靠 TS 类型推断兜签名。
2. 依赖渲染后状态的条件（divisor、manager 等）放进 patch 函数体运行时执行，不能放安装期。
3. 异步创建的对象（manager 由队列任务创建）必须先 `await rendition.started` 再取用。
4. 放弃 transform scale+translate 做整页缩放定位，用「直接设置视觉尺寸 + flex 对齐」零换算方案。
5. prev 是 prepend 路径，对齐判断必须基于最终几何位置全量重算，不能一次性判断。
6. 图片型书不用 locations/CFI 模型，用 spine 索引 + href 直跳。
7. 封面单页居中要撑 element + iframe 双宽并清 marginLeft；scrollWidth 不可信，用 naturalWidth。
8. 渲染队列必须打 catch 韧性补丁，否则单点失败静默死锁。
9. 路由 params 一律字符串化，bookId 用 `Number()` 归一。
10. 视觉/运行时疑难：两轮推导失败即停止猜测，上诊断面板拿运行时数据。
11. pre-paginated 的翻页直接换 section，不要依赖原生 next/prev 的滚动判定（会被 scrollWidth 污染骗进 scrollBy 打转）；对 view.element 的 width/margin 干预会计入 scrollWidth 反噬翻页。
12. 双页两段式 append 的「视口只有一页」是渲染中转瞬态，不能据此判定单页撑宽；真单页只看封面/奇数尾页。
