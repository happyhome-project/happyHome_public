jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'test-openid' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))
jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
  softDelete: jest.fn(),
}))
jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import {
  handleCreate,
  handleGet,
  handleList,
  handleUpdateWidgets,
  handleUpdate,
  main,
} from '../index'
import * as db from '../../../lib/db'
import type { Widget } from '../../../shared/types'

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DEFAULT_PUBLIC_COMMUNITY_ID
  delete process.env.PUBLIC_READ_COMMUNITY_IDS
})

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    widgetId: 'existing-uuid',
    type: 'short_text',
    label: '标题',
    fieldKey: 'title',
    required: false,
    order: 0,
    showInList: false,
    ...overrides,
  }
}

test('创建板块：管理员可以创建，widgets 初始为空', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.create as jest.Mock).mockResolvedValue('section-1')

  const result = await handleCreate({
    communityId: 'c1',
    name: '日记',
    icon: 'book',
    order: 1,
  }, 'test-openid')

  expect(db.create).toHaveBeenCalledWith('sections', expect.objectContaining({
    widgets: [],
    communityId: 'c1',
  }))
  expect(result.sectionId).toBe('section-1')
})

test('创建板块：非管理员无权创建', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleCreate({ communityId: 'c1', name: '日记', icon: 'book', order: 1 }, 'test-openid'))
    .rejects.toThrow('权限不足')
})

test('get：返回板块信息', async () => {
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'sections') return { _id: 'section-1', communityId: 'c1', name: '日记' }
    if (collectionName === 'communities') return { _id: 'c1', status: 'active' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])

  const result = await handleGet({ sectionId: 'section-1' }, 'test-openid')

  expect(db.getById).toHaveBeenCalledWith('sections', 'section-1')
  expect(result.section).toHaveProperty('_id', 'section-1')
})

test('list：按 order asc 返回社区所有板块', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'c1', status: 'active' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
    .mockResolvedValueOnce([
      { _id: 's1', order: 1 },
      { _id: 's2', order: 2 },
    ])

  const result = await handleList({ communityId: 'c1' }, 'test-openid')

  expect((db.query as jest.Mock).mock.calls[1]).toEqual(['sections', { communityId: 'c1' }, { orderBy: ['order', 'asc'] }])
  expect(result.sections).toHaveLength(2)
})

test('updateWidgets：showInList 超过 3 个时抛出错误', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', showInList: true }),
    makeWidget({ widgetId: 'w2', showInList: true }),
    makeWidget({ widgetId: 'w3', showInList: true }),
    makeWidget({ widgetId: 'w4', showInList: true }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid'))
    .rejects.toThrow('showInList 最多只能有 3 个控件')
})

test('updateWidgets：image_group 不能设为 showInList', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', type: 'image_group', showInList: true }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid'))
    .rejects.toThrow('不支持在列表展示')
})

test('updateWidgets：rich_text 不能设为 showInList', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', type: 'rich_text', showInList: true }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid'))
    .rejects.toThrow('不支持在列表展示')
})

test('updateWidgets：控件标签为占位文案时应报错', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', label: '新控件' }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid'))
    .rejects.toThrow('控件标签名不能为空或占位文案')
})

test('updateWidgets：新控件自动分配 UUID', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({ widgetId: '', label: '拼车说明' }), // empty widgetId
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid')

  expect(result.widgets[0].widgetId).toBe('mocked-uuid')
})

test('updateWidgets：已有 widgetId 的控件不被重新分配', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'existing-uuid-123', label: '已有控件' }),
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid')

  expect(result.widgets[0].widgetId).toBe('existing-uuid-123')
})

test('updateWidgets：showInList 恰好 3 个时成功', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', showInList: true }),
    makeWidget({ widgetId: 'w2', showInList: true }),
    makeWidget({ widgetId: 'w3', showInList: true }),
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid')
  expect(result.widgets).toHaveLength(3)
})

