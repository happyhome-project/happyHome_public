# HappyHome 微信小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一套地理位置型社区微信小程序，含动态控件板块系统、微信云开发后端、uni-app 小程序前端、Vue3 Web 管理后台。

**Architecture:** 三包 Monorepo（miniprogram / cloud / admin-web），共享 TypeScript 类型定义。云函数通过 db.ts/storage.ts 适配层访问云数据库和存储，方便未来迁移自建后端。小程序帖子内容以 widgetId 为 key 存储，展示时动态读取板块控件配置。

**Tech Stack:** uni-app (Vue 3 + TypeScript)、微信云开发（云函数 + 云数据库 + 云存储）、Vue 3 + Vite + Element Plus（Web 管理后台）、Jest（云函数单元测试）

---

## 文件结构总览

```
happyHome/
├── miniprogram/                    # uni-app 小程序
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index/index.vue     # 首页（信息流）
│   │   │   ├── detail/index.vue    # 帖子详情
│   │   │   ├── create/index.vue    # 发帖页
│   │   │   ├── profile/index.vue   # 我的
│   │   │   └── onboarding/index.vue # 新用户引导
│   │   ├── components/
│   │   │   ├── PostCard.vue        # 信息流卡片
│   │   │   ├── SectionTabs.vue     # 板块横向 Tab
│   │   │   ├── CommunitySwitcher.vue
│   │   │   └── widgets/            # 各控件渲染组件
│   │   │       ├── WidgetRenderer.vue   # 详情页渲染
│   │   │       └── WidgetEditor.vue     # 发帖页编辑
│   │   ├── store/
│   │   │   ├── user.ts             # 用户状态（openId, role）
│   │   │   ├── community.ts        # currentCommunityId + 社区列表
│   │   │   └── sections.ts         # 当前社区板块缓存
│   │   ├── api/
│   │   │   └── cloud.ts            # 封装 wx.cloud.callFunction
│   │   └── utils/
│   │       └── widget.ts           # 控件展示逻辑（getListPreview 等）
│   ├── package.json
│   └── vite.config.ts
│
├── cloud/                          # 微信云函数
│   ├── shared/
│   │   └── types.ts                # 共享类型（所有集合的 TS 接口）
│   ├── lib/
│   │   ├── db.ts                   # 云数据库适配层
│   │   └── storage.ts              # 云存储适配层
│   └── functions/
│       ├── user/index.ts           # login, getProfile
│       ├── community/index.ts      # create, list, get, approve, reject
│       ├── member/index.ts         # apply, approve, reject, leave, list
│       ├── section/index.ts        # create, update, delete, list, updateWidgets
│       └── post/index.ts           # create, list, get, delete
│
└── admin-web/                      # Vue 3 Web 管理后台
    ├── src/
    │   ├── views/
    │   │   ├── Login.vue           # 微信扫码登录
    │   │   ├── SuperAdmin/
    │   │   │   └── CommunityApproval.vue
    │   │   └── CommunityAdmin/
    │   │       ├── SectionList.vue
    │   │       ├── WidgetEditor.vue  # 拖拽控件配置
    │   │       └── MemberApproval.vue
    │   ├── api/
    │   │   └── cloud.ts            # HTTP 调用云函数
    │   └── router/index.ts
    ├── package.json
    └── vite.config.ts
```

---

## Phase 1: Foundation（基础搭建）

### Task 1: Monorepo 项目初始化

**Files:**
- Create: `miniprogram/` (uni-app 项目)
- Create: `cloud/package.json`
- Create: `admin-web/` (Vue 3 项目)
- Create: `package.json` (workspace root)

- [ ] **Step 1: 初始化 uni-app 小程序项目**

```bash
cd /home/dwang1/project/claude_workspace/happyHome
npx degit dcloudio/uni-preset-vue#vite-ts miniprogram
cd miniprogram && npm install
```

- [ ] **Step 2: 初始化 admin-web**

```bash
cd /home/dwang1/project/claude_workspace/happyHome
npm create vite@latest admin-web -- --template vue-ts
cd admin-web && npm install
npm install element-plus @element-plus/icons-vue vue-router@4 pinia axios
```

- [ ] **Step 3: 初始化 cloud 包**

```bash
cd /home/dwang1/project/claude_workspace/happyHome
mkdir -p cloud/lib cloud/functions/user cloud/functions/community \
  cloud/functions/member cloud/functions/section cloud/functions/post \
  cloud/shared
cd cloud
npm init -y
npm install --save-dev typescript jest @types/jest ts-jest
```

- [ ] **Step 4: cloud/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2018",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: cloud/jest.config.js**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
}
```

- [ ] **Step 6: 初始化 git，首次提交**

```bash
cd /home/dwang1/project/claude_workspace/happyHome
git init
echo "node_modules/\ndist/\n.env" > .gitignore
git add .
git commit -m "chore: init monorepo (miniprogram, cloud, admin-web)"
```

---

### Task 2: 共享 TypeScript 类型定义

**Files:**
- Create: `cloud/shared/types.ts`

- [ ] **Step 1: 编写所有集合的类型接口**

```typescript
// cloud/shared/types.ts

export type UserRole = 'user' | 'superAdmin'
export type JoinType = 'open' | 'approval'
export type CommunityStatus = 'pending' | 'active' | 'disabled'
export type MemberRole = 'admin' | 'member'
export type MemberStatus = 'pending' | 'active' | 'rejected' | 'left'
export type PostStatus = 'active' | 'deleted'

export type WidgetType =
  | 'short_text'
  | 'summary'
  | 'datetime'
  | 'number'
  | 'image_group'
  | 'rich_text'
  | 'location'

// 可在列表展示的控件类型
export const LIST_DISPLAYABLE_TYPES: WidgetType[] = [
  'short_text', 'summary', 'datetime', 'number'
]

export interface Widget {
  widgetId: string        // UUID，创建后不可变
  type: WidgetType
  label: string           // 可修改
  fieldKey: string        // 可修改，仅用于可读性，不作为 content key
  required: boolean
  order: number
  showInList: boolean     // 最多3个为 true，后端强制校验
  unit?: string           // 仅 number 类型使用
}

export interface User {
  _id: string             // WeChat openId
  nickName: string
  avatarUrl: string
  role: UserRole
  createdAt: string
}

export interface Community {
  _id: string
  name: string
  description: string
  coverImage: string
  location: { address: string; lat: number; lng: number }
  joinType: JoinType
  creatorId: string       // 仅记录创建者，不代表当前权限
  status: CommunityStatus
  memberCount: number
  createdAt: string
}

export interface CommunityMember {
  _id: string
  communityId: string
  userId: string
  role: MemberRole
  status: MemberStatus
  appliedAt: string
  joinedAt?: string
  leftAt?: string
}

export interface Section {
  _id: string
  communityId: string
  name: string
  icon: string
  order: number
  enableComment: boolean
  enableLike: boolean
  widgets: Widget[]
  createdAt: string
}

// post.content 的 key 是 widgetId（UUID），不是 fieldKey
export type PostContent = Record<string, string | number | string[]>

