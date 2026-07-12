import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const signIn = vi.fn()
const signOut = vi.fn()
const getLoginState = vi.fn()
const userLogin = vi.fn()
const myCommunities = vi.fn()
const calls: string[] = []
const storage = new Map<string, any>()

vi.mock('../../api/web-cloudbase', () => ({ signIn, signOut, getLoginState }))
vi.mock('../../api/cloud', () => ({
  userApi: { login: userLogin },
  memberApi: { myCommunities },
  sectionApi: { list: vi.fn() },
}))

function businessUser(overrides: Record<string, any> = {}) {
  return {
    _id: 'web-user-1',
    nickName: '青山用户',
    avatarUrl: '',
    role: 'user',
    ...overrides,
  }
}

describe('user store Web auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
    storage.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
      removeStorageSync: vi.fn((key: string) => storage.delete(key)),
    })
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn((key: string) => storage.get(key)),
      setStorageSync: vi.fn((key: string, value: any) => storage.set(key, value)),
    })
    signIn.mockImplementation(async () => { calls.push('signIn') })
    signOut.mockImplementation(async () => { calls.push('signOut') })
    userLogin.mockImplementation(async ({ nickName }: any) => {
      calls.push('user.login')
      return { user: businessUser({ nickName }), isNew: false }
    })
    myCommunities.mockResolvedValue({ communities: [] })
  })

  test('webLogin signs into Web SDK before user.login and never persists the password', async () => {
    const { useUserStore } = await import('../user')
    const store = useUserStore()

    await store.webLogin({ username: 'alice', password: 'secret', nickName: '青山用户' })

    expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(calls).toEqual(['signIn', 'user.login'])
    expect(store.isLoggedIn).toBe(true)
    expect('password' in store.$state).toBe(false)
    expect(JSON.stringify([...storage.entries()])).not.toContain('secret')
  })

  test('restoreWebSession clears stale user and community state without an SDK session', async () => {
    const { useUserStore } = await import('../user')
    const { useCommunityStore } = await import('../community')
    const store = useUserStore()
    const community = useCommunityStore()
    Object.assign(store, { openId: 'stale', nickName: '旧昵称', isLoggedIn: true })
    Object.assign(community, {
      currentCommunityId: 'stale-community',
      myCommunities: [{ _id: 'stale-community' }],
      membershipByCommunity: { 'stale-community': { isMember: true } },
    })
    getLoginState.mockResolvedValue(null)

    await store.restoreWebSession()

    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(community.currentCommunityId).toBe('')
    expect(community.myCommunities).toEqual([])
    expect(community.membershipByCommunity).toEqual({})
  })

  test('restoreWebSession refreshes the business user and memberships with the saved nickname', async () => {
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    store.nickName = '已存昵称'
    getLoginState.mockResolvedValue({ user: { uid: 'sdk-user' } })
    userLogin.mockResolvedValue({ user: businessUser({ nickName: '服务端昵称' }), isNew: false })
    myCommunities.mockResolvedValue({ communities: [{ _id: 'community-1', status: 'active' }] })

    await store.restoreWebSession()

    expect(userLogin).toHaveBeenCalledWith({ nickName: '已存昵称', avatarUrl: '' })
    expect(myCommunities).toHaveBeenCalledTimes(1)
    expect(store.nickName).toBe('服务端昵称')
    expect(store.isLoggedIn).toBe(true)
  })

  test.each([
    ['signIn', () => signIn.mockRejectedValueOnce(new Error('bad credentials'))],
    ['user.login', () => userLogin.mockRejectedValueOnce(new Error('business login failed'))],
  ])('webLogin leaves no partial login when %s fails', async (_name, arrange) => {
    arrange()
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    Object.assign(store, { openId: 'stale', nickName: '旧昵称', isLoggedIn: true })

    await expect(store.webLogin({ username: 'alice', password: 'secret', nickName: '新昵称' })).rejects.toThrow()

    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(store.nickName).toBe('')
    expect(storage.has('user_store')).toBe(false)
  })

  test('logout signs out of Web SDK before clearing local state', async () => {
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    Object.assign(store, { openId: 'web-user-1', nickName: '青山用户', isLoggedIn: true })
    signOut.mockImplementation(async () => {
      calls.push('signOut')
      expect(store.isLoggedIn).toBe(true)
    })

    await store.logout()

    expect(calls).toEqual(['signOut'])
    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
  })
})
