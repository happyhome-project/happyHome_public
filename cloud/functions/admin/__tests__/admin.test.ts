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
  queryAfterId: jest.fn(),
  increment: jest.fn(),
  runTransaction: jest.fn(),
  transactionGetByIdOrNull: jest.fn(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  }),
}))

jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
}))

jest.mock('../../../lib/amap', () => ({
  searchAmapPoi: jest.fn(),
}))

jest.mock('../../../lib/post-search', () => ({
  backfillPostSearchIndexesForCommunity: jest.fn(),
  backfillPostSearchIndexesForSection: jest.fn(),
  backfillPostSearchIndexesForSectionBatch: jest.fn(),
  refreshPostSearchIndexById: jest.fn(),
  removePostSearchIndex: jest.fn(),
  removePostSearchIndexesForSection: jest.fn(),
}))

jest.mock('../../../lib/post-rag', () => ({
  backfillPostRagJobsForSectionBatch: jest.fn(),
  enqueuePostRagDeleteJobInTransaction: jest.fn(),
  enqueuePostRagJob: jest.fn(),
  getPostRagIndexHealthForCommunity: jest.fn(),
  reconcilePostRagJobsForCommunityBatch: jest.fn(),
}))

jest.mock('../../../lib/post-rag-outbox', () => ({ appendPostRagOutboxEvent: jest.fn() }))
jest.mock('../../../lib/post-rag-v2-health', () => ({ getPostRagV2Health: jest.fn() }))
jest.mock('../../../lib/post-rag-release-probe',()=>({createPostRagReleaseProbe:jest.fn(),readPostRagReleaseTimerEvidence:jest.fn(),readPostRagReleaseProbeStatus:jest.fn(),cleanupPostRagReleaseProbe:jest.fn()}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import { main as rawMain } from '../index'
import * as db from '../../../lib/db'
import * as storage from '../../../lib/storage'
import { searchAmapPoi } from '../../../lib/amap'
import * as postSearch from '../../../lib/post-search'
import * as postRag from '../../../lib/post-rag'
import { getPostRagV2Health } from '../../../lib/post-rag-v2-health'
import * as releaseProbe from '../../../lib/post-rag-release-probe'
import { DEFAULT_GUEST_INTRO_CONFIG, GUEST_INTRO_CONFIG_KEY } from '../../../shared/guest-intro-config'

const TEST_INTERNAL_TOKEN = 'admin-unit-internal-token'
process.env.ADMIN_INTERNAL_CALL_TOKEN = TEST_INTERNAL_TOKEN
const TEST_INTERNAL_ACTOR = {
  accountId: 'admin-unit',
  role: 'superAdmin',
  userId: 'admin-unit-openid',
  username: 'admin-unit',
}
const main = (event: any) => rawMain({
  ...event,
  _actAs: event?._actAs || TEST_INTERNAL_ACTOR,
  _internalToken: TEST_INTERNAL_TOKEN,
})

beforeEach(() => {
  jest.resetAllMocks()
  ;(db.runTransaction as jest.Mock).mockImplementation(async (callback) => callback({
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => ({ data: await (db.getById as jest.Mock)(name, id) }),
        update: async ({ data }: any) => (db.updateById as jest.Mock)(name, id, data),
        remove: async () => (db.removeById as jest.Mock)(name, id),
      }),
      add: async ({ data }: any) => ({ _id: await (db.create as jest.Mock)(name, data) }),
    }),
  }))
  ;(db.transactionGetByIdOrNull as jest.Mock).mockImplementation(async (transaction, collectionName, id) => {
    const response = await transaction.collection(collectionName).doc(id).get()
    return response?.data || null
  })
})

test('production non-HTTP calls reject caller-supplied admin identities', async () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalInternalToken = process.env.ADMIN_INTERNAL_CALL_TOKEN
  process.env.NODE_ENV = 'production'
  delete process.env.ADMIN_INTERNAL_CALL_TOKEN
  ;(db.query as jest.Mock).mockResolvedValue([])

  try {
    await expect(rawMain({
      action: 'admin.listAccounts',
      _actAs: { accountId: 'forged', role: 'superAdmin', userId: 'attacker', username: 'attacker' },
    })).rejects.toThrow('Unauthorized')
    expect(db.query).not.toHaveBeenCalled()
  } finally {
    process.env.NODE_ENV = originalNodeEnv
    if (originalInternalToken === undefined) delete process.env.ADMIN_INTERNAL_CALL_TOKEN
    else process.env.ADMIN_INTERNAL_CALL_TOKEN = originalInternalToken
  }
})

test('production non-HTTP calls accept the configured internal capability', async () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  ;(db.query as jest.Mock).mockResolvedValue([])

  try {
    await expect(rawMain({
      action: 'admin.listAccounts',
      _internalToken: TEST_INTERNAL_TOKEN,
      _actAs: { accountId: 'trusted', role: 'superAdmin', userId: 'ops', username: 'ops' },
    })).resolves.toEqual({ accounts: [] })
  } finally {
    process.env.NODE_ENV = originalNodeEnv
  }
})

function useAdminMembershipTransaction(options: {
  community?: Record<string, any>
  member?: Record<string, any>
}) {
  const memberRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const communityUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const stateSet = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const transaction = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: name === 'communities' ? options.community : options.member }),
        remove: memberRemove,
        update: communityUpdate,
        set: stateSet,
      })),
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementationOnce(async (callback) => callback(transaction))
  return { memberRemove, communityUpdate, stateSet }
}

test('appConfig.getGuestIntro: superAdmin reads the guest intro popup config', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    {
      _id: 'doc-1',
      key: GUEST_INTRO_CONFIG_KEY,
      ...DEFAULT_GUEST_INTRO_CONFIG,
      title: '自定义标题',
    },
  ])

  const result: any = await main({
    action: 'appConfig.getGuestIntro',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(result.config.title).toBe('自定义标题')
  expect(db.query).toHaveBeenCalledWith('app_configs', { key: GUEST_INTRO_CONFIG_KEY }, { limit: 1 })
})

test('appConfig.updateGuestIntro: superAdmin saves copy without forcing a new version', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    {
      _id: 'doc-1',
      key: GUEST_INTRO_CONFIG_KEY,
      ...DEFAULT_GUEST_INTRO_CONFIG,
      version: 'intro-v1',
    },
  ])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'appConfig.updateGuestIntro',
    config: { title: '  新标题  ' },
    publishNewVersion: false,
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(result.config.title).toBe('新标题')
  expect(result.config.version).toBe('intro-v1')
  expect(db.updateById).toHaveBeenCalledWith(
    'app_configs',
    'doc-1',
    expect.objectContaining({
      key: GUEST_INTRO_CONFIG_KEY,
      title: '新标题',
      version: 'intro-v1',
      updatedBy: 'boss',
    }),
  )
})

