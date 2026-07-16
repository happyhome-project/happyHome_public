# HappyHome 项目协作约束

## PR 与 CI 合并门禁（强制）

本公开仓库的 `main` 由仓库级 Ruleset 强制保护，并要求所有变更经过 Pull Request、`pr-ci / offline` 和 Merge Queue。以下规则仍是所有 HappyHome 任务必须主动遵守的项目约束；GitHub 门禁与本地约束需要同时成立。

本地 Git hooks、AGENTS 和共享凭据约束是防误操作的流程护栏，不是能对抗 `--no-verify`、GitHub API 或持有生产凭据者的安全隔离。生产权限的物理隔离不在当前方案范围内。

### 角色边界

- 一个功能必须使用一个独立的 `codex/<feature>` 分支和独立 worktree。
- 功能任务只能开发、测试、提交并推送自己的功能分支，不得直接提交或推送 `main`。
- 功能任务不得在本地 `main` 工作区执行合并、部署或发布，除非用户明确指定当前任务为主干集成/发布任务。
- 公开仓库的主干集成由 GitHub Merge Queue 完成；任何本地 `main` worktree 都不是直接推送入口。

### Worktree 引导

- 新 worktree 必须由最新 `origin/main` 创建；`AGENTS.md` 必须是仓库内真实文件，禁止软链接或符号链接。
- 每台开发机首次使用仓库时必须在任一 HappyHome worktree 执行 `npm.cmd run hooks:install`。该配置使用共享 Git hooks，在后续 `git worktree add` 后执行预检。
- `worktree:create` 会在新 worktree 一次完成 hooks、AGENTS、runtime 校验与 bootstrap；无需创建后再运行 doctor/bootstrap。`worktree:doctor` 只做本地诊断。`worktree:bootstrap` 按 package/lock、Node/npm、platform/arch 指纹决定是否重新 `npm ci`。
- `worktree:create` 与 `worktree:retire` 只能从公开仓库集成 main 执行：当前 worktree 必须是 `main`，`origin` 必须精确派生为 `happyhome-project/happyHome_public`，工作区 clean、无 Git operation、根目录不是 reparse point，且刷新后 `HEAD` 必须精确等于 `origin/main`。fetch 使用校验时捕获的 remote URL，不再解析可变 remote 名；私有仓库 main、feature 分支、ahead/behind/stale main 均不是这个角色。
- 推荐从该公开仓库集成 main 使用 `npm.cmd run worktree:create -- --name=<task-name> --path=<absolute-path>` 创建；它会刷新 `origin/main`、在实际 mutation 前重验操作者身份、创建安全的 `codex/*` 分支、校验 AGENTS/hooks 并自动执行 bootstrap。这一角色只管理公开仓库同一 Git common dir 的开发 worktree。
- `npm.cmd run worktree:sync-main` 单阶段同步：behind-only 使用 fast-forward，diverged 使用普通 merge，未 behind 则 no-op；dirty 或 Git operation 阻断，禁止 stash、rebase、reset。
- `npm.cmd run worktree:status` 默认只读本地 tracking ref，不 fetch、不调用 `gh`；只有 `-- --fresh` 才刷新远端并评估退役证据。
- worktree 退役使用 `npm.cmd run worktree:retire -- <path>`；仅安全 public canonical main 可执行，并在一次 fresh main/open PR snapshot 后、非 force remove 紧前重验全部门禁。始终保留本地功能分支。
- 创建功能 worktree 的原任务必须负责清理自己创建的目录：PR 进入 GitHub 终态 `MERGED` 后，先记录该功能 worktree 的绝对路径并确认 clean、无 Git operation，再从 `C:\Project\Claude\happyHome_public` 执行 `npm.cmd run worktree:retire -- <absolute-feature-worktree-path>`。成功退役并确认目录已移除后，任务才算结束；不得只报告 merged 后留下 worktree。
- 退役失败必须报告 `worktree:retire` 的准确阻塞原因，禁止改用 force remove、手工递归删除或清理其他任务的 worktree。`CLOSED` 但未合入、仍有独有提交的分支继续保留目录和本地分支，直到代码去向明确；磁盘清理不能覆盖代码保全。

