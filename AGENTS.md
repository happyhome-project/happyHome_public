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
- 新 worktree 先运行 `npm.cmd run worktree:doctor`；只有 attached、clean、同步到 `origin/main` 的 `codex/*` 分支才可运行 `npm.cmd run worktree:bootstrap`。bootstrap 仅在仓库根执行 `npm.cmd ci`，不链接其它 worktree 的 `node_modules`。
- `worktree:create` 与 `worktree:retire` 只能从公开仓库集成 main 执行：当前 worktree 必须是 `main`，`origin` 必须精确派生为 `happyhome-project/happyHome_public`，工作区 clean、无 Git operation、根目录不是 reparse point，且刷新后 `HEAD` 必须精确等于 `origin/main`。fetch 使用校验时捕获的 remote URL，不再解析可变 remote 名；私有仓库 main、feature 分支、ahead/behind/stale main 均不是这个角色。
- 推荐从该公开仓库集成 main 使用 `npm.cmd run worktree:create -- --name=<task-name> --path=<absolute-path>` 创建；它会刷新 `origin/main`、在实际 mutation 前重验操作者身份、创建安全的 `codex/*` 分支、校验 AGENTS/hooks 并自动执行 bootstrap。这一角色只管理公开仓库同一 Git common dir 的开发 worktree，不改变 release/deploy 的私有生产 canonical 边界。
- `npm.cmd run worktree:sync-main -- --prepare` 只报告同步方案；缺失或过期 heartbeat 时还必须由操作者显式带 `--confirm-no-owner`。apply 必须带 prepare 输出的 `--expected-head` 和 `--expected-main`。dirty、活跃所有权或分叉分支不得自动 stash、merge 或 rebase。
- `npm.cmd run worktree:status` 对退役操作只读：不会 retire/prune/remove，但会 fetch 并更新本地 `origin/main` remote-tracking metadata。`candidate_stale` 仅表示除未知 owner 外的门禁已通过，不等于可退役；只有 owner 明确 inactive 且所有检查 known/pass 才会显示 `eligible`。
- worktree 退役必须先 `worktree:retire -- --prepare <path> --confirm-no-owner`，再用生成 manifest apply；target 及其已存在 ancestor 不得为 reparse/junction，其真实 Git common dir 必须与公开 operator 完全一致。apply 在共享锁内用锁外捕获的 exact HEAD/main/PR snapshot 本地重验，并在 remove 紧前完成最后一次全量 probe。始终保留本地功能分支，`--delete-merged-local-branch` 已禁用；禁止 `git worktree remove --force`、批量 prune 或删除未进入 main 的本地分支。
- 项目 hook 必须获客户端信任才会产生 heartbeat；缺失或超过 12 小时的 heartbeat 是 `unknown`，不是“无人使用”。`env:run` 仅为本地命令分类，不能授予生产权限。

### 共享云环境边界

- 功能会话不得部署或发布到生产环境，也不得上传小程序版本。
- 功能会话不得修改共享云环境的环境变量、数据库索引、触发器或迁移状态。
- 生产部署、环境变量/索引/触发器/迁移变更和小程序上传，必须由主干发布角色在真实主工作区执行。
- `scripts/deploy.mjs` 的直接生产目标也会在运行时检查 canonical main、工作区干净和 `HEAD=origin/main`；不依赖 `env:run` 或 Git hook 作为该边界。
- 跨组件正式发布编排、强制门禁、证据、上传策略和最终生产验证只在 [`docs/release-gate.md`](docs/release-gate.md) 维护；组件文档可保留自身构建或部署参考，本文件只定义权限和流程边界。

### PR 流程

1. 功能任务开始和交付前都必须确认并报告 `cwd`、branch、HEAD 和工作区状态。
2. PR 前必须确认功能 worktree 工作区 clean，执行 `git fetch origin main`；若当前分支尚未包含最新 `origin/main`，只能在原功能 worktree 执行 `git merge origin/main`，解决文本与语义冲突后重新运行受影响范围的测试。
3. 功能代码必须先提交并推送到远端功能分支，再通过 PR 进入 `main`；禁止把未提交文件当成交接手段。
4. PR 必须准确记录修改范围、测试证据、部署目标、环境变量、数据迁移/索引任务、验收步骤和已知风险。
5. 同步与修复不得自动 stash 或 rebase，不得 force-push，也不得合并其他功能分支。存在依赖时，先将前置功能合入 `main`，后续功能再同步新的 `main`。
6. PR 创建后，功能 AI 必须轮询该 PR exact HEAD 对应的 checks、review 与 comments；每次普通 push 后旧结果作废，改为跟踪新的 exact HEAD。功能 AI 对该 PR 负责到 GitHub 终态 `MERGED` 或 `CLOSED`，不得在 `merge-ready` 或入队后提前结束。
7. `merge-ready` 仅表示 PR 为 open、非 draft，exact HEAD 的全部必需 PR CI 成功且无失败、排队、取消或缺失检查，没有未处理的 review/change request，并且 GitHub 未报告文本冲突。
8. PR 创建后不要求功能分支持续追逐或同步前进的 `main`；组合后的最新主干由 Merge Queue 的 `merge_group` CI 验证。
9. 功能 AI 不执行 enqueue，但继续监控并负责到 terminal `MERGED` 或 `CLOSED`；enqueue 是主干协调 AI 的职责。

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
- 主干协调 AI 负责对每个 `merge-ready` PR 重新读取 exact HEAD 与 readiness，再执行 enqueue；功能 AI 不执行 enqueue。
- `merge_group` 失败、取消或 PR 被移除队列时，协调者先做只读 triage。代码、测试、冲突、review 或 HEAD 变化导致的失败返回原功能 AI 和原功能 worktree；功能 AI push 后旧结果作废，修复后重新达到 `merge-ready`。若是瞬态基础设施失败、取消或队列状态变化，且 exact HEAD 未变、无代码失败，协调者重新验证 `merge-ready` 后重新 enqueue，不制造提交且无需 push。协调者永不修改功能代码。
- 协调者只有在 GitHub 报告真实 `MERGED` 且对应 `merge_group` 检查成功后才能报告 merged；随后仅在 clean、同步的 public main 执行 `git pull --ff-only origin main`。
- Public 协作暂时禁用当前 `integrate:pr`，因为该命令仍绑定私有 canonical 边界；统一使用 GitHub Merge Queue，此 public 协调流程不触发 release 或 deploy。
- 合并前必须检查分支确有独有提交；无独有提交时按 no-op 结束，不重复测试、部署或发布。
- `implemented`、`tested`、`committed`、`pushed`、`PR CI passed`、`merged`、`deployed`、`production verified` 是不同状态，任务只能报告已有证据支持的最高状态。

### 首次引导例外

在首个可运行的 `pull_request` CI 工作流尚未进入 `main` 之前，仅允许用户明确指定的主干集成任务合并一次纯 CI/协作约束引导变更。该引导变更不得夹带业务功能，并且必须先在本地运行其 CI 中定义的同等检查。引导完成后，本例外自动失效。