test('geo.mapConfig: 返回后台地图 JS 配置供 admin-web 运行时加载', async () => {
  const oldJsKey = process.env.AMAP_JS_KEY
  const oldSecurityCode = process.env.AMAP_SECURITY_CODE
  process.env.AMAP_JS_KEY = 'amap-js-key'
  process.env.AMAP_SECURITY_CODE = 'amap-security-code'

  try {
    const result: any = await main({
      action: 'geo.mapConfig',
      _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
    })

    expect(result).toEqual({
      jsKey: 'amap-js-key',
      securityCode: 'amap-security-code',
    })
  } finally {
    if (oldJsKey === undefined) delete process.env.AMAP_JS_KEY
    else process.env.AMAP_JS_KEY = oldJsKey
    if (oldSecurityCode === undefined) delete process.env.AMAP_SECURITY_CODE
    else process.env.AMAP_SECURITY_CODE = oldSecurityCode
  }
})

test('geo.searchLocation: 通过高德检索目的地候选点并返回 GCJ-02 坐标', async () => {
  ;(searchAmapPoi as jest.Mock).mockResolvedValue([
    {
      id: 'B0FFTEST',
      name: '太平水库',
      address: '四川省德阳市绵竹市太平水库',
      lat: 31.405678,
      lng: 104.133456,
      province: '四川省',
      city: '德阳市',
      district: '绵竹市',
      coordSystem: 'gcj02',
      source: 'amap',
    },
  ])

  const result: any = await main({
    action: 'geo.searchLocation',
    keyword: '太平水库',
    region: '德阳',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(searchAmapPoi).toHaveBeenCalledWith({ keyword: '太平水库', region: '德阳', limit: 8 })
  expect(result.candidates).toEqual([
    expect.objectContaining({
      id: 'B0FFTEST',
      name: '太平水库',
      address: '四川省德阳市绵竹市太平水库',
      lat: 31.405678,
      lng: 104.133456,
      coordSystem: 'gcj02',
      source: 'amap',
    }),
  ])
})

test('community.updateHomeBanners: saves ordered banners for posts in the same community', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1', status: 'active' })
    .mockResolvedValueOnce({ _id: 'post-2', communityId: 'community-1', status: 'active' })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'community.updateHomeBanners',
    communityId: 'community-1',
    banners: [
      { postId: 'post-1', title: '新人必看', coverImage: 'cloud://cover-1', enabled: true },
      { bannerId: 'custom-banner', postId: 'post-2', title: '周末互助', coverImage: 'https://example.com/cover.jpg' },
    ],
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(result.success).toBe(true)
  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-1', {
    homeBanners: [
      {
        bannerId: 'post-1-0',
        postId: 'post-1',
        title: '新人必看',
        coverImage: 'cloud://cover-1',
        order: 0,
        enabled: true,
      },
      {
        bannerId: 'custom-banner',
        postId: 'post-2',
        title: '周末互助',
        coverImage: 'https://example.com/cover.jpg',
        order: 1,
        enabled: true,
      },
    ],
  })
})

test('community.updateHomeBanners: rejects duplicate posts', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    status: 'active',
  })

  await expect(main({
    action: 'community.updateHomeBanners',
    communityId: 'community-1',
    banners: [
      { postId: 'post-1', coverImage: 'cloud://cover-1' },
      { postId: 'post-1', coverImage: 'cloud://cover-2' },
    ],
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })).rejects.toThrow('Banner 关联帖子不能重复')

  expect(db.updateById).not.toHaveBeenCalled()
})

test('community.updateHomeBanners: rejects posts from other communities', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'other-community',
    status: 'active',
  })

  await expect(main({
    action: 'community.updateHomeBanners',
    communityId: 'community-1',
    banners: [{ postId: 'post-1', coverImage: 'cloud://cover-1' }],
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })).rejects.toThrow('Banner 只能关联当前社区的帖子')

  expect(db.updateById).not.toHaveBeenCalled()
})

test('community.updateHomeBanners: compare-and-set prevents clearing concurrently changed banners', async () => {
  const expectedBanners = [{
    bannerId: 'banner-1',
    postId: 'post-1',
    title: '原 Banner',
    coverImage: 'cloud://cover-1',
    order: 0,
    enabled: true,
  }]
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'community-1',
    homeBanners: [...expectedBanners, { ...expectedBanners[0], bannerId: 'banner-2', postId: 'post-2' }],
  })

  await expect(main({
    action: 'community.updateHomeBanners',
    communityId: 'community-1',
    banners: [],
    expectedBanners,
  })).rejects.toThrow('Banner 配置已变化，请重新 dry-run')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('community.updateHomeBanners: compare-and-set clears an unchanged Banner snapshot', async () => {
  const expectedBanners = [{
    bannerId: 'banner-1',
    postId: 'post-1',
    title: '原 Banner',
    coverImage: 'cloud://cover-1',
    order: 0,
    enabled: true,
  }]
  ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'community-1', homeBanners: expectedBanners })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await expect(main({
    action: 'community.updateHomeBanners',
    communityId: 'community-1',
    banners: [],
    expectedBanners,
  })).resolves.toEqual({ success: true })
  expect(db.updateById).toHaveBeenCalledWith('communities', 'community-1', { homeBanners: [] })
})

test('admin.approvalSummary: superAdmin 返回社区创建和成员加入待办数', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      { _id: 'pending-community-1', name: '待审社区', status: 'pending' },
    ])
    .mockResolvedValueOnce([
      { _id: 'community-1', name: '青山村', status: 'active' },
      { _id: 'community-2', name: '明士班', status: 'active' },
    ])
    .mockResolvedValueOnce([
      { _id: 'member-1', status: 'pending' },
      { _id: 'member-2', status: 'pending' },
    ])
    .mockResolvedValueOnce([])

  const result: any = await main({
    action: 'admin.approvalSummary',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss-openid', username: 'boss' },
  })

  expect(result.pendingCommunityCount).toBe(1)
  expect(result.pendingMemberCount).toBe(2)
  expect(result.communities).toEqual([
    { communityId: 'community-1', communityName: '青山村', pendingMemberCount: 2 },
  ])
})

test('admin.approvalSummary: communityAdmin 只返回自己可管理社区的成员待办', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'community-1' }]) // listOwnedCommunityIds: created
    .mockResolvedValueOnce([{ communityId: 'community-2' }]) // listOwnedCommunityIds: as admin
    .mockResolvedValueOnce([{ _id: 'member-1', status: 'pending' }])
    .mockResolvedValueOnce([])
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', name: '青山村', status: 'active' })
    .mockResolvedValueOnce({ _id: 'community-2', name: '明士班', status: 'active' })

  const result: any = await main({
    action: 'admin.approvalSummary',
    _actAs: { accountId: 'ca-1', role: 'communityAdmin', userId: 'admin-openid', username: 'ca' },
  })

  expect(result.pendingCommunityCount).toBe(0)
  expect(result.pendingMemberCount).toBe(1)
  expect(result.communities).toEqual([
    { communityId: 'community-1', communityName: '青山村', pendingMemberCount: 1 },
  ])
})

