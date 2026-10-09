<div align="center">

# 📚 IReader

**纯离线的本地漫画 PDF 阅读器**

导入 · 合集 · 沉浸阅读 · 断点续读 —— 你的漫画收藏，只属于你自己的电脑

[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=flat-square&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-F0C929?style=flat-square)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-grey?style=flat-square)

![文库主页](pics/主页.webp)

*文库主页 —— 导入、搜索、排序与合集，一屏尽收*

</div>

---

## ✨ 功能亮点

- 📴 **纯离线** — 零网络请求，书籍、封面与进度全部存于本机；`ireader://` 自定义协议按 id 分发文件，不暴露本地路径
- 📖 **沉浸阅读** — 单页 / 双页排版，日漫（右→左）与韩漫（左→右）两种方向，canvas 自绘的仿真纸张卷曲翻页动画；纯黑视口贴满屏幕，顶底栏靠近边缘唤出、自动隐藏
- 🔖 **断点续读** — 每本书独立记录页码、阅读模式、方向与缩放，重新打开即回到上次离开的位置
- 🗂️ **合集管理** — 按系列收纳漫画，一本书同一时刻只属于一个合集；集内可直接导入，从主页模糊搜索 + 全选添加
- ⚡ **流畅渲染** — 离屏 canvas 渲染 + LRU 位图缓存，缓存命中毫秒级上屏；滑块跨页拖动零渲染开销，后台预取前后页组

## 🖼 界面预览

<table>
  <tr>
    <td width="50%" align="center">
      <img src="pics/阅读界面（带设置）.webp" alt="沉浸阅读器" /><br/>
      <sub><b>阅读器 · 工具栏</b> —— 顶栏切换双页 / 阅读方向 / 缩放与全屏，底栏滑块即拖即翻</sub>
    </td>
    <td width="50%" align="center">
      <img src="pics/阅读界面2（设置隐藏）.webp" alt="沉浸模式" /><br/>
      <sub><b>沉浸模式</b> —— 工具栏自动隐藏，纯黑视口贴满屏幕，只剩漫画本身</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="pics/合集.webp" alt="合集视图" /><br/>
      <sub><b>合集视图</b> —— 立体书「继续阅读」侧栏，在集内书单中切换焦点、点击封面即续读</sub>
    </td>
    <td width="50%" align="center">
      <img src="pics/设置.webp" alt="设置" /><br/>
      <sub><b>设置</b> —— 阅读偏好与外观，主题支持浅色 / 深色 / 跟随系统</sub>
    </td>
  </tr>
</table>

## 📥 下载安装

前往 [**Releases**](../../releases) 页面下载对应平台的安装包：

| 平台 | 安装包 | 状态 |
| --- | --- | --- |
| macOS 12+（Apple Silicon 已验收） | `IReader-<版本>-mac.dmg` | ✅ 可用 |
| Windows 10+（已验收） | `IReader-<版本>-win.exe` | ✅ 可用 |

> **macOS 未签名说明**：当前构建跳过代码签名（`identity: null`），首次打开若被 Gatekeeper 拦截，在应用上**右键 →「打开」**放行一次即可。
>
> **Windows 未签名说明**：安装包未签名，首次运行若被 SmartScreen 拦截，点击「更多信息」→「仍要运行」即可放行。

## ⌨️ 快捷键

| 操作 | 按键 |
| --- | --- |
| 下一页 / 上一页 | `→` / `←`（固定语义，不随 RTL 翻转）、`↓` / `↑` |
| 下一页 / 上一页 | `空格` / `Shift+空格`、`PgDn` / `PgUp` |
| 首 / 末页组 | `Home` / `End` |
| 页组跳转 | 底栏滑块拖动（过程跟随，松手播放一次翻页动画） |
| 单页 / 双页 | `D` |
| 切换阅读方向 | `R` |
| 放大 / 缩小 | `Cmd/Ctrl+=` / `Cmd/Ctrl+-`，`Cmd/Ctrl+滚轮` |
| 全屏 | `F` 或工具栏按钮；`Esc` 退出全屏 / 返回文库 |

<details>
<summary><b>📚 完整功能清单</b></summary>

#### 文库（主页）

