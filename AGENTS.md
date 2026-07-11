# HappyHome 项目协作约束

## PR 与 CI 合并门禁（强制）

本仓库当前无法通过 GitHub 套餐强制保护 `main`，因此以下规则是所有 HappyHome 任务必须主动遵守的项目约束。GitHub 没有拦截，不代表允许绕过。

本地 Git hooks、AGENTS 和共享凭据约束是防误操作的流程护栏，不是能对抗 `--no-verify`、GitHub API 或持有生产凭据者的安全隔离。生产权限的物理隔离不在当前方案范围内。

### 角色边界

- 一个功能必须使用一个独立的 `codex/<feature>` 分支和独立 worktree。
- 功能任务只能开发、测试、提交并推送自己的功能分支，不得直接提交或推送 `main`。
- 功能任务不得在真实主工作区执行合并、部署或发布，除非用户明确指定当前任务为主干集成/发布任务。
- HappyHome 的真实主工作区是 `C:\Project\Claude\happyHome`。只有主干集成/发布任务可以在该目录操作 `main`。

### Worktree 引导

- 新 worktree 必须由最新 `origin/main` 创建；`AGENTS.md` 必须是仓库内真实文件，禁止软链接或符号链接。
- 每台开发机首次使用仓库时必须在任一 HappyHome worktree 执行 `npm.cmd run hooks:install`。该配置使用共享 Git hooks，在后续 `git worktree add` 后执行预检。

### 共享云环境边界

- 功能会话不得部署或发布到生产环境，也不得上传小程序版本。
- 功能会话不得修改共享云环境的环境变量、数据库索引、触发器或迁移状态。
- 生产部署、环境变量/索引/触发器/迁移变更和小程序上传，必须由主干发布角色在真实主工作区执行。

### PR 流程

1. 功能任务开始和交付前都必须确认并报告 `cwd`、branch、HEAD 和工作区状态。
2. 发起 PR 前必须将最新 `origin/main` 同步到功能分支，解决文本与语义冲突，并重新运行受影响范围的测试。
3. 功能代码必须先提交并推送到远端功能分支，再通过 PR 进入 `main`；禁止把未提交文件当成交接手段。
4. PR 必须准确记录修改范围、测试证据、部署目标、环境变量、数据迁移/索引任务、验收步骤和已知风险。
5. 功能分支之间不得互相合并。存在依赖时，先将前置功能合入 `main`，后续功能再同步新的 `main`。

### CI 门禁

- PR CI 必须由 `pull_request` 事件触发，并使用该 PR 的实际提交运行。
- CI 未触发、仍在排队、失败、取消或缺少必要检查时，PR 一律不是 `merge-ready`。
- 本地测试不能冒充 GitHub PR CI；可以作为补充证据，但不能报告为“CI 已通过”。
- 当前仓库若尚无可运行的 PR CI，任务必须明确报告 `blocked: PR CI not configured`，不得静默绕过后合并功能代码。
- CI 的 job 名称必须稳定且唯一，避免以后配置 Required Status Checks 时产生歧义。
- 普通 `integrate:pr` 拒绝任何 `.github/workflows/*.yml` / `*.yaml` 变更。纯 workflow PR 必须从 canonical main 使用 `integrate:workflow-pr -- --pr=N --prepare`，由 main 上的只读 Windows hosted validator 独立验证，再以 manifest 中逐字段绑定的精确授权短语执行 `--apply`。
- workflow 授权在 PR push/rebase、`origin/main` 前进、changed paths/binary diff、validator run/attestation 任一变化后立即失效，必须重新 prepare。候选 PR 自身 CI 只能作为补充证据，不能替代 validator attestation。
- `.github/workflows/trusted-workflow-validator.yml`、integration CLI/policy、package script 或本节信任规则均属 trust root，不能通过候选 workflow PR 自我验证；这类变更必须走独立的信任根引导审查。

### 串行合并

- 主干集成任务一次只能处理一个 PR。
- 合并一个 PR 后，下一个 PR 必须重新同步最新 `main` 并重新通过 PR CI，才能继续合并。
- 合并前必须检查分支确有独有提交；无独有提交时按 no-op 结束，不重复测试、部署或发布。
- `implemented`、`tested`、`committed`、`pushed`、`PR CI passed`、`merged`、`deployed`、`production verified` 是不同状态，任务只能报告已有证据支持的最高状态。

### 首次引导例外

在首个可运行的 `pull_request` CI 工作流尚未进入 `main` 之前，仅允许用户明确指定的主干集成任务合并一次纯 CI/协作约束引导变更。该引导变更不得夹带业务功能，并且必须先在本地运行其 CI 中定义的同等检查。引导完成后，本例外自动失效。
