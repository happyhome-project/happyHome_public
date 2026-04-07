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

beforeEach(() => jest.clearAllMocks())

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
  })

  expect(db.create).toHaveBeenCalledWith('sections', expect.objectContaining({
    widgets: [],
    communityId: 'c1',
  }))
  expect(result.sectionId).toBe('section-1')
})

test('创建板块：非管理员无权创建', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([])

  await expect(handleCreate({ communityId: 'c1', name: '日记', icon: 'book', order: 1 }))
    .rejects.toThrow('权限不足')
})

test('get：返回板块信息', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'section-1', name: '日记' })

  const result = await handleGet({ sectionId: 'section-1' })

  expect(db.getById).toHaveBeenCalledWith('sections', 'section-1')
  expect(result.section).toHaveProperty('_id', 'section-1')
})

test('list：按 order asc 返回社区所有板块', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 's1', order: 1 },
    { _id: 's2', order: 2 },
  ])

  const result = await handleList({ communityId: 'c1' })

  expect(db.query).toHaveBeenCalledWith('sections', { communityId: 'c1' }, { orderBy: ['order', 'asc'] })
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

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }))
    .rejects.toThrow('showInList 最多只能有 3 个控件')
})

test('updateWidgets：image_group 不能设为 showInList', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', type: 'image_group', showInList: true }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }))
    .rejects.toThrow('不支持在列表展示')
})

test('updateWidgets：rich_text 不能设为 showInList', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'w1', type: 'rich_text', showInList: true }),
  ]

  await expect(handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets }))
    .rejects.toThrow('不支持在列表展示')
})

test('updateWidgets：新控件自动分配 UUID', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({ widgetId: '', label: '新控件' }), // empty widgetId
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets })

  expect(result.widgets[0].widgetId).toBe('mocked-uuid')
})

test('updateWidgets：已有 widgetId 的控件不被重新分配', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ role: 'admin', status: 'active' }])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const widgets: Widget[] = [
    makeWidget({ widgetId: 'existing-uuid-123', label: '已有控件' }),
  ]

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets })

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

  const result = await handleUpdateWidgets({ communityId: 'c1', sectionId: 's1', widgets })
  expect(result.widgets).toHaveLength(3)
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
