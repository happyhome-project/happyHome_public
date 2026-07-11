# HappyHome 项目搭建指南

> 测试策略参考：`docs/TESTING.md`

## 项目结构

```
happyHome/
├── miniprogram/          # 微信小程序（uni-app + Vue 3 + TS）
│   ├── src/
│   │   ├── api/cloud.ts        # 云函数调用封装
│   │   ├── components/         # PostCard, SectionTabs, widgets/
│   │   ├── pages/              # onboarding, index, create, detail, profile, createCommunity
│   │   ├── store/              # Pinia stores (user.ts, community.ts)
│   │   ├── pages.json          # 路由配置
│   │   └── manifest.json       # AppID 等配置
│   └── dist/build/mp-weixin/   # 编译输出（微信开发者工具导入此目录）
├── cloud/                # 云函数源码（TypeScript）
│   ├── functions/        # 10个云函数: user, community, member, section, post, admin, home-prefetch, http-gateway, post-rag-worker, post-video-rag-worker
│   ├── lib/              # 共享适配层: db.ts, auth.ts, storage.ts
│   ├── shared/types.ts   # 全项目共享的 TypeScript 类型定义
│   ├── build.mjs         # esbuild 构建脚本
│   └── dist/             # 构建输出（部署此目录下的内容）
├── admin-web/            # 管理后台 Web（Vue 3 + Vite + Element Plus）
│   ├── src/
│   │   ├── api/cloud.ts        # Admin API 调用封装
│   │   ├── views/              # Login, Layout, SuperAdmin/, CommunityAdmin/
│   │   └── router/index.ts     # 路由 + 鉴权守卫
│   └── .env.local              # 环境变量（VITE_CLOUD_API_URL / VITE_ADMIN_*）
├── cloudfunctions/       # 历史快照，不作为部署源
├── scripts/
│   ├── deploy.mjs        # 一键部署（miniprogram-ci）
│   ├── test-mp.mjs       # 旧版小程序自动化测试（miniprogram-automator，需要 DevTools 支持 --auto-port）
│   ├── check-devtools-automation.mjs # 当前 DevTools 自动化能力检查 + auto-replay
│   └── set-super-admin.mjs # 初始化 superAdmin
├── private.wx673b17363cd6b4a6.key  # 小程序私钥（不提交 git）
├── project.config.json   # 微信开发者工具项目配置
└── package.json          # 根 workspace 配置
```

正式及手工云函数部署都必须使用 `cloud/dist/`。先运行 `npm.cmd --workspace cloud run build`，不要从历史 `cloudfunctions/` 目录部署。

---

## 环境要求

- Node.js 24.x LTS
- 微信开发者工具（最新稳定版）
- npm（项目使用 npm workspaces）

---

## 首次搭建

### 1. 安装依赖

```bash
npm.cmd ci                         # 根目录，按唯一 root lockfile 安装所有 workspace 依赖
```

新 worktree 使用以下顺序：

```bash
npm.cmd run worktree:create -- --name=<task-name> --path=<absolute-worktree-path>  # 仅 canonical main；自动 npm ci
npm.cmd run worktree:doctor
npm.cmd run worktree:bootstrap       # 仅 clean、已同步的 codex/* 分支
```

`worktree:create` 从刷新后的 `origin/main` 创建安全的 `codex/*` 分支，检查真实 `AGENTS.md` 与 Git hooks，并自动在新目录运行根 `npm.cmd ci`。`worktree:doctor` 只报告状态；缺依赖、错误 Node/npm、hooks/AGENTS 异常或已落后 main 会显示为 `not_ready`。不要把其它 worktree 的 `node_modules` 复制、软链接或 junction 到当前目录。

### 2. 配置小程序

- 确保 `miniprogram/src/manifest.json` 中 `appid` 为 `wx673b17363cd6b4a6`
- 确保 `miniprogram/src/App.vue` 中 `cloud.init({ env: 'cloudbase-3gh862acb1505ff3' })`

### 3. 构建小程序

```bash
cd miniprogram && npm run build:mp-weixin
```

输出在 `dist/build/mp-weixin/`。在微信开发者工具中导入此目录。

### 4. 构建云函数

