jest.mock('../db', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  getByIdOrNull: jest.fn().mockResolvedValue(null),
  query: jest.fn(),
  queryBefore: jest.fn(),
  queryAfterId: jest.fn(),
  removeById: jest.fn(),
  setById: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  runTransaction: jest.fn(async (callback) => callback({ collection: (name: string) => ({ doc: (id: string) => ({
    set: async ({ data }: any) => (require('../db').setById)(name, id, data),
    update: async ({ data }: any) => (require('../db').updateById)(name, id, data),
    remove: async () => (require('../db').removeById)(name, id),
  }) }) })),
  transactionGetByIdOrNull: jest.fn(async (_transaction, name, id) => (require('../db').getById)(name, id)),
}))

jest.mock('../post-rag-sync', () => ({ schedulePostRagSyncInTransaction: jest.fn() }))

jest.mock('../archive-topic-index', () => ({
  prepareArchivePostTopicReconciliation: jest.fn(async () => ({ references: [], existingLinks: [] })),
  reconcileArchivePostTopicsInTransaction: jest.fn(),
}))

jest.mock('../storage', () => ({
  deleteFile: jest.fn(),
  getTempUrl: jest.fn(async (fileID: string) => `https://temp.example.com/${encodeURIComponent(fileID)}`),
  requestUploadMetadata: jest.fn(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` })),
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
  computeContentRevisionDigest,
  extractAuditTargets,
  handleAuditCallback,
  isPostVisibleToMembers,
  parseTencentCiAuditResponse,
  recoverMemberAudioCleanupJobs,
  rejectPostAudit,
} from '../content-audit'
import * as db from '../db'
import * as postSearch from '../post-search'
import * as postRag from '../post-rag'
import * as postRagSync from '../post-rag-sync'
import * as archiveTopicIndex from '../archive-topic-index'
import { postWxJson } from '../wx-openapi'
import * as storage from '../storage'

beforeEach(() => {
  jest.resetAllMocks()
  ;(db.replaceValue as jest.Mock).mockImplementation((value) => ({ __set: value }))
  ;(db.removeField as jest.Mock).mockImplementation(() => ({ __remove: true }))
  ;(db.runTransaction as jest.Mock).mockImplementation(async (callback) => callback({
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async ({ data }: any) => (db.setById as jest.Mock)(name, id, data),
        update: async ({ data }: any) => (db.updateById as jest.Mock)(name, id, data),
        remove: async () => (db.removeById as jest.Mock)(name, id),
      }),
    }),
  }))
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, name, id) => (
    (db.getById as jest.Mock)(name, id)
  ))
  ;(storage.getTempUrl as jest.Mock).mockImplementation(async (fileID: string) => `https://temp.example.com/${encodeURIComponent(fileID)}`)
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` }))
  ;(archiveTopicIndex.prepareArchivePostTopicReconciliation as jest.Mock).mockResolvedValue({ references: [], existingLinks: [] })
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
  const content = { title: '标题' }
  const contentDigest = computeContentRevisionDigest(content as any)
  const post = {
    _id: 'archive-1', communityId: 'community-1', area: 'archive', format: 'text',
    content, contentRevision: 'archive-r1', contentRevisionDigest: contentDigest,
    status: 'active', auditStatus: 'pending',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await auditAndApply({
    postId: 'archive-1', communityId: 'community-1', sectionId: '', authorId: 'openid-1', source: 'user',
    section: { widgets: [] } as any,
    content: post.content as any,
    contentRevision: 'archive-r1',
    contentDigest,
    postSnapshot: post as any,
  } as any)

  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-1')
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    postId: 'archive-1', communityId: 'community-1', sectionId: '',
  }))
  expect(archiveTopicIndex.prepareArchivePostTopicReconciliation).toHaveBeenCalledWith(expect.objectContaining({
    _id: 'archive-1', auditStatus: 'pass', status: 'active',
  }))
  expect(archiveTopicIndex.reconcileArchivePostTopicsInTransaction).toHaveBeenCalled()
})

test('applyAuditSummary keeps later archive audit callbacks in RAG lifecycle', async () => {
  const post = {
    _id: 'archive-callback-1', communityId: 'community-1', area: 'archive', format: 'image_text',
    contentRevision: 'archive-callback-r1',
    content: { title: '标题', images: ['cloud://env/one.jpg'] }, status: 'active', auditStatus: 'pending',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await applyAuditSummary('archive-callback-1', 'content', 'pass', '', post as any)

  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('archive-callback-1')
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    postId: 'archive-callback-1', sectionId: '',
  }))
  expect(archiveTopicIndex.prepareArchivePostTopicReconciliation).toHaveBeenCalledWith(expect.objectContaining({
    _id: 'archive-callback-1', auditStatus: 'pass', status: 'active',
  }))
  expect(archiveTopicIndex.reconcileArchivePostTopicsInTransaction).toHaveBeenCalled()
})

test('applyAuditSummary uses the transaction-current deleted status when an audit races with deletion', async () => {
  const trustedPost = {
    _id: 'archive-race-1', communityId: 'community-1', area: 'archive', topics: ['教育成长'],
    createdAt: '2026-07-22T00:00:00.000Z', status: 'active', auditStatus: 'pending',
    contentRevision: 'archive-race-r1', content: { title: '待审内容' },
  }
  ;(db.transactionGetByIdOrNull as jest.Mock).mockResolvedValueOnce({ ...trustedPost, status: 'deleted' })

  await applyAuditSummary('archive-race-1', 'content', 'pass', '', trustedPost as any)

  expect(archiveTopicIndex.reconcileArchivePostTopicsInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ _id: 'archive-race-1', status: 'deleted', auditStatus: 'pass' }),
    expect.anything(),
    expect.any(String),
  )
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

test('buildTencentCiAuditRequestBody enables large-image handling for image URLs', () => {
  const body = buildTencentCiAuditRequestBody('image', '<Url>https://example.com/large.jpg</Url>')

  expect(body).toContain(
    '<Input><Url>https://example.com/large.jpg</Url><LargeImageDetect>1</LargeImageDetect></Input>',
  )
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
    contentRevision: 'post-r1',
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

test('auditPostContent stores the immutable content revision on every target task', async () => {
  ;(postWxJson as jest.Mock).mockResolvedValue({ result: { suggest: 'pass', label: 'normal' }, trace_id: 'trace-r1' })

  await (auditPostContent as any)({
    postId: 'post-revision-task', communityId: 'community-1', sectionId: 'section-1',
    authorId: 'openid-1', source: 'user', contentSlot: 'pendingContent', contentRevision: 'pending-r1',
    section: { widgets: [{ widgetId: 'title', type: 'short_text', label: '标题' }] },
    content: { title: '待审核内容' },
  })

  expect(db.create).toHaveBeenCalledWith('content_audit_tasks', expect.objectContaining({
    postId: 'post-revision-task', contentSlot: 'pendingContent', contentRevision: 'pending-r1',
    expectedTargetCount: 1, targetIndex: 0,
  }))
})

test('approvePostAudit promotes pendingContent and marks the post as passed', async () => {
  const legacyPost: any = { _id: 'post-1', pendingContent: { title: 'new title' } }
  ;(db.getById as jest.Mock).mockResolvedValue(legacyPost)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => (
    collection === 'posts' ? legacyPost : null
  ))
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection !== 'posts' || id !== legacyPost._id) return
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__set' in value) legacyPost[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete legacyPost[key]
      else legacyPost[key] = value
    }
  })

  await approvePostAudit('post-1')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    content: { __set: { title: 'new title' } },
    pendingContent: { __remove: true },
    pendingAuditStatus: 'pass',
    auditStatus: 'pass',
  }))
  expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
  expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ postId: 'post-1', reason: 'post.audit_changed' }))
  expect(db.query).toHaveBeenCalledWith(
    'post_media_cleanup_retries',
    { postId: 'post-1', status: 'pending' },
    { orderBy: ['updatedAt', 'asc'], limit: 20 },
  )
})

test('pending audio approval deletes only displaced finalized files after the revisioned transition', async () => {
  const scope = 'a5434f589c765f935836d608'
  const oldAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/old.mp3`
  const sharedCover = `cloud://test-env/posts/member-audio-covers-finalized/${scope}/shared.jpg`
  const newAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/new.mp3`
  const post = {
    _id: 'archive-audio-cleanup',
    communityId: 'community-1',
    authorId: 'member-openid',
    area: 'archive',
    origin: 'native_archive',
    format: 'audio',
    status: 'active',
    auditStatus: 'pass',
    contentRevision: 'published-r1',
    pendingContentRevision: 'pending-r2',
    content: { title: '旧内容', audios: [{ title: '旧音频', fileID: oldAudio, duration: 10, size: 10, ext: 'mp3', cover: sharedCover }] },
    pendingContent: { title: '新内容', audios: [{ title: '新音频', fileID: newAudio, duration: 10, size: 10, ext: 'mp3', cover: sharedCover }] },
    topics: [],
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  const authoritative = {
    ...post,
    content: post.pendingContent,
    contentRevision: 'pending-r2',
    pendingContent: undefined,
    pendingContentRevision: undefined,
  }
  const retryDocuments = new Map<string, any>()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => (
    collection === 'posts' ? post : retryDocuments.get(id) || null
  ))
  ;(db.setById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'post_media_cleanup_retries') retryDocuments.set(id, { _id: id, ...data })
  })
  ;(db.getById as jest.Mock).mockResolvedValue(authoritative)
  ;(db.queryAfterId as jest.Mock).mockResolvedValue([authoritative])
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({
    fileId: `cloud://test-env/${cloudPath}`,
  }))
  ;(storage.deleteFile as jest.Mock).mockResolvedValue(undefined)

  await (applyAuditSummary as any)('archive-audio-cleanup', 'pendingContent', 'pass', '', post, 'pending-r2')

  expect(storage.deleteFile).toHaveBeenCalledTimes(1)
  expect(storage.deleteFile).toHaveBeenCalledWith([oldAudio])
  expect(storage.deleteFile).not.toHaveBeenCalledWith([sharedCover])
  expect(storage.deleteFile).not.toHaveBeenCalledWith([newAudio])
})

