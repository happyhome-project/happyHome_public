#!/usr/bin/env node
/**
 * scripts/ensure-indexes.mjs
 *
 * 一次性脚本：给 CloudBase 数据库创建业务需要的索引（幂等，重复跑无副作用）。
 *
 * 背景：admin.community.list / community.listDisabled 等查询按 status 过滤；
 *       hardDelete 级联会扫 posts/sections/community_members 按 communityId。
 *       不建索引时这些查询走全表扫，社区数量上去后性能会塌。
 *
 * 用法（推荐）：
 *   npm run ensure:indexes
 *   —— 自动从 ~/.happyhome/cam.env 加载 CAM 密钥
 *
 * 用法（env override）：
 *   TENCENTCLOUD_SECRETID=xxx TENCENTCLOUD_SECRETKEY=yyy npm run ensure:indexes
 *
 * 腾讯云 CAM 密钥获取：https://console.cloud.tencent.com/cam/capi
 * 需要的权限：CloudBase 数据库管理（QcloudTCBFullAccess 或更细粒度的 DB 索引管理权限）。
 *
 * 密钥存储约定：
 *   文件：~/.happyhome/cam.env （仓库外，绝不会被 git 追踪）
 *   格式：每行一个 KEY=VALUE，# 开头为注释
 */
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const out = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const CAM_ENV_FILE = path.join(os.homedir(), '.happyhome', 'cam.env')
const fileEnv = loadDotEnvFile(CAM_ENV_FILE)

const ENV_ID = process.env.TCB_ENV || fileEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const SECRET_ID = process.env.TENCENTCLOUD_SECRETID || fileEnv.TENCENTCLOUD_SECRETID
const SECRET_KEY = process.env.TENCENTCLOUD_SECRETKEY || fileEnv.TENCENTCLOUD_SECRETKEY

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[ensure-indexes] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  console.error(`  Expected file: ${CAM_ENV_FILE}`)
  console.error('  Or pass via env vars directly.')
  console.error('  Get your CAM keys: https://console.cloud.tencent.com/cam/capi')
  process.exit(1)
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })
const db = app.database

/**
 * 要维护的索引清单
 * Direction: '1' 升序 / '-1' 降序
 */