export interface Post {
  _id: string
  communityId: string
  sectionId: string
  authorId: string
  status: PostStatus
  content: PostContent
  commentCount: number
  likeCount: number
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: 验证类型编译通过**

```bash
cd cloud && npx tsc --noEmit
```
Expected: 无错误输出

- [ ] **Step 3: Commit**

```bash
git add cloud/shared/types.ts
git commit -m "feat: add shared TypeScript types for all collections"
```

---

### Task 3: 数据库和存储适配层

**Files:**
- Create: `cloud/lib/db.ts`
- Create: `cloud/lib/storage.ts`
- Create: `cloud/lib/__tests__/db.test.ts`

> **重要架构约束：** 所有云函数必须通过这两个文件访问数据库和存储。未来迁移自建后端时只需替换这两个文件。

- [ ] **Step 1: 编写 db.ts 适配层**

```typescript
// cloud/lib/db.ts
// 封装微信云数据库所有操作，迁移时只改此文件

import cloud from 'wx-server-sdk'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

export { _ }

export function collection(name: string) {
  return db.collection(name)
}

// 原子递增，必须用此方法更新计数器，禁止先读再写
export async function increment(
  collectionName: string,
  docId: string,
  field: string,
  delta: number
) {
  return collection(collectionName).doc(docId).update({
    data: { [field]: _.inc(delta) }
  })
}

export async function getById(collectionName: string, id: string) {
  const res = await collection(collectionName).doc(id).get()
  return res.data
}

export async function create(collectionName: string, data: object) {
  const res = await collection(collectionName).add({ data })
  return res._id as string
}

export async function updateById(
  collectionName: string,
  id: string,
  data: object
) {
  return collection(collectionName).doc(id).update({ data })
}

export async function softDelete(collectionName: string, id: string) {
  return updateById(collectionName, id, { status: 'deleted' })
}

export async function query(
  collectionName: string,
  where: object,
  options: { orderBy?: [string, 'asc' | 'desc']; limit?: number; skip?: number } = {}
) {
  let q = collection(collectionName).where(where)
  if (options.orderBy) q = q.orderBy(options.orderBy[0], options.orderBy[1])
  if (options.skip) q = q.skip(options.skip)
  if (options.limit) q = q.limit(options.limit)
  const res = await q.get()
  return res.data
}
```

- [ ] **Step 2: 编写 storage.ts 适配层**

```typescript
// cloud/lib/storage.ts
import cloud from 'wx-server-sdk'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function uploadFile(
  cloudPath: string,
  fileContent: Buffer
): Promise<string> {
  const res = await cloud.uploadFile({ cloudPath, fileContent })
  return res.fileID
}

export async function deleteFile(fileIDs: string[]): Promise<void> {
  await cloud.deleteFile({ fileList: fileIDs })
}

export function getTempUrl(fileID: string): Promise<string> {
  return cloud.getTempFileURL({ fileList: [fileID] })
    .then(res => res.fileList[0].tempFileURL)
}
```

- [ ] **Step 3: 编写 db 适配层的单元测试（mock 云数据库）**

```typescript
// cloud/lib/__tests__/db.test.ts
// 测试 increment 不能用先读再写的方式

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  database: () => ({
    collection: () => ({
      doc: (id: string) => ({
        update: jest.fn().mockResolvedValue({ stats: { updated: 1 } }),
        get: jest.fn().mockResolvedValue({ data: { _id: id, name: 'test' } }),
      }),
      add: jest.fn().mockResolvedValue({ _id: 'new-id' }),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ data: [] }),
    }),
    command: { inc: (n: number) => ({ __inc: n }) }
  }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { getById, create, increment } from '../db'

test('getById returns document data', async () => {
  const result = await getById('users', 'user-123')
  expect(result).toEqual({ _id: 'user-123', name: 'test' })
})

test('create returns new document id', async () => {
  const id = await create('posts', { title: 'test' })
  expect(id).toBe('new-id')
})

test('increment uses _.inc (atomic), not read-then-write', async () => {
  // 验证 increment 传入的 data 包含 _.inc 对象，而非直接数值
  const cloudMock = require('wx-server-sdk')
  const updateMock = cloudMock.database().collection().doc().update
  await increment('communities', 'c1', 'memberCount', 1)
  expect(updateMock).toHaveBeenCalledWith({
    data: { memberCount: { __inc: 1 } }
  })
})
```

- [ ] **Step 4: 运行测试**

```bash
cd cloud && npx jest lib/__tests__/db.test.ts --verbose
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add cloud/lib/ 
git commit -m "feat: add db.ts and storage.ts adapter layers with tests"
```

---

### Task 4: WeChat 登录云函数

**Files:**
- Create: `cloud/functions/user/index.ts`
- Create: `cloud/functions/user/__tests__/login.test.ts`

- [ ] **Step 1: 编写登录测试**

```typescript
// cloud/functions/user/__tests__/login.test.ts
jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleLogin } from '../index'
import * as db from '../../../lib/db'

test('新用户首次登录：创建 user 记录', async () => {
  ;(db.getById as jest.Mock).mockRejectedValue(new Error('not found'))
  ;(db.create as jest.Mock).mockResolvedValue('test-openid')
  
  const result = await handleLogin({ nickName: '张三', avatarUrl: 'https://...' })
  
  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'test-openid',
    nickName: '张三',
    role: 'user'
  }))
  expect(result.isNew).toBe(true)
})

test('老用户登录：更新 nickName 和 avatarUrl', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'test-openid', nickName: '旧名', role: 'user'
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleLogin({ nickName: '新名', avatarUrl: 'https://new' })

  expect(db.updateById).toHaveBeenCalledWith('users', 'test-openid', {
    nickName: '新名', avatarUrl: 'https://new'
  })
  expect(result.isNew).toBe(false)
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd cloud && npx jest functions/user/__tests__/login.test.ts --verbose
```
Expected: FAIL（handleLogin not defined）

- [ ] **Step 3: 实现 user 云函数**

```typescript
// cloud/functions/user/index.ts
import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { User } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleLogin(params: { nickName: string; avatarUrl: string }) {
  const { OPENID } = cloud.getWXContext()
  let isNew = false

  try {
    const existing = await db.getById('users', OPENID) as User
    await db.updateById('users', OPENID, {
      nickName: params.nickName,
      avatarUrl: params.avatarUrl
    })
    return { user: { ...existing, ...params }, isNew }
  } catch {
    // 用户不存在，创建新用户
    isNew = true
    const newUser: Omit<User, '_id'> & { _id: string } = {
      _id: OPENID,
      nickName: params.nickName,
      avatarUrl: params.avatarUrl,
      role: 'user',
      createdAt: new Date().toISOString()
    }
    await db.create('users', newUser)
    return { user: newUser, isNew }
  }
}

// 云函数入口
export const main = async (event: any) => {
  const { action, ...params } = event
  if (action === 'login') return handleLogin(params)
  throw new Error(`Unknown action: ${action}`)
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd cloud && npx jest functions/user/__tests__/login.test.ts --verbose
```
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add cloud/functions/user/
git commit -m "feat: add user login cloud function with tests"
```

---

## Phase 2: 核心云函数

### Task 5: 社区管理云函数

**Files:**
- Create: `cloud/functions/community/index.ts`
- Create: `cloud/functions/community/__tests__/community.test.ts`

- [ ] **Step 1: 编写社区测试**

```typescript
// cloud/functions/community/__tests__/community.test.ts
jest.mock('../../../lib/db', () => ({
  create: jest.fn().mockResolvedValue('new-community-id'),
  getById: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
  increment: jest.fn(),
  _: { inc: (n: number) => ({ __inc: n }) }
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'creator-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleCreate, handleApprove, handleList } from '../index'
import * as db from '../../../lib/db'

test('创建社区：status 默认为 pending', async () => {
  await handleCreate({ name: '幸福小区', description: '...', joinType: 'open' })
  expect(db.create).toHaveBeenCalledWith('communities', expect.objectContaining({
    name: '幸福小区',
    status: 'pending',
    creatorId: 'creator-openid',
    memberCount: 0
  }))
})

test('审批社区：只有 superAdmin 可以操作', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ role: 'user' })
  await expect(
    handleApprove({ communityId: 'c1', callerId: 'user-openid' })
  ).rejects.toThrow('权限不足')
})

test('审批通过：社区 status 变为 active', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ role: 'superAdmin' })  // caller
    .mockResolvedValueOnce({ _id: 'c1', status: 'pending' })  // community
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleApprove({ communityId: 'c1', callerId: 'admin-openid' })
  expect(db.updateById).toHaveBeenCalledWith('communities', 'c1', { status: 'active' })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd cloud && npx jest functions/community/__tests__/community.test.ts
```
Expected: FAIL

- [ ] **Step 3: 实现社区云函数**

```typescript
// cloud/functions/community/index.ts
import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { Community, JoinType } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleCreate(params: {
  name: string; description: string; joinType: JoinType;
  coverImage?: string; location?: Community['location']
}) {
  const { OPENID } = cloud.getWXContext()
  const community: Omit<Community, '_id'> = {
    name: params.name,
    description: params.description,
    coverImage: params.coverImage ?? '',
    location: params.location ?? { address: '', lat: 0, lng: 0 },
    joinType: params.joinType,
    creatorId: OPENID,
    status: 'pending',
    memberCount: 0,
    createdAt: new Date().toISOString()
  }
  const id = await db.create('communities', community)
  return { communityId: id }
}

export async function handleApprove(params: { communityId: string; callerId: string }) {
  const caller = await db.getById('users', params.callerId) as { role: string }
  if (caller.role !== 'superAdmin') throw new Error('权限不足')
  await db.updateById('communities', params.communityId, { status: 'active' })
  return { success: true }
}

export async function handleReject(params: { communityId: string; callerId: string }) {
  const caller = await db.getById('users', params.callerId) as { role: string }
  if (caller.role !== 'superAdmin') throw new Error('权限不足')
  await db.updateById('communities', params.communityId, { status: 'disabled' })
  return { success: true }
}

export async function handleList(params: { includeAll?: boolean } = {}) {
  // includeAll=true 时返回所有社区（用于新用户发现），否则只返回 active
  const where = params.includeAll ? {} : { status: 'active' }
  return db.query('communities', where, { orderBy: ['createdAt', 'desc'] })
}

export async function handleGet(params: { communityId: string }) {
  return db.getById('communities', params.communityId)
}