- **导入**：多选 PDF 文件，或选择文件夹递归扫描（跳过隐藏目录与符号链接）；按规范化绝对路径去重
- **封面**：导入后由封面队列逐本渲染第 1 页落盘（480px JPEG），渐进上屏；失败显示占位图
- **卡片**：封面、书名、阅读进度（百分比 + 进度条）、最近阅读时间
- **排序**：最近阅读（默认）/ 添加时间 / 书名，偏好持久化
- **卡片操作**：打开、移入合集、重命名、移除（可选同时删除文件，二次确认）、缺失文件重新定位

#### 合集

- 主页创建合集，合集卡片与书本卡片等高，右侧带多页纸缘效果；封面取集内书名升序第一本
- 点击合集进入合集视图：显示成员书（书名升序）、解散合集（成员移回未分组，二次确认）
- 合集内可直接**导入漫画 / 导入文件夹**（新导入自动归属该合集）
- **从主页添加**：多选对话框把未分组的书移入合集，支持书名模糊搜索（空格分隔多词、大小写不敏感）与**全选**
- **继续阅读侧栏**：合集视图右侧栏默认展示集内最近阅读的一本（大封面 + 书页厚度的立体书籍样式），配上一本/下一本按钮在集内书单中切换焦点，点击封面直接续读

#### 阅读器

- **页组**：单页 `[1][2][3]…`；双页默认封面单独成页 `[1][2,3][4,5]…`（可在设置关闭）
- **方向**：RTL（日漫）组内第 1 页在右；LTR（韩漫）组内第 1 页在左；点击热区随方向镜像（左右键盘键固定语义，见快捷键）
- **缩放**：适宽 / 适高（默认，页面贴满视口）/ 原始 100% / 自定义 25%–400%（`Ctrl/Cmd+滚轮` 或 `=`/`-` 步进 10%）；超出视口可拖拽平移
- **翻页动画**：canvas 自绘仿真纸张卷曲（450ms，折缝阴影与纸边高光），连翻自动取消上一层；遵循 `prefers-reduced-motion`
- **渲染管线**：离屏 canvas → LRU 位图缓存（12 张，含渲染签名）→ 贴图上屏；后台按设置预取前后 0–4 组
- **性能保护**：滑块跨多页拖动零渲染开销（松手后并行渲染双页），作废渲染循环的迟到结果只入缓存不上屏

#### 设置

| 设置项 | 取值 | 默认 |
| --- | --- | --- |
| 默认阅读模式 | 单页 / 双页 | 单页 |
| 默认阅读方向 | LTR / RTL | RTL |
| 主题 | 浅色 / 深色 / 跟随系统 | 跟随系统 |
| 预加载页组数 | 0–4 | 2 |
| 双页封面单独成页 | 开 / 关 | 开 |

单本书的进度记录优先于全局默认。

</details>

## 🛠️ 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 42 |
| 前端 | Vue 3 + TypeScript + Pinia + Vue Router，Vite 5 构建（vite-plugin-electron） |
| PDF 渲染 | pdfjs-dist 4.x（渲染进程 worker 解析 → canvas） |
| 数据库 | better-sqlite3 12.x（主进程内嵌 SQLite，WAL 模式） |
| 打包 | electron-builder 24（macOS DMG / Windows NSIS） |
| 测试 | Vitest 1.x（页组划分、封面队列等纯逻辑，15 个用例） |

## 🧭 架构

Electron 双进程，前后端分离：

```
渲染进程（Vue 3 SPA）
  文库 / 阅读器 / 设置 三路由
  pdf.js worker → 离屏 canvas → LRU 缓存 → 上屏
        ▲ IPC（contextBridge 类型安全 API，contextIsolation + sandbox）
主进程（Node.js）
  文库 / 合集 / 进度 / 设置服务，封面落盘，日志
  ireader:// 自定义协议（按 id 提供 PDF 与封面，不暴露文件路径）
        ▲
  {userData}/ireader.db（SQLite WAL）+ {userData}/covers/
```

```
├── electron/          # 主进程：main / preload / db(repos+迁移) / services / ipc
├── src/               # 渲染进程：views / stores / services(pdf·pageCache·pageCurl·spread) / components
├── shared/types.ts    # 前后端共享类型（Book / Collection / Settings / Result…）
├── pics/              # 界面截图
└── build/             # 打包资源（icon 等）
```