test('failed displaced-audio deletion keeps one deterministic retry record across repeated attempts', async () => {
  const scope = 'a5434f589c765f935836d608'
  const oldAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/old.mp3`
  const newAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/new.mp3`
  const post = {
    _id: 'archive-audio-retry', communityId: 'community-1', authorId: 'member-openid',
    area: 'archive', origin: 'native_archive', format: 'audio', status: 'active', auditStatus: 'pass',
    contentRevision: 'published-r1', pendingContentRevision: 'pending-r2', topics: [],
    content: { title: '旧内容', audios: [{ title: '旧音频', fileID: oldAudio, duration: 10, size: 10, ext: 'mp3' }] },
    pendingContent: { title: '新内容', audios: [{ title: '新音频', fileID: newAudio, duration: 10, size: 10, ext: 'mp3' }] },
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  const authoritative = { ...post, content: post.pendingContent, contentRevision: 'pending-r2', pendingContent: undefined, pendingContentRevision: undefined }
  const retryDocuments = new Map<string, any>()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => {
    if (collection === 'posts') return post
    return retryDocuments.get(id) || null
  })
  ;(db.setById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'post_media_cleanup_retries') retryDocuments.set(id, { _id: id, ...data })
  })
  ;(db.getById as jest.Mock).mockResolvedValue(authoritative)
  ;(db.queryAfterId as jest.Mock).mockResolvedValue([authoritative])
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` }))
  ;(storage.deleteFile as jest.Mock).mockRejectedValue(new Error('storage unavailable'))

  await (applyAuditSummary as any)('archive-audio-retry', 'pendingContent', 'pass', '', post, 'pending-r2')
  await (applyAuditSummary as any)('archive-audio-retry', 'pendingContent', 'pass', '', post, 'pending-r2')

  expect(retryDocuments.size).toBe(1)
  const [retry] = [...retryDocuments.values()]
  expect(retry).toEqual(expect.objectContaining({
    postId: 'archive-audio-retry', fileID: oldAudio, kind: 'audio', status: 'pending', attempts: 2,
    lastError: 'storage unavailable',
  }))
  expect(storage.deleteFile).toHaveBeenCalledTimes(2)
})

test('displaced audio cleanup skips external authority and another post references', async () => {
  const scope = 'a5434f589c765f935836d608'
  const sharedAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/shared.mp3`
  const externalCover = `cloud://other-env/posts/member-audio-covers-finalized/${scope}/external.jpg`
  const newAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/new.mp3`
  const post = {
    _id: 'archive-audio-shared', communityId: 'community-1', authorId: 'member-openid',
    area: 'archive', origin: 'native_archive', format: 'audio', status: 'active', auditStatus: 'pass',
    contentRevision: 'published-r1', pendingContentRevision: 'pending-r2', topics: [],
    content: { title: '旧内容', audios: [{ title: '旧音频', fileID: sharedAudio, duration: 10, size: 10, ext: 'mp3', cover: externalCover }] },
    pendingContent: { title: '新内容', audios: [{ title: '新音频', fileID: newAudio, duration: 10, size: 10, ext: 'mp3' }] },
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  const authoritative = { ...post, content: post.pendingContent, contentRevision: 'pending-r2', pendingContent: undefined, pendingContentRevision: undefined }
  const retryDocuments = new Map<string, any>()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => (
    collection === 'posts' ? post : retryDocuments.get(id) || null
  ))
  ;(db.setById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'post_media_cleanup_retries') retryDocuments.set(id, { _id: id, ...data })
  })
  ;(db.getById as jest.Mock).mockResolvedValue(authoritative)
  ;(db.queryAfterId as jest.Mock).mockResolvedValue([
    authoritative,
    { _id: 'another-post', communityId: 'community-1', content: { audios: [{ fileID: sharedAudio }] } },
  ])
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` }))

  await (applyAuditSummary as any)('archive-audio-shared', 'pendingContent', 'pass', '', post, 'pending-r2')

  expect(storage.deleteFile).not.toHaveBeenCalled()
  expect(db.queryAfterId).toHaveBeenCalled()
})