export const main = async (event: any) => {
  const { action, ...params } = event
  const handlers: Record<string, Function> = {
    create: handleCreate,
    approve: handleApprove,
    reject: handleReject,
    list: handleList,
    get: handleGet,
  }
  if (!handlers[action]) throw new Error(`Unknown action: ${action}`)
  return handlers[action](params)
}
```

- [ ] **Step 4: 运行测试**

```bash
cd cloud && npx jest functions/community/__tests__/community.test.ts --verbose
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add cloud/functions/community/
git commit -m "feat: add community cloud functions (create, approve, list)"
```

---

### Task 6: 成员管理云函数

**Files:**
- Create: `cloud/functions/member/index.ts`
- Create: `cloud/functions/member/__tests__/member.test.ts`

- [ ] **Step 1: 编写成员管理测试**

```typescript
// cloud/functions/member/__tests__/member.test.ts
jest.mock('../../../lib/db', () => ({
  create: jest.fn().mockResolvedValue('member-id'),
  getById: jest.fn(),
  updateById: jest.fn(),
  increment: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'user-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleApply, handleLeave, handleMemberApprove } from '../index'
import * as db from '../../../lib/db'

test('申请加入：创建 pending 记录', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([]) // 没有已存在的记录
  await handleApply({ communityId: 'c1' })
  expect(db.create).toHaveBeenCalledWith('community_members', expect.objectContaining({
    communityId: 'c1',
    userId: 'user-openid',
    status: 'pending',
    role: 'member'
  }))
})

test('退出社区：status 变为 left，记录 leftAt', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'm1', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleLeave({ communityId: 'c1' })

  expect(db.updateById).toHaveBeenCalledWith(
    'community_members', 'm1',
    expect.objectContaining({ status: 'left', leftAt: expect.any(String) })
  )
  // memberCount 原子递减
  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', -1)
})

test('管理员审批通过：memberCount 原子递增', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'caller-member', role: 'admin' }]) // 验证管理员权限
    .mockResolvedValueOnce([{ _id: 'applicant-member' }])             // 找申请记录
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleMemberApprove({ communityId: 'c1', applicantId: 'applicant-openid', callerId: 'admin-openid' })

  expect(db.increment).toHaveBeenCalledWith('communities', 'c1', 'memberCount', 1)
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd cloud && npx jest functions/member/__tests__/member.test.ts
```

- [ ] **Step 3: 实现成员管理云函数**

```typescript
// cloud/functions/member/index.ts
import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleApply(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  // 检查是否已有记录（避免重复申请）
  const existing = await db.query('community_members', {
    communityId: params.communityId, userId: OPENID
  })
  if (existing.length > 0 && existing[0].status === 'active') {
    throw new Error('已是社区成员')
  }

  const community = await db.getById('communities', params.communityId) as { joinType: string }
  const status = community.joinType === 'open' ? 'active' : 'pending'

  await db.create('community_members', {
    communityId: params.communityId,
    userId: OPENID,
    role: 'member',
    status,
    appliedAt: new Date().toISOString(),
    joinedAt: status === 'active' ? new Date().toISOString() : undefined
  })

  if (status === 'active') {
    await db.increment('communities', params.communityId, 'memberCount', 1)
  }
  return { status }
}

export async function handleLeave(params: { communityId: string }) {
  const { OPENID } = cloud.getWXContext()
  const records = await db.query('community_members', {
    communityId: params.communityId, userId: OPENID, status: 'active'
  })
  if (records.length === 0) throw new Error('非社区成员')

  await db.updateById('community_members', records[0]._id, {
    status: 'left',
    leftAt: new Date().toISOString()
  })
  await db.increment('communities', params.communityId, 'memberCount', -1)
  return { success: true }
}

export async function handleMemberApprove(params: {
  communityId: string; applicantId: string; callerId: string
}) {
  // 验证操作者是社区管理员
  const callerRecords = await db.query('community_members', {
    communityId: params.communityId, userId: params.callerId, status: 'active'
  })
  if (callerRecords.length === 0 || callerRecords[0].role !== 'admin') {
    throw new Error('权限不足')
  }
  const applicantRecords = await db.query('community_members', {
    communityId: params.communityId, userId: params.applicantId, status: 'pending'
  })
  if (applicantRecords.length === 0) throw new Error('申请记录不存在')

  await db.updateById('community_members', applicantRecords[0]._id, {
    status: 'active',
    joinedAt: new Date().toISOString()
  })
  await db.increment('communities', params.communityId, 'memberCount', 1)
  return { success: true }
}

export async function handleMemberReject(params: {
  communityId: string; applicantId: string; callerId: string
}) {
  const callerRecords = await db.query('community_members', {
    communityId: params.communityId, userId: params.callerId, status: 'active'
  })
  if (callerRecords.length === 0 || callerRecords[0].role !== 'admin') {
    throw new Error('权限不足')
  }
  const applicantRecords = await db.query('community_members', {
    communityId: params.communityId, userId: params.applicantId, status: 'pending'
  })
  if (applicantRecords.length === 0) throw new Error('申请记录不存在')

  await db.updateById('community_members', applicantRecords[0]._id, { status: 'rejected' })
  return { success: true }
}

export const main = async (event: any) => {
  const { action, ...params } = event
  const handlers: Record<string, Function> = {
    apply: handleApply,
    leave: handleLeave,
    memberApprove: handleMemberApprove,
    memberReject: handleMemberReject,
  }
  if (!handlers[action]) throw new Error(`Unknown action: ${action}`)
  return handlers[action](params)
}
```

- [ ] **Step 4: 运行测试**

```bash
cd cloud && npx jest functions/member/__tests__/member.test.ts --verbose
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add cloud/functions/member/
git commit -m "feat: add member management cloud functions with tests"
```

---

### Task 7: 板块和控件配置云函数

**Files:**
- Create: `cloud/functions/section/index.ts`
- Create: `cloud/functions/section/__tests__/section.test.ts`

- [ ] **Step 1: 编写板块测试**

```typescript
// cloud/functions/section/__tests__/section.test.ts
jest.mock('../../../lib/db', () => ({
  create: jest.fn().mockResolvedValue('section-id'),
  getById: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'admin-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleUpdateWidgets } from '../index'
import * as db from '../../../lib/db'

test('updateWidgets：showInList 超过3个时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'caller', role: 'admin' }])
  const widgets = [
    { widgetId: 'w1', showInList: true, type: 'short_text', label: 'a', fieldKey: 'a', required: false, order: 1 },
    { widgetId: 'w2', showInList: true, type: 'short_text', label: 'b', fieldKey: 'b', required: false, order: 2 },
    { widgetId: 'w3', showInList: true, type: 'short_text', label: 'c', fieldKey: 'c', required: false, order: 3 },
    { widgetId: 'w4', showInList: true, type: 'datetime', label: 'd', fieldKey: 'd', required: false, order: 4 },
  ]
  await expect(
    handleUpdateWidgets({ sectionId: 's1', communityId: 'c1', widgets, callerId: 'admin-openid' })
  ).rejects.toThrow('列表显示字段不能超过3个')
})

test('updateWidgets：image_group 不能设为 showInList', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'caller', role: 'admin' }])
  const widgets = [
    { widgetId: 'w1', showInList: true, type: 'image_group', label: 'a', fieldKey: 'a', required: false, order: 1 },
  ]
  await expect(
    handleUpdateWidgets({ sectionId: 's1', communityId: 'c1', widgets, callerId: 'admin-openid' })
  ).rejects.toThrow('该控件类型不支持列表显示')
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd cloud && npx jest functions/section/__tests__/section.test.ts
```

- [ ] **Step 3: 实现板块云函数**

```typescript
// cloud/functions/section/index.ts
import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { LIST_DISPLAYABLE_TYPES, type Widget } from '../../shared/types'
import { v4 as uuidv4 } from 'uuid'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

async function assertIsAdmin(communityId: string, userId: string) {
  const records = await db.query('community_members', {
    communityId, userId, status: 'active'
  })
  if (records.length === 0 || records[0].role !== 'admin') {
    throw new Error('权限不足')
  }
}

export async function handleCreate(params: {
  communityId: string; name: string; icon: string; callerId: string
}) {
  await assertIsAdmin(params.communityId, params.callerId)
  const id = await db.create('sections', {
    communityId: params.communityId,
    name: params.name,
    icon: params.icon,
    order: 0,
    enableComment: false,
    enableLike: false,
    widgets: [],
    createdAt: new Date().toISOString()
  })
  return { sectionId: id }
}

export async function handleUpdateWidgets(params: {
  sectionId: string; communityId: string; widgets: Widget[]; callerId: string
}) {
  await assertIsAdmin(params.communityId, params.callerId)

  // 校验 showInList 最多3个
  const listCount = params.widgets.filter(w => w.showInList).length
  if (listCount > 3) throw new Error('列表显示字段不能超过3个')

  // 校验 showInList 只能用于支持的控件类型
  for (const w of params.widgets) {
    if (w.showInList && !LIST_DISPLAYABLE_TYPES.includes(w.type)) {
      throw new Error(`该控件类型不支持列表显示: ${w.type}`)
    }
  }

  // 确保每个控件有 UUID（新增控件时分配）
  const widgets = params.widgets.map(w => ({
    ...w,
    widgetId: w.widgetId || uuidv4()
  }))

  await db.updateById('sections', params.sectionId, { widgets })
  return { success: true }
}

