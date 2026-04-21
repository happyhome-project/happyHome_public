jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
}))

jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import { main } from '../index'
import * as db from '../../../lib/db'

beforeEach(() => jest.clearAllMocks())

test('member.kick：只能移出 active 普通成员', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({
      _id: 'member-1',
      communityId: 'community-1',
      userId: 'user-1',
      role: 'member',
      status: 'active',
    })
  ;(db.removeById as jest.Mock).mockResolvedValue({})
  ;(db.increment as jest.Mock).mockResolvedValue({})

  const result = await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-1' })

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-1')
  expect(db.increment).toHaveBeenCalledWith('communities', 'community-1', 'memberCount', -1)
  expect(result).toEqual({ success: true })
})

test('member.list：会物理清理历史 left 记录并且不返回', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({ _id: 'u-active', nickName: 'Active User', avatarUrl: '' })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'member-left-1', communityId: 'community-1', userId: 'u-left', role: 'member', status: 'left' },
    { _id: 'member-active-1', communityId: 'community-1', userId: 'u-active', role: 'member', status: 'active' },
  ])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({ action: 'member.list', communityId: 'community-1', status: 'all' })

  expect(db.removeById).toHaveBeenCalledWith('community_members', 'member-left-1')
  expect(result.members).toHaveLength(1)
  expect(result.members[0]._id).toBe('member-active-1')
})

test('member.kick：不能移出社区创建者', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({
      _id: 'member-1',
      communityId: 'community-1',
      userId: 'creator-1',
      role: 'member',
      status: 'active',
    })

  await expect(main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-1' }))
    .rejects.toThrow('不能移出社区创建者')
})

test('member.kick：不能移出管理员', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({
      _id: 'member-1',
      communityId: 'community-1',
      userId: 'admin-1',
      role: 'admin',
      status: 'active',
    })

  await expect(main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-1' }))
    .rejects.toThrow('不能移出管理员')
})

test('section.updateWidgets：有帖子且删除控件时需要确认', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'w2', type: 'rich_text', label: '内容', fieldKey: 'body', required: false, order: 1, showInList: false },
    ],
  })
  ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'post-1', status: 'active' }])

  const preview: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    preview: true,
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
    ],
  })

  expect(preview.requireConfirmation).toBe(true)
  expect(preview.structuralChanges.removedWidgetIds).toEqual(['w2'])

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
    ],
  })).rejects.toThrow('板块已有内容，本次结构变更需要确认')
})

test('post.deleteAdmin：走软删除', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'post-1', status: 'active' })
  ;(db.softDelete as jest.Mock).mockResolvedValue({})

  const result = await main({ action: 'post.deleteAdmin', postId: 'post-1' })

  expect(db.softDelete).toHaveBeenCalledWith('posts', 'post-1')
  expect(result).toEqual({ success: true })
})
