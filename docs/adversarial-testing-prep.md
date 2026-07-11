# HappyHome 对抗性测试准备（historical）

> 本文件是一次共享环境风险盘点的历史记录，不是当前测试或发布操作手册。当前测试命令见 [`TESTING.md`](./TESTING.md)，发布门禁见 [`release-gate.md`](./release-gate.md)。

## 当前原则

本轮测试准备必须先区分隔离边界：

- 本地安全：类型检查、单元测试、本地集成测试、静态守卫、H5/mp-weixin 构建、只读 H5 smoke。
- 共享风险：CloudBase 真调用、云函数部署、索引/集合创建、微信 DevTools 自动化、预览/上传、正式 release。
- 高风险：无界并发、真实社区脏数据写入、全局 DevTools cache 清理、CloudBase 环境变量修改。

其他 session 正在处理 main 正式发布时，当前 session 只能运行本地安全项。云端和 DevTools 项必须等发布窗口空闲，或由发布 session 明确接管。

## 已暴露的本地阻断点

1. `npm ci` 在当前 npm 版本下失败，因为 `package-lock.json` 缺少 peer dependency 解析条目。
   - 处理：用 `npm install --no-audit --no-fund` 重算 lockfile。
   - 验证：`npm ci --dry-run --no-audit --no-fund` 可解析。

2. `scripts/test-h5-profile-smoke.mjs` 必须继续覆盖 release 可见版本号和两种登录入口。
   - 当前契约：Profile smoke 需要检查 `build-info.ts` 中的版本号出现在页面里，并分别覆盖 fallback 登录与 `chooseAvatar` 登录入口。
   - 处理：保留 main 上的版本号/登录入口断言，只把它作为本地安全验证项执行。

3. `scripts/test-mp-post-rag-search-static.mjs` 需要保护正式 Post RAG 搜索契约。
   - 当前契约：首页搜索入口存在，搜索页只消费 `postApi.search` 返回的 RAG / fallback / no-answer 结果，不再混入本地 bootstrap fallback。
   - 处理：保留 main 上的 anti-bootstrap 断言、fallback 空态文案和 `post.search` 类型契约。

4. `npm run test:mp:detail-runtime-syntax` 检出 detail/profile 关键 chunk 中的 trial 空白页风险语法。
   - 处理：去掉详情页和 AppTabBar 中会编译出风险模式的写法。
   - 验证：mp-weixin 构建后 runtime syntax gate 通过。

## 本地安全验证清单

这些命令只影响当前 worktree，可以在其他 session 发布期间执行：

```powershell
npm.cmd --workspace miniprogram run type-check
npm.cmd --workspace miniprogram run test:unit
npm.cmd --workspace cloud run test:unit
npm.cmd --workspace cloud run test:integration
npm.cmd --workspace cloud run build
npm.cmd --workspace admin-web run type-check
npm.cmd --workspace admin-web run build
npm.cmd --workspace miniprogram run build:h5
npm.cmd --workspace miniprogram run build:mp-weixin
node scripts/test-figma-mini-ui-static.mjs
node scripts/test-guide-note-static.mjs
node scripts/test-default-detail-static.mjs
node scripts/test-home-static.mjs
node scripts/test-author-avatar-static.mjs
node scripts/test-admin-post-create-static.mjs
npm.cmd run test:mp:detail-runtime-syntax
npm.cmd run test:mp:profile-critical-path
npm.cmd run test:mp:post-rag-search-static
npm.cmd run test:deploy-output
node scripts/test-h5-detail-smoke.mjs
node scripts/test-h5-section-smoke.mjs
node scripts/test-h5-profile-smoke.mjs
git diff --check
```

## 暂停执行的共享环境测试

共享环境、DevTools、上传和发布检查不得与其他发布操作者并行。当前发布命令与证据以 [release gate](./release-gate.md) 为唯一来源；其它真实环境测试在执行前必须按 [AGENTS.md](../AGENTS.md) 确认权限和共享状态。

这些测试可以做，但必须满足：

- 使用唯一 run id / fixture prefix。
- 每个写入测试都必须有 cleanup，并验证 hard delete 或等效清理完成。
- 并发数必须有上限，禁止压测式无界请求。
- 测试前确认没有 release/deploy session 正在使用同一个 CloudBase 环境或 DevTools 实例。

## 后续对抗性测试矩阵

云端空闲后，按以下顺序推进：

1. CloudBase release smoke：验证函数可调用、日志可采集、fixture 可清理。
2. H5 real API journey：登录、社区、板块、发帖、详情、搜索，全部使用临时 fixture。
3. 权限对抗：非成员、非作者、非管理员、匿名用户直接调用 API。
4. 冷启动路径：未登录、未加入社区、帖子已删、板块不存在。
5. 并发写入：加入社区、审批、发帖、删除、报名等异步写操作，先小并发再扩大。
6. DevTools release UI：只在发布窗口执行，验证首页详情非空、登录版本可见、Profile 首屏可渲染。

完成标准不是“命令跑过”，而是每个失败点都有明确归因：代码问题、测试契约滞后、环境不可用、共享资源风险，四类必须分开记录。
