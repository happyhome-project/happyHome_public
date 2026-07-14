jest.mock('../db', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  query: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  runTransaction: jest.fn(async (callback) => callback({ collection: (name: string) => ({ doc: (id: string) => ({ update: async ({ data }: any) => (require('../db').updateById)(name, id, data) }) }) })),
  transactionGetByIdOrNull: jest.fn(async (_transaction, name, id) => (require('../db').getById)(name, id)),
}))

jest.mock('../post-rag-outbox', () => ({ appendPostRagOutboxEvent: jest.fn() }))

jest.mock('../storage', () => ({
  getTempUrl: jest.fn(async (fileID: string) => `https://temp.example.com/${encodeURIComponent(fileID)}`),
}))

jest.mock('../wx-openapi', () => ({
  postWxJson: jest.fn(),
}))

jest.mock('../post-search', () => ({
  refreshPostSearchIndexById: jest.fn(),
}))

jest.mock('../post-rag', () => ({
  enqueuePostRagJob: jest.fn(),
}))

import {
  applyAuditSummary,
  auditAndApply,
  auditPostContent,
  approvePostAudit,
  buildCiHttpString,
  buildTencentCiAuditRequestBody,
  extractAuditTargets,
  handleAuditCallback,
  isPostVisibleToMembers,
  parseTencentCiAuditResponse,
  rejectPostAudit,
} from '../content-audit'
import * as db from '../db'
import * as postSearch from '../post-search'
import * as postRag from '../post-rag'
import { postWxJson } from '../wx-openapi'

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.AUDIT_CALLBACK_TOKEN
})

test('extractAuditTargets collects text, rich-note images and manual video targets', () => {
  const section: any = {
    widgets: [
      { widgetId: 'title', type: 'short_text', label: 'Title' },
      { widgetId: 'rich', type: 'rich_note', label: 'Rich' },
      { widgetId: 'video', type: 'video_group', label: 'Video' },
    ],
  }

  const targets = extractAuditTargets(section, {
    title: 'hello',
    rich: {
      text: 'rich text',
      markdown: '**rich text**',
      imageFileIDs: ['cloud://env/rich.png'],
    },
    video: [
      { source: 'cos', title: 'local video', fileID: 'cloud://env/video.mp4' },
      { source: 'channels_feed', title: 'finder video', feedId: 'feed-1' },
    ],
  } as any)

  expect(targets).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'text', widgetId: 'title', text: 'hello' }),
    expect.objectContaining({ type: 'image', widgetId: 'rich', fileID: 'cloud://env/rich.png' }),
    expect.objectContaining({ type: 'video', widgetId: 'video', fileID: 'cloud://env/video.mp4' }),
    expect.objectContaining({ type: 'video', widgetId: 'video', forceManual: true }),
  ]))
})

test('isPostVisibleToMembers only exposes active posts that passed audit', () => {
  expect(isPostVisibleToMembers({ status: 'active' })).toBe(true)
  expect(isPostVisibleToMembers({ status: 'active', auditStatus: 'pass' })).toBe(true)
  expect(isPostVisibleToMembers({ status: 'active', auditStatus: 'pending' })).toBe(false)
  expect(isPostVisibleToMembers({ status: 'active', auditStatus: 'review' })).toBe(false)
  expect(isPostVisibleToMembers({ status: 'active', auditStatus: 'rejected' })).toBe(false)
  expect(isPostVisibleToMembers({ status: 'deleted', auditStatus: 'pass' })).toBe(false)
})