```bash
cd cloud && node build.mjs
```

输出在 `cloud/dist/`，每个函数一个目录，包含 `index.js` + `package.json`。

### 5. 部署云函数

**方式一：CloudBase CLI / COS 直传（2026-06-09 本机已验证可用）**

推荐脚本入口：

```bash
npm.cmd run deploy:cloud:tcb -- --only=user
```

多个函数可用逗号分隔：`--only=user,post`。不传 `--only` 会按部署脚本内的云函数列表部署全部函数。

该入口会构建云函数、切到 `cloud/dist/<fn>`、用 CloudBase CLI 的 COS 上传模式部署，并在每个函数部署后运行 `tcb fn detail <fn> ... --json` 做只读校验。

手动等价命令，以 `user` 云函数为例：

```bash
cd cloud && node build.mjs
cd C:\Project\Claude\happyHome\cloud\dist\user
npx.cmd --yes --package @cloudbase/cli tcb fn deploy user --force --yes --env-id cloudbase-3gh862acb1505ff3 --deployMode cos --json
```

成功输出应包含：

```text
[user] 部署方式: COS 上传
[user] 云函数部署成功
```

只读校验：

```bash
npx.cmd --yes --package @cloudbase/cli tcb fn detail user --env-id cloudbase-3gh862acb1505ff3 --json
```

确认 `Status: Active`、`AvailableStatus: Available`，以及新的 `ModTime`。

> PowerShell 下使用 `npx.cmd`，不要直接用 `npx`，否则可能被 `npx.ps1` 执行策略拦截。

**旧方式：一键部署脚本 / DevTools CLI**

```bash
node scripts/deploy.mjs cloud
```

该路径默认走微信开发者工具 CLI。2026-06-09 复测：即使账号已登录、项目已打开，云函数上传阶段仍可能 `success=false` 并报 `getCloudAPISignedHeader failed` / `ret=41002`。因此这条旧路径当前不可作为云函数部署成功路径，只保留为历史/诊断说明。

可选诊断命令：
```bash
# 查看 CloudBase CLI / CAM 登录是否仍有效
npx.cmd --yes --package @cloudbase/cli cloudbase fn list --env-id cloudbase-3gh862acb1505ff3 --json

# CloudBase CLI / COS 部署脚本入口
node scripts/deploy.mjs cloud --use-tcb
```

Release cloud smoke and log gate:

```bash
# Full cloud release smoke: invokes safe cloud paths, creates/cleans HH_RELEASE_SMOKE_* fixture,
# captures logs, and writes evidence under .codex-local/release-evidence/<run>/cloud-smoke/.
npm.cmd run test:cloud:release-smoke -- --env-id cloudbase-3gh862acb1505ff3

# Deploy selected cloud functions through CloudBase CLI/COS and then run the same smoke gate.
npm.cmd run deploy:cloud:tcb -- --only=user,post --smoke

# Formal release path. Cloud smoke runs after cloud deploy and before admin-web/mp upload.
npm.cmd run deploy:release -- --use-tcb
```

Notes:

- `tcb fn invoke` on Windows should use `-d @payload.json`; inline JSON can return `ClientContext parameter error` even when the CLI exits 0.
- The release gate parses CloudBase `RetMsg`/`ErrMsg`, so CLI exit code 0 alone is not enough.
- `HH_CLOUD_LOG_CAPTURE_POST` plus the `post.clientLog` runId is a hard log gate. Non-critical `fn log` failures such as CloudBase `GetFunctionLogDetail InternalError` for `member`/`section` are recorded as warnings in `summary.json`.
- Do not enable production `ALLOW_TEST_OPENID`; `user` and `section` direct invokes record runtime guard evidence, while real OPENID flows stay covered by mini-program release UI evidence.

可继续自动化的 CloudBase CLI 命令：

