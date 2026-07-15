jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  query: jest.fn(),
}))

import * as db from '../../../lib/db'
import { main } from '../index'

beforeEach(() => {
  jest.clearAllMocks()
})

test('listActive returns the single global active catalog ordered by template order', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([
    {
      _id: 'tpl-carpool',
      systemKey: 'carpool',
      name: ' 拼车出行 ',
      icon: '🚗',
      order: 0,
      status: 'active',
      widgets: [],
    },
  ])

  const result: any = await main({ action: 'listActive' })

  expect(db.query).toHaveBeenCalledWith(
    'collaboration_templates',
    { status: 'active' },
    { orderBy: ['order', 'asc'] },
  )
  expect(result.templates).toEqual([
    expect.objectContaining({ _id: 'tpl-carpool', systemKey: 'carpool', name: '拼车出行' }),
  ])
})

test('get returns disabled templates so historical posts remain renderable', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'tpl-disabled',
    systemKey: 'old-template',
    name: '旧模板',
    icon: '',
    order: 8,
    status: 'disabled',
    widgets: [],
  })

  const result: any = await main({ action: 'get', templateId: 'tpl-disabled' })

  expect(db.getById).toHaveBeenCalledWith('collaboration_templates', 'tpl-disabled')
  expect(result.template).toEqual(expect.objectContaining({ status: 'disabled' }))
})

test('get rejects an empty template id', async () => {
  await expect(main({ action: 'get', templateId: '  ' })).rejects.toThrow('templateId 不能为空')
})

test('unknown action is rejected', async () => {
  await expect(main({ action: 'create' })).rejects.toThrow('Unknown action: create')
})