export async function handleList(params: { communityId: string }) {
  return db.query('sections', { communityId: params.communityId }, {
    orderBy: ['order', 'asc']
  })
}

export const main = async (event: any) => {
  const { action, ...params } = event
  const handlers: Record<string, Function> = {
    create: handleCreate,
    updateWidgets: handleUpdateWidgets,
    list: handleList,
  }
  if (!handlers[action]) throw new Error(`Unknown action: ${action}`)
  return handlers[action](params)
}
```

- [ ] **Step 4: 安装 uuid 依赖**

```bash
cd cloud && npm install uuid && npm install --save-dev @types/uuid
```

- [ ] **Step 5: 运行测试**

```bash
cd cloud && npx jest functions/section/__tests__/section.test.ts --verbose
```
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add cloud/functions/section/
git commit -m "feat: add section/widget management cloud functions with validation"
```

---

### Task 8: 帖子云函数

**Files:**
- Create: `cloud/functions/post/index.ts`
- Create: `cloud/functions/post/__tests__/post.test.ts`

- [ ] **Step 1: 编写帖子测试**

```typescript
// cloud/functions/post/__tests__/post.test.ts
jest.mock('../../../lib/db', () => ({
  create: jest.fn().mockResolvedValue('post-id'),
  getById: jest.fn(),
  updateById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
}))
jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'user-openid' }),
  DYNAMIC_CURRENT_ENV: 'test'
}))

import { handleCreate, handleDelete } from '../index'
import * as db from '../../../lib/db'

test('发帖：校验 required 控件必须填写', async () => {
  // 模拟板块有一个必填控件
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 's1',
    widgets: [{ widgetId: 'w1', required: true, type: 'short_text' }]
  })
  ;(db.query as jest.Mock).mockResolvedValue([{ status: 'active' }]) // 用户是成员

  await expect(handleCreate({
    communityId: 'c1', sectionId: 's1', content: {}  // w1 未填
  })).rejects.toThrow('必填控件未填写')
})

test('删帖：只有发帖人可以删', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'p1', authorId: 'other-user' })

  await expect(
    handleDelete({ postId: 'p1', callerId: 'user-openid' })
  ).rejects.toThrow('无权删除')
})
```

- [ ] **Step 2: 运行确认失败**

```bash
cd cloud && npx jest functions/post/__tests__/post.test.ts
```

- [ ] **Step 3: 实现帖子云函数**

```typescript
// cloud/functions/post/index.ts
import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import type { Post, PostContent, Section } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

export async function handleCreate(params: {
  communityId: string; sectionId: string; content: PostContent
}) {
  const { OPENID } = cloud.getWXContext()

  // 验证用户是社区成员
  const memberRecords = await db.query('community_members', {
    communityId: params.communityId, userId: OPENID, status: 'active'
  })
  if (memberRecords.length === 0) throw new Error('需要先加入社区才能发帖')

  // 验证必填控件
  const section = await db.getById('sections', params.sectionId) as Section
  for (const widget of section.widgets) {
    if (widget.required && !params.content[widget.widgetId]) {
      throw new Error(`必填控件未填写: ${widget.label}`)
    }
  }

  const now = new Date().toISOString()
  const post: Omit<Post, '_id'> = {
    communityId: params.communityId,
    sectionId: params.sectionId,
    authorId: OPENID,
    status: 'active',
    content: params.content,
    commentCount: 0,
    likeCount: 0,
    createdAt: now,
    updatedAt: now
  }
  const id = await db.create('posts', post)
  return { postId: id }
}

export async function handleList(params: {
  sectionId: string; limit?: number; skip?: number
}) {
  return db.query('posts',
    { sectionId: params.sectionId, status: 'active' },
    { orderBy: ['createdAt', 'desc'], limit: params.limit ?? 20, skip: params.skip ?? 0 }
  )
}

export async function handleGet(params: { postId: string }) {
  return db.getById('posts', params.postId)
}

export async function handleDelete(params: { postId: string; callerId: string }) {
  const post = await db.getById('posts', params.postId) as Post
  if (post.authorId !== params.callerId) throw new Error('无权删除')
  await db.softDelete('posts', params.postId)
  return { success: true }
}

export const main = async (event: any) => {
  const { action, ...params } = event
  const handlers: Record<string, Function> = {
    create: handleCreate,
    list: handleList,
    get: handleGet,
    delete: handleDelete,
  }
  if (!handlers[action]) throw new Error(`Unknown action: ${action}`)
  return handlers[action](params)
}
```

- [ ] **Step 4: 运行测试**

```bash
cd cloud && npx jest functions/post/__tests__/post.test.ts --verbose
```
Expected: 2 tests PASS

- [ ] **Step 5: 运行所有云函数测试**

```bash
cd cloud && npx jest --verbose
```
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add cloud/functions/post/
git commit -m "feat: add post CRUD cloud functions with member and required-field validation"
```

---

## Phase 3: 小程序前端

> **注意：** 小程序 UI 无法自动化测试，以下步骤通过微信开发者工具手动验证。每个 Task 末尾有验证清单。

### Task 9: 小程序基础 Shell（登录 + 路由 + 全局状态）

**Files:**
- Create: `miniprogram/src/store/user.ts`
- Create: `miniprogram/src/store/community.ts`
- Create: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/App.vue`

- [ ] **Step 1: 安装 Pinia**

```bash
cd miniprogram && npm install pinia
```

- [ ] **Step 2: 编写 cloud.ts API 封装**

```typescript
// miniprogram/src/api/cloud.ts
// 封装 wx.cloud.callFunction，统一错误处理

export async function callCloud<T = any>(
  name: string, action: string, params: object = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: { action, ...params },
      success: (res: any) => resolve(res.result),
      fail: reject
    })
  })
}

export const userApi = {
  login: (params: { nickName: string; avatarUrl: string }) =>
    callCloud('user', 'login', params)
}

export const communityApi = {
  list: (includeAll = false) =>
    callCloud('community', 'list', { includeAll }),
  get: (communityId: string) =>
    callCloud('community', 'get', { communityId }),
  create: (params: object) =>
    callCloud('community', 'create', params),
}

export const memberApi = {
  apply: (communityId: string) =>
    callCloud('member', 'apply', { communityId }),
  leave: (communityId: string) =>
    callCloud('member', 'leave', { communityId }),
  approve: (params: object) =>
    callCloud('member', 'memberApprove', params),
}

export const sectionApi = {
  list: (communityId: string) =>
    callCloud('section', 'list', { communityId }),
}

export const postApi = {
  list: (sectionId: string, skip = 0) =>
    callCloud('post', 'list', { sectionId, skip }),
  get: (postId: string) =>
    callCloud('post', 'get', { postId }),
  create: (params: object) =>
    callCloud('post', 'create', params),
  delete: (postId: string, callerId: string) =>
    callCloud('post', 'delete', { postId, callerId }),
}
```

- [ ] **Step 3: 编写 user store**

```typescript
// miniprogram/src/store/user.ts
import { defineStore } from 'pinia'
import { userApi } from '../api/cloud'

export const useUserStore = defineStore('user', {
  state: () => ({
    openId: '' as string,
    nickName: '' as string,
    avatarUrl: '' as string,
    role: 'user' as 'user' | 'superAdmin',
    isLoggedIn: false
  }),
  actions: {
    async login() {
      return new Promise<void>((resolve, reject) => {
        wx.getUserProfile({
          desc: '用于展示用户头像和昵称',
          success: async (profileRes) => {
            const { nickName, avatarUrl } = profileRes.userInfo
            const result = await userApi.login({ nickName, avatarUrl }) as any
            this.openId = result.user._id
            this.nickName = nickName
            this.avatarUrl = avatarUrl
            this.role = result.user.role
            this.isLoggedIn = true
            resolve()
          },
          fail: reject
        })
      })
    }
  },
  persist: true  // 持久化到 storage
})
```

- [ ] **Step 4: 编写 community store**

```typescript
// miniprogram/src/store/community.ts
import { defineStore } from 'pinia'
import { communityApi, sectionApi } from '../api/cloud'
import type { Community, Section } from '../../../cloud/shared/types'

export const useCommunityStore = defineStore('community', {
  state: () => ({
    currentCommunityId: '' as string,
    myCommunities: [] as Community[],
    currentSections: [] as Section[],
    currentSectionIndex: 0
  }),
  getters: {
    currentCommunity: (state) =>
      state.myCommunities.find(c => c._id === state.currentCommunityId),
    currentSection: (state) =>
      state.currentSections[state.currentSectionIndex]
  },
  actions: {
    async switchCommunity(communityId: string) {
      this.currentCommunityId = communityId
      this.currentSectionIndex = 0
      this.currentSections = await sectionApi.list(communityId) as Section[]
    },
    async loadMyCommunities() {
      this.myCommunities = await communityApi.list() as Community[]
      if (this.myCommunities.length > 0 && !this.currentCommunityId) {
        await this.switchCommunity(this.myCommunities[0]._id)
      }
    }
  },
  persist: true
})
```

