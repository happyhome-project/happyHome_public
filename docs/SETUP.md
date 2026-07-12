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
npm.cmd run worktree:create -- --name=<task-name> --path=<absolute-worktree-path>  # 仅公开仓库集成 main；自动 npm ci
npm.cmd run worktree:doctor
npm.cmd run worktree:bootstrap       # 仅 clean、已同步的 codex/* 分支
```

公开仓库集成 main 不是一个固定磁盘路径，而是一组实时校验：当前分支必须是 `main`，`origin` 必须精确指向 `happyhome-project/happyHome_public`，工作区 clean、无进行中的 Git operation、根目录不是 reparse point，并且显式刷新后 `HEAD` 与 `origin/main` 完全相同。fetch 使用校验时捕获的 verified remote URL，不再解析可变的 `origin` 名称。私有 `angrybirddd/happyHome`、本地/未知 origin、feature 分支以及 ahead、behind 或 stale 的 main 都会被拒绝。此角色只负责公开仓库开发 worktree 的 create/retire；生产 release/deploy 继续使用各自既有的私有 canonical 边界，不受这里的路径去硬编码影响。

`worktree:create` 从刷新后的 `origin/main` 创建安全的 `codex/*` 分支。它在锁外用有界、非交互 fetch 捕获 exact main SHA；进入共享锁后不再访问网络，只绑定同一 root、Git common dir、HEAD 与 main SHA 做本地 recheck，并以该不可变 SHA 作为 `git worktree add` 的 start point 和创建结果校验基准。随后检查真实 `AGENTS.md` 与 Git hooks，并自动在新目录运行根 `npm.cmd ci`。`worktree:doctor` 只报告状态；缺依赖、错误 Node/npm、hooks/AGENTS 异常或已落后 main 会显示为 `not_ready`。不要把其它 worktree 的 `node_modules` 复制、软链接或 junction 到当前目录。

退役前先运行对生命周期操作只读的 inventory（命令会 fetch 并更新本地 `origin/main` remote-tracking metadata）：

```bash
npm.cmd run worktree:status
```

每个真实 worktree 的 `retirement` 会显示 `classification`、`reasons` 与逐项 `checks`。`eligible` 要求 owner 明确为 inactive，且 dirty、开放 PR、独有提交、HEAD 是否已进入 main、Git 操作和 reparse point 等检查全部 known 且通过。`candidate_stale` 只表示唯一阻断是 `unknown_owner`，它是人工复核候选，不是删除许可；缺失或过期 heartbeat 仍是 unknown。PR 查询或 `origin/main` 刷新失败也会保留 unknown 并阻断，fetch 失败时命令仍输出本地 inventory，但以非零状态退出。

这里的“只读”特指不会 retire、prune 或 remove worktree；刷新本地 Git remote-tracking metadata 是证据采集的一部分。实际退役仍必须从公开仓库集成 main 走 `worktree:retire -- --prepare ...` 生成短期 manifest，人工复核后再 apply。target 必须仍在 operator 注册列表中，target 及其已存在 ancestor 不得为 reparse/junction，且真实 Git common dir 必须与 operator 完全相同。apply 在锁外用有界、非交互的 fetch/gh 查询捕获 exact target HEAD、main 与开放 PR 点时快照；共享锁内不访问网络，只以该 snapshot 本地重验，并在 `git worktree remove` 紧前再次完成 owner、dirty、operation、HEAD、manifest 与 eligibility 全量 probe。本地 `worktree add/remove` mutation 不设短 timeout，避免中途强杀。没有后台清理路径。

退役只移除 worktree，始终保留它原来的本地功能分支，便于对应 branch owner 自行核对并推送。`--delete-merged-local-branch` 已禁用并会直接拒绝；工具中不存在触碰私有仓库路径的 branch deletion 路径。

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
cd <repository-root>\cloud\dist\user
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

Release-owned cloud smoke, log evidence, formal deployment ordering, and upload commands are maintained only in the [release gate](./release-gate.md).

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

访问 `http://localhost:5173`。登录凭据必须通过本地环境提供，不在仓库文档中记录默认值或真实值。

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

- `adminToken` 应通过命令参数或本地 `ADMIN_TOKEN` 环境变量提供；不要把值提交到仓库。
- `CLOUD_API_URL` 可通过本地环境提供。

> 注意：当前 `set:superadmin` 和 H5/API 测试工具仍包含 legacy fallback，缺少本地 `ADMIN_TOKEN` 时不会 fail closed。运行这些工具时必须显式提供 `ADMIN_TOKEN`，不应依赖 fallback；fallback 值不得作为配置或文档默认值。

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
4. 微信开发者工具自动化需要 Windows 原生环境；开发阶段的测试分层与命令见 [`TESTING.md`](./TESTING.md)。
5. 小程序发布专属的 DevTools、录制回放、上传、真机证据和最终验证要求统一见 [release gate](./release-gate.md)。本搭建指南不复制正式发布步骤。
6. `scripts/deploy.mjs` 中的路径用 `path.resolve()` 构建，跨平台兼容。
