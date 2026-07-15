# HappyHome 社区入口与目录预缓存设计

> **Historical / point-in-time:** 本规格记录 2026-07-15 已确认的产品与技术设计，不覆盖后续实现、测试或发布治理决策。
> **Current authority:** 以[文档权威映射](../../README.md)、当前 `AGENTS.md`、小程序源码、测试和正式发布门禁为准。

## 背景

Profile 页的“创建社区”和“加入社区”当前都绑定到 `goOnboarding()`，因此“创建社区”错误地先进入加入社区目录。加入社区页自身也把 `member.myCommunities`（默认可能继续加载板块）与 `community.listDiscoverable` 串行放在首屏关键路径；在两次云调用完成前，社区列表为空。

项目已经接入微信官方数据预拉取：`home-prefetch` 通过用户态 token 返回首页快照，客户端读取 `wx.getBackgroundFetchData`、监听迟到数据，并使用本地缓存和云端 bootstrap 兜底。该快照已经可以提前填充用户已加入的社区，但不包含完整的可发现社区目录。微信官方预拉取只覆盖冷启动，且响应体不能超过 256KB，因此本次不扩充 `HomeSnapshot`，避免完整目录挤占首页帖子快照的容量。

## 目标

1. 点击 Profile 的“创建社区”直接进入 `/pages/createCommunity/index`。
2. 点击“加入社区”时优先同步渲染当前用户的缓存目录和 Store 中已加入社区，不再等待串行云调用。
3. 在用户可能点击入口之前后台预拉取目录，并让预拉取与页面刷新共享同一个请求，避免重复调用。
4. 目录仍通过 `community.listDiscoverable` 后台校正，缓存不成为权限来源。
5. 保持分享进入、未登录、申请加入、已加入社区切换和下拉刷新行为正确。

## 非目标

- 不修改微信公众平台的数据预拉取配置。
- 不扩充 `home-prefetch` 或 `HomeSnapshot`，不部署云函数。
- 不改变社区卡片视觉样式、目录排序或社区创建表单。
- 不预缓存帖子；帖子和成员权限仍由现有后端接口校验。
- 不自动重试失败请求，也不清理与本功能无关的历史数据或 worktree。

## 方案选择

### 方案 A：只做页面缓存先显

加入页先显示 `communityStore.myCommunities`，再请求完整目录。改动最小，但只有已加入卡片能立即显示；首次会话中的可加入卡片仍需等待网络。

### 方案 B：缓存先显 + 应用内目录预拉取（采用）

建立按用户隔离的目录缓存，在登录成功、Profile 展示和 App 回到前台时非阻塞预拉取。加入页同步读取缓存并用同一个去重请求后台刷新。该方案同时覆盖冷、热页面跳转，不依赖微信只在冷启动触发的预拉取时机，并且无需增加官方快照体积。

### 方案 C：把完整目录加入官方 `home-prefetch`

冷启动时可能更早拿到完整目录，但需要改变云端快照协议和发布面；首页帖子快照本身接近受 256KB 约束的载荷，加入目录会提高整个预拉取回退为空快照的概率。暂不采用，后续只有在真实 trace 证明应用内预拉取仍不足时再单独评估精简目录快照。

## 组件与职责

### 1. 社区目录缓存模块

新增 `miniprogram/src/utils/community-directory-cache.ts`，职责限定为：

- 以当前用户 `openId` 为隔离键保存现有 `DirectoryCommunity[]`。
- 同时维护进程内缓存与本地存储；存储内容仅包含目录接口已有的社区字段、`viewerStatus` 和 `viewerRole`，不保存昵称、头像、凭据或 background fetch token。
- 5 分钟内视为新鲜；5 分钟至 6 小时可作为 stale-while-revalidate 的即时展示；超过 6 小时丢弃。
- 同一用户同一时刻最多存在一个 `community.listDiscoverable` 请求。页面刷新若遇到预拉取中的请求，复用同一个 Promise。
- 网络响应写入前复核用户 epoch；退出登录或身份变化后，迟到响应不得写回。
- 提供同步读取、后台 prime、强制刷新和按用户清除四类明确接口。

缓存模块不判断成员权限，也不执行页面导航。后端接口仍是最新目录与操作权限的唯一来源。

### 2. 后台预拉取触发