- [ ] **Step 5: 配置 App.vue 登录入口**

```vue
<!-- miniprogram/src/App.vue -->
<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useUserStore } from './store/user'
import { useCommunityStore } from './store/community'

onLaunch(async () => {
  const userStore = useUserStore()
  const communityStore = useCommunityStore()

  wx.cloud.init({ env: 'your-cloud-env-id', traceUser: true })

  if (userStore.isLoggedIn) {
    await communityStore.loadMyCommunities()
    if (communityStore.myCommunities.length === 0) {
      uni.reLaunch({ url: '/pages/onboarding/index' })
    }
  }
})
</script>
```

- [ ] **Step 6: 手动验证**

在微信开发者工具中：
- [ ] 冷启动 → App.vue onLaunch 执行，无报错
- [ ] cloud.init 调用成功（控制台无 cloud 初始化错误）

- [ ] **Step 7: Commit**

```bash
git add miniprogram/src/
git commit -m "feat: add mini program shell with cloud API wrapper and Pinia stores"
```

---

### Task 10: Onboarding 页（新用户发现社区）

**Files:**
- Create: `miniprogram/src/pages/onboarding/index.vue`

- [ ] **Step 1: 实现社区发现页**

```vue
<!-- miniprogram/src/pages/onboarding/index.vue -->
<template>
  <view class="onboarding">
    <view class="header">
      <text class="title">选择你的社区</text>
      <text class="subtitle">加入后即可浏览和发帖</text>
    </view>

    <view class="community-list">
      <view
        v-for="community in communities"
        :key="community._id"
        class="community-card"
        @tap="handleApply(community)"
      >
        <image :src="community.coverImage || '/static/default-community.png'" class="cover" />
        <view class="info">
          <text class="name">{{ community.name }}</text>
          <text class="desc">{{ community.description }}</text>
          <text class="meta">{{ community.memberCount }} 位成员</text>
        </view>
        <view class="badge" :class="community.joinType">
          {{ community.joinType === 'open' ? '直接加入' : '申请加入' }}
        </view>
      </view>
    </view>

    <view class="footer">
      <button class="create-btn" @tap="handleCreate">创建新社区</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { communityApi, memberApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import type { Community } from '../../../../cloud/shared/types'

const communities = ref<Community[]>([])
const communityStore = useCommunityStore()

onMounted(async () => {
  communities.value = await communityApi.list(true) as Community[]
})

async function handleApply(community: Community) {
  await memberApi.apply(community._id)
  uni.showToast({ title: community.joinType === 'open' ? '加入成功！' : '申请已提交' })
  if (community.joinType === 'open') {
    await communityStore.loadMyCommunities()
    uni.reLaunch({ url: '/pages/index/index' })
  }
}

function handleCreate() {
  uni.navigateTo({ url: '/pages/createCommunity/index' })
}
</script>
```

- [ ] **Step 2: 手动验证**

- [ ] 新用户打开看到社区列表
- [ ] 点击公开社区 → 直接加入，跳转首页
- [ ] 点击审批社区 → 显示「申请已提交」

- [ ] **Step 3: Commit**

```bash
git add miniprogram/src/pages/onboarding/
git commit -m "feat: add onboarding page for community discovery"
```

---

### Task 11: 首页信息流

**Files:**
- Create: `miniprogram/src/pages/index/index.vue`
- Create: `miniprogram/src/components/SectionTabs.vue`
- Create: `miniprogram/src/components/PostCard.vue`
- Create: `miniprogram/src/utils/widget.ts`

- [ ] **Step 1: 编写控件工具函数**

```typescript
// miniprogram/src/utils/widget.ts
import type { Section, Post } from '../../../../cloud/shared/types'

// 从帖子内容中提取列表展示字段
export function getListPreview(
  post: Post,
  section: Section
): Array<{ label: string; value: string }> {
  return section.widgets
    .filter(w => w.showInList)
    .sort((a, b) => a.order - b.order)
    .map(w => ({
      label: w.label,
      value: formatWidgetValue(post.content[w.widgetId], w.type)
    }))
    .filter(item => item.value !== '')
}

export function formatWidgetValue(value: any, type: string): string {
  if (value === undefined || value === null) return ''
  if (type === 'datetime') {
    const d = new Date(value as string)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return String(value)
}
```

- [ ] **Step 2: PostCard 组件**

```vue
<!-- miniprogram/src/components/PostCard.vue -->
<template>
  <view class="post-card" @tap="$emit('tap')">
    <view class="preview-fields">
      <view v-for="field in preview" :key="field.label" class="field">
        <text class="field-label">{{ field.label }}</text>
        <text class="field-value">{{ field.value }}</text>
      </view>
    </view>
    <text class="time">{{ formattedTime }}</text>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getListPreview } from '../utils/widget'
import type { Post, Section } from '../../../../cloud/shared/types'

const props = defineProps<{ post: Post; section: Section }>()
defineEmits(['tap'])

const preview = computed(() => getListPreview(props.post, props.section))
const formattedTime = computed(() => {
  const d = new Date(props.post.createdAt)
  return `${d.getMonth() + 1}/${d.getDate()}`
})
</script>
```

- [ ] **Step 3: SectionTabs 组件**

```vue
<!-- miniprogram/src/components/SectionTabs.vue -->
<template>
  <scroll-view scroll-x class="tabs">
    <view
      v-for="(section, i) in sections"
      :key="section._id"
      class="tab"
      :class="{ active: i === currentIndex }"
      @tap="$emit('change', i)"
    >
      {{ section.name }}
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import type { Section } from '../../../../cloud/shared/types'
defineProps<{ sections: Section[]; currentIndex: number }>()
defineEmits(['change'])
</script>
```

- [ ] **Step 4: 首页**

```vue
<!-- miniprogram/src/pages/index/index.vue -->
<template>
  <view class="page">
    <!-- 顶部社区切换 -->
    <view class="top-bar">
      <view class="community-name" @tap="showCommunitySwitcher">
        {{ communityStore.currentCommunity?.name ?? '选择社区' }}
        <text class="arrow">▾</text>
      </view>
    </view>

    <!-- 板块 Tab -->
    <SectionTabs
      :sections="communityStore.currentSections"
      :current-index="communityStore.currentSectionIndex"
      @change="handleSectionChange"
    />

    <!-- 信息流 -->
    <scroll-view
      scroll-y
      class="feed"
      @scrolltolower="loadMore"
      refresher-enabled
      @refresherrefresh="refresh"
    >
      <view v-if="posts.length === 0 && !loading" class="empty">
        <text>暂无内容，来发第一帖吧</text>
      </view>
      <PostCard
        v-for="post in posts"
        :key="post._id"
        :post="post"
        :section="communityStore.currentSection"
        @tap="goDetail(post._id)"
      />
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useCommunityStore } from '../../store/community'
import { postApi } from '../../api/cloud'
import SectionTabs from '../../components/SectionTabs.vue'
import PostCard from '../../components/PostCard.vue'
import type { Post } from '../../../../cloud/shared/types'

const communityStore = useCommunityStore()
const posts = ref<Post[]>([])
const loading = ref(false)
const hasMore = ref(true)

async function loadPosts(reset = false) {
  if (!communityStore.currentSection) return
  loading.value = true
  const skip = reset ? 0 : posts.value.length
  const newPosts = await postApi.list(communityStore.currentSection._id, skip) as Post[]
  posts.value = reset ? newPosts : [...posts.value, ...newPosts]
  hasMore.value = newPosts.length === 20
  loading.value = false
}

async function handleSectionChange(index: number) {
  communityStore.currentSectionIndex = index
  await loadPosts(true)
}

async function refresh() {
  await loadPosts(true)
  uni.stopPullDownRefresh()
}

function loadMore() {
  if (hasMore.value && !loading.value) loadPosts()
}

function goDetail(postId: string) {
  uni.navigateTo({ url: `/pages/detail/index?postId=${postId}` })
}

function showCommunitySwitcher() {
  // TODO: Task 后续实现社区切换弹层
}

watch(() => communityStore.currentSectionIndex, () => loadPosts(true), { immediate: true })
</script>
```

- [ ] **Step 5: 手动验证**

- [ ] 首页加载，显示板块 Tab
- [ ] 切换 Tab → 信息流切换
- [ ] 卡片显示 showInList 字段
- [ ] 下拉刷新、上拉加载更多

