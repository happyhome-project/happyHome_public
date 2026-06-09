jest.mock('../db', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  query: jest.fn(),
  updateById: jest.fn(),
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
  isPostVisibleToMembers,
  rejectPostAudit,
} from '../content-audit'
import * as db from '../db'

beforeEach(() => jest.clearAllMocks())

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
    content: { title: 'new title' },
    pendingContent: null,
    pendingAuditStatus: 'pass',
    auditStatus: 'pass',
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