test('member.list: 会物理清理历史 left 记录并且不返回', async () => {
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

test('member.list: 昵称优先显示真实昵称，测试账号缺失昵称时显示测试账号名', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1' })
    .mockResolvedValueOnce({ _id: 'u-real', nickName: '张三', avatarUrl: '' })
    .mockRejectedValueOnce(new Error('not found'))
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'member-real-1', communityId: 'community-1', userId: 'u-real', role: 'member', status: 'active' },
    { _id: 'member-test-1', communityId: 'community-1', userId: 'h5-reject-candidate-001', role: 'member', status: 'rejected' },
  ])

  const result: any = await main({ action: 'member.list', communityId: 'community-1', status: 'all' })

  const real = result.members.find((m: any) => m._id === 'member-real-1')
  const test = result.members.find((m: any) => m._id === 'member-test-1')
  expect(real.nickName).toBe('张三')
  expect(test.nickName).toContain('测试账号(')
})

test('member.kick: rejected 记录可移除，且不递减 memberCount', async () => {
  const transaction = useAdminMembershipTransaction({
    community: { _id: 'community-1', creatorId: 'creator-1', memberCount: 2 },
    member: {
      _id: 'member-1',
      communityId: 'community-1',
      userId: 'h5-reject-candidate-001',
      role: 'member',
      status: 'rejected',
    },
  })

  const result: any = await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-1' })

  expect(transaction.memberRemove).toHaveBeenCalled()
  expect(transaction.communityUpdate).not.toHaveBeenCalled()
  expect(result.success).toBe(true)
})

test('member.kick: active 成员移除后递减 memberCount', async () => {
  const transaction = useAdminMembershipTransaction({
    community: { _id: 'community-1', creatorId: 'creator-1', memberCount: 2 },
    member: {
      _id: 'member-2',
      communityId: 'community-1',
      userId: 'u-active',
      role: 'member',
      status: 'active',
    },
  })

  const result: any = await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-2' })

  expect(transaction.memberRemove).toHaveBeenCalled()
  expect(transaction.communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 1 } })
  expect(result.success).toBe(true)
})

test('member.kick: 成员、计数和幂等状态在同一事务内提交', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'creator-1', memberCount: 2 })
    .mockResolvedValueOnce({
      _id: 'member-2', communityId: 'community-1', userId: 'u-active', role: 'member', status: 'active',
    })
  ;(db.removeById as jest.Mock).mockResolvedValue({ stats: { removed: 1 } })
  const memberRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const communityUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const stateSet = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const transaction = {
    collection: jest.fn((name: string) => ({
      doc: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: name === 'communities'
          ? { _id: 'community-1', creatorId: 'creator-1', memberCount: 2 }
          : name === 'community_members'
            ? { _id: 'member-2', communityId: 'community-1', userId: 'u-active', role: 'member', status: 'active' }
            : null }),
        remove: memberRemove,
        update: communityUpdate,
        set: stateSet,
      })),
    })),
  }
  ;(db.runTransaction as jest.Mock).mockImplementationOnce(async (callback) => callback(transaction))

  await main({ action: 'member.kick', communityId: 'community-1', memberId: 'member-2' })

  expect(db.runTransaction).toHaveBeenCalledTimes(1)
  expect(memberRemove).toHaveBeenCalled()
  expect(communityUpdate).toHaveBeenCalledWith({ data: { memberCount: 1 } })
  expect(stateSet).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'none', memberId: '' }) })
  expect(db.removeById).not.toHaveBeenCalled()
  expect(db.increment).not.toHaveBeenCalled()
  expect(db.updateWhere).not.toHaveBeenCalled()
})

test('section.updateWidgets: evergreen 板块不允许配置 attendance', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'attendance-1', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 0, showInList: true },
    ],
  })).rejects.toThrow('realtime')
})

test('section.updateWidgets: 普通控件允许空标签或占位标签保存', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '新控件', fieldKey: 'f1', required: false, order: 0, showInList: false },
      { widgetId: 'w2', type: 'number', label: '', fieldKey: 'f2', required: false, order: 1, showInList: false },
    ],
  })

  expect(result.widgets).toEqual(expect.arrayContaining([
    expect.objectContaining({ widgetId: 'w1', label: '新控件' }),
    expect.objectContaining({ widgetId: 'w2', label: '' }),
  ]))
})

test('section.updateWidgets: attendance 空标签或通用标签会按无标题保存', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'attendance-1', type: 'attendance', label: '短文字', fieldKey: 'attendance', required: false, order: 0, showInList: true },
    ],
  })

  expect(result.widgets[0].label).toBe('')
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-1', {
    widgets: expect.arrayContaining([
      expect.objectContaining({ widgetId: 'attendance-1', type: 'attendance', label: '' }),
    ]),
  })
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-1')
})

test('section.updateWidgets: 新增控件不查询历史帖子影响', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [
      { widgetId: 'title-1', type: 'short_text', label: '标题', fieldKey: 'title', required: false, order: 0, showInList: false },
    ],
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'title-1', type: 'short_text', label: '标题', fieldKey: 'title', required: false, order: 0, showInList: false },
      { widgetId: 'image-1', type: 'image_group', label: '照片', fieldKey: 'images', required: false, order: 1, showInList: false },
    ],
  })

  expect(db.query).not.toHaveBeenCalledWith('posts', { sectionId: 'section-1', status: 'active' })
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-1')
})

test('section.updateWidgets: 公告控件由管理员维护且不进入帖子列表展示', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      {
        widgetId: 'notice-1',
        type: 'admin_notice',
        label: '近期课程',
        fieldKey: 'notice',
        required: true,
        order: 0,
        showInList: true,
        noticeContent: '  周三晚 7 点开课  ',
      },
    ],
  })

  expect(result.widgets[0]).toEqual(expect.objectContaining({
    type: 'admin_notice',
    label: '近期课程',
    required: false,
    showInList: false,
    noticeContent: '周三晚 7 点开课',
  }))
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-1', {
    widgets: expect.arrayContaining([
      expect.objectContaining({ type: 'admin_notice', noticeContent: '周三晚 7 点开课' }),
    ]),
  })
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-1')
})

test('section.updateWidgets: 公告正文按 emoji 安全字符数截断', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'evergreen',
    widgets: [],
  })
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      {
        widgetId: 'notice-emoji',
        type: 'admin_notice',
        label: '近期课程',
        fieldKey: 'notice',
        required: false,
        order: 0,
        showInList: false,
        noticeContent: ` ${'😀'.repeat(501)} `,
      },
    ],
  })

  expect(Array.from(result.widgets[0].noticeContent)).toHaveLength(500)
  expect(result.widgets[0].noticeContent).toBe('😀'.repeat(500))
})

