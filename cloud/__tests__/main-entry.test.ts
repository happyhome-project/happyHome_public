/**
 * L2 integration tests: call each cloud function's `main()` with the exact flat
 * event shape the frontend sends, to catch:
 *   - event destructuring mismatches (the bug that motivated feedback_test_through_main.md)
 *   - action routing breakage
 *   - OPENID injection failing silently
 *
 * db and auth are mocked; everything above (routing, validation, context resolution) is real.
 */

// ---- Mocks ----
jest.mock('../lib/db', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
}))

jest.mock('../lib/auth', () => ({
  assertSuperAdmin: jest.fn().mockResolvedValue(undefined),
  assertCommunityAdmin: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  getWXContext: jest.fn().mockReturnValue({ OPENID: 'wxcontext-openid' }),
  DYNAMIC_CURRENT_ENV: 'test',
}))

// uuid v13+ is ESM-only; jest won't transform it from node_modules. Mock it.
jest.mock('uuid', () => ({ v4: jest.fn().mockReturnValue('mocked-uuid') }))

import * as db from '../lib/db'
import { main as _userMain } from '../functions/user/index'
import { main as _communityMain } from '../functions/community/index'
import { main as _memberMain } from '../functions/member/index'
import { main as _sectionMain } from '../functions/section/index'
import { main as _postMain } from '../functions/post/index'

// Cast all mains to uniform signature — integration tests exercise the routing
// layer, not the per-action return shape.
type AnyMain = (event: any) => Promise<any>
const userMain = _userMain as AnyMain
const communityMain = _communityMain as AnyMain
const memberMain = _memberMain as AnyMain
const sectionMain = _sectionMain as AnyMain
const postMain = _postMain as AnyMain

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.ALLOW_TEST_OPENID
})

/**
 * Helper: build a frontend-shaped event.
 * Frontend wraps wx.cloud.callFunction with `data: { action, ...params }` — flat.
 */
function fe(action: string, params: Record<string, any> = {}, extra: Record<string, any> = {}) {
  return { action, ...params, ...extra }
}

// ============================================================
// 1. Event destructuring — EVERY main must treat event as flat
// ============================================================
describe('Event shape: flat destructuring (regression for event mismatch bug)', () => {
  test('community.get reads communityId directly from event, not event.params', async () => {
    ;(db.getById as jest.Mock).mockResolvedValue({ _id: 'c1', name: 'Test', status: 'active' })
    const res = await communityMain(fe('get', { communityId: 'c1' }))
    expect(db.getById).toHaveBeenCalledWith('communities', 'c1')
    expect(res.community._id).toBe('c1')
  })

  test('post.list reads sectionId from flat event', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({ _id: 's1', communityId: 'c1', status: 'active' })
      .mockResolvedValueOnce({ _id: 'c1', status: 'active' })
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
      .mockResolvedValueOnce([])
    await postMain(fe('list', { sectionId: 's1' }))
    const [collection, where] = (db.query as jest.Mock).mock.calls[1]
    expect(collection).toBe('posts')
    expect(where).toEqual(expect.objectContaining({ sectionId: 's1' }))
  })

  test('section.list reads communityId from flat event', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 'c1', status: 'active' })
    ;(db.query as jest.Mock)
      .mockResolvedValueOnce([{ _id: 'm1', status: 'active' }])
      .mockResolvedValueOnce([])
    await sectionMain(fe('list', { communityId: 'c1' }))
    const [collection, where] = (db.query as jest.Mock).mock.calls[1]
    expect(collection).toBe('sections')
    expect(where).toEqual({ communityId: 'c1' })
  })

  test('member.pendingList reads communityId from flat event', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([])
    await memberMain(fe('pendingList', { communityId: 'c1' }))
    expect(db.query).toHaveBeenCalledWith(
      'community_members',
      expect.objectContaining({ communityId: 'c1', status: 'pending' }),
    )
  })
})

// ============================================================
// 2. Action routing — unknown actions must throw, known ones must dispatch
// ============================================================
describe('Action routing', () => {
  test.each([
    ['user', userMain],
    ['community', communityMain],
    ['member', memberMain],
    ['section', sectionMain],
    ['post', postMain],
  ])('%s.main throws on unknown action', async (_name, main) => {
    await expect(main(fe('bogusAction'))).rejects.toThrow(/Unknown action/)
  })

  test('community.main routes "list" to handleList (not handleGet)', async () => {
    ;(db.query as jest.Mock).mockResolvedValue([{ _id: 'c1' }])
    const res = await communityMain(fe('list'))
    expect(res).toHaveProperty('communities')
    expect(res).not.toHaveProperty('community')
  })
})

