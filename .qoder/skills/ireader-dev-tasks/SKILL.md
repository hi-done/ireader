---
name: ireader-dev-tasks
description: IReader 常见开发任务的标准落地流程：端到端新增 IPC 通道、数据库 schema 迁移、新增设置项、新增渲染层功能与组件、修改阅读器行为、开发完成后的验证步骤。当在 IReader 中开发或修改功能（新增数据、新交互、新设置、新页面）时使用。
---

# IReader 开发任务流程

开始前先用 ireader-architecture skill 确认模块归属。所有流程与现有代码模式一一对应，实现细节参考对应源文件。

## 通用原则

- 界面文案与注释用中文；保持与相邻文件一致的风格与结构。
- 不新增网络依赖（纯离线应用）；引入新 npm 依赖前先征询用户。
- 不擅自扩大改动范围；修改 IPC 契约、DB schema 属于高影响改动，先说明影响面再动手。
- 每个任务收尾必须执行「任务 F：验证流程」。

## 任务 A：端到端新增一个 IPC 能力

按依赖顺序修改，缺一步会类型报错或运行时失败：

1. `shared/types.ts`：定义 payload / 返回类型；新错误场景复用或扩展 ErrorCode。
2. `electron/preload.ts`：在 ireaderApi 对应域下加方法，`ipcRenderer.invoke('域:动作', payload)`，返回 `Promise<Result<T>>`。
3. `electron/ipc/handlers.ts`：`registerIpcHandlers` 内 `ipcMain.handle('域:动作', wrap((payload) => ...))`。业务逻辑放 `electron/services/` 或 `electron/db/repos/`，handler 只做编排与广播。
4. `src/services/ipc.ts`：镜像封装 `unwrap(api().域.动作(...))`，分组与命名与 preload 保持同构。
5. 消费方（store/view）调用 `ipc.域.动作(...)`，catch IpcError 后按 error.code 给出中文提示。
6. 若变更了书库数据，主进程用 notifyLibraryChanged 广播 `library:changed`，让文库/封面等视图增量刷新。

检查点：通道名「域:动作」；多参数用对象传递；业务错误在服务层抛 `{ code, message }` 对象，由 wrap 统一转换。

## 任务 B：数据库 schema 变更

1. `electron/db/database.ts`：在 MIGRATIONS 数组**末尾追加**新函数（注释格式 `// vN: 说明`），绝不修改已发布的迁移项。
2. 同步更新对应 repo（`electron/db/repos/*.ts`）的 SQL 与字段映射（DB snake_case ↔ TS camelCase 手动映射）。
3. 检查 `shared/types.ts` 对应接口是否同步。
4. 新列设计参考 v3 做法：旧表升级用可空列 / DEFAULT，仅特定格式使用的字段（如 cfi/percentage）在不适用的书上保持 NULL。

## 任务 C：新增设置项

1. `shared/types.ts`：Settings 接口 + DEFAULT_SETTINGS 加字段（中文注释、注明取值约束）。
2. `settingsRepo` 无需改动：整体 JSON 存取，getAll 自动与默认值 merge（旧数据天然兼容）。
3. `src/stores/settings.ts` 跟随现有结构；`SettingsView.vue` 添加控件。
4. 消费方读 `useSettingsStore().settings.xxx`。持久偏好走 SQLite 设置；localStorage 仅限纯 UI 偏好（参考 library store 的排序偏好）。

## 任务 D：新增渲染层功能 / 组件

1. 判断归属：
   - 页面级 → `src/views/`，路由在 `src/router/index.ts` 注册（懒加载）。
   - 文库特性组件 → `src/components/library/`；新功能域可新建子目录。
   - 纯逻辑算法 → `src/services/`，写成可测试的纯函数（参考 spread.ts）。
   - 跨组件状态 → `src/stores/`（Pinia setup 语法）。
2. 需要主进程数据或文件能力时走「任务 A」补 IPC，不得绕过 preload 偷读 DOM / 文件。
3. 大对象或 Canvas 引用存入响应式状态时用 markRaw 防深度代理（参考 reader store 的 doc）。
4. 样式跟随现有主题体系（src/style.css、src/theme.ts），兼容 light/dark/system 三种主题。

## 任务 E：修改阅读器行为

- PDF：`src/stores/reader.ts` + `src/views/ReaderView.vue` + `src/services/`（spread / pageCache / pageCurl）。
- EPUB：`src/stores/epubReader.ts` + `src/views/EpubReaderView.vue` + `src/services/epub.ts`（进度用 CFI + percentage）。
- 页组/方向/封面单页逻辑统一走 buildSpreads，禁止在视图里散落重复实现；改 spread.ts 必须同步 spread.test.ts。
- 进度保存含页码、模式、方向、缩放；保持防抖保存模式（reader store 已有 saveTimer 实现）。

## 任务 F：验证流程（完成前必做）

1. `npm run typecheck` —— 类型错误清零。
2. `npm test` —— 单测通过；新增纯逻辑（页组计算、队列、解析类）补 *.test.ts，与被测文件同目录。
3. `npm run dev` 冒烟：涉及 IPC / 数据的改动至少走一遍「导入 → 阅读 → 退出重进恢复进度」；涉及 EPUB 改动同时验证 EPUB 路径。
4. 调试数据库时用 `ELECTRON_RUN_AS_NODE=1 npx electron <脚本>`（better-sqlite3 按 Electron ABI 编译，普通 node 运行会报 ABI 错误）。
