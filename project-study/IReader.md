# IReader 项目学习文件

## 项目功能梳理

### 实现功能

IReader 是一款纯离线的本地漫画/电子书阅读器（Electron + Vue 3），支持 PDF 与 EPUB 两种格式。

- 多格式支持：PDF（pdf.js）与 EPUB（epub.js）双引擎，共用文库与阅读偏好
- 沉浸阅读：单页/双页排版，日漫（RTL）/韩漫（LTR）方向切换，PDF 仿真纸张卷曲翻页动画
- 断点续读：记录每本书的页码/CFI、模式、方向与缩放，重新打开即恢复
- 合集管理：按系列收纳漫画，支持集内导入与模糊搜索
- 阅读输入：热区点击、键盘、滚轮、页码滑块、底栏按钮、全屏、缩放/字号调节
- 性能优化：离屏 Canvas 渲染 + LRU 位图缓存、后台预取相邻页组、渲染序号作废旧任务
- 数据安全：contextIsolation/sandbox 安全基线，ireader:// 自定义协议按 ID 分发文件，不暴露本地路径

### 运行流程

1. 启动：主进程（electron/main.ts）在 whenReady 后初始化日志、SQLite 数据库（WAL）与封面服务，注册 ireader:// 协议与全部 IPC 处理器，创建窗口加载渲染层 Vue SPA。
2. 文库：主页（LibraryView）展示书籍网格与合集；导入、移除、重命名、移动合集等均经 IPC 到主进程，数据落 SQLite，封面由封面队列后台生成。
3. 打开书籍：进入 reader 路由后按格式分发——EPUB 由 EpubReaderView 处理，PDF 由 ReaderView 的 Canvas 阅读器处理；经 ipc.reader.open 获取 ireader:// 文件地址与阅读进度，分别交给 pdf.js / epub.js 加载并恢复断点。
4. 阅读翻页：状态（页组索引 / CFI）驱动渲染；PDF 附卷曲动画与位图缓存预取；进度防抖 1s 落盘，关闭/换书时立即 flush。（详见 Q1）
5. 设置：SettingsView 修改的偏好经 IPC 持久化到 SQLite，阅读器实时读取（默认模式/方向、预取数量、封面单独成页、EPUB 字号等）。

## 项目代码结构

- `shared/types.ts`：双进程共享类型与常量（ReadingMode/Direction/ZoomMode、ReadingProgress、Settings 与 DEFAULT_SETTINGS、Result<T> 错误契约、ErrorCode 等）
- `electron/main.ts`：主进程入口：初始化日志/数据库/封面服务，注册 ireader:// 协议与 IPC，创建主窗口（安全基线 contextIsolation+sandbox+nodeIntegration=false）
- `electron/preload.ts`：预加载脚本，向渲染层暴露 window.ireader API
- `electron/ipc/handlers.ts`：全部 IPC 通道处理器（dialog/library/reader/cover/collection/settings/log/window/shell）
- `electron/db/database.ts`：SQLite 初始化（WAL 模式）
- `electron/db/repos/`：数据仓库层——booksRepo / collectionsRepo / progressRepo / settingsRepo
- `electron/services/`：coverService（封面生成）、libraryService（导入/移除/重链等文库逻辑）、protocol（ireader:// 分发：按 ID 提供书籍文件/封面，另供给 pdf.js 的 cmaps/standard_fonts 运行时资源，见 Q2）、logger
- `src/services/ipc.ts`：渲染侧 IPC 封装：统一解包 Result<T>，失败时抛出 IpcError
- `src/services/pdf.ts`：pdf.js 封装：文档加载（含 CJK CMap 与标准字体资源配置，见 Q2）、按页渲染（重入自动取消、devicePixelRatio 高清）
- `src/services/epub.ts`：epub.js 封装：加载/渲染、图片型书检测、pre-paginated 适配与翻页导航补丁、CFI 位置映射
- `src/services/spread.ts`：页组划分与方向映射（纯函数）：单/双页分组、封面单独成页、RTL/LTR 显示顺序、模式切换重定位
- `src/services/pageCurl.ts`：仿真纸张卷曲翻页动画（覆盖层 canvas 逐帧绘制）
- `src/services/pageCache.ts`：页面位图 LRU 缓存（12 张，key 含渲染签名）
- `src/services/coverQueue.ts`：封面生成队列（由 coverQueue.test.ts 覆盖单测）
- `src/stores/reader.ts`：PDF 阅读状态：文档打开/关闭、页组与当前索引、翻页、进度防抖保存
- `src/stores/epubReader.ts`：EPUB 阅读状态：rendition 生命周期、next/prev/goTo、单双页与方向切换、进度保存
- `src/stores/library.ts`：文库状态：书籍列表、刷新（refresh）与过滤（filteredBooks）、合集
- `src/stores/settings.ts`：设置状态：加载与 patch 持久化
- `src/views/LibraryView.vue`：主页：书籍网格、合集视图、排序/搜索、导入入口
- `src/views/ReaderView.vue`：阅读路由入口；EPUB 分发到 EpubReaderView，PDF 走内置 Canvas 阅读器（翻页动画/输入/缓存预取均在此）
- `src/views/EpubReaderView.vue`：EPUB 阅读器：epub.js 渲染容器、热区/键盘/滚轮/滑块输入、iframe 事件转发
- `src/views/SettingsView.vue`：设置页
- `src/components/library/`：文库对话框组件（导入书籍、合集选择、移除确认、缺失文件提示、文本输入等）
- `specs/EPUB阅读支持问题与解决方案.md`：EPUB 支持开发总结（epub.js 陷阱、封面策略、翻页导航补丁根因链等）

## 研究问题总结

- [Q1-20261015 阅读器翻页功能的实现机制](./questions/Q1-20261015.md)
- [Q2-20261015 中文文档 PDF 中文不显示的根因](./questions/Q2-20261015.md)