test('section.create: 图文攻略展示模板可保存到板块', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('section-guide')

  const result: any = await main({
    action: 'section.create',
    communityId: 'community-1',
    name: '亲子出游',
    type: 'evergreen',
    displayTemplate: 'guide_note',
  })

  expect(result.sectionId).toBe('section-guide')
  expect(db.create).toHaveBeenCalledWith('sections', expect.objectContaining({
    name: '亲子出游',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      expect.objectContaining({ widgetId: 'guide_title', type: 'short_text', label: '标题', required: true, showInList: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_images', type: 'image_group', label: '封面/图片', required: true, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_distance', type: 'short_text', label: '距离', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', required: true, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_body', type: 'rich_note', label: '正文', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_liangbulu_track_id', type: 'short_text', label: '两步路轨迹编号', required: false, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_location', type: 'location', label: '目的地位置', required: true, showInList: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', required: false, showInList: false, locked: true }),
    ],
  }))
})

test('section.create: 纯文字笔记创建时写入精确的两个固定控件', async () => {
  ;(db.create as jest.Mock).mockResolvedValue('section-text')

  await main({ action: 'section.create', communityId: 'community-1', name: '随手记', type: 'evergreen', displayTemplate: 'text_note' })

  expect(db.create).toHaveBeenCalledWith('sections', expect.objectContaining({
    displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
      { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
    ],
  }))
})

test('section.create: 未知展示模板不会静默降级', async () => {
  await expect(main({ action: 'section.create', communityId: 'community-1', name: '错误模板', type: 'evergreen', displayTemplate: 'unknown' }))
    .rejects.toThrow('展示模板')
  expect(db.create).not.toHaveBeenCalled()
})

test.each(['section.get', 'section.list'])('%s: 纯文字笔记会修复缺失或篡改的固定控件', async (action) => {
  const section = {
    _id: 'section-text', communityId: 'community-1', type: 'evergreen', displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'text_title', type: 'summary', label: '被篡改', fieldKey: 'oops', required: false, order: 99, showInList: false },
      { widgetId: 'custom', type: 'short_text', label: '自定义', fieldKey: 'custom', required: false, order: 4, showInList: false },
    ],
  }
  if (action === 'section.get') (db.getById as jest.Mock).mockResolvedValue(section)
  else (db.query as jest.Mock).mockResolvedValue([section])

  const result: any = await main(action === 'section.get'
    ? { action, sectionId: 'section-text' }
    : { action, communityId: 'community-1' })
  const normalized = action === 'section.get' ? result.section : result.sections[0]

  expect(normalized.widgets).toEqual([
    { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
    { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
  ])
})

test('section.updateWidgets: section.get 归一化的纯文字固定结构可原样保存', async () => {
  const rawSection = {
    _id: 'section-text', communityId: 'community-1', type: 'evergreen', displayTemplate: 'text_note',
    widgets: [{ widgetId: 'text_title', type: 'summary', label: '旧标题', order: 0 }],
  }
  ;(db.getById as jest.Mock).mockResolvedValue(rawSection)
  const getResult: any = await main({ action: 'section.get', sectionId: 'section-text' })

  ;(db.getById as jest.Mock).mockResolvedValue(rawSection)
  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-text',
    widgets: getResult.section.widgets,
  })).resolves.toEqual(expect.objectContaining({ widgets: getResult.section.widgets }))
})

