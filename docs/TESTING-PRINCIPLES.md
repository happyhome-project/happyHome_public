# happyHome 测试指导思想

> **相关文档**：测试分层架构 / 命令 / 文件结构见 [`TESTING.md`](./TESTING.md)。本文只讲方法论。
>
> 核心原则：**测"用户会怎么用"，不只测"系统能不能做到"。**

## 一、三个视角

每个功能必须从三个视角设计测试用例：

### 1. 开发者视角（系统能力）
- 函数能返回正确结果
- 参数校验生效
- 权限控制拦截
- 错误格式一致

*这是我们最熟悉的视角，通常做得最好。*

### 2. 用户视角（真实旅程）
- 用户第一次打开 app 会看到什么？
- 用户在没有任何上下文（没登录、没加入社区、没有数据）时点每一个按钮会怎样？
- 用户可能跳过"推荐流程"直接触达深层页面吗？

**关键问法**：把自己想象成一个什么都没有的新用户。每个入口页面在没有前置条件时应该给出什么反馈？

### 3. 对抗视角（恶意/异常）
- 用户 A 能不能操作用户 B 的数据？
- 后端拒绝了，前端有没有同步拦截？
- 多次重复提交会不会创建重复数据？

## 二、前端守卫 + 后端兜底 = 测试双层校验

**规则**：每个需要权限的操作，测试时必须验证两层。

| 层级 | 职责 | 测试方法 |
|------|------|---------|
| **前端守卫** | 阻止用户走到提交那一步（UX 友好） | UI 级测试：检查未满足条件时页面不展示表单/展示引导 |
| **后端兜底** | 即使前端被绕过，服务端也拒绝 | API 级测试：直接调云函数，验证抛错 |

❌ **反面教材**：发帖页没有前端守卫，用户填完整个表单后才被后端"非社区成员，无法发帖"打回。

✅ **正面做法**：发帖页 `onShow` 检查 `member.myStatus`，非成员显示"加入社区"引导，根本不展示表单。

## 三、冷启动路径必测清单

**每个需要前置条件的页面**，都要有一条"冷启动"测试：

| 页面/功能 | 前置条件 | 冷启动测试 |
|-----------|---------|-----------|
| 发帖 | 已登录 + 已加入社区 | 未登录 → 提示登录；已登录未加入 → 提示加入 |
| 帖子详情 | 帖子存在 | 帖子已删 → 提示"不存在" |
| 社区管理 | 是管理员 | 普通成员 → 不展示管理入口 |
| 审批列表 | 是管理员 | 非管理员 → 拒绝 |

**方法**：为每个页面列出它的"最窄入口条件"，然后测试每一个条件不满足时的行为。

## 四、测试金字塔（happyHome 版）

> 详细分层架构见 [`TESTING.md`](./TESTING.md)。这里只给测试-原则层面的归类。

| 层 | 目标 | 文件 / 命令 |
|----|------|------------|
| **L1 单元** | 分支、边界、mock | `cloud/**/__tests__/*.test.ts` + `miniprogram/src/utils/__tests__/*.test.ts`，`cd cloud && npm run test:unit` |
| **L1 路由守卫** | event 解构、action 路由、openid 注入 | `cloud/__tests__/main-entry.test.ts`（mock db） |
| **L2 本地集成** | 真实业务流（mem db） | `cloud/__tests__/integration/full-flow.integration.test.ts`，`npm run test:integration` |
| **L3 云端验收** | 真 CloudBase | `cloud/__tests__/cloud/admin-api.cloud.test.ts`（Jest），`scripts/test-h5-e2e.mjs` / `scripts/h5-test/0*.mjs`（Node 脚本） |
| **冷启动路径** | 真 CloudBase 用户旅程 | `scripts/h5-test/06-cold-start-user-journey.mjs`, `07-approval-community-journey.mjs` |
| **并发压测** | 连击、race | `scripts/h5-test/08-concurrent-clicks.mjs` |

## 五、编写新测试时的 Checklist

写完一个功能后，对照这张清单补测试：

- [ ] **Happy path** — 正常流程是否走通？
- [ ] **权限边界** — 换一个没权限的用户，同样的操作是否被拒？
  - [ ] 后端拒绝？
  - [ ] 前端拦截？
- [ ] **冷启动** — 一个全新用户、没有任何前置条件，走到这个页面会怎样？
- [ ] **重复操作** — 同样的操作重复两次（幂等性 / 去重）？
- [ ] **event 形状** — `main()` 测试是否用前端实际发送的 flat event 形状？
- [ ] **空值 / 边界** — 必填字段为空？数组为空？ID 不存在？
- [ ] **视觉走查** — 见 §八 视觉回归
- [ ] **连击 / 并发** — 用户连点 2-5 次同一个按钮，是否产生重复数据？见 §九

## 八、视觉回归（UI 截断 / 溢出 / 错位）

逻辑测试覆盖不到的问题：按钮文案被截、placeholder 看不全、长文本顶出容器、弹窗遮住操作区。

**触发场景**：
- 新增表单控件或页面后
- 改动样式（padding/margin/width/flex）后
- 长文本/空状态/多行输入等边界数据