### 机器本地验证租约

- DevTools 自动化与使用 `fixture-write` 的普通仓库命令共用同一个机器本地 `validation lease`；已有 lease 会阻止新的受保护命令。过期 lease 仍是 `unknown`，不得自动接管；先用 `npm.cmd run validation:lease:status` 查看状态，确认原 owner 已退出后才可使用 `npm.cmd run validation:lease:recover -- --expected-owner-token=<uuid> --confirm-no-owner --reason="..."` 显式恢复。
- 该租约是协作护栏：原始 CLI/API 仍可能绕过它，因此不是安全隔离。不得终止或关闭另一 owner 的进程或 DevTools，也不得移动或删除另一 owner 的缓存；应由 owner 释放租约，或在明确确认无人持有后走显式恢复命令。

### 共享云环境边界

- 功能会话不得部署或发布到生产环境，也不得上传小程序版本。
- 功能会话不得修改共享云环境的环境变量、数据库索引、触发器或迁移状态。
- 正式生产发布只能由主干发布角色在 clean、已同步的公开 canonical main `C:\Project\Claude\happyHome_public` 执行；当前分支必须为 `main`，`HEAD` 必须精确等于刷新后的 `origin/main`，且 `origin` 必须精确派生为 `https://github.com/happyhome-project/happyHome_public.git`。feature、dirty、ahead/behind/stale main、路径或 origin 不匹配都必须阻断。
- `full-current` 正式发布必须在 prepare 和 publish 两阶段都显式传入 `--full-current`。它只在发布规划时忽略上次生产 SHA，不得清除、改写或伪造生产状态；缺失生产锁、UI 或 cloud smoke 失败、fixture cleanup 失败也必须阻断。
- 生产部署、环境变量/索引/触发器/迁移变更和小程序上传，必须由上述主干发布角色在真实主工作区执行。
- `scripts/deploy.mjs` 的直接生产目标也会在运行时检查 canonical main、工作区干净和 `HEAD=origin/main`；不依赖 `env:run` 或 Git hook 作为该边界。
- 跨组件正式发布编排、强制门禁、证据、上传策略和最终生产验证只在 [`docs/release-gate.md`](docs/release-gate.md) 维护；组件文档可保留自身构建或部署参考，本文件只定义权限和流程边界。

### PR 流程

GitHub 上 PR 的 exact HEAD 是 push、CI、review 和合并状态的权威事实源。Webhook 只能作为可选加速通知，控制面未收到 `synchronize`、处于 paused 或 `record-push` 未登记，都不得阻止功能 AI 直接向 GitHub 核验 exact HEAD 后继续。正常流程不需要集中轮询或 orphan watchdog；创建 PR 的原功能 AI 自己负责到终态。

1. 功能任务开始和交付前都必须确认并报告 `cwd`、branch、HEAD 和工作区状态。
2. PR 前确认功能 worktree clean；不要求无条件追逐 main。仅在真实冲突、显式依赖或 `merge_group` 代码失败时，回到原功能 worktree 同步并修复。
3. 功能代码必须先提交并推送到远端功能分支，再通过 PR 进入 `main`；禁止把未提交文件当成交接手段。
4. PR 必须准确记录修改范围、测试证据、部署目标、环境变量、数据迁移/索引任务、验收步骤和已知风险。
5. 同步与修复不得自动 stash 或 rebase，不得 force-push，也不得合并其他功能分支。存在依赖时，先将前置功能合入 `main`，后续功能再同步新的 `main`。
6. 每次普通 push 后旧结果作废，功能 AI 立即读取 GitHub PR 并确认 repo、head branch 和新的 exact HEAD 等于刚推送的 SHA；不得等待 webhook 或反复轮询 `record-push`。确认后轮询该 exact HEAD 对应的 checks、review 与 comments。功能 AI 对该 PR 负责到 GitHub 终态 `MERGED` 或 `CLOSED`，不得在 `merge-ready` 或入队后提前结束。
7. `merge-ready` 仅表示 PR 为 open、非 draft，exact HEAD 的全部必需 PR CI 成功且无失败、排队、取消或缺失检查，没有未处理的 review/change request，并且 GitHub 未报告文本冲突。
8. PR 创建后不要求功能分支持续追逐或同步前进的 `main`；组合后的最新主干由 Merge Queue 的 `merge_group` CI 验证。
9. exact HEAD 的 CI 和 review 门禁满足后，功能 AI立即使用 `gh pr merge <N> --auto --merge` arm Merge Queue，并继续监控 `merge_group` CI，直到 terminal `MERGED` 或 `CLOSED`。
10. PR `MERGED` 后，原功能 AI 必须从 canonical main 调用 `worktree:retire` 退役自己创建的 worktree，并确认目录已移除；退役是 PR 生命周期的最后一步。若 `CLOSED` 未合入或安全门禁阻断，保留现场并报告原因，不得强删。