// ============================================================
// 3. OPENID injection gating
// ============================================================
describe('OPENID injection via _testOpenid', () => {
  const cloud = require('wx-server-sdk')

  test('without ALLOW_TEST_OPENID env, _testOpenid is IGNORED, falls back to wxContext', async () => {
    ;(db.create as jest.Mock).mockResolvedValue('c-new')
    await communityMain(fe('create', {
      name: 'x', description: '', coverImage: '', location: {}, joinType: 'open',
    }, { _testOpenid: 'attacker' }))
    const createdCommunity = (db.create as jest.Mock).mock.calls[0][1]
    expect(createdCommunity.creatorId).toBe('wxcontext-openid')
    expect(createdCommunity.creatorId).not.toBe('attacker')
  })

  test('WITH ALLOW_TEST_OPENID=true, _testOpenid overrides wxContext', async () => {
    process.env.ALLOW_TEST_OPENID = 'true'
    ;(db.create as jest.Mock).mockResolvedValue('c-new')
    await communityMain(fe('create', {
      name: 'y', description: '', coverImage: '', location: {}, joinType: 'open',
    }, { _testOpenid: 'injected-user' }))
    const createdCommunity = (db.create as jest.Mock).mock.calls[0][1]
    expect(createdCommunity.creatorId).toBe('injected-user')
  })

  test('_testOpenid field is not leaked into params passed to handlers', async () => {
    process.env.ALLOW_TEST_OPENID = 'true'
    ;(db.create as jest.Mock).mockResolvedValue('c-new')
    await communityMain(fe('create', {
      name: 'z', description: '', coverImage: '', location: {}, joinType: 'open',
    }, { _testOpenid: 'u1' }))
    const createdCommunity = (db.create as jest.Mock).mock.calls[0][1]
    expect(createdCommunity).not.toHaveProperty('_testOpenid')
  })

  test('when wxContext has no OPENID and env flag off, writes throw', async () => {
    cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
    await expect(
      postMain(fe('create', { communityId: 'c1', sectionId: 's1', content: {} })),
    ).rejects.toThrow(/Missing OPENID/)
  })
})

// ============================================================
// 4. OPENID dependency — operations requiring OPENID must declare it
// ============================================================
describe('OPENID requirement contract', () => {
  const cases: Array<[string, (ev: any) => Promise<any>, string, Record<string, any>]> = [
    ['user.login', userMain, 'login', { nickName: 'a', avatarUrl: '' }],
    ['community.create', communityMain, 'create', { name: 'x', description: '', coverImage: '', location: {}, joinType: 'open' }],
    ['community.approve', communityMain, 'approve', { communityId: 'c1' }],
    ['community.reject', communityMain, 'reject', { communityId: 'c1' }],
    ['community.pendingList', communityMain, 'pendingList', {}],
    ['member.apply', memberMain, 'apply', { communityId: 'c1' }],
    ['member.leave', memberMain, 'leave', { communityId: 'c1' }],
    ['member.memberApprove', memberMain, 'memberApprove', { communityId: 'c1', memberId: 'm1' }],
    ['member.memberReject', memberMain, 'memberReject', { communityId: 'c1', memberId: 'm1' }],
    ['member.pendingList', memberMain, 'pendingList', { communityId: 'c1' }],
    ['section.create', sectionMain, 'create', { communityId: 'c1', name: 'x', icon: '', order: 0 }],
    ['section.updateWidgets', sectionMain, 'updateWidgets', { communityId: 'c1', sectionId: 's1', widgets: [] }],
    ['section.update', sectionMain, 'update', { sectionId: 's1', communityId: 'c1' }],
    ['post.create', postMain, 'create', { communityId: 'c1', sectionId: 's1', content: {} }],
    ['post.delete', postMain, 'delete', { postId: 'p1' }],
    ['post.update', postMain, 'update', { postId: 'p1', content: {} }],
  ]

  test.each(cases)('%s rejects when OPENID is empty', async (_label, main, action, params) => {
    const cloud = require('wx-server-sdk')
    cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
    await expect(main(fe(action, params))).rejects.toThrow(/Missing OPENID|无权|已删除|帖子已删除/)
  })
})

test('member.myCommunities without OPENID returns empty list as backend fallback', async () => {
  const cloud = require('wx-server-sdk')
  cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
  await expect(memberMain(fe('myCommunities'))).resolves.toEqual({ communities: [] })
})

// ============================================================
// 5. Community content reads require active membership
// ============================================================
describe('Community content reads require membership', () => {
  test('community.list works without wxContext OPENID', async () => {
    const cloud = require('wx-server-sdk')
    cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
    ;(db.query as jest.Mock).mockResolvedValue([])
    const res = await communityMain(fe('list'))
    expect(res).toHaveProperty('communities')
  })

  test('section.list without OPENID is rejected', async () => {
    const cloud = require('wx-server-sdk')
    cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
    await expect(sectionMain(fe('list', { communityId: 'c1' }))).rejects.toThrow('需要先加入社区后查看内容')
  })

  test('post.list without OPENID is rejected', async () => {
    const cloud = require('wx-server-sdk')
    cloud.getWXContext.mockReturnValueOnce({ OPENID: '' })
    ;(db.getById as jest.Mock).mockResolvedValueOnce({ _id: 's1', communityId: 'c1', status: 'active' })
    await expect(postMain(fe('list', { sectionId: 's1' }))).rejects.toThrow('需要先加入社区后查看内容')
  })
})
