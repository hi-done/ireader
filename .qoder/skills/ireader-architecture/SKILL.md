---
name: ireader-architecture
description: IReader（Electron + Vue 3 离线 PDF/EPUB 阅读器）的架构与数据流参考：双进程结构、IPC 通道清单、SQLite 表结构、ireader:// 协议与核心数据流。当需要理解项目结构、定位功能代码位置、分析跨进程数据流，或判断新代码应放入哪个模块时使用。
---

# IReader 架构与数据流

纯离线本地漫画/电子书阅读器（PDF + EPUB），无任何网络请求依赖。以下内容与当前代码一一对应。

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 42（main + preload + renderer） |
| 渲染层 | Vue 3 + Pinia + Vue Router（hash 模式）+ TypeScript strict |
| 阅读引擎 | pdfjs-dist（PDF）、epubjs（EPUB） |
| 数据 | better-sqlite3（主进程内嵌，WAL 模式） |
| 构建 | Vite 5 + vite-plugin-electron；打包 electron-builder |
| 测试 | Vitest（仅纯逻辑单测） |

## 目录职责

| 路径 | 职责 |
|---|---|
| electron/main.ts | 主进程入口：建窗、生命周期、初始化顺序 |
| electron/preload.ts | contextBridge 暴露 window.ireader API（类型见 IreaderApi） |
| electron/ipc/handlers.ts | 所有 ipcMain.handle 集中注册；wrap() 把异常统一转 Result |
| electron/db/database.ts | SQLite 初始化 + MIGRATIONS 数组增量迁移（PRAGMA user_version） |
| electron/db/repos/ | 各表数据访问：booksRepo / progressRepo / collectionsRepo / settingsRepo |
| electron/services/ | libraryService（导入）、coverService（封面落盘）、protocol（ireader://）、logger |
| shared/types.ts | 双进程共享类型、常量、Result/ok/fail、ErrorCode |
| src/views/ | 页面：LibraryView / ReaderView / EpubReaderView / SettingsView |
| src/components/library/ | 文库相关对话框与卡片组件 |
| src/stores/ | Pinia：library / reader / epubReader / settings |
| src/services/ | 渲染层服务：ipc（Result 解包）、pdf、epub、pageCache（LRU 位图）、spread（页组计算）、pageCurl（翻页动画）、coverQueue（封面生成队列） |
| src/router/index.ts | 路由注册（懒加载，hash 模式） |

## 进程架构

- 渲染进程（Vue SPA）不直接访问 Node/文件系统，全部能力经 `window.ireader`（preload contextBridge）调用。
- 安全基线：contextIsolation=true、sandbox=true、nodeIntegration=false，禁止绕过 preload 直接暴露 Node API。
- 主进程初始化顺序（main.ts）：
  1. registerProtocolScheme() —— 必须在 app ready **之前**；
  2. whenReady 后：initLogger → initDatabase → initCoverService → registerProtocolHandler → registerIpcHandlers → createWindow。
- 窗口行为：macOS 隐藏原生标题栏（titleBarStyle: 'hidden'，页面需为红绿灯留避让）；Windows 保留默认标题栏；非 macOS 移除应用菜单。
- before-quit 时 closeDatabase()。

## IPC 通道清单（invoke 一律返回 Result<T>）

| 通道 | 说明 |
|---|---|
| dialog:pickBookFiles / pickFolder | 文件/目录选择 |
| library:import / list / remove / relink / rename / moveToCollection | 文库操作 |
| library:changed | 主→渲染事件：文库变更通知（LibraryChangedPayload：added/coverReady/removed/missing） |
| reader:open / saveProgress | 打开书籍、保存阅读进度 |
| collection:create / list / remove | 合集管理 |
| cover:submit | 渲染层生成封面后回写落盘 |
| settings:all / patch | 读写设置（key-value JSON） |
| log:write | 渲染层日志（fire-and-forget，失败静默） |
| window:setFullscreen | 全屏切换 |
| shell:showInFolder | 在文件管理器中定位文件 |

调用链：view/store → `src/services/ipc.ts`（解包 Result，失败抛 IpcError）→ `window.ireader.*`（preload）→ `ipcMain.handle`。

## 数据库（userData/library.db）

| 表 | 关键列 | 说明 |
|---|---|---|
| books | id, title, file_path(UNIQUE), file_size, total_pages, cover_path, added_at, last_opened_at, collection_id | 书籍元数据 |
| reading_progress | book_id(PK, FK CASCADE), page, mode, direction, zoom_mode, zoom_scale, updated_at, cfi, percentage | 进度；cfi/percentage 仅 EPUB 使用（PDF 保持 NULL） |
| collections | id, title, created_at | 合集 |
| settings | key, value(JSON) | 单行记录：key='app' 存整个 Settings |

- 迁移机制：MIGRATIONS 数组按序执行，PRAGMA user_version 记录版本；只允许**追加**新迁移，禁止修改已发布项。
- 外键已开启（foreign_keys=ON）；books.collection_id 为 NULL 表示未分组。

## ireader:// 协议

- `ireader://cover/{bookId}`：封面 JPG（userData/covers/{id}.jpg）。
- `ireader://pdf/{bookId}` 与 `ireader://epub/{bookId}`：直出原文件流。
- 已声明为特权协议（standard / secure / stream / supportFetchAPI / corsEnabled），响应附加 `Access-Control-Allow-Origin: *`（pdf.js 跨源加载必需，缺失会静默失败）。
- 渲染层拿不到本地文件路径，只按 bookId 分发。

## 核心数据流

**导入书籍**：渲染层选文件 → `library:import` → libraryService 校验（去重/格式/页数）→ 写 books 表 → 渲染层 coverQueue 用 pdf.js / epub.js 渲染首页封面 → `cover:submit` 落盘 → 主进程广播 `library:changed` → store 响应式刷新。

**打开阅读**：`reader:open` → 主进程校验文件存在（缺失则标记 missing）→ 返回 fileUrl + progress → PDF 走 loadPdfWithTask；EPUB 走 epub 服务 → store 用 buildSpreads 重建页组 → 阅读中防抖 saveProgress。

**文库变更广播**：主进程统一经 notifyLibraryChanged 发送 `library:changed`；渲染层 store 订阅 onChanged 增量刷新，不要轮询。

## 阅读器内部模型（PDF 侧）

- Spread（页组）：buildSpreads 按模式（single/double）、方向（rtl 日漫 / ltr 韩漫）、封面是否单独成页计算；toDisplayOrder 处理方向镜像。
- 进度中的 page 存「页组第一页的 1 基页码」；第 1 页是封面页。
- pageCache：离屏 Canvas 渲染 + LRU 位图缓存；后台按 preloadSpreads 设置预取前后页组。
- EPUB 侧：EpubReaderView + epubReader store + epub.ts 服务，进度用 CFI（断点定位）+ percentage（文库进度圆环）。
