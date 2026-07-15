import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const signIn = vi.fn()
const signOut = vi.fn()
const getLoginState = vi.fn()
const userLogin = vi.fn()
const myCommunities = vi.fn()
const primeCommunityDirectory = vi.fn()
const clearCommunityDirectoryCache = vi.fn()
const calls: string[] = []
const storage = new Map<string, any>()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

vi.mock('../../api/web-cloudbase', () => ({ signIn, signOut, getLoginState }))
vi.mock('../../api/cloud', () => ({
  userApi: { login: userLogin },
  memberApi: { myCommunities },
  sectionApi: { list: vi.fn() },
}))
vi.mock('../../utils/community-directory-cache', () => ({
  primeCommunityDirectory,
  clearCommunityDirectoryCache,
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
    primeCommunityDirectory.mockResolvedValue({
      communities: [],
      fetchedAt: Date.now(),
      freshness: 'fresh',
    })
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
    expect(primeCommunityDirectory).toHaveBeenCalledWith(
      'web-user-1',
      'community.directory.login-prefetch',
    )
  })

  test('direct login commits the session without waiting for directory prefetch', async () => {
    primeCommunityDirectory.mockReturnValueOnce(new Promise(() => {}))
    const { useUserStore } = await import('../user')
    const store = useUserStore()

    await store.login({ nickName: '青山用户', avatarUrl: '' })

    expect(store.isLoggedIn).toBe(true)
    expect(store.openId).toBe('web-user-1')
    expect(primeCommunityDirectory).toHaveBeenCalledWith(
      'web-user-1',
      'community.directory.login-prefetch',
    )
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

  test('restoreWebSession signs out an SDK session that has no saved nickname', async () => {
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    getLoginState.mockResolvedValue({ user: { uid: 'sdk-user' } })

    await store.restoreWebSession()

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(store.isLoggedIn).toBe(false)
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
    expect(clearCommunityDirectoryCache).toHaveBeenCalledWith('web-user-1')
    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
  })

  test('webLogin reports both failures and clears local state when rollback signOut fails', async () => {
    userLogin.mockRejectedValueOnce(new Error('business login failed'))
    signOut.mockRejectedValueOnce(new Error('rollback signOut failed'))
    const { useUserStore } = await import('../user')
    const store = useUserStore()

    await expect(store.webLogin({ username: 'alice', password: 'secret', nickName: '新昵称' }))
      .rejects.toThrow(/business login failed.*rollback signOut failed/)

    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(storage.has('user_store')).toBe(false)
  })

  test('logout clears local state even when Web signOut fails', async () => {
    signOut.mockRejectedValueOnce(new Error('signOut unavailable'))
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    Object.assign(store, { openId: 'web-user-1', nickName: '青山用户', isLoggedIn: true })

    await expect(store.logout()).rejects.toThrow('signOut unavailable')

    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(storage.has('user_store')).toBe(false)
  })

  test('a restore waiting on user.login cannot revive the session after logout', async () => {
    const pendingLogin = deferred<{ user: any; isNew: boolean }>()
    getLoginState.mockResolvedValue({ user: { uid: 'sdk-user' } })
    userLogin.mockReturnValueOnce(pendingLogin.promise)
    const { useUserStore } = await import('../user')
    const { useCommunityStore } = await import('../community')
    const store = useUserStore()
    const community = useCommunityStore()
    store.nickName = '已存昵称'

    const restoring = store.restoreWebSession()
    await vi.waitFor(() => expect(userLogin).toHaveBeenCalledTimes(1))
    await store.logout()
    pendingLogin.resolve({ user: businessUser({ _id: 'stale-user' }), isNew: false })
    await restoring

    expect(store.openId).toBe('')
    expect(store.isLoggedIn).toBe(false)
    expect(storage.has('user_store')).toBe(false)
    expect(community.currentCommunityId).toBe('')
    expect(community.myCommunities).toEqual([])
    expect(myCommunities).not.toHaveBeenCalled()
  })

  test('a canceled direct login does not apply a late user.login result', async () => {
    const pendingLogin = deferred<{ user: any; isNew: boolean }>()
    userLogin.mockReturnValueOnce(pendingLogin.promise)
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    let current = true

    const loggingIn = store.login(
      { nickName: '本轮昵称', avatarUrl: '' },
      undefined,
      { shouldApply: () => current },
    )
    current = false
    pendingLogin.resolve({ user: businessUser({ _id: 'late-user' }), isNew: false })
    await loggingIn

    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(storage.has('user_store')).toBe(false)
  })

  test('a canceled web login rolls back the SDK session and ignores a late business user', async () => {
    const pendingLogin = deferred<{ user: any; isNew: boolean }>()
    userLogin.mockReturnValueOnce(pendingLogin.promise)
    const { useUserStore } = await import('../user')
    const store = useUserStore()
    let current = true

    const loggingIn = store.webLogin(
      { username: 'alice', password: 'secret', nickName: '本轮昵称' },
      undefined,
      { shouldApply: () => current },
    )
    await vi.waitFor(() => expect(userLogin).toHaveBeenCalledTimes(1))
    current = false
    pendingLogin.resolve({ user: businessUser({ _id: 'late-web-user' }), isNew: false })
    await loggingIn

    expect(signOut).toHaveBeenCalledTimes(1)
    expect(store.isLoggedIn).toBe(false)
    expect(store.openId).toBe('')
    expect(storage.has('user_store')).toBe(false)
  })
})