const INDEXES = [
  // communities: admin.community.list 过滤 status，按 createdAt 倒序
  {
    coll: 'communities',
    name: 'idx_status_createdAt',
    keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'createdAt', Direction: '-1' },
    ],
  },
  // community_members: 审批/权限校验大量按 communityId + status 查
  {
    coll: 'community_members',
    name: 'idx_communityId_status',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  // community_members: 发帖/加入前校验按 userId + status 查
  {
    coll: 'community_members',
    name: 'idx_userId_status',
    keys: [
      { Name: 'userId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  // sections: section.list 按 communityId + order 排序
  {
    coll: 'sections',
    name: 'idx_communityId_order',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'order', Direction: '1' },
    ],
  },
  // posts: post.list 按 sectionId + status 查，createdAt 倒序
  {
    coll: 'posts',
    name: 'idx_sectionId_status_createdAt',
    keys: [
      { Name: 'sectionId', Direction: '1' },
      { Name: 'status', Direction: '1' },
      { Name: 'createdAt', Direction: '-1' },
    ],
  },
  // posts: hardDeleteCommunity 级联扫 posts by communityId
  {
    coll: 'posts',
    name: 'idx_communityId',
    keys: [
      { Name: 'communityId', Direction: '1' },
    ],
  },
  // post_attendance_members: 帖子参与名单按 postId + widgetId + joinedAt 读取
  {
    coll: 'post_attendance_members',
    name: 'idx_post_widget_joinedAt',
    keys: [
      { Name: 'postId', Direction: '1' },
      { Name: 'widgetId', Direction: '1' },
      { Name: 'joinedAt', Direction: '-1' },
    ],
  },
  // post_attendance_members: 参与去重 / 删除参与人按 postId + widgetId + userId 查询
  {
    coll: 'post_attendance_members',
    name: 'idx_post_widget_user',
    keys: [
      { Name: 'postId', Direction: '1' },
      { Name: 'widgetId', Direction: '1' },
      { Name: 'userId', Direction: '1' },
    ],
  },
  // post_attendance_members: community.hardDelete 级联删除时按 communityId 扫描
  {
    coll: 'post_attendance_members',
    name: 'idx_communityId',
    keys: [
      { Name: 'communityId', Direction: '1' },
    ],
  },
  // admin_accounts: auth.login 按 username 查，且需要唯一约束
  {
    coll: 'admin_accounts',
    name: 'idx_username_unique',
    keys: [
      { Name: 'username', Direction: '1' },
    ],
    unique: true,
  },
  // users: 微信数据预拉取入口按 backgroundFetchToken 反查用户
  {
    coll: 'users',
    name: 'idx_backgroundFetchToken',
    keys: [
      { Name: 'backgroundFetchToken', Direction: '1' },
    ],
  },
  // admin_accounts: admin.bindWechat / wxLogin 按 userId 反查
  {
    coll: 'admin_accounts',
    name: 'idx_userId',
    keys: [
      { Name: 'userId', Direction: '1' },
    ],
  },
  // admin_sessions: 查询 accountId 的所有 session（重置密码/删除账号时批量清理）
  {
    coll: 'admin_sessions',
    name: 'idx_accountId',
    keys: [
      { Name: 'accountId', Direction: '1' },
    ],
  },
  // admin_sessions: 过期清理（未来可能加定期 job）
  {
    coll: 'admin_sessions',
    name: 'idx_expiresAt',
    keys: [
      { Name: 'expiresAt', Direction: '1' },
    ],
  },
  // admin_login_tickets: 扫码登录 ticket 过期懒清理
  {
    coll: 'admin_login_tickets',
    name: 'idx_expiresAt',
    keys: [
      { Name: 'expiresAt', Direction: '1' },
    ],
  },
  // admin_notification_subscriptions: 保存管理员对审批提醒模板的授权结果
  {
    coll: 'admin_notification_subscriptions',
    name: 'idx_user_event_template',
    keys: [
      { Name: 'userId', Direction: '1' },
      { Name: 'eventType', Direction: '1' },
      { Name: 'templateId', Direction: '1' },
    ],
    unique: true,
  },
  // admin_notifications: notificationStatus 读取当前管理员最近通知失败原因
  {
    coll: 'admin_notifications',
    name: 'idx_recipient_createdAt',
    keys: [
      { Name: 'recipientUserId', Direction: '1' },
      { Name: 'createdAt', Direction: '-1' },
    ],
  },
  // content_audit_tasks: audit detail pages and callback reconciliation by post/slot/trace/job
  {
    coll: 'content_audit_tasks',
    name: 'idx_postId_contentSlot_createdAt',
    keys: [
      { Name: 'postId', Direction: '1' },
      { Name: 'contentSlot', Direction: '1' },
      { Name: 'createdAt', Direction: '-1' },
    ],
  },
  {
    coll: 'content_audit_tasks',
    name: 'idx_traceId',
    keys: [
      { Name: 'traceId', Direction: '1' },
    ],
  },
  {
    coll: 'content_audit_tasks',
    name: 'idx_jobId',
    keys: [
      { Name: 'jobId', Direction: '1' },
    ],
  },
  // post_search_terms: member-facing post search candidate lookup and cleanup
  {
    coll: 'post_search_terms',
    name: 'idx_communityId_term',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'term', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_terms',
    name: 'idx_postId',
    keys: [
      { Name: 'postId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_terms',
    name: 'idx_chunkId',
    keys: [
      { Name: 'chunkId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_documents',
    name: 'idx_communityId_sectionId',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'sectionId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_chunks',
    name: 'idx_postId',
    keys: [
      { Name: 'postId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_chunks',
    name: 'idx_sectionId',
    keys: [
      { Name: 'sectionId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_chunks',
    name: 'idx_communityId_sectionId',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'sectionId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_vector_terms',
    name: 'idx_communityId_term',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'term', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_vector_terms',
    name: 'idx_postId',
    keys: [
      { Name: 'postId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_vector_terms',
    name: 'idx_chunkId',
    keys: [
      { Name: 'chunkId', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_index_state',
    name: 'idx_communityId_status',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  {
    coll: 'post_search_index_state',
    name: 'idx_status_indexedAt',
    keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'indexedAt', Direction: '-1' },
    ],
  },
  {
    coll: 'post_rag_jobs',
    name: 'idx_status_createdAt',
    keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'createdAt', Direction: '1' },
    ],
  },
  {
    coll: 'post_rag_jobs',
    name: 'idx_postId_status',
    keys: [
      { Name: 'postId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  {
    coll: 'post_rag_jobs',
    name: 'idx_communityId_status',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  {
    coll: 'post_rag_index_state',
    name: 'idx_communityId_status',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'status', Direction: '1' },
    ],
  },
  {
    coll: 'post_rag_index_state',
    name: 'idx_status_indexedAt',
    keys: [
      { Name: 'status', Direction: '1' },
      { Name: 'indexedAt', Direction: '-1' },
    ],
  },
  {
    coll: 'post_rag_chunks',
    name: 'idx_communityId_postId',
    keys: [
      { Name: 'communityId', Direction: '1' },
      { Name: 'postId', Direction: '1' },
    ],
  },
  {
    coll: 'post_rag_chunks',
    name: 'idx_sectionId_postId',
    keys: [
      { Name: 'sectionId', Direction: '1' },
      { Name: 'postId', Direction: '1' },
    ],
  },
  // app_configs: global product/admin configuration documents by stable key
  {
    coll: 'app_configs',
    name: 'idx_key_unique',
    unique: true,
    keys: [
      { Name: 'key', Direction: '1' },
    ],
  },
]

const REQUIRED_COLLECTIONS = [
  'app_configs',
  'post_attendance_members',
  'admin_accounts',
  'admin_sessions',
  'admin_login_tickets',  // 扫码登录会话（_id=ticket，主键查询，索引仅 expiresAt 用）
  'admin_runtime',        // 运行时缓存（wx access_token 等单文档，无需额外索引）
  'admin_notification_subscriptions', // 审批提醒订阅授权状态
  'admin_notifications',  // 审批提醒发送记录与失败原因
  'content_audit_tasks',  // 内容审核任务与回调对账
  'post_search_documents', // 帖子搜索文档（_id=postId）
  'post_search_terms',     // 帖子搜索倒排词条
  'post_search_chunks',    // RAG 证据分块（_id=chunkId）
  'post_search_vector_terms', // 本地稀疏向量词条
  'post_search_index_state',  // 每篇帖子索引状态
  'post_rag_jobs',            // 正式 RAG 异步索引任务
  'post_rag_index_state',     // 正式 RAG 每篇帖子索引状态
  'post_rag_chunks',          // RAG chunk 元数据镜像/排障用
]

let hadError = false

for (const coll of REQUIRED_COLLECTIONS) {
  try {
    const existRes = await db.checkCollectionExists(coll)
    if (existRes?.Exists) {
      console.log(`= collection ${coll} (already exists)`)
      continue
    }
    await db.createCollection(coll)
    console.log(`✓ collection ${coll} created`)
  } catch (e) {
    const msg = String(e?.message || e)
    console.error(`✗ collection ${coll}`, msg)
    hadError = true
  }
}

for (const idx of INDEXES) {
  try {
    // 先查索引是否已存在，避免重复建（updateCollection 遇到同名会报错）
    const existRes = await db.checkIndexExists(idx.coll, idx.name)
    if (existRes?.Exists) {
      console.log(`= ${idx.coll}.${idx.name} (already exists)`)
      continue
    }

    await db.updateCollection(idx.coll, {
      CreateIndexes: [
        {
          IndexName: idx.name,
          MgoKeySchema: {
            MgoIndexKeys: idx.keys,
            MgoIsUnique: Boolean(idx.unique),
          },
        },
      ],
    })
    console.log(`✓ ${idx.coll}.${idx.name}  created`)
  } catch (e) {
    // checkIndexExists 对不存在的集合会抛错；降级到尝试直接建，若失败再报
    const msg = String(e?.message || e)
    if (msg.includes('不存在') || msg.includes('not exist') || msg.includes('CollectionNotExists')) {
      console.error(`✗ ${idx.coll}.${idx.name}  collection "${idx.coll}" 不存在，跳过`)
      continue
    }
    console.error(`✗ ${idx.coll}.${idx.name}`, msg)
    hadError = true
  }
}

if (hadError) {
  console.error('\n[ensure-indexes] 有索引创建失败，请查看上方日志')
  process.exit(1)
}

console.log('\n[ensure-indexes] Done.')
