# HappyHome 对抗性测试准备

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

2. `scripts/test-h5-profile-smoke.mjs` 仍按旧 profile 首屏断言版本号和默认登录表单。
   - 当前契约：Profile 版本号不是 release 硬要求；登录页版本号才是 release gate。
   - 处理：改为检查当前 Figma 版 profile shell 是否稳定渲染。

3. `scripts/test-mp-post-rag-search-static.mjs` 绑定旧搜索 placeholder 和旧赋值语句。
   - 当前契约：首页和搜索页采用 Figma 文案，但 `postApi.search`、AI answer、citations、no-answer 处理必须保留。
   - 处理：断言业务链路而不是旧 UI 文案。

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

以下命令会触达共享环境或全局工具状态，本轮不在其他发布 session 并行期间执行：

```powershell
npm.cmd run deploy:release -- --use-tcb
npm.cmd run deploy:cloud:tcb
npm.cmd run deploy:mp
npm.cmd run deploy:mp:upload
npm.cmd run deploy:admin-web
npm.cmd run test:cloud:release-smoke
npm.cmd run test:admin:api
npm.cmd run test:real
npm.cmd run test:mp:release-ui
npm.cmd run test:mp:replay
npm.cmd run ensure:indexes
node scripts/h5-test/run-all.mjs
node scripts/h5-test/08-concurrent-clicks.mjs
```

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