```bash
# 部署后确认函数状态 / ModTime / Handler / env
npx.cmd --yes --package @cloudbase/cli tcb fn detail user --env-id cloudbase-3gh862acb1505ff3 --json

# 事件函数烟测，后续可为每个函数补不会污染业务数据的安全 fixture payload
npx.cmd --yes --package @cloudbase/cli tcb fn invoke user -d "<safe-json-payload>" --env-id cloudbase-3gh862acb1505ff3 --json

# 失败时抓最近日志
npx.cmd --yes --package @cloudbase/cli tcb fn log user --limit 20 --order desc --env-id cloudbase-3gh862acb1505ff3 --json

# CI/无人值守登录方向：使用腾讯云永久密钥或 CloudBase API Key，不把密钥写入仓库
npx.cmd --yes --package @cloudbase/cli tcb login --apiKeyId %TCB_SECRET_ID% --apiKey %TCB_SECRET_KEY% --json
npx.cmd --yes --package @cloudbase/cli tcb login --cloudbase-api-key %TCB_API_KEY% --env-id cloudbase-3gh862acb1505ff3 --json
```

官方 CLI 还支持 `cloudbaserc.json` + `tcb fn deploy --all --yes` 批量部署，以及 `tcb config diff/update fn` 管理函数配置。当前项目暂不启用配置文件批量覆盖，因为云函数 env 里有线上手工配置；要自动化 env，先用 `tcb config diff fn` 对齐差异，再用 `tcb config update fn --env-mode merge --yes` 做增量更新。

DevTools CLI 云函数部署的 `--project` 使用 `miniprogram/dist/build/mp-weixin`，不要手动改成仓库根。

**方式二：微信开发者工具手动部署**
在 cloudfunctions 目录右键各函数 → 上传并部署（云端安装依赖）。

### 6. 启动 Admin Web

```bash
cd admin-web
# 确保 .env.local 中环境变量正确
# 必填：VITE_CLOUD_API_URL
# 生产建议配置：
#   VITE_ADMIN_USERNAME
#   VITE_ADMIN_PASSWORD
#   VITE_ADMIN_TOKEN（需与云函数 ADMIN_TOKEN 一致）
npm run dev
```

访问 `http://localhost:5173`。  
默认账号为 `admin / happyhome2024`（可通过 `VITE_ADMIN_USERNAME` / `VITE_ADMIN_PASSWORD` 覆盖）。

> 生产环境请在 `admin` 云函数中配置环境变量 `ADMIN_TOKEN`，并与
> Admin Web 的 `VITE_ADMIN_TOKEN` 保持一致。

### 7. 设置 superAdmin（首次初始化）

```bash
npm run set:superadmin -- <openId> <CloudBaseHttpBaseUrl> [adminToken]
```

示例：

```bash
npm run set:superadmin -- o1234567890abcdef https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com
```

- `adminToken` 默认是 `happyhome-admin-2024`
- 也可以用环境变量 `CLOUD_API_URL`、`ADMIN_TOKEN`

---

## 关键配置文件

| 文件 | 作用 |
|------|------|
| `miniprogram/src/manifest.json` | 小程序 AppID |
| `miniprogram/src/App.vue` | 云开发环境 ID（`cloud.init`） |
| `admin-web/.env.local` | `VITE_CLOUD_API_URL` 与 `VITE_ADMIN_*` |
| `project.config.json` | 微信开发者工具项目配置 |
| `private.*.key` | 小程序上传密钥（从微信公众平台下载） |

---

## ⚠️ 踩过的坑

### 1. admin 云函数 HTTP 调用崩溃
- **现象**: `FUNCTION_INVOCATION_FAILED`
- **原因**: CloudBase HTTP 访问服务的运行环境不含 `wx-server-sdk`（通过微信 SDK 调用的环境才有）
- **解决**: 所有云函数部署时都必须 `remoteNpmInstall: true`（`scripts/deploy.mjs` 已统一处理）
- **环境差异**: HTTP 访问用 Node 16，微信 SDK 调用用 Node 18

### 2. cloud.DYNAMIC_CURRENT_ENV 在 HTTP 上下文失效
- **解决**: `cloud.init({ env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV })`

### 3. callCloud 参数格式
- **错误**: `data: { action, params }` — 云函数收到的是 `{ action, params: {...} }`
- **正确**: `data: { action, ...params }` — 云函数收到的是 `{ action, key1, key2 }`

### 4. esbuild 二进制不能用 node 直接执行
- `node ./node_modules/.bin/esbuild` 报错
- 改为 `import { build } from '../node_modules/esbuild/lib/main.js'`

