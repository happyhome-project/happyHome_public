import cloud from 'wx-server-sdk'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import type { Section, PostContent } from '../../shared/types'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function sanitizeContent(content: PostContent, section: Section): PostContent {
  const allowedIds = new Set((section.widgets || []).map((widget) => widget.widgetId))
  return Object.fromEntries(
    Object.entries(content || {}).filter(([key]) => allowedIds.has(key))
  ) as PostContent
}

export async function handleCreate(
  params: { communityId: string; sectionId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  // Check user is active community member
  const members = await db.query('community_members', {
    communityId: params.communityId,
    userId: openid,
    status: 'active',
  })
  if (!members || members.length === 0) throw new Error('非社区成员，无法发帖')

  // Get section to validate required widgets
  const section = await db.getById('sections', params.sectionId) as Section
  const sanitizedContent = sanitizeContent(params.content, section)

  // Validate all required widgets are filled in content
  for (const widget of section.widgets) {
    if (widget.required) {
      const value = sanitizedContent[widget.widgetId]
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0)
      if (isEmpty) {
        throw new Error(`必填项未填写：${widget.label}`)
      }
    }
  }

  const now = new Date().toISOString()
  const postId = await db.create('posts', {
    communityId: params.communityId,
    sectionId: params.sectionId,
    authorId: openid,
    status: 'active',
    content: sanitizedContent,
    commentCount: 0,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  })

  return { postId }
}

export async function handleList(params: {
  sectionId: string
  skip?: number
  limit?: number
}) {
  const posts = await db.query('posts', {
    sectionId: params.sectionId,
    status: 'active',
  }, {
    orderBy: ['createdAt', 'desc'],
    skip: params.skip ?? 0,
    limit: params.limit ?? 20,
  })
  return { posts }
}

export async function handleGet(params: { postId: string }) {
  const post = await db.getById('posts', params.postId) as { status: string }
  if (post.status === 'deleted') throw new Error('帖子不存在')
  return { post }
}

export async function handleDelete(params: { postId: string }, openid: string) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as { authorId: string; status: string }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权删除')

  await db.softDelete('posts', params.postId)
  return { success: true }
}

export async function handleUpdate(
  params: { postId: string; content: PostContent },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')

  const post = await db.getById('posts', params.postId) as {
    sectionId: string
    authorId: string
    status: string
  }
  if (post.status === 'deleted') throw new Error('帖子已删除')
  if (post.authorId !== openid) throw new Error('无权修改')

  const section = await db.getById('sections', post.sectionId) as Section
  const sanitizedContent = sanitizeContent(params.content, section)

  for (const widget of section.widgets) {
    if (!widget.required) continue
    const value = sanitizedContent[widget.widgetId]
    const isEmpty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    if (isEmpty) {
      throw new Error(`必填项未填写：${widget.label}`)
    }
  }

  const updatedAt = new Date().toISOString()
  await db.updateById('posts', params.postId, {
    content: sanitizedContent,
    updatedAt,
  })
  return { success: true, updatedAt }
}

export const main = async (event: any) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'list') return handleList(params)
  if (action === 'get') return handleGet(params)
  if (action === 'delete') return handleDelete(params, openid)
  if (action === 'update') return handleUpdate(params, openid)
  throw new Error(`Unknown action: ${action}`)
}