### CI 门禁

- PR CI 必须由 `pull_request` 事件触发，并使用该 PR 的实际提交运行；同一必需检查还必须监听 `merge_group`，验证队列生成的临时合并提交。
- CI 未触发、仍在排队、失败、取消或缺少必要检查时，PR 一律不是 `merge-ready`。
- 本地测试不能冒充 GitHub PR CI；可以作为补充证据，但不能报告为“CI 已通过”。
- 当前仓库若尚无可运行的 PR CI，任务必须明确报告 `blocked: PR CI not configured`，不得静默绕过后合并功能代码。
- CI 的 job 名称必须稳定且唯一，避免以后配置 Required Status Checks 时产生歧义。
- 普通 `integrate:pr` 拒绝任何 `.github/workflows/*.yml` / `*.yaml` 变更。纯 workflow PR 必须从 canonical main 使用 `integrate:workflow-pr -- --pr=N --prepare`，由 main 上的只读 Windows hosted validator 独立验证，再以 manifest 中逐字段绑定的精确授权短语执行 `--apply`。
- workflow 授权在 PR push/rebase、`origin/main` 前进、changed paths/binary diff、validator run/attestation 任一变化后立即失效，必须重新 prepare。候选 PR 自身 CI 只能作为补充证据，不能替代 validator attestation。
- `.github/workflows/trusted-workflow-validator.yml`、integration CLI/policy、package script 或本节信任规则均属 trust root，不能通过候选 workflow PR 自我验证；这类变更必须走独立的信任根引导审查。

### Merge Queue 协调

- 所有公开仓库 PR 必须加入 Merge Queue；不得绕过队列直接调用 merge API。
- 多个 `merge-ready` PR 允许正常进入 Merge Queue，由 GitHub 管理顺序，并对受前序合并影响的队列组合重新运行 `merge_group` CI。
- 功能 AI 自审、push 并达到 `merge-ready` 后，使用 `gh pr merge <N> --auto --merge` 交给 Merge Queue，并继续处理评论与失败，直到 GitHub 终态 `MERGED` 或 `CLOSED`。
- `merge_group` 代码、测试、冲突、review 或 HEAD 变化失败时，功能 AI 在原 worktree 修复；瞬态基础设施或队列状态失败且 exact HEAD 未变时，同一功能 AI 复核 readiness 后重新 arm，不制造提交。依赖 PR 保持 draft，直到前置 PR 已进入 main。
- Public 协作暂时禁用当前 `integrate:pr`，因为该命令仍绑定私有 canonical 边界；统一使用 GitHub Merge Queue，此 public 协调流程不触发 release 或 deploy。
- 合并前必须检查分支确有独有提交；无独有提交时按 no-op 结束，不重复测试、部署或发布。
- `implemented`、`tested`、`committed`、`pushed`、`PR CI passed`、`merged`、`deployed`、`production verified` 是不同状态，任务只能报告已有证据支持的最高状态。

### 首次引导例外

在首个可运行的 `pull_request` CI 工作流尚未进入 `main` 之前，仅允许用户明确指定的主干集成任务合并一次纯 CI/协作约束引导变更。该引导变更不得夹带业务功能，并且必须先在本地运行其 CI 中定义的同等检查。引导完成后，本例外自动失效。