- App 恢复已有登录态或回到前台时，非阻塞调用目录 prime；5 分钟 TTL 会抑制重复云调用。
- 两套登录入口完成 `user.login` 并提交登录 UI 后，非阻塞 prime，不能延长登录关键路径。
- Profile `onShow` 再调用一次 prime，确保用户停留在入口页时尽早开始请求；缓存模块负责去重。
- 预拉取失败只记录非敏感诊断，不弹 Toast，不影响登录、首页或 Profile。

### 3. 加入社区页数据流

页面进入后按以下顺序执行：

1. 校验登录状态与分享参数。
2. 同步读取当前用户目录缓存，并与 `communityStore.myCommunities` 合并后立即赋给列表。
3. 发起或复用一次 `community.listDiscoverable`；不在目录请求之前调用 `member.myCommunities`，也不加载板块。
4. 最新目录到达后归并并替换卡片；封面 URL 异步解析，不能阻塞卡片可交互。
5. 下拉刷新绕过 5 分钟新鲜 TTL，但仍复用正在进行的同一请求。

`listDiscoverable` 已返回 `viewerStatus` 和 `viewerRole`，因此发现模式不需要先调用 `member.myCommunities` 才能显示“已加入/审核中/我要加入”。自动进入和分享进入仍根据最新目录中的 `viewerStatus` 判断；缓存只负责先显，不单独触发权限跳转。

### 4. Profile 路由

- “创建社区”绑定独立的 `goCreateCommunity()`，直接 `uni.navigateTo({ url: '/pages/createCommunity/index' })`。
- “加入社区”继续绑定 `goOnboarding()` 并携带 `mode=discover`。
- 其他使用 onboarding 的分享、无社区引导和发帖保护入口保持不变。

## 失败与一致性处理

- 有缓存、刷新失败：保留卡片，显示轻量失败状态和手动重试入口。
- 无缓存、刷新失败：显示明确的目录加载失败状态和重试入口，不显示永久空白。
- 请求超过 5 秒：显示“加载较慢”，不自动重试。
- 用户退出或切换身份：清除对应内存状态并隔离本地键；旧身份的迟到响应通过 epoch 丢弃。
- 缓存中的成员状态过期：点击操作仍由 `member.apply`、板块/首页 bootstrap 等后端路径验权；明确权限失败时使缓存失效并强制刷新。
- 页面重复 `onShow`、`onMounted` 或预拉取并发：共享 in-flight Promise，并使用页面 load epoch 忽略迟到 UI 写入。

## 测试设计

### 单元与静态契约

- Profile 两个卡片分别绑定创建路由与加入路由。
- 缓存按 `openId` 隔离，错误用户缓存不可读取。
- 5 分钟内命中新鲜缓存，5 分钟至 6 小时返回 stale，6 小时后丢弃。
- 并发 prime、Profile prime 和加入页刷新只调用一次目录 endpoint。
- 退出登录后，进行中的旧用户响应不能写回。
- deferred Promise 验证：目录网络未返回时，已加入卡片和缓存目录已经可见。
- 加入页首屏加载不调用 `communityStore.loadMyCommunities`、`section.list` 或 `member.myStatus`。
- 封面解析未完成时，目录卡片仍可交互。
- 分享目标、普通用户、管理员、pending、无权限、超时和刷新失败路径保持覆盖。

### 离线验证

- 运行相关 Vitest 测试并完成红绿循环。
- 运行全部 miniprogram unit tests。
- 运行 `vue-tsc --noEmit`。
- 构建 `mp-weixin`，并运行 `git diff --check`。

### DevTools 验收

在 validation lease 下使用真实登录态验证，但不创建生产 fixture、不部署、不上传：

- 点击“创建社区”后直接进入创建页，不出现加入目录闪屏。
- 有缓存时，点击“加入社区”到首批卡片可交互不超过 500ms。
- 目录刷新期间已有卡片不消失，刷新完成后状态得到校正。
- 一次页面进入最多出现一个 `community.listDiscoverable`，且之前没有 `member.myCommunities` 或 `section.list` 阻塞。
- 冷缓存时允许等待唯一目录请求，但页面必须显示加载/慢加载/重试状态，不得空白无反馈。

## 发布边界

本功能分支只提交代码、测试和文档并创建 PR。它不自行部署云函数、上传小程序、进入 Merge Queue 或修改生产共享状态。后续正式发布仍由 canonical `main` 的发布流程负责。