### 5. miniprogram-ci 需要 IP 白名单
- 在微信公众平台 → 开发管理 → 开发设置 → IP 白名单 中添加部署机器的公网 IP

### 6. uni-app 不支持 `<router-view />`
- App.vue 中不能用 `<router-view />`，uni-app 有自己的页面路由系统

### 7. Pinia 持久化
- 微信小程序不能用 `pinia-plugin-persistedstate`
- 手动用 `wx.setStorageSync / wx.getStorageSync` 实现

### 8. 编译输出选 build 不选 dev
- `dist/dev/mp-weixin/`（watch 模式）有时不完整
- 用 `dist/build/mp-weixin/`（build 模式）更可靠

---

## Windows 迁移注意

### 一次性迁移流程（WSL -> Windows）

1. **不要复制旧的 `node_modules`**
   - 只迁移源码、`package.json`、`package-lock.json`、配置文件
   - 如果已经复制过，先删掉根目录和各 workspace 的 `node_modules`
2. 在项目根目录执行依赖安装：
   ```bash
   npm.cmd ci
   ```
3. 如果 `admin-web` 构建仍报 `@rollup/rollup-win32-x64-msvc` 缺失，先确认没有复用或复制旧 `node_modules`，删除当前 worktree 的 `node_modules` 后重新执行根 `npm.cmd ci`。不要在某个 workspace 临时执行 `npm i`，否则会偏离唯一 root lockfile。
4. 验证核心命令：
   ```bash
   # admin web
   cd admin-web && npm run build

   # miniprogram
   cd ../miniprogram && npm run type-check && npm run build:mp-weixin

   # cloud
   cd ../cloud && npm run build && npm test
   ```

### 本次迁移已踩中的典型问题

1. `esbuild` 平台包不匹配（`linux-x64` 与 `win32-x64` 冲突）
   - 根因：直接复用了 WSL 的 `node_modules`
   - 修复：在 Windows 上重新执行根 `npm.cmd ci`
2. `rollup` 可选依赖未自动安装
   - 现象：`Cannot find module @rollup/rollup-win32-x64-msvc`
   - 修复：删除当前 worktree 的 `node_modules`，在根目录重新执行 `npm.cmd ci`；若仍失败，记录 lockfile/Node/npm 版本并作为依赖问题处理，不在 workspace 临时加包
3. `miniprogram` 的 `pinia` 类型安装时报错
   - 现象：`Argument of type 'Pinia' is not assignable to parameter of type 'Plugin<[]>'`
   - 修复：`src/main.ts` 中对 `app.use(pinia)` 做类型断言（已在代码中修复）

### 其他注意

1. 所有路径使用 `/` 或 `path.join()`，代码中无硬编码 Linux 路径
2. `private.*.key` 文件需要一起迁移（不在 git 中）
3. `.env.local` 文件需要一起迁移（不在 git 中）
4. 微信开发者工具自动化在 Windows + 原生环境下运行；当前新版 DevTools 的 `auto-replay` 使用 IDE HTTP 服务端口。
   - 发布前优先执行 `npm.cmd run test:mp:devtools`。它会同时检查：DevTools CLI 路径、当前工具版本、IDE HTTP 服务端口、`cli auto --help` 是否支持 `--auto-port`、`cli auto-replay --help` 是否支持 `--replay-all`，最后实际运行 `auto-replay` 并要求出现 `auto-replay finish`。
   - `scripts/test-mp-replay.mjs` / `scripts/check-devtools-automation.mjs` 会优先自动识别已运行的 DevTools IDE 端口（例如 `21929`）：当存在多个 `wechatdevtools` 监听端口时，必须探测 `http://127.0.0.1:<port>/open`，只有返回 `/v2/open` 重定向的端口才算 IDE HTTP 服务端口，不能简单取第一个端口。
   - 如识别失败，再设置 `WECHAT_DEVTOOLS_PORT=<实际端口>` 执行 `npm.cmd run test:mp:devtools` 或 `npm.cmd run test:mp:replay`。
   - 旧 `miniprogram-automator` 仍依赖 WebSocket 自动化端口。官方 CLI 文档仍写有 `cli auto --project <path> --auto-port <port>`，但本机 DevTools Stable v2.01.2510290 的 `cli auto --help` 已没有 `--auto-port`，只有 `--test-ticket` / `--ticket`。因此遇到新版 DevTools `ws://127.0.0.1:<IDE_HTTP_PORT>/` 返回 404 时，结论是“旧 WebSocket automator 入口不可用”，不得把 automator 失败当作通过，也不得把 IDE HTTP 端口当作 WebSocket 端口。
   - 官方依据：命令行/HTTP 文档要求 CLI/HTTP 服务端口在“设置 -> 安全设置”中开启，HTTP V2 路径需使用 `/v2` 前缀；小程序自动化 SDK 文档的旧 WebSocket 用法依赖 `--auto-port`；录制回放 CLI 文档支持 `cli auto-replay --project <path> --replay-all` 和 `--replay-config-path`。