test('updateWidgets：公告正文支持 emoji 且不会截断半个表情', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({
      widgetId: 'notice-1',
      type: 'admin_notice',
      label: '近期课程',
      fieldKey: 'notice',
      required: true,
      showInList: true,
      noticeContent: ` ${'😀'.repeat(501)} `,
    }),
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }, 'test-openid')

  expect(result.widgets[0]).toEqual(expect.objectContaining({
    required: false,
    showInList: false,
  }))
  expect(Array.from(result.widgets[0].noticeContent || '')).toHaveLength(500)
  expect(result.widgets[0].noticeContent).toBe('😀'.repeat(500))
})

// --- handleUpdate 测试 ---

test('update：管理员可以更新板块名称', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleUpdate({
    sectionId: 's1',
    communityId: 'c1',
    name: '新名称',
  }, 'test-openid')

  expect(db.updateById).toHaveBeenCalledWith('sections', 's1', { name: '新名称' })
  expect(result.success).toBe(true)
})

test('update：非管理员无权更新', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleUpdate({
    sectionId: 's1',
    communityId: 'c1',
    name: '新名称',
  }, 'test-openid')).rejects.toThrow('权限不足')
})

test('update：不会把 sectionId/communityId 写入更新数据', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await handleUpdate({
    sectionId: 's1',
    communityId: 'c1',
    icon: 'star',
    enableComment: false,
  }, 'test-openid')

  const updateData = (db.updateById as jest.Mock).mock.calls[0][2]
  expect(updateData).not.toHaveProperty('sectionId')
  expect(updateData).not.toHaveProperty('communityId')
  expect(updateData).toEqual({ icon: 'star', enableComment: false })
})

test('update：缺少 OPENID 时抛出错误', async () => {
  await expect(handleUpdate({
    sectionId: 's1',
    communityId: 'c1',
    name: '新名称',
  }, '')).rejects.toThrow('Missing OPENID')
})

// --- main() 路由测试 ---

test('main(): action=update 正确路由', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await main({ action: 'update', sectionId: 's1', communityId: 'c1', name: 'test' })
  expect(result).toEqual({ success: true })
})

test('list：非 active 成员不可查看板块内容', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(main({ action: 'list', communityId: 'c1' })).rejects.toThrow('需要先加入社区后查看内容')
})

test('list: unauthenticated viewer can read active public community sections', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'c1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'communities' && id === 'c1') return { _id: 'c1', status: 'active' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 's1', communityId: 'c1', name: '公告', order: 1 },
  ])

  const result = await handleList({ communityId: 'c1' }, '')

  expect(result.sections.map((section: any) => section._id)).toEqual(['s1'])
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('get：active 成员可查看板块详情', async () => {
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'sections') return { _id: 's1', communityId: 'c1', name: '拼车' }
    if (collectionName === 'communities') return { _id: 'c1', status: 'active' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])

  const result: any = await main({ action: 'get', sectionId: 's1' })

  expect(result.section?._id).toBe('s1')
})

test('get: unauthenticated viewer can read active public community section detail', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  process.env.PUBLIC_READ_COMMUNITY_IDS = 'c1'
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'sections' && id === 's1') return { _id: 's1', communityId: 'c1', name: '公告' }
    if (collectionName === 'communities' && id === 'c1') return { _id: 'c1', status: 'active' }
    return null
  })

  const result = await handleGet({ sectionId: 's1' }, '')

  expect(result.section?._id).toBe('s1')
  expect((db.query as jest.Mock).mock.calls.some(([collection]) => collection === 'community_members')).toBe(false)
})

test('get: guest mode ignores injected openid membership for private section detail', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 's1', communityId: 'c1', name: '私密板块' })
  ;(db.query as jest.Mock).mockImplementation(async (collectionName: string, where: any) => {
    if (collectionName === 'community_members' && where.userId === 'wx-injected-openid') {
      return [{ _id: 'm1', communityId: 'c1', status: 'active' }]
    }
    return []
  })

  await expect(handleGet({ sectionId: 's1', asGuest: true }, 'wx-injected-openid'))
    .rejects.toThrow('需要先加入社区后查看内容')
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