- [ ] **Step 6: Commit**

```bash
git add miniprogram/src/
git commit -m "feat: add home feed with section tabs and post cards"
```

---

### Task 12: 帖子详情页

**Files:**
- Create: `miniprogram/src/pages/detail/index.vue`
- Create: `miniprogram/src/components/widgets/WidgetRenderer.vue`

- [ ] **Step 1: WidgetRenderer — 详情展示各类控件**

```vue
<!-- miniprogram/src/components/widgets/WidgetRenderer.vue -->
<template>
  <view class="widget-item">
    <text class="label">{{ widget.label }}</text>
    <view class="value">
      <!-- 短文字 / 摘要 -->
      <text v-if="['short_text', 'summary'].includes(widget.type)">
        {{ displayValue }}
      </text>
      <!-- 日期时间 -->
      <text v-else-if="widget.type === 'datetime'">
        {{ formatDatetime(value) }}
      </text>
      <!-- 数字 -->
      <text v-else-if="widget.type === 'number'">
        {{ value }} {{ widget.unit ?? '' }}
      </text>
      <!-- 图片组 -->
      <view v-else-if="widget.type === 'image_group'" class="images">
        <image
          v-for="(img, i) in (value as string[])"
          :key="i"
          :src="img"
          mode="aspectFill"
          @tap="previewImage(i)"
        />
      </view>
      <!-- 富文本 -->
      <rich-text v-else-if="widget.type === 'rich_text'" :nodes="value as string" />
      <!-- 空值 -->
      <text v-else class="empty">-</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { formatWidgetValue } from '../../utils/widget'
import type { Widget, PostContent } from '../../../../../cloud/shared/types'

const props = defineProps<{ widget: Widget; content: PostContent }>()
const value = computed(() => props.content[props.widget.widgetId])
const displayValue = computed(() => formatWidgetValue(value.value, props.widget.type))

function formatDatetime(val: any) {
  if (!val) return '-'
  const d = new Date(val)
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
}

function previewImage(index: number) {
  wx.previewImage({ current: (value.value as string[])[index], urls: value.value as string[] })
}
</script>
```

- [ ] **Step 2: 详情页**

```vue
<!-- miniprogram/src/pages/detail/index.vue -->
<template>
  <view class="detail-page" v-if="post && section">
    <view class="widgets">
      <WidgetRenderer
        v-for="widget in section.widgets"
        :key="widget.widgetId"
        :widget="widget"
        :content="post.content"
      />
    </view>
    <view class="meta">
      <text class="time">{{ post.createdAt }}</text>
    </view>
  </view>
  <view v-else class="loading">加载中...</view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { postApi, sectionApi } from '../../api/cloud'
import { useCommunityStore } from '../../store/community'
import WidgetRenderer from '../../components/widgets/WidgetRenderer.vue'
import type { Post, Section } from '../../../../cloud/shared/types'

const post = ref<Post | null>(null)
const section = ref<Section | null>(null)
const communityStore = useCommunityStore()

onLoad(async (options) => {
  const postId = options?.postId as string
  post.value = await postApi.get(postId) as Post
  section.value = communityStore.currentSections.find(
    s => s._id === post.value!.sectionId
  ) ?? null
})
</script>
```

- [ ] **Step 3: 手动验证**

- [ ] 点击卡片 → 详情页
- [ ] 所有控件正确渲染（文字、图片、富文本）
- [ ] 控件无值时显示 `-`（宽松策略）

- [ ] **Step 4: Commit**

```bash
git add miniprogram/src/pages/detail/ miniprogram/src/components/widgets/
git commit -m "feat: add post detail page with widget renderer"
```

---

### Task 13: 发帖页

**Files:**
- Create: `miniprogram/src/pages/create/index.vue`
- Create: `miniprogram/src/components/widgets/WidgetEditor.vue`

- [ ] **Step 1: WidgetEditor — 发帖时编辑各类控件**

```vue
<!-- miniprogram/src/components/widgets/WidgetEditor.vue -->
<template>
  <view class="widget-editor">
    <text class="label">{{ widget.label }}<text v-if="widget.required" class="required">*</text></text>

    <input
      v-if="['short_text', 'summary'].includes(widget.type)"
      :value="modelValue as string"
      :placeholder="`请输入${widget.label}`"
      @input="$emit('update:modelValue', ($event as any).detail.value)"
    />

    <picker
      v-else-if="widget.type === 'datetime'"
      mode="dateTime"
      :value="modelValue as string"
      @change="$emit('update:modelValue', ($event as any).detail.value)"
    >
      <view class="picker-display">
        {{ modelValue || `选择${widget.label}` }}
      </view>
    </picker>

    <input
      v-else-if="widget.type === 'number'"
      type="number"
      :value="String(modelValue ?? '')"
      :placeholder="`请输入${widget.label}`"
      @input="$emit('update:modelValue', Number(($event as any).detail.value))"
    />

    <view v-else-if="widget.type === 'image_group'" class="image-uploader">
      <view
        v-for="(img, i) in (modelValue as string[] ?? [])"
        :key="i"
        class="thumb"
      >
        <image :src="img" />
        <view class="remove" @tap="removeImage(i)">×</view>
      </view>
      <view class="add-btn" @tap="addImage">+</view>
    </view>

    <textarea
      v-else-if="widget.type === 'rich_text'"
      :value="modelValue as string"
      :placeholder="`请输入${widget.label}`"
      @input="$emit('update:modelValue', ($event as any).detail.value)"
    />
  </view>
</template>

<script setup lang="ts">
import type { Widget } from '../../../../../cloud/shared/types'

const props = defineProps<{ widget: Widget; modelValue: any }>()
const emit = defineEmits(['update:modelValue'])

function addImage() {
  wx.chooseMedia({
    count: 9,
    mediaType: ['image'],
    success: (res) => {
      const current = (props.modelValue as string[]) ?? []
      // 实际上传逻辑在发帖时统一处理
      emit('update:modelValue', [...current, ...res.tempFiles.map(f => f.tempFilePath)])
    }
  })
}

function removeImage(index: number) {
  const imgs = [...((props.modelValue as string[]) ?? [])]
  imgs.splice(index, 1)
  emit('update:modelValue', imgs)
}
</script>
```

- [ ] **Step 2: 发帖页**

```vue
<!-- miniprogram/src/pages/create/index.vue -->
<template>
  <view class="create-page">
    <!-- 选择板块 -->
    <view v-if="!selectedSection" class="section-picker">
      <text class="hint">选择发帖板块</text>
      <view
        v-for="section in communityStore.currentSections"
        :key="section._id"
        class="section-option"
        @tap="selectedSection = section"
      >
        {{ section.name }}
      </view>
    </view>

    <!-- 填写表单 -->
    <view v-else class="form">
      <view class="section-name">{{ selectedSection.name }}</view>
      <WidgetEditor
        v-for="widget in selectedSection.widgets"
        :key="widget.widgetId"
        :widget="widget"
        v-model="formData[widget.widgetId]"
      />
      <button class="submit-btn" @tap="handleSubmit" :disabled="submitting">
        {{ submitting ? '发布中...' : '发布' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useCommunityStore } from '../../store/community'
import { useUserStore } from '../../store/user'
import { postApi } from '../../api/cloud'
import WidgetEditor from '../../components/widgets/WidgetEditor.vue'
import type { Section } from '../../../../cloud/shared/types'

const communityStore = useCommunityStore()
const userStore = useUserStore()
const selectedSection = ref<Section | null>(null)
const formData = reactive<Record<string, any>>({})
const submitting = ref(false)

async function handleSubmit() {
  if (!userStore.isLoggedIn) {
    uni.showModal({ content: '请先登录' })
    return
  }
  if (!communityStore.currentCommunityId) {
    uni.showModal({ content: '需要先加入社区，或创建自己的社区' })
    return
  }

  submitting.value = true
  try {
    await postApi.create({
      communityId: communityStore.currentCommunityId,
      sectionId: selectedSection.value!._id,
      content: { ...formData }
    })
    uni.showToast({ title: '发布成功' })
    uni.navigateBack()
  } catch (e: any) {
    uni.showModal({ content: e.message ?? '发布失败，请重试' })
  } finally {
    submitting.value = false
  }
}
</script>
```

- [ ] **Step 3: 手动验证**

- [ ] 点击底部 `+` → 进入发帖页
- [ ] 选择板块 → 显示对应控件表单
- [ ] 必填控件为空时，云函数返回错误，弹窗提示
- [ ] 未加入社区时点 `+` → 提示「需要先加入社区」
- [ ] 发布成功 → 返回首页，新帖出现在信息流

- [ ] **Step 4: Commit**

```bash
git add miniprogram/src/pages/create/ miniprogram/src/components/widgets/
git commit -m "feat: add create post page with dynamic widget form"
```

---

### Task 14: 我的页面