test('deleted other-post references do not prevent displaced audio cleanup', async () => {
  const scope = 'a5434f589c765f935836d608'
  const oldAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/deleted-reference.mp3`
  const newAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/new-after-deleted-reference.mp3`
  const post = {
    _id: 'archive-audio-deleted-reference', communityId: 'community-1', authorId: 'member-openid',
    area: 'archive', origin: 'native_archive', format: 'audio', status: 'active', auditStatus: 'pass',
    contentRevision: 'published-r1', pendingContentRevision: 'pending-r2', topics: [],
    content: { title: '旧内容', audios: [{ title: '旧音频', fileID: oldAudio, duration: 10, size: 10, ext: 'mp3' }] },
    pendingContent: { title: '新内容', audios: [{ title: '新音频', fileID: newAudio, duration: 10, size: 10, ext: 'mp3' }] },
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  const authoritative = { ...post, content: post.pendingContent, contentRevision: 'pending-r2', pendingContent: undefined, pendingContentRevision: undefined }
  const retryDocuments = new Map<string, any>()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => (
    collection === 'posts' ? post : retryDocuments.get(id) || null
  ))
  ;(db.setById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'post_media_cleanup_retries') retryDocuments.set(id, { _id: id, ...data })
  })
  ;(db.getById as jest.Mock).mockResolvedValue(authoritative)
  ;(db.queryAfterId as jest.Mock).mockResolvedValue([
    authoritative,
    { _id: 'deleted-post', communityId: 'community-1', status: 'deleted', content: { audios: [{ fileID: oldAudio }] } },
  ])
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` }))

  await (applyAuditSummary as any)('archive-audio-deleted-reference', 'pendingContent', 'pass', '', post, 'pending-r2')

  expect(storage.deleteFile).toHaveBeenCalledWith([oldAudio])
})

test('failed audit transition neither deletes displaced media nor leaves a cleanup retry outside the transaction', async () => {
  const scope = 'a5434f589c765f935836d608'
  const oldAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/old.mp3`
  const post = {
    _id: 'archive-audio-transaction-fail', communityId: 'community-1', authorId: 'member-openid',
    area: 'archive', origin: 'native_archive', format: 'audio', status: 'active', auditStatus: 'pass',
    contentRevision: 'published-r1', pendingContentRevision: 'pending-r2', topics: [],
    content: { title: '旧内容', audios: [{ title: '旧音频', fileID: oldAudio, duration: 10, size: 10, ext: 'mp3' }] },
    pendingContent: { title: '新内容', audios: [] }, createdAt: '2026-08-01T00:00:00.000Z',
  }
  ;(db.runTransaction as jest.Mock).mockRejectedValueOnce(new Error('transaction failed'))

  await expect((applyAuditSummary as any)('archive-audio-transaction-fail', 'pendingContent', 'pass', '', post, 'pending-r2'))
    .rejects.toThrow('transaction failed')
  expect(storage.deleteFile).not.toHaveBeenCalled()
  expect(db.setById).not.toHaveBeenCalledWith('post_media_cleanup_retries', expect.any(String), expect.anything())
})