test('auditAndApply can keep archive posts searchable without enqueueing RAG work', async () => {
  const post = {
    _id: 'archive-1', communityId: 'community-1', area: 'archive', format: 'text',
    content: { title: '标题' }, status: 'active', auditStatus: 'pending',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await auditAndApply({
    postId: 'archive-1', communityId: 'community-1', sectionId: '', authorId: 'openid-1', source: 'user',
    section: { widgets: [] } as any,
    content: post.content as any,
    postSnapshot: post as any,
  } as any)

  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-1')
  expect(postRag.enqueuePostRagJob).not.toHaveBeenCalled()
  const { appendPostRagOutboxEvent } = require('../post-rag-outbox')
  expect(appendPostRagOutboxEvent).not.toHaveBeenCalled()
  expect(db.updateWhere).toHaveBeenCalledWith('archive_post_topics', { postId: 'archive-1' }, expect.objectContaining({ auditStatus: 'pass' }))
})

test('applyAuditSummary automatically keeps later archive audit callbacks out of RAG', async () => {
  const post = {
    _id: 'archive-callback-1', communityId: 'community-1', area: 'archive', format: 'image_text',
    content: { title: '标题', images: ['cloud://env/one.jpg'] }, status: 'active', auditStatus: 'pending',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await applyAuditSummary('archive-callback-1', 'content', 'pass', '', post as any)

  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-callback-1')
  expect(postRag.enqueuePostRagJob).not.toHaveBeenCalled()
  const { appendPostRagOutboxEvent } = require('../post-rag-outbox')
  expect(appendPostRagOutboxEvent).not.toHaveBeenCalled()
  expect(db.updateWhere).toHaveBeenCalledWith('archive_post_topics', { postId: 'archive-callback-1' }, expect.objectContaining({ auditStatus: 'pass' }))
})

test('buildCiHttpString follows Tencent CI XML signature newline format', () => {
  expect(buildCiHttpString('POST', '/text/auditing', {
    host: '636c-cloudbase-3gh862acb1505ff3-1307183045.ci.ap-shanghai.myqcloud.com',
  })).toBe(
    'post\n'
    + '/text/auditing\n'
    + '\n'
    + 'host=636c-cloudbase-3gh862acb1505ff3-1307183045.ci.ap-shanghai.myqcloud.com\n',
  )
})

test('buildTencentCiAuditRequestBody lets image audits use the default policy', () => {
  const body = buildTencentCiAuditRequestBody('image', '<Url>https://example.com/a.webp</Url>')

  expect(body).toContain('<Conf></Conf>')
  expect(body).not.toContain('DetectType')
  expect(body).not.toContain('Illegal')
  expect(body).not.toContain('Abuse')
  expect(body).not.toContain('Terrorism')
})

test('parseTencentCiAuditResponse keeps Tencent job errors visible', () => {
  const result = parseTencentCiAuditResponse('image', `<?xml version="1.0" encoding="utf-8"?>
<Response>
  <JobsDetail>
    <Code>InvalidArgument</Code>
    <Message>invalid DetectType</Message>
    <State>Failed</State>
  </JobsDetail>
</Response>`)

  expect(result.status).toBe('review')
  expect(result.provider).toBe('tencent_ci')
  expect(result.reason).toBe('Tencent CI InvalidArgument: invalid DetectType')
})

test('auditPostContent submits independent audit targets concurrently', async () => {
  let inFlight = 0
  let maxInFlight = 0
  ;(postWxJson as jest.Mock).mockImplementation(async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 10))
    inFlight -= 1
    return { result: { suggest: 'pass', label: 'normal' }, trace_id: `trace-${maxInFlight}` }
  })

  await auditPostContent({
    postId: 'post-1',
    communityId: 'community-1',
    sectionId: 'section-1',
    authorId: 'openid-1',
    source: 'user',
    section: {
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题' },
        { widgetId: 'summary', type: 'summary', label: '摘要' },
      ],
    } as any,
    content: {
      title: '第一段待审核内容',
      summary: '第二段待审核内容',
    } as any,
  })

  expect(postWxJson).toHaveBeenCalledTimes(2)
  expect(maxInFlight).toBeGreaterThan(1)
  expect(db.create).toHaveBeenCalledTimes(2)
})

test('approvePostAudit promotes pendingContent and marks the post as passed', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'post-1', pendingContent: { title: 'new title' } })

  await approvePostAudit('post-1')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    content: { __set: { title: 'new title' } },
    pendingContent: { __remove: true },
    pendingAuditStatus: 'pass',
    auditStatus: 'pass',
  }))
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
  expect(postRag.enqueuePostRagJob).toHaveBeenCalledWith(expect.objectContaining({
    postId: 'post-1',
    action: 'upsert',
    reason: 'audit.pending.pass',
  }))
})

test('approvePostAudit replaces content and removes pendingContent atomically for CloudBase nested object updates', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'post-guide', pendingContent: { guide_age: '8岁以上' } })

  await approvePostAudit('post-guide')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-guide', expect.objectContaining({
    content: { __set: { guide_age: '8岁以上' } },
    pendingContent: { __remove: true },
  }))
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-guide')
  expect(postRag.enqueuePostRagJob).toHaveBeenCalledWith(expect.objectContaining({
    postId: 'post-guide',
    action: 'upsert',
    reason: 'audit.pending.pass',
  }))
})

test('rejectPostAudit rejects pending edits without replacing current content', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    content: { title: 'old title' },
    pendingContent: { title: 'bad edit' },
  })

  await rejectPostAudit('post-1', 'manual reject')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    pendingAuditStatus: 'rejected',
    pendingAuditReason: 'manual reject',
  }))
  expect((db.updateById as jest.Mock).mock.calls[0][2].content).toBeUndefined()
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
  expect(postRag.enqueuePostRagJob).not.toHaveBeenCalled()
})

test('handleAuditCallback rejects public callback when callback token is not configured', async () => {
  await expect(handleAuditCallback({
    traceId: 'trace-1',
    suggest: 'pass',
    callbackToken: 'any-token',
  })).rejects.toThrow('audit callback token is not configured')

  expect(db.query).not.toHaveBeenCalled()
  expect(db.updateById).not.toHaveBeenCalled()
})
