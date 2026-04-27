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
| 云函数部署 | `npm run deploy:cloud [-- --only=post,admin]` | DevTools CLI 主路径；`--use-ci` 强制走 miniprogram-ci fallback |
| 小程序预览 | `npm run deploy:mp` | 同上；生成 `preview-qr.png` + `preview-info.json` |
| 云函数单测 | `cd cloud && npm run test:unit` | 通过 `main(event)` 入口，不直接 call handler |
| H5 本地 | `npm --prefix miniprogram run dev:h5` | 配合 `?dev-gateway=1` 走 http-gateway 调真云函数 |
| mp-weixin 构建 | `npm --prefix miniprogram run build:mp-weixin` | 产物 → `miniprogram/dist/build/mp-weixin/` |
| 建索引 | `npm run ensure:indexes` | 用 @cloudbase/manager-node + CAM 密钥 |
| admin 种子 | `SEED_ADMIN_USERNAME=xxx SEED_ADMIN_PASSWORD=yyy npm run seed:admin` | 幂等 |

---

## 部署铁律

1. **微信/CloudBase 上传类操作一律优先走 DevTools CLI**（`cli.bat cloud functions deploy` / `cli.bat preview` / `cli.bat upload`）。IDE 内部网络栈绕开本机 IPv6 / 透明代理 / WeChat CI IP 白名单。`miniprogram-ci` 只做 fallback
2. 云函数部署前强制 IPv4（`scripts/deploy.mjs` 顶部已 `dns.setDefaultResultOrder('ipv4first')`；fallback 路径失败时再加 `NODE_OPTIONS=--dns-result-order=ipv4first`）
3. 部署失败先看错误里的 IP 是不是 IPv6，再查白名单
4. **详情与历史**：[memory/feedback_deploy_force_ipv4.md](memory/feedback_deploy_force_ipv4.md)（文件名叫 "force_ipv4" 但现在核心结论已泛化为"走 DevTools CLI"）

---

## 测试铁律

1. **集成测试走 `main(event)` 入口**，不直接 call handler —— 否则会漏掉事件解构不匹配的问题
2. **前端异步写按钮必须用 `useBusyLock` / `useKeyedBusyLock`** —— 后端不保证去重（5 次并发发帖 = 5 条重复帖），前端是唯一防线
3. **覆盖用户视角**，不只测"系统能不能做到"—— 测前端守卫 + 后端兜底双层；冷启动路径必测
4. **改完代码必须自己自测** —— 有 H5 / preview / automator 环境，别把验证甩给用户
5. 四层金字塔和必过 checklist 统一入口：[docs/TESTING-PRINCIPLES.md](docs/TESTING-PRINCIPLES.md)

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