test('recoverMemberAudioCleanupJobs processes a bounded durable batch for the same post', async () => {
  const scope = 'a5434f589c765f935836d608'
  const orphanAudio = `cloud://test-env/posts/member-audios-finalized/${scope}/orphan.mp3`
  const post: any = {
    _id: 'archive-audio-recover-old-job', communityId: 'community-1', authorId: 'member-openid',
    area: 'archive', origin: 'native_archive', format: 'audio', status: 'active', auditStatus: 'pass',
    contentRevision: 'published-r2', content: { title: '新内容', audios: [] },
  }
  const job: any = {
    _id: 'cleanup-job-old', postId: post._id, communityId: post.communityId, authorId: post.authorId,
    kind: 'audio', fileID: orphanAudio, expectedRevision: 'published-r2', status: 'pending', attempts: 1,
    lastError: 'storage unavailable', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  }
  ;(db.query as jest.Mock).mockImplementation(async (collection: string, where: any, options: any) => {
    if (collection === 'post_media_cleanup_retries') {
      expect(where).toEqual({ postId: post._id, status: 'pending' })
      expect(options).toEqual({ orderBy: ['updatedAt', 'asc'], limit: 20 })
      return [job]
    }
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (collection: string) => collection === 'posts' ? post : null)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => {
    if (collection === 'post_media_cleanup_retries') return job
    if (collection === 'posts') return post
    return null
  })
  ;(db.queryAfterId as jest.Mock).mockResolvedValue([post])
  ;(storage.requestUploadMetadata as jest.Mock).mockImplementation(async (cloudPath: string) => ({ fileId: `cloud://test-env/${cloudPath}` }))
  ;(storage.deleteFile as jest.Mock).mockResolvedValue(undefined)
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  await expect(recoverMemberAudioCleanupJobs({ postId: post._id })).resolves.toBe(1)

  expect(storage.deleteFile).toHaveBeenCalledWith([orphanAudio])
  expect(db.removeById).toHaveBeenCalledWith('post_media_cleanup_retries', expect.any(String))
})

test('approvePostAudit replaces content and removes pendingContent atomically for CloudBase nested object updates', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'post-guide', pendingContentRevision: 'pending-guide-r1', pendingContent: { guide_age: '8岁以上' },
  })

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
    pendingContentRevision: 'pending-archive-r1',
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
  expect(archiveTopicIndex.prepareArchivePostTopicReconciliation).toHaveBeenLastCalledWith(expect.objectContaining({
    _id: 'archive-edit-1', topics: ['新话题'], status: 'active', auditStatus: 'pass',
  }))
})

test('rejectPostAudit rejects pending edits without replacing current content', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'post-1',
    content: { title: 'old title' },
    pendingContentRevision: 'pending-reject-r1',
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

test('handleAuditCallback replaces XML task raw atomically and does not persist callback credentials', async () => {
  process.env.AUDIT_CALLBACK_TOKEN = 'callback-secret'
  const content = { title: 'audited audio' }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'tencent-audio-post', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'tencent-audio-r1', contentRevisionDigest: digest,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  const task: any = {
    _id: 'tencent-audio-task', postId: post._id, contentSlot: 'content', contentRevision: post.contentRevision,
    contentDigest: digest, expectedTargetCount: 1, targetIndex: 0, targetType: 'audio',
    provider: 'tencent_ci', status: 'pending', jobId: 'tencent-audio-job',
    raw: '<Response><JobId>tencent-audio-job</JobId></Response>',
  }
  const callbackRecords = new Map<string, any>()
  const persistedCallbackPayloads: any[] = []
  let persistedCallbackId = ''
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => {
    if (collection === 'posts') return post
    if (id === task._id) return task
    return callbackRecords.get(id) || null
  })
  ;(db.setById as jest.Mock).mockImplementation(async (_collection: string, id: string, data: any) => {
    persistedCallbackId = id
    persistedCallbackPayloads.push(data)
    callbackRecords.set(id, { _id: id, ...data })
  })
  ;(db.removeById as jest.Mock).mockImplementation(async (_collection: string, id: string) => { callbackRecords.delete(id) })
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.jobId === task.jobId) return [task]
    if (where.contentRevision === task.contentRevision) return [task]
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks' && id === task._id
        ? task
        : null
    if (!target) return
    for (const [key, value] of Object.entries(data)) {
      if (key === 'raw' && typeof target.raw === 'string' && value && typeof value === 'object' && !('__set' in value)) {
        throw new Error('PathNotViable: cannot create field in string raw')
      }
      if (value && typeof value === 'object' && '__set' in value) target[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete target[key]
      else target[key] = value
    }
  })

  await expect(handleAuditCallback({
    callbackToken: 'callback-secret',
    token: 'legacy-callback-secret',
    jobId: task.jobId,
    Result: '0',
    Label: 'Normal',
  })).resolves.toEqual({ success: true, matched: 1, status: 'pass' })

  expect(task.status).toBe('pass')
  expect(post.auditStatus).toBe('pass')
  expect(task.raw).toEqual({ jobId: task.jobId, Result: '0', Label: 'Normal' })
  expect(persistedCallbackPayloads).toHaveLength(1)
  expect(persistedCallbackPayloads[0].raw).toEqual({ jobId: task.jobId, Result: '0', Label: 'Normal' })

  task.status = 'pending'
  task.raw = '<Response><JobId>tencent-audio-job</JobId></Response>'
  post.auditStatus = 'pending'
  post.auditReason = 'media audit is pending'
  callbackRecords.set(persistedCallbackId, {
    _id: persistedCallbackId,
    ...persistedCallbackPayloads[0],
    raw: {
      callbackToken: 'previously-stored-secret',
      token: 'previously-stored-legacy-secret',
      jobId: task.jobId,
      Result: '0',
      Label: 'Normal',
    },
  })

  await expect(handleAuditCallback({
    callbackToken: 'callback-secret',
    jobId: task.jobId,
    Result: '0',
    Label: 'Normal',
  })).resolves.toEqual({ success: true, matched: 1, status: 'pass' })

  expect(task.raw).toEqual({ jobId: task.jobId, Result: '0', Label: 'Normal' })
  expect(persistedCallbackPayloads).toHaveLength(1)
})