安全基线：渲染进程沙箱启用、`contextIsolation: true`、`nodeIntegration: false`；本地文件只能经 `ireader://pdf/{id}`、`ireader://cover/{id}` 按 id 获取。

<details>
<summary><b>🗄️ 数据模型（SQLite，增量迁移）</b></summary>

- `books`：书名、规范化路径（唯一）、页数、封面路径、添加 / 最近阅读时间、`collection_id`（NULL = 未分组）
- `collections`：合集（id、标题、创建时间）
- `reading_progress`：每本书一条（页码、模式、方向、缩放，变更防抖 1s 保存，退出强制落盘）
- `settings`：key-value（JSON）

迁移用 `PRAGMA user_version` 版本号 + 顺序脚本（当前 v2：合集表与书籍归属列），只追加不回改。

</details>

## 💻 本地开发

```bash
npm install        # 安装依赖（postinstall 自动 electron-rebuild better-sqlite3）
npm run dev        # 启动开发环境
npm test           # Vitest 单元测试
npm run typecheck  # vue-tsc 类型检查
```

> 注意：`better-sqlite3` 是为 Electron ABI 编译的原生模块，直接用系统 Node 运行会报 `ERR_DLOPEN_FAILED`；如需脚本化操作数据库，使用 `ELECTRON_RUN_AS_NODE=1 npx electron <脚本>`。

欢迎提交 Issue 与 Pull Request。

## 📦 打包发布

```bash
npm run build      # 类型检查 → vite 构建 → electron-builder
```

产物输出至 `release/<版本号>/`：

- `IReader-<版本号>-mac.dmg` — macOS 安装镜像
- `mac-arm64/IReader.app` — 可直接使用的应用包

要点：

- macOS 当前**跳过代码签名**（`identity: null`）：首次打开如被 Gatekeeper 拦截，右键应用 →「打开」放行一次即可
- `asarUnpack` 已含 `better-sqlite3`（.node 原生二进制不能从 asar 内加载）
- Windows NSIS 目标已配置并完成实机验收

### 发布到 GitHub Releases

安装包不进 git 仓库（`.gitignore` 已忽略 `release/`），由 **GitHub Actions 自动构建并发布**：推送 `v*` 格式的版本 tag 即触发——先跑类型检查与测试，再在 macOS / Windows 双平台构建，产物自动挂到 Release 并生成更新说明。

**标准发版流程**（要求 git 工作区干净）：

```bash
# 1. 提升版本号，按改动性质三选一（自动改 package.json 的 version →
#    自动 commit（message 为版本号）→ 自动打 v 前缀 tag，无需手写版本号）：
npm version patch          # 修订号 +1，bug 修复          1.0.1 → 1.0.2
npm version minor          # 次版本 +1，新功能且兼容      1.0.1 → 1.1.0
npm version major          # 主版本 +1，破坏性改动        1.0.1 → 2.0.0

# 2. 推送分支与 tag（tag 是触发自动发布的开关）：
git push origin main --follow-tags

# 3. 盯进度与验收：
gh run list --workflow Release --limit 1   # 查最新构建状态（记下 run-id）
gh run watch <run-id> --exit-status        # 可选：终端实时盯进度
gh release view v<新版本号>                 # 构建完校验 Release 与双平台产物
```

构建约 5～10 分钟，进度也可在仓库 **Actions** 页查看；完成后 Release 自动出现在 Releases 页。

**发版失败需要重跑时**（tag 指向旧 commit，Actions 页 re-run 无效，须重打 tag）：

```bash
git push origin :refs/tags/vx.y.z   # 删除远程旧 tag
git tag -f vx.y.z                   # 本地把 tag 重打到修复后的最新 commit
git push origin vx.y.z              # 单独推 tag，重新触发构建
```

本地手动构建（备选）：`npm run build` 后执行
`gh release create v<版本号> "release/<版本号>/IReader-<版本号>-mac.dmg" --title "v<版本号>" --notes "更新说明"`。

## 📄 许可证

本项目基于 [MIT](./LICENSE) 许可证开源。