test('section.updateWidgets: 纯文字笔记固定控件不能删除或修改', async () => {
  const section = { _id: 'section-text', type: 'evergreen', displayTemplate: 'text_note', widgets: [] }
  ;(db.getById as jest.Mock).mockResolvedValue(section)

  await expect(main({ action: 'section.updateWidgets', sectionId: 'section-text', widgets: [
    { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
  ] })).rejects.toThrow('固定控件')

  await expect(main({ action: 'section.updateWidgets', sectionId: 'section-text', widgets: [
    { widgetId: 'text_title', type: 'summary', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
    { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
  ] })).rejects.toThrow('固定控件')

  await expect(main({ action: 'section.updateWidgets', sectionId: 'section-text', widgets: [
    { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
    { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
    { widgetId: 'custom', type: 'short_text', label: '不允许', fieldKey: 'custom', required: false, order: 3, showInList: false },
  ] })).rejects.toThrow('只能包含标题和正文')
})

test('section.updateWidgets: activity_invite 只能配置到 evergreen 板块', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    type: 'realtime',
    widgets: [],
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-1',
    widgets: [
      { widgetId: 'invite-1', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 0, showInList: false },
    ],
  })).rejects.toThrow('沉淀')
})

test('section.updateWidgets: 图文攻略固定控件不能删除或修改', async () => {
  const guideWidgets = [
    { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
    { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
    { widgetId: 'guide_distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false, locked: true },
    { widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', fieldKey: 'highestAltitude', required: false, order: 3, showInList: false, locked: true },
    { widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 4, showInList: false, locked: true },
    { widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 5, showInList: false, locked: true },
    { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
    { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
    { widgetId: 'guide_liangbulu_track_id', type: 'short_text', label: '两步路轨迹编号', fieldKey: 'liangbuluTrackId', required: false, order: 8, showInList: false, locked: true },
    { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 9, showInList: false, locked: true },
    { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
  ]
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: guideWidgets,
  })

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: guideWidgets.filter((widget) => widget.widgetId !== 'guide_images'),
  })).rejects.toThrow('固定控件')

  await expect(main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: guideWidgets.map((widget) => (
      widget.widgetId === 'guide_title'
        ? { ...widget, type: 'summary' }
        : widget
    )),
  })).rejects.toThrow('固定控件')
})

test('section.updateWidgets: 图文攻略允许在固定控件后追加小控件', async () => {
  const guideWidgets = [
    { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
    { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
    { widgetId: 'guide_distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false, locked: true },
    { widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', fieldKey: 'highestAltitude', required: false, order: 3, showInList: false, locked: true },
    { widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 4, showInList: false, locked: true },
    { widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 5, showInList: false, locked: true },
    { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
    { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
    { widgetId: 'guide_liangbulu_track_id', type: 'short_text', label: '两步路轨迹编号', fieldKey: 'liangbuluTrackId', required: false, order: 8, showInList: false, locked: true },
    { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 9, showInList: false, locked: true },
    { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
  ]
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: guideWidgets,
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.query as jest.Mock).mockResolvedValue([])

  const result: any = await main({
    action: 'section.updateWidgets',
    sectionId: 'section-guide',
    widgets: [
      ...guideWidgets,
      { widgetId: 'guide_scenery', type: 'short_text', label: '景色特点', fieldKey: 'scenery', required: false, order: 11, showInList: false },
    ],
  })

  expect(result.widgets.slice(0, 11).every((widget: any) => widget.locked === true)).toBe(true)
  expect(result.widgets[11]).toEqual(expect.objectContaining({ widgetId: 'guide_scenery', locked: false }))
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-guide', expect.objectContaining({
    widgets: expect.arrayContaining([
      expect.objectContaining({ widgetId: 'guide_images', required: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_drive_duration', required: true, locked: true }),
      expect.objectContaining({ widgetId: 'guide_liangbulu_track_id', required: false, locked: true }),
      expect.objectContaining({ widgetId: 'guide_distance', locked: true }),
      expect.objectContaining({ widgetId: 'guide_activity_invite', locked: true }),
      expect.objectContaining({ widgetId: 'guide_scenery', locked: false }),
    ]),
  }))
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-guide')
})

test('section.get: 旧图文攻略板块会补齐路线攻略固定控件', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-guide',
    type: 'evergreen',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
      { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
      { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
      { widgetId: 'guide_location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false, locked: true },
    ],
  })

  const result: any = await main({
    action: 'section.get',
    sectionId: 'section-guide',
  })

  expect(result.section.widgets.map((widget: any) => widget.widgetId).slice(0, 11)).toEqual([
    'guide_title',
    'guide_images',
    'guide_distance',
    'guide_highest_altitude',
    'guide_total_climb',
    'guide_reference_duration',
    'guide_drive_duration',
    'guide_body',
    'guide_liangbulu_track_id',
    'guide_location',
    'guide_activity_invite',
  ])
  expect(result.section.widgets[6]).toEqual(expect.objectContaining({
    widgetId: 'guide_drive_duration',
    label: '驾车到达用时',
    required: true,
    order: 6,
    locked: true,
  }))
  expect(result.section.widgets[8]).toEqual(expect.objectContaining({
    widgetId: 'guide_liangbulu_track_id',
    label: '两步路轨迹编号',
    required: false,
    order: 8,
    locked: true,
  }))
  expect(result.section.widgets[9]).toEqual(expect.objectContaining({
    widgetId: 'guide_location',
    label: '目的地位置',
    required: true,
    order: 9,
    locked: true,
  }))
  expect(result.section.widgets[10]).toEqual(expect.objectContaining({
    widgetId: 'guide_activity_invite',
    label: '活动召集',
    required: false,
    order: 10,
    locked: true,
  }))
})

test('section.updateMeta: 已创建板块拒绝切换或传入未知展示模板', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    communityId: 'community-1',
    type: 'realtime',
    status: 'active',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await expect(main({
    action: 'section.updateMeta',
    sectionId: 'section-1',
    displayTemplate: 'guide_note',
  })).rejects.toThrow('展示模板')

  await expect(main({
    action: 'section.updateMeta',
    sectionId: 'section-1',
    displayTemplate: 'unexpected-template',
  })).rejects.toThrow('展示模板')
  expect(db.updateById).not.toHaveBeenCalled()
})

test.each(['guide_note', 'text_note'])('section.updateMeta: 已创建 %s 板块允许回传相同展示模板', async (displayTemplate) => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-1',
    communityId: 'community-1',
    type: 'evergreen',
    status: 'active',
    displayTemplate,
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  await expect(main({
    action: 'section.updateMeta',
    sectionId: 'section-1',
    name: '更新名称',
    displayTemplate,
  })).resolves.toEqual({ success: true })

  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-1', {
    name: '更新名称',
    displayTemplate,
  })
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-1')
})

test('section.updateStatus: refreshes search and queues RAG jobs for existing posts', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'section-live',
    type: 'realtime',
    status: 'active',
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'post-a', communityId: 'community-a', sectionId: 'section-live', status: 'active' },
    { _id: 'post-b', communityId: 'community-b', sectionId: 'section-live', status: 'active' },
  ])
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.updateStatus',
    sectionId: 'section-live',
    status: 'dormant',
  })

  expect(result.success).toBe(true)
  expect(db.updateById).toHaveBeenCalledWith('sections', 'section-live', { status: 'dormant' })
  expect(db.query).toHaveBeenCalledWith('posts', { sectionId: 'section-live', status: 'active' })
  expect(postRag.enqueuePostRagJob).toHaveBeenCalledTimes(2)
  expect(postRag.enqueuePostRagJob).toHaveBeenNthCalledWith(1, {
    postId: 'post-a',
    communityId: 'community-a',
    sectionId: 'section-live',
    action: 'upsert',
    reason: 'section.updateStatus',
  })
  expect(postRag.enqueuePostRagJob).toHaveBeenNthCalledWith(2, {
    postId: 'post-b',
    communityId: 'community-b',
    sectionId: 'section-live',
    action: 'upsert',
    reason: 'section.updateStatus',
  })
  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-live')
})

test('section.delete: removes stale search index rows for the deleted section', async () => {
  ;(db.query as jest.Mock).mockResolvedValue([])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'section.delete',
    sectionId: 'section-empty',
  })

  expect(result.success).toBe(true)
  expect(db.removeById).toHaveBeenCalledWith('sections', 'section-empty')
  expect(postSearch.removePostSearchIndexesForSection).toHaveBeenCalledWith('section-empty')
})

test('post.getAdmin: 返回 attendance 汇总和完整名单', async () => {
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-1',
      status: 'active',
      content: { title: '活动帖' },
      createdAt: '2024-01-01T00:00:00.000Z',
      adminEditedAt: '2024-01-03T00:00:00.000Z',
      adminEditedByUsername: 'ops-admin',
    })
    .mockResolvedValueOnce({ _id: 'author-1', nickName: '作者', avatarUrl: '' })
    .mockResolvedValueOnce({
      _id: 'section-1',
      communityId: 'community-1',
      name: '活动区',
      type: 'realtime',
      enableComment: true,
      enableLike: true,
      widgets: [
        { widgetId: 'attendance-1', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 0, showInList: true, capacity: 5 },
      ],
    })
    .mockResolvedValueOnce({ _id: 'user-1', nickName: '小王', avatarUrl: '1.png' })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])
    .mockResolvedValueOnce([
      { _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1', joinedAt: '2024-01-02T00:00:00.000Z' },
    ])

  const result: any = await main({ action: 'post.getAdmin', postId: 'post-1' })

  expect(result.post.attendanceSummaryByWidget['attendance-1'].count).toBe(1)
  expect(result.post.adminEditedAt).toBe('2024-01-03T00:00:00.000Z')
  expect(result.post.adminEditedByUsername).toBe('ops-admin')
  expect(result.post.authorAvatarUrl).toMatch(/^\/static\/ai-avatars\/avatar-\d{2}\.svg$/)
  expect(result.attendanceMembersByWidget['attendance-1']).toHaveLength(1)
  expect(result.attendanceMembersByWidget['attendance-1'][0].userId).toBe('user-1')
})

