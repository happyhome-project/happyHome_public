# happyHome · 项目指南

> 这是 **主 repo 的"项目宪法"**。所有 worktree / 所有会话都受它约束。它只写**不变的约定**和**反复踩坑的铁律**。动态状态（当前进度 / 最近改动）去 `docs/SESSION-HANDOFF.md`；单次踩坑细节去 `memory/`。

---

## 项目定位

村级社区小程序（`miniprogram/`）+ 管理后台（`admin-web/`）+ 微信云开发后端（`cloud/`）的 monorepo。npm workspaces 组织，云函数源码 TypeScript，部署走微信开发者工具。

---

## 新会话开场 4 件事（必做）

1. **读 [docs/SESSION-HANDOFF.md](docs/SESSION-HANDOFF.md)** —— 当前进度、近期改动、正在走的迁移
2. **扫 [TASKS.md](TASKS.md)** —— 跨 session 的 TODO / 待决策项
3. **扫 `memory/MEMORY.md` 索引**（系统自动加载到 context）—— 过往踩坑提示
4. **对齐用户需求再开工** —— "有 95% 把握理解需求后再开始"（CLAUDE.md 全局原则）

---

## 关键命令速查

| 动作 | 命令 | 备注 |
|---|---|---|
| 云函数部署 | `npm.cmd run deploy:cloud:tcb -- --only=user` | 2026-06-09 已验证 CloudBase CLI / COS 直传可用；旧 `npm run deploy:cloud` DevTools CLI 路径当前签名失败，仅保留为旧路径说明 |
| 小程序预览 | `npm run deploy:mp` | 同上；生成 `preview-qr.png` + `preview-info.json` |
| 小程序开发版上传 | `npm run deploy:mp:upload -- --version=1.0.x --desc="trial ..."` | DevTools CLI `upload` 主路径；不生成二维码，默认自动生成版本号和描述；上传后到微信后台把该开发版本选为体验版 |
| 正式发布流程 | `npm run deploy:release` | 云函数 + admin-web + 小程序 upload；不生成二维码；体验版切换需在微信后台确认 |
| 云函数单测 | `cd cloud && npm run test:unit` | 通过 `main(event)` 入口，不直接 call handler |
| H5 本地 | `npm --prefix miniprogram run dev:h5` | 配合 `?dev-gateway=1` 走 http-gateway 调真云函数 |
| mp-weixin 构建 | `npm --prefix miniprogram run build:mp-weixin` | 产物 → `miniprogram/dist/build/mp-weixin/` |
| 建索引 | `npm run ensure:indexes` | 用 @cloudbase/manager-node + CAM 密钥 |
| admin 首登 | 用 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` 直接登 admin-web | admin_accounts 为空时自动 seed superAdmin，**不需要跑 cli seed** |
| admin 种子（备用）| `SEED_ADMIN_USERNAME=xxx SEED_ADMIN_PASSWORD=yyy npm run seed:admin` | 幂等；CI 环境或 bootstrap 用不了时再跑 |
| admin env 同步 | `node scripts/update-admin-env.mjs` | 一次性把本地 BOOTSTRAP/SESSION 变量推到 CloudBase admin 函数 env，免去手工去控制台填 |
| 审批提醒 env 同步 | `npm run update:approval-env` | 把小程序订阅消息模板 ID / 字段映射同步到 `member`、`community` 云函数 |
| 审批模板 API 配置 | `npm run configure:approval-templates -- discover` | 通过微信订阅消息 API 发现/添加模板；用 `admin` 云函数 env 里的 `WX_APPID/WX_APPSECRET` |

---

## 部署铁律

> **云函数当前可用路径**：CloudBase CLI / COS 直传。2026-06-09 本机实测 `tcb fn deploy <fn> --force --yes --deployMode cos` 在函数包目录内可部署 `user` 成功。旧 DevTools CLI 云函数路径仍保留，但当前会在真实上传阶段报 `getCloudAPISignedHeader failed` / `ret=41002`，不能当作可用主路径；`miniprogram-ci` 只做"DevTools 装不上"的 CI 服务器 fallback。

1. **云函数 deploy 优先走 CloudBase CLI / COS 直传**：
   - 推荐入口：`npm.cmd run deploy:cloud:tcb -- --only=user`（多个函数可用逗号：`--only=user,post`；不传 `--only` 会部署全部 `CLOUD_FUNCTIONS`）
   - 该入口会构建云函数、切到 `cloud/dist/<fn>`、用 `tcb fn deploy <fn> --force --yes --env-id cloudbase-3gh862acb1505ff3 --deployMode cos --json` 部署，并用 `tcb fn detail <fn> ... --json` 做只读校验。
   - 底层参数依据官方 CLI：`--yes` 跳过交互、`--json` 便于解析、`--env-id` 指定环境、`--deployMode cos` 固定 COS 上传；CloudBase 官方也支持 `cloudbaserc.json` + `tcb fn deploy --all --yes`，但该项目暂不把 env/触发器配置写入配置文件，以免覆盖线上手工 env。
   - 先构建：`cd cloud && node build.mjs`
   - 到函数包目录执行，例如 `user`：
     ```bash
     cd C:\Project\Claude\happyHome\cloud\dist\user
     npx.cmd --yes --package @cloudbase/cli tcb fn deploy user --force --yes --env-id cloudbase-3gh862acb1505ff3 --deployMode cos --json
     ```
   - 成功证据：输出包含 `[user] 部署方式: COS 上传` 和 `[user] 云函数部署成功`；`tcb fn detail user --env-id cloudbase-3gh862acb1505ff3 --json` 应显示 `Status: Active` / `AvailableStatus: Available` / 新的 `ModTime`。
   - 注意：在 PowerShell 里用 `npx.cmd`，不要用会触发执行策略的 `npx.ps1`。
   - 2026-06-09 已修正 `scripts/deploy.mjs cloud --use-tcb`：旧实现从仓库根目录调用 `cloudbase fn deploy <fn> --dir ...`，复测可挂起超过正常 10 秒级部署窗口；新实现改为函数包目录直传。
2. **旧 DevTools CLI 云函数路径保留但当前不可用**：
   - `scripts/deploy.mjs` 默认仍会先走 `cli.bat`，相关实现位于 `deployCloudViaDevtoolsCli`。
   - `--use-ci` 强制跳过 DevTools CLI / CloudBase CLI 直接走 miniprogram-ci（仅用于无 DevTools 的 CI 服务器）
   - `WX_DEVTOOLS_CLI=<path>` 可覆盖 cli.bat 路径，否则脚本自己在 `C:/D:/E:/X:` 下搜
   - 直接命令模板（无 `npm` 时备用）：
     ```bash
     "X:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat" cloud functions deploy ^
       --env cloudbase-3gh862acb1505ff3 ^
       --paths "C:\Project\Claude\happyHome\cloud\dist\admin" ^
       --project "C:\Project\Claude\happyHome\miniprogram\dist\build\mp-weixin" ^
       --remote-npm-install
     ```
   - **`--project` 必须指向 `miniprogram/dist/build/mp-weixin`**，不是仓库根。2026-05-26 实测该路径可全量部署 7 个云函数；历史上 `cli.bat auto --project <ROOT>` 曾把根目录当独立小程序项目并覆写 `project.config.json`。
   - 2026-06-09 复测：即使账号已登录、项目已打开，DevTools CLI 云函数部署仍可能在上传阶段输出 `success=false` 和 `getCloudAPISignedHeader failed` / `ret=41002`。这条旧路径当前不可用；不要把它当成云函数部署成功证据。
   - 日常真机测试上传走 `npm run deploy:mp:upload` 或 `npm run deploy:release`；不要为了真机测试额外跑 `deploy:mp`，避免生成预览二维码。
   - DevTools CLI `upload` 上传的是微信后台“开发版本”。要让体验成员看到它，需要在微信小程序后台的版本管理里把刚上传的开发版本“选为体验版”。

3. **云函数 env 变量必须逐函数手工配**——云函数代码部署不会自动同步 env。新增/改 env 后要去 CloudBase 控制台 → 云函数 → 函数配置里逐个填。常见踩坑：admin 函数加了 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` / `ADMIN_SESSION_TTL_DAYS` 后忘了在控制台填 → bootstrap 登录走默认值 admin/happyhome2024，不安全也不一致

