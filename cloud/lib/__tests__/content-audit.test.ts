jest.mock('../db', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  getByIdOrNull: jest.fn().mockResolvedValue(null),
  query: jest.fn(),
  setById: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  runTransaction: jest.fn(async (callback) => callback({ collection: (name: string) => ({ doc: (id: string) => ({
    set: async ({ data }: any) => (require('../db').setById)(name, id, data),
    update: async ({ data }: any) => (require('../db').updateById)(name, id, data),
  }) }) })),
  transactionGetByIdOrNull: jest.fn(async (_transaction, name, id) => (require('../db').getById)(name, id)),
}))

jest.mock('../post-rag-sync', () => ({ schedulePostRagSyncInTransaction: jest.fn() }))

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
  applyWechatMediaAuditResult,
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
import * as postRagSync from '../post-rag-sync'
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

test('auditAndApply enqueues section-free archive posts for formal RAG search', async () => {
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
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    postId: 'archive-1', communityId: 'community-1', sectionId: '',
  }))
  expect(db.updateWhere).toHaveBeenCalledWith('archive_post_topics', { postId: 'archive-1' }, expect.objectContaining({ auditStatus: 'pass' }))
})

test('applyAuditSummary keeps later archive audit callbacks in RAG lifecycle', async () => {
  const post = {
    _id: 'archive-callback-1', communityId: 'community-1', area: 'archive', format: 'image_text',
    content: { title: '标题', images: ['cloud://env/one.jpg'] }, status: 'active', auditStatus: 'pending',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await applyAuditSummary('archive-callback-1', 'content', 'pass', '', post as any)

  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-callback-1')
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    postId: 'archive-callback-1', sectionId: '',
  }))
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
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'post-1', reason: 'post.audit_changed' }))
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
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'post-guide', reason: 'post.audit_changed' }))
})

test('approvePostAudit promotes pending archive topics and retires removed topic links', async () => {
  const post = {
    _id: 'archive-edit-1', communityId: 'community-1', area: 'archive', format: 'text',
    status: 'active', auditStatus: 'pass', createdAt: '2026-07-15T01:00:00.000Z',
    pendingContent: { title: '更新', body: { text: '正文' } },
    pendingTopics: ['新话题'], pendingPresentation: { textNoteTheme: 'mint' },
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await approvePostAudit('archive-edit-1')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'archive-edit-1', expect.objectContaining({
    content: { __set: post.pendingContent },
    pendingContent: { __remove: true },
    topics: { __set: ['新话题'] },
    pendingTopics: { __remove: true },
    presentation: { __set: { textNoteTheme: 'mint' } },
    pendingPresentation: { __remove: true },
  }))
  expect(db.updateWhere).toHaveBeenCalledWith('archive_post_topics', { postId: 'archive-edit-1' }, expect.objectContaining({ status: 'deleted' }))
  expect(db.setById).toHaveBeenCalledWith('archive_post_topics', expect.any(String), expect.objectContaining({
    postId: 'archive-edit-1', topicKey: '新话题', status: 'active', auditStatus: 'pass',
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
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'post-1' }))
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

test('applyWechatMediaAuditResult updates exact trace tasks and refreshes each post slot once', async () => {
  const traceTasks = [
    { _id: 'task-1', postId: 'post-1', contentSlot: 'content', provider: 'wechat', status: 'pending' },
    { _id: 'task-2', postId: 'post-1', contentSlot: 'content', provider: 'wechat', status: 'pending' },
    { _id: 'task-3', postId: 'post-2', contentSlot: 'pendingContent', provider: 'wechat', status: 'pending' },
  ]
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-pass') return traceTasks
    if (where.postId === 'post-1') return [{ ...traceTasks[0], status: 'pass' }, { ...traceTasks[1], status: 'pass' }]
    if (where.postId === 'post-2') return [{ ...traceTasks[2], status: 'pass' }]
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (_collection: string, id: string) => ({
    _id: id,
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'active',
    content: { title: 'existing' },
    ...(id === 'post-2' ? { pendingContent: { title: 'pending' } } : {}),
  }))

  const result = await applyWechatMediaAuditResult({ traceId: 'trace-pass', suggest: 'pass', label: 100 })

  expect(result).toEqual({ success: true, matched: 3, status: 'pass', refreshed: 2 })
  expect(db.updateById).toHaveBeenCalledWith('content_audit_tasks', 'task-1', expect.objectContaining({
    status: 'pass', suggest: 'pass', label: 100,
  }))
  expect((db.query as jest.Mock).mock.calls.filter(([, where]) => where.postId === 'post-1')).toHaveLength(1)
  expect((db.query as jest.Mock).mock.calls.filter(([, where]) => where.postId === 'post-2')).toHaveLength(1)
  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({ auditStatus: 'pass' }))
  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-2', expect.objectContaining({ auditStatus: 'pass' }))
})

test('applyWechatMediaAuditResult acknowledges unknown traces without mutation', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([])

  await expect(applyWechatMediaAuditResult({ traceId: 'unknown', suggest: 'review', label: undefined }))
    .resolves.toEqual({ success: true, matched: 0, status: 'review', refreshed: 0 })

  expect(db.updateById).not.toHaveBeenCalled()
  expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
})

test('applyWechatMediaAuditResult is idempotent for duplicate rejected delivery', async () => {
  const task = { _id: 'task-1', postId: 'post-1', contentSlot: 'content', provider: 'wechat', status: 'pending' }
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-rejected') return [task]
    if (where.postId === 'post-1') return [{ ...task, status: 'rejected', reason: 'wechat media rejected' }]
    return []
  })
  let postStatus = 'pending'
  ;(db.getById as jest.Mock).mockImplementation(async () => ({
    _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', content: {},
    auditStatus: postStatus, auditReason: postStatus === 'rejected' ? 'wechat media rejected' : 'media audit is pending',
  }))
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, _id: string, data: any) => {
    if (collection === 'posts' && data.auditStatus) postStatus = data.auditStatus
  })

  await applyWechatMediaAuditResult({ traceId: 'trace-rejected', suggest: 'rejected', label: 20001 })
  await applyWechatMediaAuditResult({ traceId: 'trace-rejected', suggest: 'rejected', label: 20001 })

  expect(db.create).not.toHaveBeenCalled()
  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({ auditStatus: 'rejected' }))
  expect((db.updateById as jest.Mock).mock.calls.filter(([collection]) => collection === 'posts')).toHaveLength(1)
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledTimes(1)
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledTimes(1)
})
