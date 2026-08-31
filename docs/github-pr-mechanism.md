# GitHub PR 机制：设计逻辑、边界与可迁移经验

> **定位：reference / 设计说明。** 本文解释 HappyHome 的选择及其局限，不新增执行权限，也不替代 [AGENTS](../AGENTS.md)、[日常操作](SETUP.md#功能-pr-与-merge-queue-协作) 和 [正式发布规则](release-gate.md)。
> **核对基线：2026-08-31，public main `24f7f293241337487ed2b712cdde53f1a6f92be6`。** 源码链接用于继续追踪实现；下方 GitHub 设置和 PR #209 是有日期的证据，设置变化后必须重新查询，不能把此表当实时控制面。

## 1. 从目标推导机制，而不是从工具推导流程

真正的目标不是“每个改动都有 PR”，而是：**多个开发者或 AI 可以并行工作，只有身份明确、经过规定验证的组合才能进入主干；失败有人负责，发布另有证据。** PR 只是承载变更、讨论和证据的容器。

先明确四个要求：

| 要求 | 必须回答的问题 | HappyHome 的对应机制 |
|---|---|---|
| 安全性 | 未通过规定验证的变化，能否误入 main？ | GitHub Ruleset、稳定 required check、队列组合验证 |
| 可追溯性 | 通过的到底是哪份代码？ | repository + PR number + exact HEAD + check run；队列有独立 SHA |
| 可推进性 | 多个 PR 同时前进、通知丢失、CI 失败后，谁继续？ | 原任务负责终态；GitHub 实况优先于通知；区分代码失败和瞬态失败 |
| 副作用隔离 | 集成会不会顺便部署、污染测试数据、删掉未交付代码？ | 独立 worktree、验证租约、发布角色分离、受保护退役 |

约束也决定了成本：这是 Windows / Node 单仓、多组件、多人或多 AI 并发、共享云环境的项目。它需要组合验证和隔离工作目录，但不因此需要再造一套集中合并调度器。测试覆盖有限，所以不能把目标表述为“main 永远没有 bug”；可证明的是“指定身份的代码经过了指定门禁”。

## 2. 三层控制，不能混称“强制安全”

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| 协作协议：AGENTS、runbook、任务 owner | 范围、角色、review 处理、终态责任、何时允许操作 | 不能物理阻止持有权限的人违反约定 |
| 本地护栏：hooks、worktree CLI、validation lease、生产入口检查 | 提前发现错误目录/分支、dirty、并发占用、身份漂移，降低误操作 | 不能对抗 `--no-verify`、另一台机器、原始 API 或直接使用共享生产凭据 |
| GitHub 服务端：有效 Ruleset + Actions 结果 + Merge Queue | 对受保护分支执行配置的合入条件，验证当前队列组合 | 不等于独立人工审查、测试充分性、CI 定义可信或生产验收 |

这些控制有不同失效域：漏装 hook 不应让 main 失去服务端保护；Webhook 丢失不应让 PR 永久无人推进；GitHub 不可读时则不能凭本地缓存猜测已经合并。

**威胁模型必须说清楚。** 当前设计主要防协作者和自动化的失误，不是让一个持有同一管理员身份、能修改 Ruleset、CI 或生产凭据的恶意执行者受到独立安全隔离。无 bypass 表示当前规则中未配置豁免，不表示规则本身不能被有管理权限的人更改。

实现索引：[本地 pre-push](../.githooks/pre-push)、[worktree 操作](../scripts/worktree.mjs)、[生命周期判定](../scripts/lib/worktree-lifecycle.mjs)、[生产入口护栏](../scripts/lib/production-release-guard.mjs)。

## 3. 身份模型：PR head、队列 head、生产版本各是一回事

设 `H` 为功能分支 exact HEAD，`B` 为当时 main，`Q` 为队列构造的临时组合提交：

```text
功能 worktree ──提交/推送──> PR(H) ──检查/审查──> merge-ready
                                                 │
                                                 v
                                    Queue(B + 前序PR + H) = Q
                                                 │
                                         组合 CI(Q) 通过
                                                 │
                                                 v
                                            main 已合并
                                                 │
                          独立发布规划/门禁/产物/线上验证（可能无需发布）
```

- `H` 通过，只证明该候选在所选检查下通过；不证明它能与随后变化的 main 共存。
- `Q` 包含最新目标分支及前序队列项，用另一轮检查证明这个组合。前序项退出或组合变化，旧 `Q` 的结果不能冒充新组合的结果。
- 分支名、PR 编号、最新一条“绿灯”都不够。自动化应携带 `{repo, pr, headSha, runId, event}`；涉及集成还要记录 `baseSha / queueSha / mergeCommit`，涉及生产再绑定 release run 与产物摘要。
- 新 push 得到 `H2` 后，原先针对 `H` 的就绪判断失效；需要重新核对检查及仍适用的 review。即使 GitHub 没自动撤销旧 approval，旧 approval 也不能被表述为审过新提交。
- 队列提交、PR head、最终 main 提交不应在通用工具中假定相等；本项目使用 MERGE，保留功能提交的祖先关系，便于追溯和安全退役。

本仓库 [pr-ci.yml](../.github/workflows/pr-ci.yml) 同时监听 `pull_request` 与 `merge_group/checks_requested`，显式 checkout `pull_request.head.sha` 或 `merge_group.head_sha`。这不是 GitHub 默认 checkout 的含义：默认 PR 事件通常指向测试合并引用，必须明确自己验证的是 head 还是合并结果。[GitHub 事件语义](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

队列承担组合验证，因此普通功能 PR 不必在每次 main 前进后都反复同步、重跑。真实冲突、显式依赖或组合 CI 的代码失败才回原 worktree 处理。这个选择减少主干频繁前进时的“追赶循环”，但不取消最新组合验证。[GitHub Merge Queue 机制](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

## 4. 服务端实际配置：不要把期望当现状

2026-08-31 只读核对 [Ruleset `main-merge-governance`（18804705）](https://github.com/happyhome-project/happyHome_public/rules/18804705) 及 `rules/branches/main`：

| 配置 | 实际值 | 意义 / 注意 |
|---|---|---|
| 作用域 / enforcement | `~DEFAULT_BRANCH` / `active` | 当前默认分支为 main；不是任意功能分支 |
| 删除 / 非 fast-forward | 禁止 | 保护主干引用；本地保留分支是另一条规则 |
| PR | required | 不能把直接 push 当日常集成入口 |
| Required check | `context: offline` | workflow 叫 `pr-ci`、job/check 叫 `offline`；界面描述 `pr-ci / offline` 不等于 API context 字面值 |
| 检查来源绑定 | 未返回 `integration_id` | 未限定特定 GitHub App；#209 实际结果来自 `github-actions`，不代表规则强制其来源 |
| Strict status policy | `true` | 不把它解释为“每个普通 PR 必须人工追 main”；此仓库还启用了队列，由组合检查覆盖最新主干 |
| Approving reviews | **0** | PR 必需，但独立人工 approve 并非服务端必需条件 |
| 讨论解决 | `required_review_thread_resolution: true` | 必须解决 review thread；“标记已解决”本身不证明问题已正确修复 |
| Code owner / last push approval / stale dismissal | 均 `false` | 不存在这些额外的服务端审查保证 |
| 额外 unattributed-change approval | API 字段为 `true` | 记录该字段，不据此把最低 approval 数改称 1，或声称已有一般双人复核 |
| Queue | `MERGE`、`ALLGREEN` | 排队组合执行 required checks，不是普通本地 merge |
| Queue 容量 / 时间 | build concurrency 5；merge min 1 / max 5；等候最小批量上限 5 分钟；check timeout 60 分钟 | 等候值不是“每个 PR 强制等 5 分钟”；构建并发和一次合入数量也不是同一个参数 |
| Bypass | `[]`；当前查询身份 `never` | 当前未配置规则豁免；并非权限体系不可修改 |

仓库总开关允许 auto-merge，且 merge/squash/rebase 总开关都开；但 main 的 PR rule 仅允许 `merge`，queue 使用 `MERGE`。判断某分支能做什么，应读取**有效分支规则**，不能只读仓库总开关或只看 YAML。`delete_branch_on_merge=false` 也不等于“本地 worktree 已清理”。

GitHub 支持把 required check 绑定到指定 App；仅按名字匹配不能证明执行者和检查定义可信。不同项目应按威胁模型选择来源约束、独立审批和规则管理权限，不能照抄本项目的“0 approval”。[Ruleset 的检查与审查能力](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

### 可复核的只读查询

```powershell
$repo = 'happyhome-project/happyHome_public'
gh api "repos/$repo/rules/branches/main"
gh api "repos/$repo/rulesets/18804705"
gh pr view 209 --repo $repo --json state,headRefOid,baseRefName,mergeCommit,mergedAt,statusCheckRollup,reviews,reviewDecision
gh api "repos/$repo/commits/e6d28d8e6b1be1720e87bb290f9a4742202401c7/check-runs"
```

这是本次取证示例，不是通用配置脚本。迁移项目时替换仓库/规则/提交，检查返回是否完整；API 无权限、分页未读完或网络失败时记录 unknown，不把空结果当无门禁。PR 普通 comments、reviews 与 unresolved review threads 是不同数据；例如未解决线程需额外查询 GraphQL `reviewThreads` 并处理分页。没有评论不等于已独立审查。

## 5. CI 设计：一个稳定出口，两种验证范围

required job 保持 `offline` 稳定；内部检查范围按变化选择。这把“GitHub 等待哪个结果”与“本次需要做多少工作”解耦。

| 输入 | PR 检查选择（概括） | 为什么 |
|---|---|---|
| root Markdown / `docs/` 普通增改 | docs + governance | 快速反馈；仍执行依赖安装，不是零成本 |
| 单组件变更 | 组件相关测试/类型/构建 + release plan | 缩短独立候选反馈时间 |
| `cloud/shared/` | cloud + admin + miniprogram + release plan | 共享契约影响消费者 |
| package/lock、scripts、`.github/`、未知路径、删除/重命名/复制/二进制 | full | 不确定性扩大验证范围，不猜测无影响 |
| 任意 `merge_group` | full | 最后集成边界不沿用 PR 的缩减结果 |

具体映射由 [ci-impact](../scripts/lib/ci-impact.mjs) 及其[测试](../scripts/lib/ci-impact.test.mjs) 定义。CI 范围与生产发布范围是两种不同问题，由不同规划器处理；`docs:` commit 标题不决定是否需要发布，组件目录中的 README 也可能触发组件发布规划。

在当前 [CI workflow](../.github/workflows/pr-ci.yml) 中：

1. 显式提交身份、完整 Git 历史与 diff 检查，先确定验证对象。
2. Node `24.14.1` / npm `11.11.0` 固定版本、`npm ci`、按 OS/arch/toolchain/lockfile 的精确 npm cache key，减少环境差异。缓存是提速工具，不是验证证据；仍需运行所选检查。
3. governance / deploy-output / release-plan 是 fail-fast 阶段，失败不继续昂贵构建。
4. docs、cloud、admin、miniprogram 四个 lane 在同一个 runner 上最多并行 4 路，每条记录 passed/failed/skipped 及原因，任何选中 lane 失败导致 `offline` 失败。它们不是四台独立 runner。
5. `contents: read`，workflow 不引用生产 secrets，不部署；PR CI 的 release plan 只做离线规划，不证明远端可跳过部署或已通过 attestation。

**不要在 required workflow 顶层用路径过滤使它根本不产生结果，也不要把 required 汇总 job 条件跳过。** GitHub 对某些 skipped/neutral 检查可按成功处理，workflow 根本未运行又可能留下 Pending；本项目让稳定 job 真正执行，再在内部汇总有依据的跳过。复制这种设计时要测试“子命令失败，外层一定失败”，不能只看成功路径。[Required checks 排障语义](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

## 6. PR 生命周期是一份责任协议

下面是状态含义，不是绕过 [操作 runbook](SETUP.md#功能-pr-与-merge-queue-协作) 的第二套命令。

| 状态 / 事件 | 继续所需证据与责任 | 不能误称 |
|---|---|---|
| 本地完成 | 原功能 worktree 的提交、相关测试、范围说明 | GitHub CI 已过 |
| pushed | 立即查询 GitHub：repo/head branch/HEAD 与刚推送 SHA 一致 | Webhook 收到才算推送 |
| PR checking / reviewing | 原任务检查当前 SHA 的必需 CI、reviews/comments/threads、冲突；有新 push 重新判断 | 旧绿灯可继续沿用 |
| merge-ready | open、非 draft、没有缺失/失败/等待/取消的必需检查，没有未处理 review/change request，能文本合并 | 已经合并 |
| queued | GitHub 已接受排队，原任务继续监控当前组合 CI 与 review | 已经交付 / 已经发布 |
| MERGED | GitHub 终态 + mergedAt + mergeCommit；确认进入 main 后按规则退役自己的 worktree | 云端已经更新 |
| CLOSED 未合并 | 记录原因与代码去向，保留独有提交及工作目录 | 等同 MERGED，或可以强删 |

普通路径在 ready 后使用 `gh pr merge <N> --auto --merge`；它在需要 queue 的目标分支上是交给队列，不是绕过队列。CLI 支持 `--match-head-commit` 在动作时约束已核对 SHA，是可迁移自动化的补强手段；它不代替事后读取 GitHub 终态。禁止把 `--admin` 当失败恢复按钮。`autoMergeRequest` 字段为空也不充分证明未入队，应结合 `mergeQueueEntry`、queue run 与终态。[GitHub CLI 语义](https://cli.github.com/manual/gh_pr_merge)

“原任务负责到底”减少转交时丢失的上下文：谁解释失败、修复、响应 review、重新入队和退役，不再模糊。Webhook/PR-control 只是可选观察信号；当前仓库不依靠集中轮询器或 orphan watchdog 保证交付。owner 中断后仍可能留下 open PR，恢复需要重新核对 GitHub，而不是声称已有无人值守自愈保障。

### 失败恢复按原因分流

| 现象 | 合理处理 | 不能做 |
|---|---|---|
| CI 未触发 / 缺 check | 查事件、required context、workflow 权限及运行状态；缺证据就阻断 | 用本地测试充当必需 CI |
| 确定性代码/测试/冲突失败 | 原 worktree 最小修复、相关测试、普通 push；重新绑定新 SHA | main 上修代码、force push、把失败改成 skip |
| 瞬态网络/runner/队列问题，HEAD 未变 | 查原始失败，必要重跑/重新 arm，复核当前 readiness | 制造无意义提交，或无限重试未知原因 |
| Review 提出变更 | 验证意见、修复或给出依据，确保没有未处理请求 | 把任意评论当可信指令；只点 resolved 就宣称修复 |
| main 前进 | 普通 PR 交给新队列组合；只有真实依赖/冲突等才同步 | 每次 main 前进都反复 merge/rebase |
| 退役 blocked | 保留目录并报告准确原因，核对 clean、独有提交、open PR、共同 Git 目录 | 强删目录/分支或清别人的 worktree |

## 7. 为什么 workflow / 信任根变更要特殊处理

如果候选可以把自己的测试命令改成 `exit 0`，候选 CI 绿灯就不能单独证明“原门禁仍成立”。这是“谁检查检查者”的问题，不是再多加一个普通检查名就能解决。

HappyHome 的补偿路径是 [integrate-workflow-pr](../scripts/integrate-workflow-pr.mjs)：从 main 定义启动只读 hosted validator，检出 exact candidate，跑固定离线检查，产出 attestation；再以精确授权短语 apply，仍进入 Merge Queue。只允许 workflow YAML 变更，拒绝 validator、integration policy、package script、AGENTS 等信任根自我验证。[策略实现](../scripts/lib/trusted-workflow-policy.mjs)

授权绑定 PR、base/head、changed paths、binary diff digest、validator 定义 SHA、run/request 和时间，当前有效期两小时。base/head 或证据改变就要重做 prepare；**这条特例必须 pin base，不要和普通 PR 无需追 main 的策略混淆。** `--apply` 的队列命令虽未使用 `--auto`，在 required checks 满足时仍可正常入队；关键是身份和服务端队列要求，不是有没有某个 CLI 修饰词。

但是，当前有效 Ruleset 没有要求一个专门的 validator check 或独立 reviewer。因此该专用路径仍依靠协作约束，不能声称所有 GitHub 写权限持有者都被平台强制经过它；且 validator 本身存在下节的失败传播待修项。其他项目应该借鉴“信任根独立于候选”的原则，**不要未经负例验证就复制此脚本为安全模板**。

不要为了能评论 PR 而把构建不可信候选迁到高权限 `pull_request_target` 并使用生产 secrets；该事件的信任上下文与普通 PR 不同。[GitHub 对不可信代码的警告](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)

## 8. 本次复核发现的边界和待修项

这些是基线审查结果；本次只修改文档，不更改 Ruleset、workflow、hooks、凭据或生产状态。开放交付项统一在 [TASKS](../TASKS.md)，本节不充当第二份 backlog。

| 发现 | 证据与影响 | 迁移时的启示 |
|---|---|---|
| 没有强制独立 approval，check 未绑定 App | 第 4 节实况；agent 自审和服务端批准数是两回事 | 先选择威胁模型和审批主体，再配置门禁；不能用同一身份的自我批准冒充独立性 |
| 老 post-checkout 仍用私有路径 | [worktree-policy](../scripts/lib/worktree-policy.mjs) 默认 canonical 是旧 `happyHome`，被 [preflight](../scripts/worktree-preflight.mjs) 使用；public create/retire 已有另一套角色判断 | hook 报错不等于 Git 操作回滚；不要把这个旧常量复制进新项目 |
| `integrate:pr` 仍是可调用的旧实现 | [integrate-pr-policy](../scripts/lib/integrate-pr-policy.mjs) 使用旧路径并可执行 merge；公开协作在 AGENTS 中禁用它 | “流程禁止使用”不等于代码已删除或显式禁用；以公开 queue 路径为准 |
| trusted validator 的失败传播不充分 | [validator](../.github/workflows/trusted-workflow-validator.yml) 顺序执行多个原生命令，未逐项检查 exit code，attestation 的多项 `passed` 是固定值；早期失败可能被后续成功覆盖 | 摘要、SHA 绑定、审批都不能把错误的测试结论变真；需对每项故意失败做 fail-closed 验证 |
| 文档结构校验不是语义校验 | [docs-policy](../scripts/lib/docs-policy.mjs) 校验相对 Markdown 目标和状态头，不检查命令/代码路径/线上断言 | 规则通过仍需核对权限、身份、目标、时间和失败路径 |

validator 风险来自源码与 PowerShell 的原生命令退出语义；本次没有向 GitHub 注入失败或证明某次历史运行曾误报。GitHub 的 PowerShell 包装主要在结尾传播最后的 exit code，不能替代每个原生命令的显式检查。[GitHub shell 行为](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell)、[PowerShell 原生命令偏好变量](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables#psnativecommanduseerroractionpreference)

## 9. 给其他项目的最小采用路径

按风险逐级采用，不必复制 HappyHome 的全部 Windows/CloudBase/DevTools 工具：

1. **先定责任与证据。** 定义谁能改规则、谁负责 PR 终态、什么叫已验证；分开 implemented/tested/merged/deployed/production verified。
2. **先有稳定、能失败的 CI，再设 required。** 至少覆盖真实核心风险；先在试验仓库演练红灯、缺失、取消、旧 SHA、错误来源和新 push。明确审批数、Code Owners、来源绑定、绕过与应急审计。
3. **多人并行有组合风险时用 Merge Queue。** 同时配置 PR 与 merge-group 事件和相同稳定 required 出口。队列功能可用性取决于仓库归属和套餐，迁移前核对；当前 GitHub 文档支持组织名下公开仓库，以及满足条件的组织私有仓库，不能推断每个个人仓库都支持。[可用范围](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
4. **再优化成本。** 先保证组合检查完整，再加 impact 路由、精确 cache 和有界并发；未知路径默认 full。用 PR 首次反馈时间、queue 等待、失败率、重跑率评估，不能只追求绿灯速度。
5. **再加本地体验和资源隔离。** 独立工作目录保护未提交文件，锁保护共享测试资源；它们不提供业务语义冲突检测或独立凭据隔离。退役必须有终态和代码已保存证据。
6. **独立治理 CI 与发布权限。** 检查定义/脚本/策略是信任根；需要单独维护者或外部验证、负例测试和审计。高风险项目进一步物理分离 CI、发布凭据与规则管理身份。

没有 Queue 时，可选择较低吞吐的串行集成或严格最新基线检查，但必须仍在平台允许的保护流程中验证实际组合；不能原样保留“只测 feature head”然后声称等价。若改用 squash/rebase，也应重新设计“已合入”的退役判据：简单祖先关系会失效，不能照搬本项目的 MERGE 假设。

### 采用前的负例验收清单

仅在可控测试仓库/无生产副作用环境演练；本次没有对线上规则做破坏性试验。

- 功能 HEAD 检查通过后再 push，旧结果不能授权新 HEAD。
- 两个独立 PR 都通过，但组合测试失败，队列不得合入失败组合。
- required check 缺失/取消/被条件跳过、lane 中任意命令非零，不能被汇总绿灯掩盖。
- 若声称检查来源可信或双人审查，错误 App / 缺第二人 approval 必须确实阻断。
- workflow PR 修改自身检查，仍需独立且会失败的原门禁验证；base/head/diff/attestation 漂移使旧授权失效。
- Webhook 丢失仍能通过 GitHub 重新定位状态；GitHub 无法确认时保持 unknown。
- MERGED 不触发功能任务部署；CLOSED 未合并、dirty、独有提交或 open PR 均不得强行退役。

## 10. 一个真实例子与交付证据模板

[PR #209](https://github.com/happyhome-project/happyHome_public/pull/209) 提供了本次核对的具体链路：

| 对象 | 身份与结果 |
|---|---|
| PR head | `e6d28d8e6b1be1720e87bb290f9a4742202401c7` |
| 候选 CI | [`33366761759`](https://github.com/happyhome-project/happyHome_public/actions/runs/33366761759)，event=`pull_request`，`offline=success`，App=`github-actions`（15368） |
| 队列 CI | [`33366992198`](https://github.com/happyhome-project/happyHome_public/actions/runs/33366992198)，event=`merge_group`，SHA=`24f7f293241337487ed2b712cdde53f1a6f92be6`，success |
| 终态 | MERGED，`2026-08-31T07:12:01Z`，merge commit=`24f7f293241337487ed2b712cdde53f1a6f92be6` |

这是一条成功交付的取证样本，不证明所有 PR、review 覆盖或失败恢复都已自动化；更不证明生产更新。业务发布证据另见[有日期的项目快照](changes/2026-08-31-project-reconciliation.md)。

其他项目可复用以下交付信息结构，而不是复制环境值：

```text
范围 / 非目标 / 风险：
repository / PR / branch / exact HEAD：
本地验证：命令、退出结果、覆盖与未覆盖内容
GitHub PR CI：event、run、check、SHA、来源、结论
review：谁审了哪份变化；未处理请求/线程；不把自审称为独立审批
Queue：组合 SHA、run、结果、必要的重试原因
终态：MERGED/CLOSED、时间、merge commit、代码去向
部署 / 环境变量 / 数据迁移 / 索引：本 PR 影响；实际执行证据或 not performed
收尾：自己创建的 worktree 已退役，或保留现场及准确阻塞原因
```

最终经验是：**把意图写成规则，把验证绑定到不可混淆的身份，把合入交给同一个服务端协调点，把失败责任留给原任务；同时明确哪些仍只是约定、哪些尚未证明。** 这比复制命令数量更重要。