4. **fallback 路径（`miniprogram-ci`）必须强制 IPv4**：`scripts/deploy.mjs` 顶部已 `dns.setDefaultResultOrder('ipv4first')` + `dns.lookup` 猴补 `family=4`；命令行 fallback `NODE_OPTIONS=--dns-result-order=ipv4first npm run deploy:cloud -- --use-ci`

5. **部署失败排查顺序**：
   - 先看错误里 IP——如果是 IPv6（`2409:...`）→ 主路径就该走 DevTools CLI 而不是 ci，检查 `scripts/deploy.mjs` 是不是被 `--use-ci` 强制 fallback
   - 再看 DevTools 是否登录/签名态有效——即使 `cli.bat islogin` 看起来正常，`getCloudAPISignedHeader failed` 也要先提示用户打开微信开发者工具重新登录/扫码
   - CloudBase CLI 可用 `npx.cmd --yes --package @cloudbase/cli cloudbase fn list --env-id cloudbase-3gh862acb1505ff3 --json` 验证 CAM/CloudBase 登录；能 list 说明不是腾讯云长期未登录导致的 CLI 认证过期。
   - 如果 `tcb fn deploy` 停在交互选择“使用合并配置更新 / 手动输入配置 / 退出”，补 `--yes`；如果通过 `--dir` 从仓库根部署挂起，切到 `cloud/dist/<fn>` 后用位置参数部署，或直接用 `npm.cmd run deploy:cloud:tcb -- --only=<fn>`。
   - 最后查 CloudBase 白名单 / COS 上传链路——只在前两步都排除后才考虑

