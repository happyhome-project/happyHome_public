# HappyHome 测试策略（本地 + 云端）

## 背景

当前后端是微信云函数，直接在本地完整复现云环境成本高。  
为了既保证开发效率，又保证上线可信度，采用分层测试方案。

## 方案关系（关键结论）

`lib/db.local.ts` 内存数据库适配器方案，与云端真测是互补关系，不是二选一：

1. 本地内存适配器：快，适合高频验证业务流正确性。
2. 云端测试环境：慢但真实，适合发布前验收与回归。

推荐组合：日常开发先跑本地层，合并前再跑云端层。

## 分层测试模型

### L1：单元测试（已有）

- 方式：Jest + mock `wx-server-sdk` + mock `lib/db`
- 目标：函数内分支、参数校验、权限判断
- 特点：最快，定位问题最细

### L2：本地集成测试（推荐新增）

- 方式：新增 `cloud/lib/db.local.ts`，实现与 `cloud/lib/db.ts` 相同接口
- 存储：内存 `Map`
- 切换：
  - 方案 A：Jest `moduleNameMapper` 将 `../../lib/db` 映射到 `../../lib/db.local`
  - 方案 B：通过环境变量在统一入口选择 `db` 实现
- 目标：真正跑通业务流
  - 创建社区 -> 加入社区 -> 发帖 -> 改帖 -> 删帖
  - 管理员审批与计数变更一致性

### L3：云端验收测试（推荐保留）

- 方式：部署到独立 CloudBase 测试环境后执行
- 覆盖：
  - Admin HTTP 调用链路（鉴权 + action 路由）
  - 小程序 `wx.cloud.callFunction` 实链路
- 目标：验证真实平台行为与部署配置正确

## 为什么必须 L2 + L3 组合

只做 L2 的风险：

1. 无法发现云环境权限/上下文差异（如 OPENID、HTTP 事件结构）
2. 无法发现云端配置问题（环境变量、函数类型、部署包）

只做 L3 的风险：

1. 反馈慢，开发迭代效率低
2. 问题定位成本高（难快速收敛到具体逻辑）

## 建议执行节奏

1. 开发中：`L1 + L2`
2. 提交前：至少跑一次 `L2`
3. 合并前/发布前：跑 `L3`
4. 线上事故复盘：先补 `L1/L2` 用例，再补 `L3` 回归场景

## 当前可直接执行的真实测试命令

### 1) 仅验证云端 Admin HTTP 链路

```bash
# PowerShell
$env:CLOUD_API_URL="https://<env-id>-<uin>.ap-shanghai.app.tcloudbase.com"
$env:ADMIN_TOKEN="your_admin_token"
npm run test:real:admin
```

可选：

```bash
$env:TEST_COMMUNITY_ID="<communityId>"
npm run test:real:admin
```

### 2) 统一入口（可选串行跑小程序真测）

```bash
# 仅跑 Admin HTTP 真测
npm run test:real

# 同时跑小程序自动化真测（需微信开发者工具开启服务端口）
$env:RUN_MP_AUTOMATOR="1"
npm run test:real
```

说明：

1. `test:real` 在小程序阶段会先尝试 `scripts/test-mp.mjs`（`miniprogram-automator`）。
2. 若当前 DevTools 版本与 `miniprogram-automator` 协议不兼容，会自动回退到 `scripts/test-mp-replay.mjs`（`cli auto-replay`）。

## 落地清单

1. 新增 `cloud/lib/db.local.ts`（与 `db.ts` 同签名）
2. 新增 `cloud/lib/db.contract.test.ts`（校验两实现行为一致）
3. 新增 `cloud/functions/**/__tests__/*.integration.test.ts`（业务流用例）
4. 增加 npm scripts：
   - `test:unit`（L1）
   - `test:integration:local`（L2）
   - `test:integration:cloud`（L3）
5. 在 CI 中设置分层门禁：
   - PR 必跑 `L1 + L2`
   - release 分支或手动任务跑 `L3`

## 验收标准

满足以下条件可认为测试体系可用：

1. 本地 10 分钟内可完成 `L1 + L2` 全量执行
2. 能稳定复现核心链路（创建社区 -> 加入 -> 发帖 -> 删帖）
3. 云端验收在独立测试环境可一键执行并给出明确失败点
4. 同一类缺陷不再重复线上出现（有对应回归用例）