test('post.removeAttendanceMemberAdmin: 可移除参与人并返回最新名单', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([{ _id: 'record-1', postId: 'post-1', widgetId: 'attendance-1', userId: 'user-1' }])
    .mockResolvedValueOnce([])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.removeAttendanceMemberAdmin',
    postId: 'post-1',
    widgetId: 'attendance-1',
    userId: 'user-1',
  })

  expect(db.removeById).toHaveBeenCalledWith('post_attendance_members', 'record-1')
  expect(result).toEqual({ success: true, members: [], total: 0 })
})

test('community.hardDelete: cleans cloud files from current and pending post content', async () => {
  const community = {
    _id: 'community-1',
    status: 'disabled',
    coverImage: 'cloud://env/community-cover.jpg',
  }
  ;(db.getById as jest.Mock).mockResolvedValue(community)
  let postsReturned = false
  ;(db.queryAfterId as jest.Mock).mockImplementation(async (collectionName, _where, afterId) => {
    if (collectionName === 'posts' && afterId === null && !postsReturned) {
      postsReturned = true
      return [{
        _id: 'post-1',
        communityId: 'community-1',
        sectionId: 'section-1',
        content: { images: ['cloud://env/current.jpg'] },
        pendingContent: { rich: { imageFileIDs: ['cloud://env/pending.jpg'] } },
      }]
    }
    return []
  })
  ;(db.removeById as jest.Mock).mockResolvedValue({})
  ;(storage.deleteFile as jest.Mock).mockResolvedValue({})

  await main({ action: 'community.hardDelete', communityId: 'community-1' })

  expect(storage.deleteFile).toHaveBeenCalledWith([
    'cloud://env/community-cover.jpg',
    'cloud://env/current.jpg',
    'cloud://env/pending.jpg',
  ])
})

test('admin.createAccount: 创建绑定微信的 superAdmin 时同步小程序用户角色', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // username 未占用
  ;(db.getById as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('not found'), { errCode: -502001 }))
  ;(db.create as jest.Mock)
    .mockResolvedValueOnce('super-account-1')
    .mockResolvedValueOnce('super-openid')

  const result: any = await main({
    action: 'admin.createAccount',
    username: 'ops',
    password: 'happyhome2024',
    role: 'superAdmin',
    userId: 'super-openid',
    _actAs: { accountId: 'root', role: 'superAdmin', userId: 'root-openid', username: 'root' },
  })

  expect(db.create).toHaveBeenCalledWith('admin_accounts', expect.objectContaining({
    username: 'ops',
    userId: 'super-openid',
    role: 'superAdmin',
    status: 'active',
  }))
  expect(db.create).toHaveBeenCalledWith('users', expect.objectContaining({
    _id: 'super-openid',
    role: 'superAdmin',
    roleSource: 'admin_account',
  }))
  expect(result.accountId).toBe('super-account-1')
})

test('admin.bindWechat: 绑定 superAdmin 微信 openId 时同步小程序用户角色', async () => {
  ;(db.query as jest.Mock).mockResolvedValueOnce([]) // openId 未绑定其他账号
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'super-account-1',
      username: 'admin',
      role: 'superAdmin',
      status: 'active',
      userId: '',
    })
    .mockResolvedValueOnce({
      _id: 'super-openid',
      nickName: '一年',
      avatarUrl: '',
      role: 'user',
    })
  ;(db.updateById as jest.Mock).mockResolvedValue({})
  ;(db.updateWhere as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'admin.bindWechat',
    accountId: 'super-account-1',
    openId: 'super-openid',
    _actAs: { accountId: 'root', role: 'superAdmin', userId: 'root-openid', username: 'root' },
  })

  expect(db.updateById).toHaveBeenCalledWith('admin_accounts', 'super-account-1', { userId: 'super-openid' })
  expect(db.updateById).toHaveBeenCalledWith('users', 'super-openid', {
    role: 'superAdmin',
    roleSource: 'admin_account',
  })
  expect(db.updateWhere).toHaveBeenCalledWith('admin_sessions', { accountId: 'super-account-1' }, { userId: 'super-openid' })
  expect(result.success).toBe(true)
})

test('admin.listAccounts: 标记未删除社区的创建者管理员账号', async () => {
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([
      {
        _id: 'account-creator',
        username: 'creator-admin',
        role: 'communityAdmin',
        status: 'active',
        userId: 'creator-openid',
        createdAt: '2026-04-28T00:00:00.000Z',
        createdBy: 'boss',
      },
      {
        _id: 'account-free',
        username: 'free-admin',
        role: 'communityAdmin',
        status: 'active',
        userId: 'free-openid',
        createdAt: '2026-04-28T00:00:00.000Z',
        createdBy: 'boss',
      },
    ])
    .mockResolvedValueOnce([{ _id: 'community-1', name: '青山村', creatorId: 'creator-openid' }])
    .mockResolvedValueOnce([])

  const result: any = await main({ action: 'admin.listAccounts' })

  expect(result.accounts[0]).toEqual(expect.objectContaining({
    _id: 'account-creator',
    creatorCommunityCount: 1,
    creatorCommunityNames: ['青山村'],
  }))
  expect(result.accounts[1]).toEqual(expect.objectContaining({
    _id: 'account-free',
    creatorCommunityCount: 0,
  }))
})

test('admin.deleteAccount: 不能删除未删除社区的创建者管理员账号', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'account-creator',
    userId: 'creator-openid',
    username: 'creator-admin',
    role: 'communityAdmin',
    status: 'active',
  })
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    { _id: 'community-1', name: '青山村', creatorId: 'creator-openid' },
  ])

  await expect(main({
    action: 'admin.deleteAccount',
    accountId: 'account-creator',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })).rejects.toThrow('创建者管理员账号')
  expect(db.removeById).not.toHaveBeenCalledWith('admin_accounts', 'account-creator')
})

test('admin.deleteAccount: 删除普通管理员账号并清理 session', async () => {
  ;(db.getById as jest.Mock).mockResolvedValue({
    _id: 'account-free',
    userId: 'free-openid',
    username: 'free-admin',
    role: 'communityAdmin',
    status: 'active',
  })
  ;(db.query as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { _id: 'session-1', accountId: 'account-free' },
      { _id: 'session-2', accountId: 'account-free' },
    ])
  ;(db.removeById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'admin.deleteAccount',
    accountId: 'account-free',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })

  expect(db.removeById).toHaveBeenCalledWith('admin_sessions', 'session-1')
  expect(db.removeById).toHaveBeenCalledWith('admin_sessions', 'session-2')
  expect(db.removeById).toHaveBeenCalledWith('admin_accounts', 'account-free')
  expect(result).toEqual({ success: true, revokedSessions: 2 })
})

test('admin.deleteAccount: 不能删除自己的账号', async () => {
  await expect(main({
    action: 'admin.deleteAccount',
    accountId: 'super-1',
    _actAs: { accountId: 'super-1', role: 'superAdmin', userId: 'boss', username: 'boss' },
  })).rejects.toThrow('不能删除自己的账号')
})