6. **详情与历史**：[memory/feedback_cloudbase_cli_cos_deploy.md](memory/feedback_cloudbase_cli_cos_deploy.md) 记录 2026-06-09 已验证的新云函数部署路径；旧 DevTools CLI 背景见 `feedback_deploy_devtools_cli.md`（若该历史文件在当前 checkout 缺失，以本条新记录为准）。

---

## 内容审核铁律

1. **腾讯 CI 图片审核不要默认传 `DetectType`**：2026-06-12 实测 `/image/auditing` 携带旧的通用 `DetectType`（如 `Porn,Terrorism,Politics,Ads,Illegal,Abuse`，甚至缩减到 `Porn,Ads`）会返回 `InvalidArgument / invalid DetectType`，导致帖子被保守落到“人工复核”。图片审核默认走腾讯 CI 策略；如需自定义图片策略，先在腾讯云配置图片审核 BizType，再用 `TENCENT_CI_IMAGE_BIZ_TYPE` 显式指定。
2. **审核问题不能只看帖子状态**：看到 `auditStatus=review` 时，要查 `content_audit_tasks.raw/reason/provider`。如果 raw 里是供应商参数错误，说明不是内容真的需要人工审核，而是调用协议/配置错误。
3. **涉及媒体审核的修复必须做线上临时 fixture 闭环**：单测只能证明请求体形态，不能证明腾讯云真实接受。至少创建临时社区/板块/帖子，上传真实图片或媒体，确认 `auditStatus=pass` 或预期状态，再硬删除临时社区清理数据。
4. **DevTools CLI 云函数部署仍不是成功证据**：如果 `npm.cmd run deploy:cloud -- --only=...` 报 `getCloudAPISignedHeader failed` / `ret=41002`，切到 `npm.cmd run deploy:cloud:tcb -- --only=...`。本次 `admin,post` 审核修复就是走 CloudBase CLI / COS 路径部署并线上验证。

详情见 [memory/feedback_tencent_ci_image_audit.md](memory/feedback_tencent_ci_image_audit.md)。

---

## 测试铁律

