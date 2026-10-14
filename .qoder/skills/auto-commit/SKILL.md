---
name: auto-commit
description: 梳理当前分支工作区改动（git status / git diff），按项目 Conventional Commits 中文规范生成提交信息，展示给用户确认后执行 git commit。当用户要求提交代码、生成 commit 信息、梳理并提交当前改动，或提到 auto-commit / 自动提交时使用。
---

# auto-commit 自动提交

将「梳理改动 → 生成提交信息 → 用户确认 → 提交」流程标准化。全程使用中文；生成的提交信息必须与项目 git log 既有风格保持一致。

## 步骤 1：检查工作区状态

1. `git status --porcelain` 与 `git branch --show-current` 获取改动清单和当前分支名。
2. 工作区干净时（已暂存、未暂存、未跟踪均无），告知用户「当前分支无待提交改动」并结束，不创建空提交。
3. 扫描疑似敏感文件（.env、密钥、token、证书类），发现时必须单独列出并等待用户确认，不得擅自纳入提交。

## 步骤 2：梳理变更内容

1. 分别获取：未暂存改动 `git diff`、已暂存改动 `git diff --cached`、未跟踪新文件列表（`git status` 中 `??` 项）。
2. 未跟踪新文件一并纳入提交范围；对关键改动用 Read 查看文件内容理解意图，禁止仅凭文件名猜测变更目的。
3. 输出分组摘要：按模块/功能归类，每项说明「改了什么 + 为什么改」。

## 步骤 3：生成提交信息

格式：`<type>(<scope>): <中文简述>`，scope 可省略。参考项目历史风格：

```
feat: 新增 EPUB 格式阅读支持
fix: 修复EPUB双页翻页无反应（scrollWidth污染滚动判定）
docs: 补充发版手册
chore(deps): 升级 Electron 30→42
chore(ci): 升级 actions 至 Node 24 运行时版本
perf: 截图转 WebP 并缩至 1600px
```

- type 按改动性质选择：feat / fix / docs / perf / chore；依赖变更用 chore(deps)，CI 变更用 chore(ci) 或 fix(ci)。
- 混合多种改动时取影响最大的一类；简述用中文、动词开头、不加句号，控制在一行内。
- 简单改动单行即可；改动复杂时追加 body 分条说明要点（`git commit -m "标题" -m "body"`）。

## 步骤 4：展示并等待用户确认（必须）

1. 展示：当前分支、变更文件清单（分组摘要）、拟定的完整提交信息。
2. 明确询问用户是否执行提交；用户要求调整消息内容或文件范围时，修改后再次确认。
3. 未经用户确认，绝不执行 `git add` / `git commit`。

## 步骤 5：执行提交

1. `git add -A`（或按用户确认的文件范围选择性 add）。
2. `git commit -m "<标题>"`，含 body 时追加 `-m "<body>"`。
3. 红线：不执行 `git push`；不使用 `--no-verify`、`--force`、`--amend`；不修改 git config；hooks 报错时如实反馈，不得绕过。

## 步骤 6：汇报结果

输出提交结果：短 hash、提交信息、文件变更统计（如 `N files changed`），并提示「尚未推送到远端，如需推送请告知」，不得擅自 push。