test('post.pinAdmin: active 帖子可置顶并记录操作人', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    status: 'active',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.pinAdmin',
    postId: 'post-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    isPinned: true,
    pinnedAt: expect.any(String),
    pinnedByAccountId: 'admin-1',
  }))
  expect(result.success).toBe(true)
})

test('post.featureAdmin: active 帖子可加精并记录操作人', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-1',
    communityId: 'community-1',
    status: 'active',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.featureAdmin',
    postId: 'post-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
    isFeatured: true,
    featuredAt: expect.any(String),
    featuredByAccountId: 'admin-1',
  }))
  expect(result.success).toBe(true)
})

test('post.listAdmin: filters pinned and featured posts', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockReset()
  ;(db.query as jest.Mock).mockResolvedValueOnce([
    {
      _id: 'post-featured-pinned',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      isPinned: true,
      isFeatured: true,
      adminCreatedAt: '2026-04-22T09:55:00.000Z',
      adminCreatedByAccountId: 'admin-creator',
      adminCreatedByUsername: 'ops-admin',
      createdAt: '2026-04-22T10:00:00.000Z',
      content: {},
    },
    {
      _id: 'post-normal',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'user-1',
      status: 'active',
      isPinned: false,
      isFeatured: false,
      createdAt: '2026-04-22T11:00:00.000Z',
      content: {},
    },
  ])
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
    if (collectionName === 'users' && id === 'user-1') return { _id: 'user-1', nickName: '一年' }
    if (collectionName === 'sections' && id === 'section-1') {
      return {
        _id: 'section-1',
        communityId: 'community-1',
        name: '拼车出行',
        type: 'realtime',
        status: 'active',
        widgets: [],
      }
    }
    return null
  })

  const result: any = await main({
    action: 'post.listAdmin',
    communityId: 'community-1',
    pinned: true,
    featured: true,
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(result.posts.map((post: any) => post._id)).toEqual(['post-featured-pinned'])
  expect(result.posts[0].authorNickname).toBe('后台代发：ops-admin')
  expect(result.total).toBe(1)
})

test('post.pinAdmin/post.featureAdmin: deleted 帖子不可置顶或加精', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock)
    .mockResolvedValueOnce({
      _id: 'post-deleted',
      communityId: 'community-1',
      status: 'deleted',
    })
    .mockResolvedValueOnce({
      _id: 'post-deleted',
      communityId: 'community-1',
      status: 'deleted',
    })

  await expect(main({
    action: 'post.pinAdmin',
    postId: 'post-deleted',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })).rejects.toThrow('已删除帖子不能置顶或加精')

  await expect(main({
    action: 'post.featureAdmin',
    postId: 'post-deleted',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })).rejects.toThrow('已删除帖子不能置顶或加精')
  expect(db.updateById).not.toHaveBeenCalled()
})

test('post.deleteAdmin: clears pin and featured flags', async () => {
  ;(db.getById as jest.Mock).mockReset()
  ;(db.updateById as jest.Mock).mockReset()
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'post-flagged',
    communityId: 'community-1',
    sectionId: 'section-1',
    status: 'active',
    isPinned: true,
    pinnedAt: '2026-04-20T10:00:00.000Z',
    pinnedByAccountId: 'admin-old',
    isFeatured: true,
    featuredAt: '2026-04-20T11:00:00.000Z',
    featuredByAccountId: 'admin-old',
  })
  ;(db.updateById as jest.Mock).mockResolvedValue({})

  const result: any = await main({
    action: 'post.deleteAdmin',
    postId: 'post-flagged',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(db.updateById).toHaveBeenCalledWith('posts', 'post-flagged', {
    status: 'deleted',
    isPinned: false,
    pinnedAt: '',
    pinnedByAccountId: '',
    isFeatured: false,
    featuredAt: '',
    featuredByAccountId: '',
  })
  expect(result).toEqual({ success: true })
  expect(postRag.enqueuePostRagJob).toHaveBeenCalledWith({
    postId: 'post-flagged',
    communityId: 'community-1',
    sectionId: 'section-1',
    action: 'delete',
    reason: 'post.deleteAdmin',
  })
  expect(postSearch.removePostSearchIndex).toHaveBeenCalledWith('post-flagged')
})