5. 小程序发布前必须单独覆盖 `我的` 页，不得只用首页或通用 replay 代替。
   - `node scripts/deploy.mjs miniprogram-upload` 和 `node scripts/deploy.mjs release` 会在上传前自动执行 `npm.cmd run test:mp:release-gate -- --skip-mp-build`；这一步不生成二维码，失败时必须先修复，不能继续上传体验版。
   - 手动发布前也可以单独跑 `npm.cmd run test:mp:release-gate`。该 gate 会覆盖：`build:mp-weixin`、详情/我的 compiled runtime syntax guard、profile critical path guard、H5 profile smoke、H5 detail smoke、DevTools automation capability。
   - 先执行 `npm.cmd --workspace miniprogram run build:h5`，再执行 `npm.cmd run test:h5:profile-smoke`，确认 `#/pages/profile/index` 首屏包含 `ver:`、`state:logged-out login:0` 和实际页面内容。
   - `npm.cmd run test:h5:detail-smoke` 必须能在未登录详情路径渲染 `.hh-login-guard` 和 `ver:`，确保详情页至少不会首屏完全空白；已登录、真实帖子点击仍需要 DevTools 录制回放或真机验证。
   - `test:h5:profile-smoke` 必须同时覆盖 H5 fallback 登录分支和模拟真机 `wx.canIUse('button.open-type.chooseAvatar')` 分支；不能只看 fallback 分支就认为真机登录页安全。
   - `npm.cmd run test:mp:profile-critical-path` 必须在 `build:mp-weixin` 之后通过，确保 `pages/profile/index.js` 首屏不会静态拉入登录后/管理员专用 helper。真机体验版一旦出现 `我的` 页空白，优先检查 profile 首屏静态依赖是否又变重。
   - `npm.cmd run test:mp:detail-runtime-syntax` 会读取编译后的 `app.json` 和 `project.config.json`，要求 `lazyCodeLoading=requiredComponents`、固定基础库，并遍历全部页面与分包的本地 JS、组件、WXML/WXS、WXSS 依赖；bare/动态/越界依赖、缺失产物、未经审查的 framework/第三方 runtime hash 或项目自有高风险语法都会阻断上传。上传配置必须关闭 DevTools 的 ES6 二次转换、增强编译和二次压缩，让被扫描的 JavaScript 与交给上传器的 JavaScript 保持一致。
   - `pages/profile/index` 保留顶部 `ver/state/login/cc` 诊断条，以及 `profile.mounted/profile.show/profile.render.tick/profile.refresh.*` clientLog；真机反馈空白时，先用 CloudBase 日志确认这些事件和 build 号。
   - 结论边界：当前新版 DevTools CLI 可以在发布环节验证工具链、编译产物、回放窗口和已录制用例，但不能凭空断言“任意帖子点击详情在真机一定不空白”。要机器证明这个点击路径，必须先在微信开发者工具里录制覆盖“首页点击帖子 -> 详情有内容”和“进入我的页 -> 有版本/登录内容”的回放用例；没有录制用例时，发布 gate 只能阻止已知空白根因，最终体验版仍需真机点测。
6. `scripts/deploy.mjs` 中的路径用 `path.resolve()` 构建，跨平台兼容
