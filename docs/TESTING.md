# HappyHome 测试策略（本地 + 云端）

> **职责**：本文是测试分层、命令和运行前置条件的操作权威。如何选择用户旅程、权限、冷启动和并发用例，见 [`TESTING-PRINCIPLES.md`](./TESTING-PRINCIPLES.md)。发布专属门禁与证据只在 [`release-gate.md`](./release-gate.md) 维护。

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
- 运行：`cd cloud && npm run test:unit`

### L2：本地集成测试

- 方式：`cloud/lib/db.local.ts` 内存适配器替代 `db.ts`
- 切换：Jest `moduleNameMapper` 在 `jest.integration.config.js` 中将 `lib/db` 映射到 `lib/db.local`
- `wx-server-sdk` 的 `getWXContext` 通过 `setup.ts` mock，支持运行时切换用户身份
- 目标：真正跑通业务流
  - 创建社区 -> SuperAdmin 审批 -> 加入社区 -> 创建板块 -> 发帖 -> 改帖 -> 删帖
  - 管理员审批与计数变更一致性
  - 权限校验（非成员/非管理员/非作者）
- 运行：`cd cloud && npm run test:integration`

### L3：云端验收测试

- 方式：通过 HTTP 调用部署在 CloudBase 上的 admin 云函数
- 覆盖：
  - Admin HTTP 鉴权（Bearer token）
  - action 路由正确性
  - 板块 CRUD（创建、查询、更新 widgets、删除）
  - 成员审批查询
- 运行：`cd cloud && CLOUD_API_URL=https://xxx.app.tcloudbase.com ADMIN_TOKEN=xxx npm run test:cloud`
- 可选：`TEST_COMMUNITY_ID=xxx` 启用板块/成员 CRUD 测试

## 为什么必须 L2 + L3 组合

只做 L2 的风险：

1. 无法发现云环境权限/上下文差异（如 OPENID、HTTP 事件结构）
2. 无法发现云端配置问题（环境变量、函数类型、部署包）

只做 L3 的风险：

1. 反馈慢，开发迭代效率低
2. 问题定位成本高（难快速收敛到具体逻辑）

## 命令速查

```bash
cd cloud

# L1 单元测试（mock 一切，最快）
npm run test:unit

# L2 本地集成测试（内存 db，真实业务流）
npm run test:integration

# L1 + L2 一起跑（默认 npm test）
npm test

# L3 云端验收（需要配置环境变量）
CLOUD_API_URL=https://<env>.ap-shanghai.app.tcloudbase.com \
ADMIN_TOKEN=your_token \
TEST_COMMUNITY_ID=xxx \
npm run test:cloud
```

## 文件结构

```
cloud/
├── lib/
│   ├── db.ts                          # 云端实现（wx-server-sdk）
│   ├── db.local.ts                    # 内存实现（L2 测试用）
│   ├── auth.ts                        # 权限校验
│   └── __tests__/
│       ├── db.test.ts                 # L1: db 单元测试
│       ├── db.contract.test.ts        # 契约测试: 验证两个 db 实现签名一致
│       ├── auth.test.ts               # L1: auth 单元测试
│       └── storage.test.ts            # L1: storage 单元测试
├── functions/
│   └── */__tests__/*.test.ts          # L1: 各函数单元测试
├── __tests__/
│   ├── integration/
│   │   ├── setup.ts                   # 集成测试公共设置（mock getWXContext）
│   │   └── full-flow.integration.test.ts  # L2: 完整业务流测试
│   └── cloud/
│       ├── helpers.ts                 # 云端测试辅助（HTTP 调用封装）
│       └── admin-api.cloud.test.ts    # L3: Admin API 验收测试
├── jest.config.js                     # L1 配置
├── jest.integration.config.js         # L2 配置（moduleNameMapper → db.local）
└── jest.cloud.config.js               # L3 配置
```

## 建议执行节奏

1. 开发中：`L1 + L2`
2. 提交前：至少跑一次 `L2`
3. 合并前/发布前：跑 `L3`
4. 线上事故复盘：先补 `L1/L2` 用例，再补 `L3` 回归场景

## 验收标准

满足以下条件可认为测试体系可用：

1. 本地 10 分钟内可完成 `L1 + L2` 全量执行
2. 能稳定复现核心链路（创建社区 -> 加入 -> 发帖 -> 删帖）
3. 云端验收在独立测试环境可一键执行并给出明确失败点
4. 同一类缺陷不再重复线上出现（有对应回归用例）

## L3 云端测试前置条件

1. admin 函数已部署为 HTTP 类型（参考 `docs/cloudbase-http-access.md`）
2. 函数环境变量 `ADMIN_TOKEN` 已设置
3. 至少有一个 active 状态的社区（用于 `TEST_COMMUNITY_ID`）

## RAG 生产验收

正式发布流程不运行本节测试，也不运行 RAG timer 证明、reconcile、回填或语义评测。只有发布完成后，RAG 负责人才能在隔离的 `validation` 社区中执行下列闭环。

`post.search` 的正式 RAG 验收不能只靠 mock。使用下面的命令创建隔离社区、板块和帖子，定向运行 `post-rag-worker`，再以真实 `post.search` 查询验证回答、引用和帖子跳转；成功和失败路径都会删除临时数据：

```powershell
npm.cmd run verify:post-rag-smoke
```

脚本必须验证三个语义查询：`有没有讲节俭家风的帖子？`、`勤俭持家` 和 `一粥一饭当思来处不易`。每个查询都要求 `mode=rag`、非空 `answer`，并在 `citations` 或 `items` 中命中同一临时帖子。该 fixture 验证检索能力，不代表正式业务库已经存在相关内容；排查真实无结果时，先检查原帖和 `post_rag_chunks` 是否包含可召回证据。