test('applyWechatMediaAuditResult updates exact trace tasks and refreshes each post slot once', async () => {
  const post1Digest = computeContentRevisionDigest({ title: 'existing' } as any)
  const post2Digest = computeContentRevisionDigest({ title: 'pending' } as any)
  const traceTasks = [
    { _id: 'task-1', postId: 'post-1', contentSlot: 'content', contentRevision: 'post-1-r1', contentDigest: post1Digest, expectedTargetCount: 2, targetIndex: 0, provider: 'wechat', status: 'pending' },
    { _id: 'task-2', postId: 'post-1', contentSlot: 'content', contentRevision: 'post-1-r1', contentDigest: post1Digest, expectedTargetCount: 2, targetIndex: 1, provider: 'wechat', status: 'pending' },
    { _id: 'task-3', postId: 'post-2', contentSlot: 'pendingContent', contentRevision: 'post-2-r1', contentDigest: post2Digest, expectedTargetCount: 1, targetIndex: 0, provider: 'wechat', status: 'pending' },
  ]
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-pass') return traceTasks
    if (where.contentRevision === 'post-1-r1') return [{ ...traceTasks[0], status: 'pass' }, { ...traceTasks[1], status: 'pass' }]
    if (where.contentRevision === 'post-2-r1') return [{ ...traceTasks[2], status: 'pass' }]
    return []
  })
  ;(db.getById as jest.Mock).mockImplementation(async (_collection: string, id: string) => ({
    _id: id,
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'active',
    ...(id === 'post-1'
      ? { contentRevision: 'post-1-r1', contentRevisionDigest: post1Digest }
      : { pendingContentRevision: 'post-2-r1', pendingContentRevisionDigest: post2Digest }),
    content: { title: 'existing' },
    ...(id === 'post-2' ? { pendingContent: { title: 'pending' } } : {}),
  }))

  const result = await applyWechatMediaAuditResult({ traceId: 'trace-pass', suggest: 'pass', label: 100 })

  expect(result).toEqual({ success: true, matched: 3, status: 'pass', refreshed: 2 })
  expect(db.updateById).toHaveBeenCalledWith('content_audit_tasks', 'task-1', expect.objectContaining({
    status: 'pass', suggest: 'pass', label: 100,
  }))
  expect((db.query as jest.Mock).mock.calls.filter(([, where]) => where.contentRevision === 'post-1-r1')).toHaveLength(1)
  expect((db.query as jest.Mock).mock.calls.filter(([, where]) => where.contentRevision === 'post-2-r1')).toHaveLength(1)
  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({ auditStatus: 'pass' }))
  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-2', expect.objectContaining({ auditStatus: 'pass' }))
})

test('the first callback cannot pass a revision before every expected audit task exists', async () => {
  const content = { title: 'two audit targets', summary: 'second target not persisted yet' }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'post-partial-tasks', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'revision-partial', contentRevisionDigest: digest,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  const task: any = {
    _id: 'task-first', postId: post._id, contentSlot: 'content', contentRevision: 'revision-partial', contentDigest: digest,
    expectedTargetCount: 2, targetIndex: 0, provider: 'wechat', status: 'pending', traceId: 'trace-first',
  }
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-first') return [task]
    if (where.contentRevision === 'revision-partial' || where.postId === post._id) return [task]
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'content_audit_tasks' && id === task._id) Object.assign(task, data)
    if (collection === 'posts' && id === post._id) Object.assign(post, data)
  })

  await applyWechatMediaAuditResult({ traceId: 'trace-first', suggest: 'pass', label: 100 })

  expect(post.auditStatus).toBe('pending')
  expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
})