1. **集成测试走 `main(event)` 入口**，不直接 call handler —— 否则会漏掉事件解构不匹配的问题
2. **前端异步写按钮必须用 `useBusyLock` / `useKeyedBusyLock`** —— 后端不保证去重（5 次并发发帖 = 5 条重复帖），前端是唯一防线
3. **覆盖用户视角**，不只测"系统能不能做到"—— 测前端守卫 + 后端兜底双层；冷启动路径必测
4. **体验版关键入口必须扫 mp-weixin 编译产物** —— 详情页和登录所在的 `profile` 页都可能在真机解析阶段先炸。发布前必须跑 `npm run test:mp:detail-runtime-syntax`，它会扫描 detail/profile 关键依赖中的高风险语法/API（如 `Object.fromEntries`、`Object.values`、`Array.from`、`Map/Set` 转换链、对象/数组展开、数组解构回调、`catch {}` optional catch binding）以及 detail 是否误引入 `widget-editor`。`miniprogram/vite.config.ts` 的 `build.target` 必须保持可兼容微信基础库的低目标（当前 `es2017`）；不要只看 H5 正常就上传体验版。
5. **改完代码必须自己自测** —— 有 H5 / preview / automator 环境，别把验证甩给用户
6. 四层金字塔和必过 checklist 统一入口：[docs/TESTING-PRINCIPLES.md](docs/TESTING-PRINCIPLES.md)

---

## 设计方向

**2026-04-20 pivot 到 Classical Dossier**（墨绿 + 宋体 + 纸底）：

- 主色：`$hh-accent: #3A6A45`（墨绿）、`$hh-accent-ink: #1D4E2B`（暗版文字）
- 纸底：`$hh-surface-1: #FDFBF8`（卡片）、`$hh-surface-0: #F5F3F0`（页面）
- 字体：`$hh-font-serif`（Songti SC 宋体栈，标题用）、`$hh-font-sans`（正文）、`$hh-font-num`（数字）
- token 命名空间：`$hh-*`；旧 `$hh-color-*` 是 compat alias，新组件不要用
- 四件套：[docs/VISUAL-TONE.md](docs/VISUAL-TONE.md) → [docs/DESIGN-TOKENS.md](docs/DESIGN-TOKENS.md) → [docs/UI-LIBRARY.md](docs/UI-LIBRARY.md) → [docs/UX-PRINCIPLES.md](docs/UX-PRINCIPLES.md)

做 UI 前先研究参考设计（wot-ui.cn / Dage 原型 / 竞品），不要闭门造车。

---

## 开发纪律

1. **执行边界开场必声明**（2026-04-24 立规则，避免"顺手做完一气呵成"越界）：
   - 不可撤销 / 对外部产生影响的动作（`git push origin main` / `cli.bat cloud functions deploy` / `cli.bat preview` / 删 worktree / `push --force` 等）**必须先声明边界，再开工**
   - 标准边界关键词：

     | 关键词 | 含义 |
     |---|---|
     | **到 edit 止** | 只改文件。不 commit、不跑本机命令以外的事 |
     | **到 commit 止** | 改 + commit。**不 push** |
     | **到 push 止** | 改 + commit + push origin。**不 deploy 云函数 / 不上传小程序预览** |
     | **到 deploy 止** | 完整 pipeline：改 + commit + push + 部署生产 |

   - 开场模板：
     ```
     我打算做：<动作摘要>
     执行边界：到 X 止
     副作用：<例如 "会 push 到 origin/main，会触发 member 云函数部署到 cloudbase-3gh862acb1505ff3"，或 "无外部副作用">
     ```
   - 用户指令明确边界时（"修了就合 main 部署"、"做到 push 就停"），按指令；指令含糊时（"A/B/C 都做"、"看着弄"），**默认到 edit 止**，做完停下来等下一步指令
   - 部署前必走的本机验证：
     - 改了云函数 → cloud unit tests
     - 改了前端 → `vue-tsc --noEmit` + `npm run build:h5`
     - 改了 UI 交互 → 真机 / DevTools automator E2E（不能只看 H5 mock）
   - 未做这层验证就 deploy 视为越界
2. **不越权清理 / 破坏性操作先问**（来自 `~/.claude/CLAUDE.md` 全局规则）：
   - 发现"多余"的分支 / worktree / 文件 / 目录 → 先问，不自作主张删
   - `git branch -D` / `worktree remove --force` / `rm -rf` / `reset --hard` / `push --force` → 用户没明确说"做这件事"就不能做
   - 正确流程：完成用户明确要求的 → 列出"相邻可改进点" → 等用户确认再动
