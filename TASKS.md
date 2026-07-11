# 项目 TODO

> 跨 session / 跨 worktree 的任务清单。每条必须**自包含**——新 session 冷启就能接手，不依赖上下文。
>
> 不放纯"我下次要想一想的想法"；放的都是**具体要做、有产出的活**。
> 已完成的项在 git log 里找，不在这里保留。

---

## P1 · Worktree 并行开发补全（部分已实现，待后续拆分认领）

**来源**：`eloquent-pike-35f53c` worktree 曾有一份未提交的 `docs/WORKTREE-WORKFLOW.md`；其思路已在 `codex/worktree-lifecycle-governance` 分支中重新审查。

**历史草案主要内容（仅供追溯，不作为当前操作指令）**：
- `npm run worktree:bootstrap`——分配专属端口 + symlink private key + npm install
- `npm run worktree:doctor` / `worktree:ports`——诊断 / 列端口
- `.claude/worktrees/ports.json` + `.claude/worktree.env`——端口状态
- DevTools 资源锁：`npm run devtools:lock/unlock/status`（WECHAT_DEVTOOLS_PORT=9420 单例）
- `npm run worktree:pre-merge`——rebase + typecheck + H5 build + h5-test smoke + 跨 worktree 冲突扫描
- `deploy:cloud` 分支守卫（只从 main，非 main exit 1）
- 合并顺序约定：按改动面小 → 大

**当前已实现（待合入 main）**：`worktree:create/doctor/bootstrap/status/sync-main/retire`、Node 24/npm 11 + root lockfile、Git hooks/AGENTS 检查、session heartbeat 的 fail-closed retirement、以及 `deploy.mjs` 的 canonical-main 运行时门禁。没有采用端口分配、私钥 symlink 或共享 `node_modules`，因为它们会扩大跨 worktree 影响面。

**选项**（待拍板）：
**仍待决策/认领**：
- DevTools 单例资源锁（需要先确认真实 DevTools 并发行为，而非只锁端口）。
- 跨 worktree 语义冲突检查与完整 46 篇 Markdown 的权威性审计。
- 是否需要每个 worktree 的固定本地端口；若需要，必须先定义端口冲突、回收和失败恢复契约，不能用 symlink 私钥或共享 `node_modules` 代替。

**当前限制**：以上治理尚未合入 `main`；在 PR CI 与主干集成前，已存在 worktree 仍按原有流程工作，所有权未知时不会被自动清理。

---

## Backlog 模板（后续往下加）

格式：
```
## 优先级 · 一句话标题
**来源**：哪个 session / 哪次发现
**现状**：目前是什么状态
**选项 / 下一步**：具体能做什么
```