**走查方法**：

| 方法 | 工具 | 何时用 |
|------|------|------|
| H5 Preview 快速截图 | `preview_screenshot` + `preview_resize` | 日常开发迭代 |
| 读 CSS 计算值查溢出 | `preview_inspect` | 怀疑 box-sizing/width 不对时 |
| 真机小程序截图 | 用户扫预览码 + 截图反馈 | 发版前关键流程走查 |

**重点检查项**：
- 输入框 `placeholder`（尤其占位文字较长的）是否完整显示
- 按钮文案是否被截断（中文两端留白要够）
- 列表 item 里的长文本有没有 `overflow: hidden` / `text-overflow: ellipsis`
- `width: 100%` + `padding` 的容器是否设了 `box-sizing: border-box`（注意微信小程序 `input` 组件对 box-sizing 支持不完全，用 `display:block; width:auto` 更稳）
- 不同屏幕宽度（小屏 iPhone SE、大屏 Pro Max）的布局

**记录模式**：可复用且不含隐私的跨端样式约束应补充到本文档并用回归测试固化。

## 九、连击、并发、压力测试

> **根本原则**：假设用户会连点 N 次；假设后端**没有**去重。

### 问题模型

每一个"异步写操作"按钮都有 3 种被重复触发的方式：
1. **用户连点**（手滑、UI 无反馈、网络慢以为没响应）
2. **并发请求**（多个标签/多设备同一账号）
3. **弱网重试**（用户以为没发出去，重新提交）

### 防重三层

| 层 | 策略 | 在哪实现 |
|----|------|--------|
| **前端 UI** | 按钮 `disabled` 状态 + 视觉反馈（"加入中..."） | `useBusyLock` 统一 |
| **前端请求** | 请求未返回时拒绝新的点击 | `useBusyLock.run()` 自动 |
| **后端** | 天然幂等 / 唯一键 / 条件更新 | 业务函数内 |

**发帖这类非幂等操作**，后端不保证去重（经 08 测试证实 5 次并发会创建 5 条）。**前端 `useBusyLock` 是唯一防线**。

### `useBusyLock` / `useKeyedBusyLock` 用法

```ts
// 单操作（如"创建社区"、"删除帖子"）
const submitLock = useBusyLock(async () => {
  await api.create({...})
})
// template: :disabled="submitLock.busy.value" @tap="submitLock.run()"

// 列表中每行独立锁（如"审批成员 A" 不阻塞 "审批成员 B"）
const approveLock = useKeyedBusyLock(
  async (member) => await api.approve(member._id),
  (member) => member._id,
)
// template: :disabled="approveLock.isBusy(member._id)" @tap="approveLock.run(member)"
```

### 测试清单

每个异步写操作按钮要验证：

- [ ] 前端：连点 5 次同按钮 → 只发 1 个请求（用 `useBusyLock` 单测覆盖，`miniprogram/src/utils/__tests__/useBusyLock.test.ts`）
- [ ] 后端：5 个并发相同请求 → 结果符合预期
  - 幂等操作（软删、审批）：都成功或至少不产生脏数据
  - 非幂等操作（发帖）：记录后端是否去重，**如果不去重，前端必须锁**
- [ ] UI：按钮在 busy 状态有可见反馈（文案变"xx中..."或 opacity/disabled）

**参考测试**：`scripts/h5-test/08-concurrent-clicks.mjs`

### 压力测试的扩展

当流量上量后，还要考虑：
- **限流**：同一 IP / openid 每秒请求数上限（CloudBase 默认有函数级并发限制，业务层没有）
- **数据清理**：测试数据堆积，建 `cleanup-demo.mjs` 定期清
- **死锁 / 僵死**：长链接、定时器、异步队列堆积 — 本项目当前无这类场景

**底线**：每上线一个写接口，最少在 h5-test 里加一条并发测试。

## 六、事件形状回归守卫

> 来自 `feedback_test_through_main.md` 的教训

前端发 `{ action, ...params }`（扁平），后端 `main` 必须用扁平解构：

```ts
// ✅ 正确
const { action, _testOpenid, ...params } = event

// ❌ 错误（曾导致 params 永远是 {}）
const { action, params = {} } = event
```

**守卫机制**：`cloud/__tests__/main-entry.test.ts` 的 "Event shape: flat destructuring" 测试组会自动拦截这类回归。新增云函数时，必须在这个测试文件里加一条 flat event 断言。

## 七、用户旅程测试模板

添加新的用户旅程测试时，使用这个模板：

```js
// scripts/h5-test/NN-journey-name.mjs
import { callAs, createAsserter, makeRunId, seedApprovedCommunity } from './_shared.mjs'

const { assert, expectReject, finish } = createAsserter('journey-name')
const runId = makeRunId()

// Stage 1: [前置条件不满足时]
// Stage 2: [满足条件后]
// Stage 3: [完成目标操作]
// Stage 4: [边界/异常]

finish()
```

每个 Stage 代表用户旅程中的一个"关键转折点"。测试要覆盖每个转折前后的行为差异。
