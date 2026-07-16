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
│   ├── deploy.mjs        # 正式发布编排（CloudBase CLI/COS + DevTools upload）
│   ├── test-mp.mjs       # 旧版小程序自动化测试（miniprogram-automator，需要 DevTools 支持 --auto-port）
│   ├── check-devtools-automation.mjs # 当前 DevTools 自动化能力检查 + auto-replay
│   └── set-super-admin.mjs # 初始化 superAdmin
├── private.wx673b17363cd6b4a6.key  # 小程序私钥（不提交 git）
├── project.config.json   # 微信开发者工具项目配置
└── package.json          # 根 workspace 配置
```

正式及手工云函数部署都必须使用 `cloud/dist/`。先运行 `npm.cmd --workspace cloud run build`，不要从历史 `cloudfunctions/` 目录部署。

`miniprogram-ci` 只用于显式请求的 `--use-ci` 小程序上传 fallback，不是正式发布的默认路径。跨组件正式发布必须遵循 [release gate](./release-gate.md)。

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
npm.cmd run worktree:doctor          # 仅本地诊断
npm.cmd run worktree:bootstrap       # 指纹相同且 node_modules 存在时跳过 npm ci
```

公开仓库集成 main 不是一个固定磁盘路径，而是一组实时校验：当前分支必须是 `main`，`origin` 必须精确指向 `happyhome-project/happyHome_public`，工作区 clean、无进行中的 Git operation、根目录不是 reparse point，并且显式刷新后 `HEAD` 与 `origin/main` 完全相同。fetch 使用校验时捕获的 verified remote URL，不再解析可变的 `origin` 名称。私有 `angrybirddd/happyHome`、本地/未知 origin、feature 分支以及 ahead、behind 或 stale 的 main 都会被拒绝。此角色只负责公开仓库开发 worktree 的 create/retire。

`worktree:create` 从刷新后的 `origin/main` 创建安全的 `codex/*` 分支，并一次完成 hooks、真实 `AGENTS.md`、Node 24/npm 11 与 bootstrap 校验，无需创建后再 doctor/bootstrap。bootstrap 的 package.json、package-lock、Node/npm、platform/arch 指纹相同且 node_modules 存在时报告 skipped/ready；指纹变化或依赖缺失才运行 `npm ci`。HEAD 单独变化不会触发重装。

退役前先运行对生命周期操作只读的 inventory（命令会 fetch 并更新本地 `origin/main` remote-tracking metadata）：

```bash
npm.cmd run worktree:status          # 本地 inventory，不访问网络
npm.cmd run worktree:status -- --fresh
```

默认状态为 `local`，只报告注册 worktree、本地身份、dirty、Git operation、hooks、AGENTS 与本地 tracking ref divergence；远端退役证据为 `not_evaluated`。`--fresh` 才刷新 origin/main、查询开放 PR，并计算独有提交与 HEAD-in-main；刷新失败仍输出本地 inventory，但非零退出。

实际退役从公开仓库集成 main 使用 `npm.cmd run worktree:retire -- <path>`。命令一次刷新 main 与开放 PR snapshot，要求 registered、同一真实 common dir、无 reparse ancestor、非 main、clean、无 Git operation、无开放 PR、无独有提交且 HEAD 已进入 pinned main，并在非 force `git worktree remove` 紧前再次本地重验；本地分支始终保留。

创建 PR 的原功能任务在 GitHub 报告 `MERGED` 后必须立即退役自己的 worktree。即使任务当前 shell 仍位于功能目录，也应把绝对路径保存为变量，并从 canonical main 执行：

```powershell
$featureWorktree = 'C:\absolute\path\to\the-feature-worktree'
Set-Location C:\Project\Claude\happyHome_public
npm.cmd run worktree:retire -- $featureWorktree
Test-Path -LiteralPath $featureWorktree  # 必须为 False
```

成功退役会移除工作目录和其中体积最大的依赖/构建产物，但保留本地功能分支。命令阻断时只报告原因；不得使用 `--force`、递归删除或顺手清理其他任务的 worktree。`CLOSED` 未合入且仍有独有提交的 worktree不会自动退役。

退役只移除 worktree，始终保留它原来的本地功能分支，便于对应 branch owner 自行核对并推送。`--delete-merged-local-branch` 已禁用并会直接拒绝；工具中不存在触碰私有仓库路径的 branch deletion 路径。

### 功能 PR 与 Merge Queue 协作

GitHub 上 PR 的 exact HEAD 是 push、CI、review 和合并状态的权威事实源。Webhook 只可加速通知，不是继续流程的前置门禁；不得等待 webhook，也不得因为 PR-control paused 或 `record-push` 尚未登记而重复空轮询。正常流程不需要集中轮询或 orphan watchdog，原功能 AI 负责自己的 PR 到终态。

PR 前先在原功能 worktree 确认工作区 clean 并验证修改；不要求无条件 fetch/merge main：

```bash
git status --short --branch
# 运行受影响范围测试
git push origin HEAD           # 普通 push
```

同步与修复不得自动 stash 或 rebase，不得 force-push，也不得合并其他功能分支。仅在真实冲突、显式依赖或 `merge_group` 代码失败时回原功能 worktree 修复。PR 创建后，功能 AI 轮询 PR exact HEAD 的 checks、review 和 comments；push 新提交后旧检查结果作废，并先直接向 GitHub 核验 repo、branch 和新 SHA，再负责到 terminal `MERGED` 或 `CLOSED`。

`merge-ready` 的完整含义是：PR 为 open、非 draft；exact HEAD 的全部必需 PR CI 成功，没有失败、排队、取消或缺失检查；没有未处理的 review/change request；GitHub 未报告文本冲突。多个 `merge-ready` PR 可以正常进入 Merge Queue。PR 创建后不要求功能分支持续追逐或同步前进的 main；GitHub 会用 `merge_group` CI 验证最新 main 与前序队列变更的组合。

功能 AI 自审、push 后等待 exact HEAD CI；CI 与 review 门禁满足后立即运行 `gh pr merge <N> --auto --merge`，继续处理 `merge_group` CI、评论与失败并负责到 `MERGED` 或 `CLOSED`。真实冲突、显式依赖或 `merge_group` 代码失败回到原 worktree 修复；瞬态 Queue 失败且 exact HEAD 未变时，同一功能 AI 复核后重新 arm，不制造提交。依赖 PR 保持 draft，直到前置进入 main。

当前 public 协作禁用 `integrate:pr`，公开仓库统一使用 GitHub Merge Queue。此协调流程不触发 release 或 deploy。

正式生产发布只能从 clean、已同步的公开 canonical main `C:\Project\Claude\happyHome_public` 执行：分支必须是 `main`，显式刷新后 `HEAD` 必须精确等于 `origin/main`，且 `origin` 必须精确派生为 `https://github.com/happyhome-project/happyHome_public.git`。feature、dirty、ahead/behind/stale main、路径或 origin 不匹配都会阻断。`full-current` 发布还必须在 prepare 与 publish 两阶段都显式传入 `--full-current`；该模式只在规划时忽略上次生产 SHA，不会清除、改写或伪造生产状态。生产锁缺失、DevTools UI 证据或 cloud smoke 失败、fixture cleanup 失败同样会阻断。完整命令及 UI、cloud、cleanup、digest 与上传门禁见 [release gate](./release-gate.md)。

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