test('revision-indexed aggregation is complete when two 61-target revisions interleave', async () => {
  const content = { title: 'revision B' }
  const digestA = computeContentRevisionDigest({ title: 'revision A' } as any)
  const digestB = computeContentRevisionDigest(content as any)
  const makeTasks = (revision: string, digest: string, prefix: string) => Array.from({ length: 61 }, (_, targetIndex) => ({
    _id: `${prefix}-${targetIndex}`, postId: 'post-interleaved', contentSlot: 'content', contentRevision: revision, contentDigest: digest,
    expectedTargetCount: 61, targetIndex, provider: 'wechat', status: targetIndex === 0 && prefix === 'b' ? 'pending' : 'pass',
    traceId: targetIndex === 0 && prefix === 'b' ? 'trace-b-first' : '', createdAt: `2026-08-17T00:00:${String(targetIndex).padStart(2, '0')}.000Z`,
  }))
  const tasksA: any[] = makeTasks('revision-a-61', digestA, 'a')
  const tasksB: any[] = makeTasks('revision-b-61', digestB, 'b')
  const interleaved = tasksA.flatMap((task, index) => [task, tasksB[index]])
  const post: any = {
    _id: 'post-interleaved', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'revision-b-61', contentRevisionDigest: digestB,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-b-first') return [tasksB[0]]
    if (where.contentRevision) return interleaved.filter((task) => task.contentRevision === where.contentRevision).slice(0, 100)
    if (where.postId === post._id) return interleaved.slice(0, 100)
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'content_audit_tasks') {
      const task = interleaved.find((item) => item._id === id)
      if (task) Object.assign(task, data)
    }
    if (collection === 'posts' && id === post._id) Object.assign(post, data)
  })

  await applyWechatMediaAuditResult({ traceId: 'trace-b-first', suggest: 'pass', label: 100 })

  expect(post.auditStatus).toBe('pass')
  expect(db.query).toHaveBeenCalledWith('content_audit_tasks', { contentRevision: 'revision-b-61' }, { limit: 100 })
})

test('delayed revision A pass cannot publish overwritten revision B and late callbacks stay no-op', async () => {
  const revisionADigest = computeContentRevisionDigest({ title: 'revision A' } as any)
  const revisionBDigest = computeContentRevisionDigest({ title: 'revision B' } as any)
  const currentPost: any = {
    _id: 'post-race', communityId: 'community-1', sectionId: 'section-1', authorId: 'openid-1',
    status: 'active', auditStatus: 'pass', contentRevision: 'published-r0',
    content: { title: 'published' },
    pendingContentRevision: 'pending-rb', pendingContentRevisionDigest: revisionBDigest, pendingAuditStatus: 'pending',
    pendingContent: { title: 'revision B' },
  }
  const tasks: any[] = [{
    _id: 'task-a', postId: 'post-race', contentSlot: 'pendingContent', contentRevision: 'pending-ra', contentDigest: revisionADigest,
    expectedTargetCount: 1, targetIndex: 0,
    provider: 'wechat', status: 'pending', traceId: 'trace-a',
  }]
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId) return tasks.filter((task) => task.traceId === where.traceId)
    if (where.contentRevision) return tasks.filter((task) => task.contentRevision === where.contentRevision)
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(currentPost)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => collection === 'posts' ? currentPost : null)
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    if (collection === 'content_audit_tasks') {
      const task = tasks.find((item) => item._id === id)
      if (task) Object.assign(task, data)
      return
    }
    if (collection !== 'posts' || id !== currentPost._id) return
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__set' in value) currentPost[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete currentPost[key]
      else currentPost[key] = value
    }
  })

  await applyWechatMediaAuditResult({ traceId: 'trace-a', suggest: 'pass', label: 100 })
  tasks.push({
    _id: 'task-b', postId: 'post-race', contentSlot: 'pendingContent', contentRevision: 'pending-rb', contentDigest: revisionBDigest,
    expectedTargetCount: 1, targetIndex: 0,
    provider: 'wechat', status: 'pending', traceId: 'trace-b',
  })
  await applyWechatMediaAuditResult({ traceId: 'trace-b', suggest: 'rejected', label: 20001 })
  await applyWechatMediaAuditResult({ traceId: 'trace-a', suggest: 'pass', label: 100 })

  expect(currentPost.content).toEqual({ title: 'published' })
  expect(currentPost.contentRevision).toBe('published-r0')
  expect(currentPost.pendingContent).toEqual({ title: 'revision B' })
  expect(currentPost.pendingContentRevision).toBe('pending-rb')
  expect(currentPost.pendingAuditStatus).toBe('rejected')
})

test('applyWechatMediaAuditResult acknowledges unknown traces without mutation', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([])

  await expect(applyWechatMediaAuditResult({ traceId: 'unknown', suggest: 'review', label: undefined }))
    .resolves.toEqual({ success: true, matched: 0, status: 'review', refreshed: 0 })

  expect(db.updateById).not.toHaveBeenCalled()
  expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
})

test('legacy revisionless audit callbacks update their task but conservatively leave the post unchanged', async () => {
  const task = {
    _id: 'legacy-task', postId: 'legacy-post', contentSlot: 'content', provider: 'wechat',
    status: 'pending', traceId: 'legacy-trace',
  }
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => (
    where.traceId === 'legacy-trace' ? [task] : []
  ))

  await expect(applyWechatMediaAuditResult({ traceId: 'legacy-trace', suggest: 'pass', label: 100 }))
    .resolves.toEqual({ success: true, matched: 1, status: 'pass', refreshed: 0 })

  expect(db.updateById).toHaveBeenCalledWith('content_audit_tasks', 'legacy-task', expect.objectContaining({ status: 'pass' }))
  expect((db.updateById as jest.Mock).mock.calls.some(([collection]) => collection === 'posts')).toBe(false)
  expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
})

