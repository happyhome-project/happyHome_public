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

import { handleCreate, handleList, handleGet, handleDelete, handleUpdate, main } from '../index'
import * as db from '../../../lib/db'
import type { Section } from '../../../shared/types'

beforeEach(() => jest.clearAllMocks())

const mockSection: Section = {
  _id: 'section-1',
  communityId: 'c1',
  name: '日记',
  icon: 'book',
  order: 1,
  enableComment: true,
  enableLike: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  widgets: [
    {
      widgetId: 'widget-uuid-1',
      type: 'short_text',
      label: '标题',
      fieldKey: 'title',
      required: true,
      order: 0,
      showInList: true,
    },
    {
      widgetId: 'widget-uuid-2',
      type: 'rich_text',
      label: '内容',
      fieldKey: 'body',
      required: false,
      order: 1,
      showInList: false,
    },
  ],
}

test('发帖：校验 required 控件必须填写（空内容）', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }]) // active member
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)

  await expect(handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: {}, // required widget not filled
  })).rejects.toThrow('必填项未填写：标题')
})

test('发帖：required 控件有值时正常创建', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  const result = await handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'widget-uuid-1': '我的日记标题' },
  })

  expect(db.create).toHaveBeenCalledWith('posts', expect.objectContaining({
    authorId: 'test-openid',
    status: 'active',
    communityId: 'c1',
  }))
  expect(result.postId).toBe('post-1')
})

test('发帖：非社区成员不能发帖', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // not a member

  await expect(handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'widget-uuid-1': '标题' },
  })).rejects.toThrow('非社区成员，无法发帖')

  expect(db.getById).not.toHaveBeenCalled()
  expect(db.create).not.toHaveBeenCalled()
})

test('发帖：content key 使用 widgetId 而非 fieldKey', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-1')

  // fieldKey is 'title' but content should use widgetId 'widget-uuid-1'
  // Using fieldKey 'title' should not satisfy required validation
  await expect(handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'title': '标题内容' }, // wrong key (fieldKey instead of widgetId)
  })).rejects.toThrow('必填项未填写：标题')
})

test('删帖：只有发帖人可以删', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'post-1',
    authorId: 'another-user', // different from test-openid
    status: 'active',
  })

  await expect(handleDelete({ postId: 'post-1' })).rejects.toThrow('无权删除')
  expect(db.softDelete).not.toHaveBeenCalled()
})

test('删帖：发帖人可以软删除', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'post-1',
    authorId: 'test-openid',
    status: 'active',
  })
  ;(db.softDelete as jest.Mock).mockResolvedValue({})

  await handleDelete({ postId: 'post-1' })

  expect(db.softDelete).toHaveBeenCalledWith('posts', 'post-1')
})

test('改帖：只有发帖人可以修改', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    sectionId: 'section-1',
    authorId: 'another-user',
    status: 'active',
  })

  await expect(handleUpdate({
    postId: 'post-1',
    content: { 'widget-uuid-1': '新标题' },
  })).rejects.toThrow('无权修改')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('改帖：required 控件为空时失败', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      sectionId: 'section-1',
      authorId: 'test-openid',
      status: 'active',
    })
    .mockResolvedValueOnce(mockSection)

  await expect(handleUpdate({
    postId: 'post-1',
    content: {},
  })).rejects.toThrow('必填项未填写：标题')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('改帖：作者可修改，更新 content 与 updatedAt', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      sectionId: 'section-1',
      authorId: 'test-openid',
      status: 'active',
    })
    .mockResolvedValueOnce(mockSection)
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result = await handleUpdate({
    postId: 'post-1',
    content: { 'widget-uuid-1': '修改后的标题' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    content: { 'widget-uuid-1': '修改后的标题' },
  }))
  expect(result.success).toBe(true)
  expect(result.updatedAt).toBeTruthy()
})

test('list：按 createdAt desc 分页查询', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    { _id: 'p1', createdAt: '2024-02-01' },
    { _id: 'p2', createdAt: '2024-01-01' },
  ])

  const result = await handleList({ sectionId: 'section-1', skip: 0, limit: 10 })

  expect(db.query).toHaveBeenCalledWith('posts', { sectionId: 'section-1', status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
    skip: 0,
    limit: 10,
  })
  expect(result.posts).toHaveLength(2)
})

test('get：返回单个帖子', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'post-1', status: 'active' })

  const result = await handleGet({ postId: 'post-1' })

  expect(db.getById).toHaveBeenCalledWith('posts', 'post-1')
  expect(result.post).toHaveProperty('_id', 'post-1')
})

test('get：已删除帖子抛出错误', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'post-1', status: 'deleted' })

  await expect(handleGet({ postId: 'post-1' })).rejects.toThrow('帖子不存在')
})

test('删帖：帖子已删除时抛出错误', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'post-1',
    authorId: 'test-openid',
    status: 'deleted',
  })

  await expect(handleDelete({ postId: 'post-1' })).rejects.toThrow('帖子已删除')
  expect(db.softDelete).not.toHaveBeenCalled()
})

test('发帖：required 字段值为 null 时校验失败', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)

  await expect(handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'widget-uuid-1': null as any },
  })).rejects.toThrow('必填项未填写：标题')
})

test('发帖：required 字段值为空数组时校验失败', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)

  await expect(handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'widget-uuid-1': [] as any },
  })).rejects.toThrow('必填项未填写：标题')
})

test('发帖：非 required 字段留空时正常创建', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
  ;(db.getById as jest.Mock).mockResolvedValue(mockSection)
  ;(db.create as jest.Mock).mockResolvedValue('post-2')

  // widget-uuid-2 is not required, so omitting it is fine
  const result = await handleCreate({
    communityId: 'c1',
    sectionId: 'section-1',
    content: { 'widget-uuid-1': '标题' },
  })
  expect(result.postId).toBe('post-2')
})

test('list：默认 skip=0, limit=20', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([])

  await handleList({ sectionId: 'section-1' })

  expect(db.query).toHaveBeenCalledWith('posts', { sectionId: 'section-1', status: 'active' }, {
    orderBy: ['createdAt', 'desc'],
    skip: 0,
    limit: 20,
  })
})

test('main(): 未知 action 抛出错误', async () => {
  await expect(main({ action: 'unknown' })).rejects.toThrow('Unknown action: unknown')
})
