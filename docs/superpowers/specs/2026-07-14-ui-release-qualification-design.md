# HappyHome UI Release Qualification Design

## Goal

在正式 `prepare` 之前，用一个明确命令完成一次完整的小程序发布候选 UI 验收；验收证据与不可变构建身份严格绑定，正式 `prepare` 可显式复用，避免每次失败都重新构建、清理 DevTools 缓存并逐个发现下一个问题。

## Scope

本 PR 只修改发布 UI 测试与证据复用：

- 新增 `release:ui-qualify`，构建小程序和 H5，执行现有 release gate，并生成 qualification wrapper。
- `prepare` 新增显式 `--ui-qualification=<absolute-path>`；提供该参数时只接受完整匹配的证据，不匹配立即阻断。
- DevTools UI 检查改为依赖感知的顺序聚合：cold-start 是前置；fixture 成功后分别执行 tabs 与 detail；profile 独立执行；最后统一报告全部失败。
- fixture cleanup 对明确瞬态错误做最多两次有界尝试，最终 cleanup 失败继续硬阻断。
- 所有可选 screenshot 都使用同一个有界 helper。

不修改 CI workflow、RAG 专项验证、发布 DAG、业务 API、业务数据模型或云函数部署逻辑。

## Qualification Identity

Qualification wrapper 使用加法 schema，至少绑定：

- `gitSha`
- `version`、`desc`
- 小程序 `packageDigest`
- DevTools 版本
- UI evidence 文件路径及其 SHA-256
- source/dist build-info
- required markers
- `createdAt`

证据不依赖隐式 `latest`。`prepare` 只有显式收到 qualification 路径时才尝试跨 run 复用；任一字段、文件摘要、marker、build-info 或 package digest 不匹配时硬失败，不自动退回重跑。未传该参数时保留当前 prepare 行为。

Qualification 绑定 exact main SHA 与小程序包，不绑定当前远端云函数版本。后端部署正确性继续由 publish 后的非 RAG cloud smoke 和版本探针负责。

## UI Execution And Error Handling

UI 流程仍保持单一 DevTools session 和顺序执行，避免共享 storage、fixture 和端口并发冲突：

1. cold-start home；失败时跳过依赖 home fixture 的 tabs/detail，但仍执行独立 profile 检查。
2. 创建 fixture；成功后分别执行 tabs 和 detail，单项失败不阻止另一项收集证据。
3. profile/login 独立执行。
4. cleanup 始终优先于最终抛错。
5. 最后抛出一个脱敏 `AggregateError`，列出各失败 stage；cleanup 失败必须包含在最终错误中。

只允许以下瞬态 cleanup 错误重试一次：

- `TransactionBusy` / `DATABASE_TRANSACTION_FAIL`
- 已有受信 admin invoke timeout
- 明确网络 timeout/reset

权限、参数、业务状态错误不重试。每个 cleanup action 最多两次，短退避；`disable` 和 `hardDelete` 都通过同一策略。

所有 screenshot 都是可选证据：默认不调用；显式启用时最多等待 15 秒，失败只记录 warning，不影响结构化 UI gate。

## Interfaces

- CLI：`npm.cmd run release:ui-qualify -- --version=<v> --desc=<d> --output=<absolute-path>`
- prepare：`... prepare -- --ui-qualification=<absolute-path> ...`
- 新模块：`scripts/lib/release-ui-qualification.mjs`
- Qualification wrapper 默认由调用者指定路径，正式流程不搜索 `latest`。

## Tests

TDD 覆盖：

- qualification exact SHA/package/build-info/DevTools version/marker/evidence digest 全匹配时通过；任一漂移时拒绝。
- 显式 qualification 无效时 prepare 阻断且不会调用 build/DevTools。
- tabs 失败后 detail 与 profile 仍执行；cold-start 失败时 profile 仍执行。
- 多个 UI 失败一次性汇总，错误信息不包含 token/openid。
- `TransactionBusy` 或 timeout 首次失败、第二次 cleanup 成功；权限错误不重试；两次失败硬阻断。
- 成功 evidence 末尾 screenshot 永不返回时，15 秒边界后继续并记录 warning。
- publish resume 继续验证 qualification digest、package digest 和 UI markers。

## Acceptance

- 同一 exact SHA/package 的 qualification 通过后，prepare 显式复用时不再构建小程序/H5、不再启动 DevTools。
- 一次真实 qualification 可报告所有可继续执行的独立 UI 问题，而不是只报告第一个。
- fixture cleanup 无残留；最终失败证据可复核。
- 未提供 qualification 参数的旧发布路径行为不变，可作为回滚路径。