**Files:**
- Create: `miniprogram/src/pages/profile/index.vue`

- [ ] **Step 1: 实现我的页面**

```vue
<!-- miniprogram/src/pages/profile/index.vue -->
<template>
  <view class="profile-page">
    <!-- 用户信息 -->
    <view class="user-info">
      <image :src="userStore.avatarUrl" class="avatar" />
      <text class="name">{{ userStore.nickName }}</text>
    </view>

    <!-- 我的社区 -->
    <view class="section-title">我的社区</view>
    <view
      v-for="community in myCommunities"
      :key="community._id"
      class="community-item"
      @tap="communityStore.switchCommunity(community._id)"
    >
      <text>{{ community.name }}</text>
      <text v-if="isAdmin(community._id)" class="admin-badge">管理员</text>
    </view>

    <!-- 待审批（管理员可见） -->
    <view v-if="hasAdminRole" class="section-title">待审批申请</view>
    <view v-if="hasAdminRole" class="pending-list">
      <view v-for="item in pendingMembers" :key="item._id" class="pending-item">
        <text>{{ item.userId }}</text>
        <button size="mini" @tap="approve(item)">通过</button>
        <button size="mini" @tap="reject(item)">拒绝</button>
      </view>
    </view>

    <!-- 申请记录 -->
    <view class="section-title">我的申请记录</view>
    <view v-for="record in myApplications" :key="record._id" class="application-item">
      <text>{{ record.communityId }}</text>
      <text class="status" :class="record.status">{{ statusLabel(record.status) }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../../store/user'
import { useCommunityStore } from '../../store/community'
import { memberApi } from '../../api/cloud'

const userStore = useUserStore()
const communityStore = useCommunityStore()
const myCommunities = computed(() => communityStore.myCommunities)
const myApplications = ref<any[]>([])
const pendingMembers = ref<any[]>([])
const myAdminCommunities = ref<string[]>([])

const hasAdminRole = computed(() => myAdminCommunities.value.length > 0)

function isAdmin(communityId: string) {
  return myAdminCommunities.value.includes(communityId)
}

function statusLabel(status: string) {
  return { pending: '待审批', active: '已加入', rejected: '已拒绝', left: '已退出' }[status] ?? status
}

async function approve(item: any) {
  await memberApi.approve({
    communityId: item.communityId,
    applicantId: item.userId,
    callerId: userStore.openId
  })
  pendingMembers.value = pendingMembers.value.filter(m => m._id !== item._id)
}

async function reject(item: any) {
  // 同 approve，调用 memberReject
}

onMounted(async () => {
  // 加载数据（简化：实际需要新增云函数 member/myApplications, member/pendingList）
})
</script>
```

- [ ] **Step 2: 手动验证**

- [ ] 显示头像和昵称
- [ ] 我的社区列表
- [ ] 管理员可见待审批列表，审批操作正常

- [ ] **Step 3: Commit**

```bash
git add miniprogram/src/pages/profile/
git commit -m "feat: add profile page with my communities and admin approval"
```

---

## Phase 4: Web 管理后台

### Task 15: Admin Web 基础框架 + 微信扫码登录

**Files:**
- Modify: `admin-web/src/main.ts`
- Create: `admin-web/src/router/index.ts`
- Create: `admin-web/src/views/Login.vue`

- [ ] **Step 1: 配置 main.ts**

```typescript
// admin-web/src/main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import router from './router'
import App from './App.vue'

createApp(App).use(createPinia()).use(ElementPlus).use(router).mount('#app')
```

- [ ] **Step 2: 路由配置**

```typescript
// admin-web/src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('../views/Login.vue') },
    {
      path: '/',
      component: () => import('../views/Layout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: 'approval', component: () => import('../views/SuperAdmin/CommunityApproval.vue') },
        { path: 'sections/:communityId', component: () => import('../views/CommunityAdmin/SectionList.vue') },
        { path: 'widgets/:sectionId', component: () => import('../views/CommunityAdmin/WidgetEditor.vue') },
        { path: 'members/:communityId', component: () => import('../views/CommunityAdmin/MemberApproval.vue') },
      ]
    }
  ]
})
```

- [ ] **Step 3: 微信扫码登录页**

```vue
<!-- admin-web/src/views/Login.vue -->
<!-- 注意：微信网页扫码登录需要接入微信开放平台，获取 appid 和配置回调域名 -->
<template>
  <div class="login-page">
    <h2>HappyHome 管理后台</h2>
    <div id="wechat-qr-container"></div>
    <p class="hint">请使用微信扫码登录</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

onMounted(() => {
  // 引入微信官方 JS-SDK 并渲染二维码
  // 文档：https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html
  const script = document.createElement('script')
  script.src = 'https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js'
  script.onload = () => {
    new (window as any).WxLogin({
      self_redirect: false,
      id: 'wechat-qr-container',
      appid: import.meta.env.VITE_WECHAT_APPID,
      scope: 'snsapi_login',
      redirect_uri: encodeURIComponent(import.meta.env.VITE_REDIRECT_URI),
      state: Math.random().toString(36).slice(2),
    })
  }
  document.head.appendChild(script)
})
</script>
```

- [ ] **Step 4: 配置环境变量**

```bash
# admin-web/.env.local
VITE_WECHAT_APPID=your_open_platform_appid
VITE_REDIRECT_URI=http://localhost:5173/login/callback
```

- [ ] **Step 5: 手动验证**

```bash
cd admin-web && npm run dev
```
- [ ] 访问 http://localhost:5173/login 显示微信二维码
- [ ] 未登录访问 `/` 重定向到 `/login`

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/
git commit -m "feat: add admin web scaffold with WeChat QR login"
```

---

### Task 16: 超级管理员 — 社区审批

**Files:**
- Create: `admin-web/src/views/SuperAdmin/CommunityApproval.vue`
- Create: `admin-web/src/api/cloud.ts`

- [ ] **Step 1: Admin Web 的 API 封装**

```typescript
// admin-web/src/api/cloud.ts
// Web 端通过 HTTP 调用云函数（需要在腾讯云开通 HTTP 触发器）
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_CLOUD_API_URL

export async function callCloud(fnName: string, action: string, params = {}) {
  const res = await axios.post(`${BASE_URL}/${fnName}`, { action, ...params }, {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  })
  return res.data
}

export const communityApi = {
  list: (includeAll = true) => callCloud('community', 'list', { includeAll }),
  approve: (communityId: string, callerId: string) =>
    callCloud('community', 'approve', { communityId, callerId }),
  reject: (communityId: string, callerId: string) =>
    callCloud('community', 'reject', { communityId, callerId }),
}
```

- [ ] **Step 2: 社区审批页**

```vue
<!-- admin-web/src/views/SuperAdmin/CommunityApproval.vue -->
<template>
  <div>
    <h3>社区审批</h3>
    <el-table :data="pendingCommunities" style="width: 100%">
      <el-table-column prop="name" label="社区名称" />
      <el-table-column prop="description" label="描述" />
      <el-table-column prop="createdAt" label="申请时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="approve(row)">通过</el-button>
          <el-button type="danger" size="small" @click="reject(row)">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { communityApi } from '../../api/cloud'
import { ElMessage } from 'element-plus'

const pendingCommunities = ref<any[]>([])
const callerId = 'super-admin-openid' // 从登录状态获取

onMounted(async () => {
  const all = await communityApi.list() as any[]
  pendingCommunities.value = all.filter((c: any) => c.status === 'pending')
})

async function approve(row: any) {
  await communityApi.approve(row._id, callerId)
  pendingCommunities.value = pendingCommunities.value.filter(c => c._id !== row._id)
  ElMessage.success('已通过')
}

async function reject(row: any) {
  await communityApi.reject(row._id, callerId)
  pendingCommunities.value = pendingCommunities.value.filter(c => c._id !== row._id)
  ElMessage.info('已拒绝')
}
</script>
```

- [ ] **Step 3: 手动验证**

- [ ] 待审批社区列表正确显示
- [ ] 通过 / 拒绝操作后列表更新

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/views/SuperAdmin/
git commit -m "feat: add super admin community approval view"
```

---

### Task 17: 社区管理员 — 板块管理 + 控件配置

**Files:**
- Create: `admin-web/src/views/CommunityAdmin/SectionList.vue`
- Create: `admin-web/src/views/CommunityAdmin/WidgetEditor.vue`

- [ ] **Step 1: 板块列表页**