test('applyWechatMediaAuditResult is idempotent for duplicate rejected delivery', async () => {
  const contentDigest = computeContentRevisionDigest({} as any)
  const task = {
    _id: 'task-1', postId: 'post-1', contentSlot: 'content', contentRevision: 'post-r1', contentDigest,
    expectedTargetCount: 1, targetIndex: 0,
    provider: 'wechat', status: 'pending',
  }
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === 'trace-rejected') return [task]
    if (where.contentRevision === 'post-r1') return [{ ...task, status: 'rejected', reason: 'wechat media rejected' }]
    return []
  })
  let postStatus = 'pending'
  ;(db.getById as jest.Mock).mockImplementation(async () => ({
    _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', content: {},
    contentRevision: 'post-r1', contentRevisionDigest: contentDigest,
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

test('manual pending rejection rotates the revision so a delayed pass callback is a full no-op', async () => {
  const content = { title: 'manual wins' }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'manual-terminal-post', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content: { title: 'published' }, contentRevision: 'published-r1', auditStatus: 'pass',
    pendingContent: content, pendingContentRevision: 'pending-machine-r1', pendingContentRevisionDigest: digest,
    pendingAuditStatus: 'pending', pendingAuditReason: 'media audit is pending',
  }
  const task: any = {
    _id: 'manual-terminal-task', postId: post._id, contentSlot: 'pendingContent',
    contentRevision: 'pending-machine-r1', contentDigest: digest, expectedTargetCount: 1, targetIndex: 0,
    provider: 'wechat', status: 'pending', traceId: 'manual-terminal-trace',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => (
    collection === 'posts' ? post : null
  ))
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === task.traceId) return [task]
    if (where.contentRevision === task.contentRevision) return [task]
    return []
  })
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks' && id === task._id
        ? task
        : null
    if (!target) return
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__set' in value) target[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete target[key]
      else target[key] = value
    }
  })

  await rejectPostAudit(post._id, 'manual reject')
  const terminalRevision = post.pendingContentRevision
  await applyWechatMediaAuditResult({ traceId: task.traceId, suggest: 'pass', label: 100 })

  expect(terminalRevision).toEqual(expect.any(String))
  expect(terminalRevision).not.toBe('pending-machine-r1')
  expect(post.pendingContent).toEqual(content)
  expect(post.pendingAuditStatus).toBe('rejected')
  expect(post.pendingAuditReason).toBe('manual reject')
})

test('manual direct-content rejection clears revision-bound staged metadata', async () => {
  const content = { title: 'rejected direct content' }
  const post: any = {
    _id: 'manual-direct-reject', communityId: 'community-1', status: 'active',
    content, contentRevision: 'direct-r1', contentRevisionDigest: computeContentRevisionDigest(content as any),
    contentAuditTopics: ['待审话题'], contentAuditPresentation: { textNoteTheme: 'mint' },
    auditStatus: 'review',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)

  await rejectPostAudit(post._id, 'manual reject')

  expect(db.updateById).toHaveBeenCalledWith('posts', post._id, expect.objectContaining({
    contentAuditTopics: { __remove: true },
    contentAuditPresentation: { __remove: true },
  }))
})

test('async direct-content pass promotes revision-bound archive topics and presentation', async () => {
  const content = { title: 'new direct content' }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'direct-metadata-post', communityId: 'community-1', area: 'archive', format: 'text', status: 'active',
    content, contentRevision: 'direct-metadata-r1', contentRevisionDigest: digest,
    contentAuditTopics: ['新话题'], contentAuditPresentation: { textNoteTheme: 'mint' },
    topics: ['旧话题'], presentation: { textNoteTheme: 'paper' }, auditStatus: 'pending', auditReason: 'media audit is pending',
    createdAt: '2026-08-17T00:00:00.000Z',
  }
  const task: any = {
    _id: 'direct-metadata-task', postId: post._id, contentSlot: 'content', contentRevision: post.contentRevision,
    contentDigest: digest, expectedTargetCount: 1, targetIndex: 0, provider: 'wechat', status: 'pending',
    traceId: 'direct-metadata-trace',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => (
    collection === 'posts' ? post : null
  ))
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === task.traceId) return [task]
    if (where.contentRevision === task.contentRevision) return [task]
    return []
  })
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks' && id === task._id
        ? task
        : null
    if (!target) return
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__set' in value) target[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete target[key]
      else target[key] = value
    }
  })

  await applyWechatMediaAuditResult({ traceId: task.traceId, suggest: 'pass', label: 100 })

  expect(post.auditStatus).toBe('pass')
  expect(post.topics).toEqual(['新话题'])
  expect(post.presentation).toEqual({ textNoteTheme: 'mint' })
  expect(post.contentAuditTopics).toBeUndefined()
  expect(post.contentAuditPresentation).toBeUndefined()
})

test('auditAndApply re-aggregates after all expected tasks are durable when the first callback was early', async () => {
  const content = { cover: 'cloud://env/cover.jpg', title: 'sync text' }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'barrier-post', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'barrier-r1', contentRevisionDigest: digest,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  const tasks: any[] = []
  let releaseText!: () => void
  const textGate = new Promise<void>((resolve) => { releaseText = resolve })
  ;(postWxJson as jest.Mock).mockImplementation(async (_path: string, payload: any) => {
    if (payload.media_url) return { trace_id: 'barrier-trace' }
    await textGate
    return { result: { suggest: 'pass', label: 'normal' }, trace_id: 'text-trace' }
  })
  ;(db.create as jest.Mock).mockImplementation(async (_collection: string, data: any) => {
    const task = { _id: `barrier-task-${tasks.length}`, ...data }
    tasks.push(task)
    if (data.traceId === 'barrier-trace') {
      await applyWechatMediaAuditResult({ traceId: 'barrier-trace', suggest: 'pass', label: 100 })
      releaseText()
    }
    return task._id
  })
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId) return tasks.filter((task) => task.traceId === where.traceId)
    if (where.contentRevision) return tasks.filter((task) => task.contentRevision === where.contentRevision)
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string) => (
    collection === 'posts' ? post : null
  ))
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks'
        ? tasks.find((task) => task._id === id)
        : null
    if (target) Object.assign(target, data)
  })

  await auditAndApply({
    postId: post._id, communityId: post.communityId, sectionId: post.sectionId,
    section: { widgets: [
      { widgetId: 'cover', type: 'image_group', label: '封面' },
      { widgetId: 'title', type: 'short_text', label: '标题' },
    ] } as any,
    content: { cover: [content.cover], title: content.title } as any,
    authorId: 'openid-1', source: 'user', contentSlot: 'content',
    contentRevision: post.contentRevision, contentDigest: digest,
  })

  expect(tasks).toHaveLength(2)
  expect(post.auditStatus).toBe('pass')
})

