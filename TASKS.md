# 项目 TODO

> 跨 session / 跨 worktree 的任务清单。每条必须**自包含**——新 session 冷启就能接手，不依赖上下文。
>
> 不放纯"我下次要想一想的想法"；放的都是**具体要做、有产出的活**。
> 已完成的项在 git log 里找，不在这里保留。

---

## P1 · Worktree 并行开发脚手架（待决策或认领）

**来源**：`eloquent-pike-35f53c` worktree 里有一份 158 行的 `docs/WORKTREE-WORKFLOW.md`（未 commit，在工作区），描述了完整的 worktree 协作工作流。

**内容提纲**：
- `npm run worktree:bootstrap`——分配专属端口 + symlink private key + npm install
- `npm run worktree:doctor` / `worktree:ports`——诊断 / 列端口
- `.claude/worktrees/ports.json` + `.claude/worktree.env`——端口状态
- DevTools 资源锁：`npm run devtools:lock/unlock/status`（WECHAT_DEVTOOLS_PORT=9420 单例）
- `npm run worktree:pre-merge`——rebase + typecheck + H5 build + h5-test smoke + 跨 worktree 冲突扫描
- `deploy:cloud` 分支守卫（只从 main，非 main exit 1）
- 合并顺序约定：按改动面小 → 大

**现状**：引用的所有脚本和 deploy.mjs 分支守卫**主 repo 都不存在**。这份文档**描述的是一套未实现的工作流**。

**选项**（待拍板）：
- **(A) 认领实现**——工程量：1 个完整 session。需要：
  - `scripts/worktree-bootstrap.mjs`（端口分配 + key symlink + npm install）
  - `scripts/worktree-doctor.mjs`（只读诊断）
  - `scripts/devtools-lock.mjs` + status/unlock 配套
  - `scripts/pre-merge-check.mjs`（rebase 检查 + 冲突扫描）
  - `.claude/worktrees/ports.json` + `.claude/worktree.env` schema + 写入逻辑
  - `deploy.mjs` 分支守卫（`getCurrentBranch()` + `exit(1)` if not main）
  - package.json scripts 补齐
  - 文档从 worktree 合进 main
- **(B) 降级为规划文档**——塞进 `docs/roadmap/WORKTREE-WORKFLOW.md`，顶部加 `⚠️ 本文档描述未实现的工作流` 标，让未来决策者知道这个设计已经存在，别重新设计
- **(C) 作废**——当前 2-3 个活跃 worktree 的量级靠人脑 + CLAUDE.md 的"Worktree 协作"那段已够用

**现状（2026-04-24）**：文档内容当前还只漂在 `eloquent-pike-35f53c` 的工作区里，没提交。如果 (A) 或 (B)，需要从那个 worktree 拿源文件。

---

## Backlog 模板（后续往下加）

格式：
```
## 优先级 · 一句话标题
**来源**：哪个 session / 哪次发现
**现状**：目前是什么状态
**选项 / 下一步**：具体能做什么
```