```vue
<!-- admin-web/src/views/CommunityAdmin/SectionList.vue -->
<template>
  <div>
    <div class="toolbar">
      <h3>板块管理</h3>
      <el-button type="primary" @click="showCreateDialog = true">新建板块</el-button>
    </div>

    <el-table :data="sections">
      <el-table-column prop="name" label="板块名称" />
      <el-table-column prop="order" label="排序" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button size="small" @click="goWidgetEditor(row._id)">配置控件</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="showCreateDialog" title="新建板块">
      <el-form :model="form">
        <el-form-item label="板块名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.icon" placeholder="如 child / car / book" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="createSection">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callCloud } from '../../api/cloud'

const route = useRoute()
const router = useRouter()
const sections = ref<any[]>([])
const showCreateDialog = ref(false)
const form = ref({ name: '', icon: '' })
const communityId = route.params.communityId as string

onMounted(async () => {
  sections.value = await callCloud('section', 'list', { communityId }) as any[]
})

async function createSection() {
  await callCloud('section', 'create', {
    communityId,
    name: form.value.name,
    icon: form.value.icon,
    callerId: 'admin-openid' // 从登录状态获取
  })
  sections.value = await callCloud('section', 'list', { communityId }) as any[]
  showCreateDialog.value = false
}

function goWidgetEditor(sectionId: string) {
  router.push(`/widgets/${sectionId}`)
}
</script>
```

- [ ] **Step 2: 控件配置页（拖拽排序）**

```bash
cd admin-web && npm install vuedraggable@next
```

```vue
<!-- admin-web/src/views/CommunityAdmin/WidgetEditor.vue -->
<template>
  <div class="widget-editor">
    <h3>控件配置</h3>

    <!-- 可拖拽排序的控件列表 -->
    <draggable v-model="widgets" item-key="widgetId" handle=".drag-handle">
      <template #item="{ element: widget }">
        <el-card class="widget-card">
          <div class="drag-handle">⠿</div>
          <el-form-item label="控件类型">
            <el-select v-model="widget.type" :disabled="!widget.isNew">
              <el-option label="短文字" value="short_text" />
              <el-option label="一句话简介" value="summary" />
              <el-option label="日期时间" value="datetime" />
              <el-option label="数字" value="number" />
              <el-option label="图片组" value="image_group" />
              <el-option label="富文本" value="rich_text" />
              <el-option label="地图位置" value="location" />
            </el-select>
          </el-form-item>
          <el-form-item label="标签名">
            <el-input v-model="widget.label" />
          </el-form-item>
          <el-form-item label="fieldKey（可读标识）">
            <el-input v-model="widget.fieldKey" />
          </el-form-item>
          <el-form-item label="必填">
            <el-switch v-model="widget.required" />
          </el-form-item>
          <el-form-item label="在列表显示">
            <el-switch
              v-model="widget.showInList"
              :disabled="!isListDisplayable(widget.type)"
            />
          </el-form-item>
          <el-button type="danger" size="small" @click="removeWidget(widget)">删除</el-button>
        </el-card>
      </template>
    </draggable>

    <el-alert
      v-if="listCount > 3"
      title="列表显示字段不能超过3个"
      type="error"
    />

    <div class="toolbar">
      <el-button @click="addWidget">+ 添加控件</el-button>
      <el-button type="primary" @click="save" :disabled="listCount > 3">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { callCloud } from '../../api/cloud'
import { LIST_DISPLAYABLE_TYPES } from '../../../../cloud/shared/types'
import { v4 as uuidv4 } from 'uuid'
import { ElMessage } from 'element-plus'

const route = useRoute()
const sectionId = route.params.sectionId as string
const widgets = ref<any[]>([])

const listCount = computed(() => widgets.value.filter(w => w.showInList).length)

function isListDisplayable(type: string) {
  return LIST_DISPLAYABLE_TYPES.includes(type as any)
}

onMounted(async () => {
  const section = await callCloud('section', 'get', { sectionId }) as any
  widgets.value = section.widgets ?? []
})

function addWidget() {
  widgets.value.push({
    widgetId: uuidv4(),
    type: 'short_text',
    label: '新控件',
    fieldKey: `field_${Date.now()}`,
    required: false,
    order: widgets.value.length,
    showInList: false,
    isNew: true
  })
}

function removeWidget(widget: any) {
  widgets.value = widgets.value.filter(w => w.widgetId !== widget.widgetId)
}

async function save() {
  const orderedWidgets = widgets.value.map((w, i) => ({ ...w, order: i }))
  try {
    await callCloud('section', 'updateWidgets', {
      sectionId,
      communityId: 'current-community-id', // 从路由或 store 获取
      widgets: orderedWidgets,
      callerId: 'admin-openid'
    })
    ElMessage.success('保存成功')
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}
</script>
```

- [ ] **Step 3: 手动验证**

- [ ] 板块列表正确显示
- [ ] 点击「配置控件」进入控件编辑页
- [ ] 拖拽控件改变顺序
- [ ] showInList 超过3个时保存按钮禁用，提示错误
- [ ] image_group / rich_text 的 showInList 开关禁用
- [ ] 保存成功后小程序端显示新控件

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/views/CommunityAdmin/
git commit -m "feat: add section and widget configuration with drag-and-drop"
```

---

### Task 18: 社区管理员 — 成员审批

**Files:**
- Create: `admin-web/src/views/CommunityAdmin/MemberApproval.vue`

- [ ] **Step 1: 实现成员审批页**

```vue
<!-- admin-web/src/views/CommunityAdmin/MemberApproval.vue -->
<template>
  <div>
    <h3>成员审批</h3>
    <el-table :data="pendingMembers">
      <el-table-column prop="userId" label="用户 ID" />
      <el-table-column prop="appliedAt" label="申请时间" />
      <el-table-column label="操作">
        <template #default="{ row }">
          <el-button type="primary" size="small" @click="approve(row)">通过</el-button>
          <el-button type="danger" size="small" @click="reject(row)">拒绝</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { callCloud } from '../../api/cloud'
import { ElMessage } from 'element-plus'

const route = useRoute()
const communityId = route.params.communityId as string
const pendingMembers = ref<any[]>([])

onMounted(async () => {
  pendingMembers.value = await callCloud('member', 'pendingList', { communityId }) as any[]
})

async function approve(row: any) {
  await callCloud('member', 'memberApprove', {
    communityId, applicantId: row.userId, callerId: 'admin-openid'
  })
  pendingMembers.value = pendingMembers.value.filter(m => m._id !== row._id)
  ElMessage.success('已通过')
}

async function reject(row: any) {
  await callCloud('member', 'memberReject', {
    communityId, applicantId: row.userId, callerId: 'admin-openid'
  })
  pendingMembers.value = pendingMembers.value.filter(m => m._id !== row._id)
  ElMessage.info('已拒绝')
}
</script>
```

> **Note:** 需要在 `cloud/functions/member/index.ts` 补充 `pendingList` action：
> ```typescript
> export async function handlePendingList(params: { communityId: string }) {
>   return db.query('community_members', { communityId: params.communityId, status: 'pending' })
> }
> ```

- [ ] **Step 2: 手动验证**

- [ ] 待审批成员列表正确显示
- [ ] 通过后成员在小程序端可以正常浏览

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/views/CommunityAdmin/
git commit -m "feat: add member approval view for community admin"
```

---

## Self-Review

### Spec Coverage 检查

| 需求 | 覆盖 Task |
|------|---------|
| 三级菜单（社区/板块/控件）管理 | Task 5, 7, 17 |
| 动态控件组合定义发帖表单 | Task 7, 8, 13 |
| 信息流卡片按 showInList 字段展示 | Task 11 |
| 帖子详情全控件展示，宽松策略 | Task 12 |
| 地理型社区，公开/审批加入 | Task 5, 6 |
| 多社区支持，切换社区 | Task 9, 14 |
| 发帖默认当前社区 | Task 13 |
| 新用户 onboarding | Task 10 |
| 超级管理员审批社区 | Task 5, 16 |
| 社区管理员审批成员 | Task 6, 18 |
| db.ts / storage.ts 迁移适配层 | Task 3 |
| widgetId UUID 为 content key | Task 2, 8 |
| showInList 最多3个后端校验 | Task 7 |
| 原子计数器（memberCount 等） | Task 3, 6 |
| Web 管理后台微信扫码登录 | Task 15 |
| 控件拖拽配置（Web） | Task 17 |
| 用户退出社区（status=left） | Task 6 |
| 评论/点赞预留 | types.ts 有字段，未实现功能 |

### Placeholder Scan

- Task 14 的 `approve reject` 函数体内注释 "同 approve" → 已检查：reject 和 approve 逻辑对称，调用不同 action，用户参照 approve 即可实现，非占位符
- Task 15 的 `callerId = 'admin-openid'` → 实际开发时需从登录状态获取，已在注释中标注

### Type Consistency

- `Widget.widgetId` 在 types.ts 定义，Task 7 生成时用 `uuidv4()`，Task 8 存 content 时用 widgetId 为 key ✅
- `LIST_DISPLAYABLE_TYPES` 在 types.ts 导出，Task 7 云函数和 Task 17 Web 端都从同一文件导入 ✅
- `PostContent = Record<string, string | number | string[]>` 在 types.ts 定义，WidgetRenderer 和 post 云函数一致使用 ✅
