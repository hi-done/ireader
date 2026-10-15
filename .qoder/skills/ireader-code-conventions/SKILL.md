---
name: ireader-code-conventions
description: IReader 项目编码规范：Result<T> 错误处理与 IPC 契约、中文注释风格、命名与文件组织、Pinia store 与服务层写法、Vitest 测试要求及关键工程红线。当在 IReader 中编写或修改代码、评审代码，或需要与现有代码风格保持一致时使用。
---

# IReader 编码规范

## 错误处理：Result<T> 契约

- 主进程 handler 一律返回 `Result<T>`（shared/types.ts 的 ok/fail）。业务代码直接 throw；由 handlers.ts 的 wrap() 捕获转换——错误对象带 `code`（ErrorCode）时保留，否则归为 UNKNOWN。
- 主进程抛业务错误统一为对象字面量：`throw { code: 'XXX', message: '中文说明' }`（参考 libraryService.ts / handlers.ts），必要时 `as AppError`；不要抛裸字符串。
- 渲染层**禁止**直接使用 window.ireader；一律经 `src/services/ipc.ts`（unwrap 后失败抛 IpcError）。UI 层 catch 后按 error.code 映射中文提示。
- 新增错误场景：扩展 shared/types.ts 的 ErrorCode 联合类型，并在两端映射文案。

## 注释风格（全中文）

- 文件头：一行中文注释概述模块职责；确知出处时可注明「对应设计文档 §x.x」，不确定则不写。
- 注释解释「为什么」而非「做什么」；性能取舍、时机约束、平台差异必须注释（参考 protocol.ts 对 corsEnabled 必要性、main.ts 对菜单移除差异的说明）。
- 注释与代码同步修改，不留过期注释。
- 导出函数用 JSDoc（含 @param）；迁移函数用 `// vN: 说明` 格式。

## 命名约定

- 组件/视图文件 PascalCase（BookCard.vue、LibraryView.vue）；服务与仓库小写（coverQueue.ts、booksRepo.ts）。
- 测试文件与被测文件同目录，命名为 `<被测名>.test.ts`。
- DB 列 snake_case ↔ TS 属性 camelCase，在 repo 层手动映射，不引入 ORM。
- IPC 通道名「域:动作」，动作用 camelCase（如 library:moveToCollection）。
- 主进程 repo / 服务导出单例对象（`export const booksRepo = {...}`）或具名函数，跟随所在目录现有形态。
- Pinia 一律 setup 语法（ref/computed/函数），命名 useXxxStore。
- 双端共用取值用字符串字面量联合（'single' | 'double'），不用 TS enum。
- 类型导入用 `import type`；shared 类型以 `../../shared/types` 相对路径引用。

## 文件组织

- 纯逻辑能放 `src/services/` 的不要耦合 Vue；能用主进程做的不要放渲染层。
- `shared/types.ts` 是双进程唯一共享源：跨进程类型只在这里定义，electron/ 与 src/ 之间禁止互相 import 其他模块。
- 组件按功能域分目录（如 components/library/），新功能域新建目录。

## 关键工程红线

1. **纯离线**：应用不发起任何外网请求；唯一例外是设置页用户手动点击「检查更新 / 下载更新」时访问 GitHub（hi-done/ireader Releases，经 updaterService 单点）。禁止 CDN 资源、远程字体、遥测与任何后台自动检查 / 轮询类网络行为。
2. **better-sqlite3 是原生模块**：vite.config.ts 中必须保持 external；数据库操作只在主进程；渲染层不得直接引用。
3. **协议注册时机**：registerSchemesAsPrivileged 必须在 app ready 前、protocol.handle 在 ready 后，顺序不可调换。
4. **sandbox=true**：preload 必须用 contextBridge 暴露；不得开启 nodeIntegration、不得使用 remote。
5. **持久化分流**：进度/设置等业务数据只经 IPC 走 SQLite；localStorage 仅限纯 UI 偏好（如文库排序）。
6. **大文件不走 IPC**：PDF/EPUB 原文件与封面一律经 `ireader://` 协议流式读取；IPC 只传元数据与 ArrayBuffer 封面图这类小载荷。

## Vitest 测试要求

- 只测纯逻辑（页组计算、队列、缓存淘汰、解析函数），不测 Electron/DOM 集成。
- 运行 `npm test`；新增/修改以下模块必须同步补测试：spread.ts、coverQueue.ts、pageCache 淘汰逻辑。
- 用例描述用中文（如「每组 1 页」「RTL 方向镜像」），断言直接比对结构值。

## TypeScript

- strict 全开；禁止 any 泄漏，边界处用 unknown + 收窄（参考 handlers.ts wrap 的异常处理写法）。
- 阅读器内的长生命周期对象（pdf 文档、Canvas、定时器句柄）用 markRaw 或普通变量持有，避免 Vue 代理开销与内存泄漏。