3. **事实性问题先查再答** —— 分支 / 部署 / DB / 文件存在性这类 5 秒可查的事必须先查
4. **外部依赖任务一次讲清** —— 部署 / 建资源 / 配环境变量要一次列清所有手动步骤，别挤牙膏
5. **小步快跑** —— bug 修复不需要周边清理；一次操作不需要辅助 helper；不要预设未来需求
6. **不加"用不上"的错误处理** —— 内部调用相信框架保证；只在系统边界（用户输入 / 外部 API）做校验

---

## Git 约定

- **Author**：AngryBird / `48046333+angrybirddd@users.noreply.github.com`（全局 CLAUDE.md 强制；错了要 filter-branch 改写 author + committer）
- **Commit 风格**：`feat(scope): ...` / `fix(scope): ...` / `test: ...` / `docs: ...` / `refactor: ...`
- **部署源分支**：`main`。feature 工作在 worktree 分支（`claude/<name>` 或 `codex/<name>`）
- 合回 main 流程：worktree 分支 rebase 到 latest main → 主 repo fast-forward → push origin main
- 已推送的错误身份 commit 用 `git filter-branch --env-filter` 改 author + committer，然后 `git push --force-with-lease`

---

## Memory 系统

- **自动加载**：`~/.claude/projects/C--Project-Claude-happyHome/memory/MEMORY.md`（索引）
- **按需加载**：`memory/feedback_*.md`（单条细节）
- **发现新教训主动写入**并更新索引。不要在 memory 里写已经能从代码 / git 推出来的事实
- 不是 git 仓内文件，per-user 存储

---

## Worktree 协作

- 每个 worktree 是一个独立 feature 分支（`.claude/worktrees/<name>` 下）
- preview_start 在 worktree 里起 dev server 会报 "cwd must be within project root" —— 需要 preview 时从主仓库根新开会话（详见 `memory/feedback_preview_worktree_lock.md`）
- 合回 main 前在 worktree 里 rebase origin/main，主 repo 做 `merge --ff-only` 再 push
- 多 worktree 同时改共享文件（`cloud.ts` / `deploy.mjs` / 全局 token）时小心冲突，合并顺序：小改动面先、大改动面后

---

## 文档地图

| 类别 | 文件 | 什么时候读 |
|---|---|---|
| Session 入口 | `docs/SESSION-HANDOFF.md` | 每次开场 |
| 测试原则 | `docs/TESTING-PRINCIPLES.md` | 写测试 / 改跟用户交互相关代码 |
| 设计系统 | `docs/VISUAL-TONE.md` / `DESIGN-TOKENS.md` / `UI-LIBRARY.md` / `UX-PRINCIPLES.md` | 做 UI |
| 本地环境 | `docs/SETUP.md` | 首次 clone |
| 运维 | `docs/cloudbase-http-access.md` | http-gateway 相关 |
| Admin Web 生产入口与部署 | `docs/admin-web-deploy.md` | 处理 `admin.tinghai.xin`、Nginx、HTTPS、阿里云服务器代理时必读 |
| 审批提醒配置 | `docs/approval-notifications.md` | 配微信小程序订阅消息模板、同步云函数 env |
| UI 回归 | `docs/ui-click-regression-checklist.md` | 改 UI 交互 |

---

## 遇到这些情况，优先读对应 memory

- 部署失败 / -10008 invalid ip → `feedback_deploy_force_ipv4.md`
- 测试没抓住 bug → `feedback_test_through_main.md` / `feedback_test_user_perspective.md` / `feedback_test_methodology.md`
- 小程序 vs H5 样式不一致 → `feedback_wx_style_pitfalls.md`
- 连击 / 重复提交 → `feedback_repeat_click_defense.md`
- H5 调云函数 → `feedback_h5_http_gateway.md` / `feedback_dev_login_mode.md`
- 级联删除 / 状态机 → `feedback_community_status_machine.md` / `feedback_cascade_delete_order.md`
- CloudBase 建索引 → `feedback_cloudbase_index_mgmt.md`
- DevTools automator / cli.bat → `feedback_devtools_automator_usage.md`
- admin 双权限 → `feedback_admin_dual_role.md` / `feedback_admin_router_names_missing.md`
- 凭印象回答 → `feedback_fact_check_before_answering.md`
