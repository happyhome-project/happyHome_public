jest.mock('../db', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  query: jest.fn(),
  updateById: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
}))

jest.mock('../storage', () => ({
  getTempUrl: jest.fn(async (fileID: string) => `https://temp.example.com/${encodeURIComponent(fileID)}`),
}))

jest.mock('../wx-openapi', () => ({
  postWxJson: jest.fn(),
}))

import {
  approvePostAudit,
  extractAuditTargets,
  handleAuditCallback,
  isPostVisibleToMembers,
  rejectPostAudit,
} from '../content-audit'
import * as db from '../db'

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

test('approvePostAudit promotes pendingContent and marks the post as passed', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'post-1', pendingContent: { title: 'new title' } })
    .mockResolvedValueOnce({ _id: 'post-1', pendingContent: { title: 'new title' } })

  await approvePostAudit('post-1')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    content: { __set: { title: 'new title' } },
    pendingContent: { __remove: true },
    pendingAuditStatus: 'pass',
    auditStatus: 'pass',
  }))
})

test('approvePostAudit replaces content and removes pendingContent atomically for CloudBase nested object updates', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'post-guide', pendingContent: { guide_age: '8岁以上' } })
    .mockResolvedValueOnce({ _id: 'post-guide', pendingContent: { guide_age: '8岁以上' } })

  await approvePostAudit('post-guide')

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-guide', expect.objectContaining({
    content: { __set: { guide_age: '8岁以上' } },
    pendingContent: { __remove: true },
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