test('an unmatched callback persisted before its task is reconciled after task creation', async () => {
  const content = { cover: ['cloud://env/cover.jpg'] }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'inbox-post', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'inbox-r1', contentRevisionDigest: digest,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  const tasks: any[] = []
  const documents = new Map<string, any>()
  const ordering: string[] = []
  let activeTransactionReads = 0
  ;(postWxJson as jest.Mock).mockImplementation(async () => {
    await applyWechatMediaAuditResult({ traceId: 'callback-before-task', suggest: 'pass', label: 100 })
    return { trace_id: 'callback-before-task' }
  })
  ;(db.create as jest.Mock).mockImplementation(async (_collection: string, data: any) => {
    const task = { _id: 'inbox-task', ...data }
    tasks.push(task)
    return task._id
  })
  ;(db.setById as jest.Mock).mockImplementation(async (_collection: string, id: string, data: any) => {
    ordering.push('callback-durable')
    documents.set(id, { _id: id, ...data })
  })
  ;(db.removeById as jest.Mock).mockImplementation(async (_collection: string, id: string) => { documents.delete(id) })
  ;(db.getByIdOrNull as jest.Mock).mockImplementation(async (_collection: string, id: string) => documents.get(id) || null)
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => {
    activeTransactionReads += 1
    if (activeTransactionReads > 1) {
      activeTransactionReads -= 1
      throw new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
    }
    try {
      await new Promise((resolve) => setImmediate(resolve))
      if (collection === 'posts') return post
      return documents.get(id) || null
    } finally {
      activeTransactionReads -= 1
    }
  })
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId) {
      ordering.push('callback-task-query')
      return tasks.filter((task) => task.traceId === where.traceId)
    }
    if (where.contentRevision) return tasks.filter((task) => task.contentRevision === where.contentRevision)
    return []
  })
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks'
        ? tasks.find((task) => task._id === id)
        : null
    if (target) Object.assign(target, data)
  })

  await auditAndApply({
    postId: post._id, communityId: post.communityId, sectionId: post.sectionId,
    section: { widgets: [{ widgetId: 'cover', type: 'image_group', label: '封面' }] } as any,
    content, authorId: 'openid-1', source: 'user', contentSlot: 'content',
    contentRevision: post.contentRevision, contentDigest: digest,
  })

  expect(tasks).toHaveLength(1)
  expect(tasks[0].status).toBe('pass')
  expect(post.auditStatus).toBe('pass')
  expect(ordering.indexOf('callback-durable')).toBeLessThan(ordering.indexOf('callback-task-query'))
  expect(documents.size).toBe(0)
})

test('the first durable callback result is idempotent and cannot be reversed by a duplicate terminal callback', async () => {
  const content = { cover: ['cloud://env/cover.jpg'] }
  const digest = computeContentRevisionDigest(content as any)
  const post: any = {
    _id: 'callback-terminal-post', communityId: 'community-1', sectionId: 'section-1', status: 'active',
    content, contentRevision: 'callback-terminal-r1', contentRevisionDigest: digest,
    auditStatus: 'pending', auditReason: 'media audit is pending',
  }
  const task: any = {
    _id: 'callback-terminal-task', postId: post._id, contentSlot: 'content', contentRevision: post.contentRevision,
    contentDigest: digest, expectedTargetCount: 1, targetIndex: 0, provider: 'wechat', status: 'pending',
    traceId: 'callback-terminal-trace',
  }
  const documents = new Map<string, any>()
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (_transaction, collection: string, id: string) => {
    if (collection === 'posts') return post
    return documents.get(id) || null
  })
  ;(db.setById as jest.Mock).mockImplementation(async (_collection: string, id: string, data: any) => {
    documents.set(id, { _id: id, ...data })
  })
  ;(db.removeById as jest.Mock).mockImplementation(async (_collection: string, id: string) => { documents.delete(id) })
  ;(db.getByIdOrNull as jest.Mock).mockImplementation(async (_collection: string, id: string) => documents.get(id) || null)
  ;(db.getById as jest.Mock).mockResolvedValue(post)
  ;(db.query as jest.Mock).mockImplementation(async (_collection: string, where: any) => {
    if (where.traceId === task.traceId) return [task]
    if (where.contentRevision === task.contentRevision) return [task]
    return []
  })
  ;(db.updateById as jest.Mock).mockImplementation(async (collection: string, id: string, data: any) => {
    const target = collection === 'posts' && id === post._id
      ? post
      : collection === 'content_audit_tasks' && id === task._id
        ? task
        : null
    if (!target) return
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object' && '__set' in value) target[key] = (value as any).__set
      else if (value && typeof value === 'object' && '__remove' in value) delete target[key]
      else target[key] = value
    }
  })

  await applyWechatMediaAuditResult({ traceId: task.traceId, suggest: 'pass', label: 100 })
  await applyWechatMediaAuditResult({ traceId: task.traceId, suggest: 'rejected', label: 20001 })

  expect(task.status).toBe('pass')
  expect(post.auditStatus).toBe('pass')
  expect(post.auditReason).toBe('')
  expect(documents.size).toBe(0)
})