test('post.rebuildSearchIndexAdmin: rebuilds derived search index for a scoped community', async () => {
  ;(postSearch.backfillPostSearchIndexesForCommunity as jest.Mock).mockResolvedValue({
    communityId: 'community-1',
    scannedCount: 3,
    indexedCount: 2,
    removedCount: 1,
    failedCount: 0,
  })

  const result: any = await main({
    action: 'post.rebuildSearchIndexAdmin',
    communityId: 'community-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(postSearch.backfillPostSearchIndexesForCommunity).toHaveBeenCalledWith('community-1')
  expect(result).toEqual({
    communityId: 'community-1',
    scannedCount: 3,
    indexedCount: 2,
    removedCount: 1,
    failedCount: 0,
  })
})

test('post.rebuildSearchIndexSectionAdmin: rebuilds derived search index for a scoped section', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'section-1',
    communityId: 'community-1',
    name: '课程',
  })
  ;(postSearch.backfillPostSearchIndexesForSection as jest.Mock).mockResolvedValue({
    sectionId: 'section-1',
    scannedCount: 2,
    indexedCount: 2,
    removedCount: 0,
    failedCount: 0,
  })

  const result: any = await main({
    action: 'post.rebuildSearchIndexSectionAdmin',
    sectionId: 'section-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(postSearch.backfillPostSearchIndexesForSection).toHaveBeenCalledWith('section-1')
  expect(result).toEqual({
    sectionId: 'section-1',
    scannedCount: 2,
    indexedCount: 2,
    removedCount: 0,
    failedCount: 0,
  })
})

test('post.rebuildSearchIndexSectionBatchAdmin: rebuilds a bounded derived search index batch', async () => {
  ;(db.getById as jest.Mock).mockResolvedValueOnce({
    _id: 'section-1',
    communityId: 'community-1',
    name: '课程',
  })
  ;(postSearch.backfillPostSearchIndexesForSectionBatch as jest.Mock).mockResolvedValue({
    sectionId: 'section-1',
    skip: 5,
    limit: 5,
    scannedCount: 5,
    indexedCount: 5,
    removedCount: 0,
    failedCount: 0,
    hasMore: true,
    nextSkip: 10,
  })

  const result: any = await main({
    action: 'post.rebuildSearchIndexSectionBatchAdmin',
    sectionId: 'section-1',
    skip: 5,
    limit: 5,
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(postSearch.backfillPostSearchIndexesForSectionBatch).toHaveBeenCalledWith('section-1', {
    skip: 5,
    limit: 5,
  })
  expect(result).toEqual({
    sectionId: 'section-1',
    skip: 5,
    limit: 5,
    scannedCount: 5,
    indexedCount: 5,
    removedCount: 0,
    failedCount: 0,
    hasMore: true,
    nextSkip: 10,
  })
})

test('post.reconcileRagIndexCommunityBatchAdmin: queues missing stale and removable RAG jobs for a community batch', async () => {
  ;(postRag.reconcilePostRagJobsForCommunityBatch as jest.Mock).mockResolvedValue({
    communityId: 'community-1',
    skip: 5,
    limit: 10,
    scannedCount: 10,
    upsertQueuedCount: 2,
    deleteQueuedCount: 1,
    skippedCount: 7,
    missingStateCount: 1,
    staleStateCount: 1,
    removableStateCount: 1,
    failedCount: 0,
    hasMore: true,
    nextSkip: 15,
  })

  const result: any = await main({
    action: 'post.reconcileRagIndexCommunityBatchAdmin',
    communityId: 'community-1',
    skip: 5,
    limit: 10,
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(postRag.reconcilePostRagJobsForCommunityBatch).toHaveBeenCalledWith('community-1', {
    skip: 5,
    limit: 10,
  })
  expect(result).toEqual({
    communityId: 'community-1',
    skip: 5,
    limit: 10,
    scannedCount: 10,
    upsertQueuedCount: 2,
    deleteQueuedCount: 1,
    skippedCount: 7,
    missingStateCount: 1,
    staleStateCount: 1,
    removableStateCount: 1,
    failedCount: 0,
    hasMore: true,
    nextSkip: 15,
  })
})

test('post.ragIndexHealthAdmin: returns RAG index health counts for a scoped community', async () => {
  ;(postRag.getPostRagIndexHealthForCommunity as jest.Mock).mockResolvedValue({
    communityId: 'community-1',
    activePostCount: 6,
    indexedStateCount: 4,
    removedStateCount: 1,
    failedStateCount: 1,
    pendingJobCount: 2,
    failedJobCount: 1,
    potentialMissingActiveCount: 2,
    coverageRatio: 4 / 6,
  })

  const result: any = await main({
    action: 'post.ragIndexHealthAdmin',
    communityId: 'community-1',
    _actAs: { accountId: 'admin-1', role: 'superAdmin', userId: 'ops-openid', username: 'ops' },
  })

  expect(postRag.getPostRagIndexHealthForCommunity).toHaveBeenCalledWith('community-1')
  expect(result).toEqual({
    communityId: 'community-1',
    activePostCount: 6,
    indexedStateCount: 4,
    removedStateCount: 1,
    failedStateCount: 1,
    pendingJobCount: 2,
    failedJobCount: 1,
    potentialMissingActiveCount: 2,
    coverageRatio: 4 / 6,
  })
})

test('post.ragV2HealthAdmin: is superAdmin-only and returns exact v2 coverage', async () => {
  ;(getPostRagV2Health as jest.Mock).mockResolvedValue({ communityId:'community-1', schemaVersion:2, eligibleActivePostCount:125, exactSourceVersionCount:125, missingExactSourceVersionCount:0, pendingJobCount:0, retryJobCount:0, processingJobCount:0, failedJobCount:0, coverageRatio:1 })
  await expect(main({action:'post.ragV2HealthAdmin',communityId:'community-1'})).resolves.toMatchObject({eligibleActivePostCount:125,exactSourceVersionCount:125})
  await expect(main({action:'post.ragV2HealthAdmin',communityId:'community-1',_actAs:{accountId:'a',role:'communityAdmin',userId:'u',username:'n'}})).rejects.toThrow('权限不足')
  expect(getPostRagV2Health).toHaveBeenCalledWith('community-1')
})

test('release timer probe actions route only through internal superAdmin with run-bound params',async()=>{;(releaseProbe.createPostRagReleaseProbe as jest.Mock).mockResolvedValue({runId:'run-1',postId:'p1'});(releaseProbe.readPostRagReleaseTimerEvidence as jest.Mock).mockResolvedValue({evidence:null});(releaseProbe.readPostRagReleaseProbeStatus as jest.Mock).mockResolvedValue({complete:false});(releaseProbe.cleanupPostRagReleaseProbe as jest.Mock).mockResolvedValue({success:true})
  await expect(main({action:'post.ragTimerProbeCreateAdmin',runId:'run-1'})).resolves.toMatchObject({runId:'run-1'});await main({action:'post.ragTimerEvidenceAdmin',runId:'run-1'});await main({action:'post.ragTimerProbeStatusAdmin',runId:'run-1',postId:'p1'});await main({action:'post.ragTimerProbeCleanupAdmin',runId:'run-1',postId:'p1'});expect(releaseProbe.readPostRagReleaseTimerEvidence).toHaveBeenCalledWith('run-1')
  await expect(main({action:'post.ragTimerProbeCreateAdmin',runId:'run-1',_actAs:{accountId:'a',role:'communityAdmin',userId:'u',username:'n'}})).rejects.toThrow('权限不足')
  const response:any=await rawMain({httpMethod:'POST',headers:{authorization:'Bearer ignored'},body:JSON.stringify({action:'post.ragTimerProbeCreateAdmin',runId:'run-1'})});expect(response.statusCode).toBe(403)
})

test('community.listAllPageAdmin: is superAdmin-only and paginates every community status', async () => {
  const statuses = ['active', 'pending', 'rejected', 'disabled']
  const all = Array.from({ length: 125 }, (_, index) => ({
    _id: `community-${String(index + 1).padStart(3, '0')}`,
    status: statuses[index % statuses.length],
  }))
  ;(db.queryAfterId as jest.Mock).mockImplementation(async (
    _collection: string,
    _where: Record<string, unknown>,
    afterId: string | null,
    limit: number,
  ) => all.filter((item) => !afterId || item._id > afterId).slice(0, limit))

  const first: any = await main({
    action: 'community.listAllPageAdmin',
    afterId: '',
    limit: 100,
  })
  const second: any = await main({
    action: 'community.listAllPageAdmin',
    afterId: first.nextAfterId,
    limit: 100,
  })
  const items = [...first.items, ...second.items]

  expect(items).toHaveLength(125)
  expect(first.hasMore).toBe(true)
  expect(second.hasMore).toBe(false)
  expect(new Set(items.map((item: any) => item.status))).toEqual(new Set(statuses))
  expect(db.queryAfterId).toHaveBeenNthCalledWith(1, 'communities', {}, null, 100)
  expect(db.queryAfterId).toHaveBeenNthCalledWith(2, 'communities', {}, 'community-100', 100)

  await expect(main({
    action: 'community.listAllPageAdmin',
    _actAs: { accountId: 'a', role: 'communityAdmin', userId: 'u', username: 'n' },
  })).rejects.toThrow('权限不足')
})
