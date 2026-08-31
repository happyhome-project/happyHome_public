# 2026-08-31 项目现状与文档对齐

> **Historical / point-in-time:** 本文记录 2026-08-31 对公开仓库基线 `e185533ee04c09a32244f08b11642db6fda42917` 的盘点，不是实时状态面板或新的发布指令。
> **当前权威 / Current authority:** 项目入口见 [README](../../README.md)，文档分类见 [文档地图](../README.md)，开放工作见 [TASKS](../../TASKS.md)，发布规则见 [release gate](../release-gate.md)。实现事实以当前代码和测试为准。

## 一眼看懂项目

HappyHome 是面向社区的微信小程序产品，包含管理站点、CloudBase 后端和独立微信运营工具。以下“已实现”来自该基线的源码核对，不表示本次重新执行了全部线上业务验收。

| 模块 | 基线中已有的能力 | 主要入口 / 边界 |
|---|---|---|
| 小程序浏览 | 访客浏览、社群首页、话题/归档流、搜索、详情、快照/预拉取 | `miniprogram/src/pages/index/index.vue`；首页与“我的”为 native tab，中间发布按钮打开面板 |
| 小程序发布 | 图文、文字、视频/音频、协作模板与相应详情展示 | `miniprogram/src/pages/create/index.vue`、`pages/detail/index.vue` |
| 身份与个人页 | 登录、成员状态、我的帖子/活动、分享、管理员审批入口 | `miniprogram/src/pages/profile/index.vue`；登录后权限仍由后端校验 |
| 管理站点 | super-admin 与 community-admin 分工；社区、板块、话题、成员、帖子、审核与配置 | `admin-web/src/router/index.ts`；[组件说明](../../admin-web/README.md) |
| 云端业务 | 用户、社区、成员、板块、帖子、协作模板、首页预取、HTTP gateway、管理入口 | `cloud/functions/`、`cloud/shared/` |
| 异步审核与提醒 | 微信媒体审核回调；社区/成员审批通知及订阅配置查询 | [发布回调边界](../release-gate.md#wechat-media-audit-callback)、[审批提醒](../approval-notifications.md) |
| RAG | 正式帖子 current-state 索引与检索、worker/revision 隔离；默认 CloudBase 存储与腾讯原子能力 | [RAG 运维说明](../post-rag-search.md)；不以普通发布成功代替检索专项验收 |
| 工程交付 | 独立 worktree、offline PR CI、Merge Queue、两阶段正式发布、组件摘要与远端证明 | [AGENTS](../../AGENTS.md)、[测试操作](../TESTING.md)、[发布规则](../release-gate.md) |
| 微信运营 | 官方分析数据和客服账号工具 | [wechat-ops](../../wechat-ops/README.md)；不提交审核或发布版本 |

## 已核实的发布快照

2026-08-31 从 canonical main 只读查询 `release:status`、`release:lock -- status`、`release:pending`，并对照该 run 的本地 ledger：

| 项目 | 证据结果 |
|---|---|
| Git / 生产 SHA | `e185533ee04c09a32244f08b11642db6fda42917`，查询时 clean main 与刷新后的 `origin/main` 一致 |
| 正式 run | `20260828T092515-public-main-e185533ee04c-3f0c5f85`，ledger `passed`，远端生产记录同 run/SHA |
| 版本 / 描述 | `1.0.260828092515.57775493` / `current-main-e185533ee04c` |
| 云组件 | include-RAG 计划 12 个；实际部署 4 个，8 个远端证明匹配后跳过部署，12 个 fresh probe 验证通过 |
| 非 RAG smoke | run 内 10/10 函数通过，必需标签齐全，fixture cleanup 成功 |
| admin-web | run 内部署完成并验证远端字节 |
| 小程序 | DevTools 开发版上传与归一化回执验证通过，UI gate 通过 |
| 收尾 | 查询时生产锁为空，`release:pending` 为 `required=false` |

以上运行验收是 2026-08-28 该 run 的历史证据，本次只重新核对记录，没有重跑云端 smoke、UI fixture 或部署。RAG timer、backfill、语义检索/eval 不在该发布的验收范围；微信后台体验版选择、真机测试也没有由这次记录核对证明。

`release:status` 中旧的 `cloud-deploy: pending` 是 legacy umbrella 条目；该 V2 run 的 `cloud-deploy-rag-bootstrap` 与 `cloud-deploy-remaining` 已通过。不能把旧条目单独读成发布中断，也不能以它掩盖任何 active stage 失败。判断方法已合并进发布文档。

## 风险与未完成事项

- **依赖安全需要专项分流。** 对同一 root lockfile，`npm.cmd audit --json` 报告 142 项（4 low / 54 moderate / 40 high / 44 critical）；`--omit=dev` 报告 131 项（1 / 48 / 38 / 44）。这些是 npm 依赖审计统计，可能包含相同问题的传递链影响，不是线上可利用漏洞数。根 `dependencies` 仍包含 `miniprogram-ci` 等本地上传工具；omit-dev 不能替代云包/浏览器包可达性分析。未运行自动修复，未升级 package/lockfile。独立交付目标已加入 TASKS。
- **评论/点赞尚无完整产品闭环。** 保留为待设计事项，不把数据模型预留说成可用功能。
- **并发治理已有基础。** validation lease 已实现，不能继续把“是否需要 DevTools 单例锁”当未实现功能。跨 worktree 语义冲突与端口分配仍是未排期设计问题，遇到真实冲突再按 TASKS 的结果要求推进。
- **RAG 的开放 PR 不属于 main。** 查询时 [#57](https://github.com/happyhome-project/happyHome_public/pull/57) 与 [#46](https://github.com/happyhome-project/happyHome_public/pull/46) 为 open，[#14](https://github.com/happyhome-project/happyHome_public/pull/14) 为 draft。未因存在 PR 就宣称已集成；也未替它们合并、关闭或修改分支。后续以 GitHub exact HEAD 和终态为准。
- **保留本机历史工作现场。** worktree 本地清单仅用于盘点，不等于退役授权；存在未提交改动的旧工作区。本次不清理其他任务的目录、分支、缓存或凭据。

## 文档整理范围与结果

盘点前 tracked Markdown 共 149 份：8 current、8 operational、4 reference、129 historical。完整核对根目录 6 份 Markdown、`docs/` 直接下的 20 份，以及组件/测试入口；对更深层历史文件做目录、分类、状态头和链接检查，没有逐条重新批准历史方案。

| 处理 | 文件 / 内容 |
|---|---|
| 就地更新现行入口 | `README.md` 补模块与验收边界；`CLAUDE.md` 不再要求成功创建 worktree 后重复 doctor/bootstrap；`TASKS.md` 移除已落地锁的讨论并列出依赖分流目标 |
| 就地更新运维 | `docs/release-gate.md` 对齐非视觉版本身份、源码 marker 恢复、HOME_PREFETCH smoke 标签、V2 stage 解读；`post-rag-search.md` 对齐社区自动策略；`approval-notifications.md` 对齐模板来源与生产配置权限；`TESTING.md` 对齐真实认证和共享云测试边界；`admin-web-deploy.md` 补部署角色边界 |
| 就地更新前端说明 | `docs/UX-PRINCIPLES.md` 对齐主色、发布导航、前后端防重复职责；管理端角色能力概览放在根 README 和本文，不重复扩写组件 README |
| 历史正文保留，仅纠正页首指路 | `docs/DESIGN-BRIEF.md`、`DESIGN-TOKENS.md`、`UI-LIBRARY.md`、`VISUAL-TONE.md` 不再把过时设计断言包装成当前权威 |
| 核对后不改 | `AGENTS.md`、`PRODUCT.md`、`design-qa.md`；`docs/SETUP.md`、`TESTING-PRINCIPLES.md`、`h5-preview-runbook.md`、`miniprogram-pre-fetch.md`、`ui-click-regression-checklist.md`、`figma-mini-0626-inventory.md`、`adversarial-testing-prep.md`、`cloudbase-http-access.md`、`NOTES.md`；`admin-web/README.md`、`wechat-ops/README.md`、`scripts/h5-test/README.md` |
| 索引 | `docs/README.md` 加本次历史快照入口；不增设第二份 backlog 或发布规范 |

规则核对：本仓库要求 `AGENTS.md` 是实体文件，`CLAUDE.md` 明确从属且承担不同职责，因此保持两者，不套用通用软链接模板。Git 身份、共享 hooks、必需文档、敏感文件 ignore 与现有链接检查已核对；未修改全局配置。Codex 机器生成记忆库不是可手改的项目文档，本次未重写；没有创建新的 memory/skill 副本来重复上述事实。

## 验证边界

文档结构/链接检查与文档策略测试用于这次纯文档变更；PR 的 exact-HEAD CI 和 Merge Queue 仍独立负责集成门禁。既有 smoke/上传证据只说明上面的指定 run；本次整理不改变业务代码、workflow、生产配置、数据库、部署产物或 release watcher 状态。

本地 `docs:check` 无缺失、断链或历史头问题；`node --test scripts/lib/docs-policy.test.mjs` 为 26/26 通过。新版 L3 命令只用 `profile=read` 与 `--listTests --runInBand` 验证测试发现路径，未执行云端测试。依赖审计返回非零漏洞结果，未把它报告为安全检查通过。

现有发布规划器把 `admin-web/README.md` 也计入组件变更，因此没有保留该文件的可选扩写；本文不借文档整理修改发布分类代码。
