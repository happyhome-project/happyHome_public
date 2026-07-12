import { describe, expect, test, vi } from 'vitest'

import { createWebCloudbaseApi } from '../web-cloudbase'

describe('web CloudBase API', () => {
  test('initializes one app and auth instance and delegates the v3 auth API', async () => {
    const loginState = { user: { uid: 'web-user' } }
    const auth = {
      getLoginState: vi.fn().mockResolvedValue(loginState),
      signIn: vi.fn().mockResolvedValue(loginState),
      signOut: vi.fn().mockResolvedValue(undefined),
    }
    const app = {
      auth: vi.fn(() => auth),
      callFunction: vi.fn().mockResolvedValue({ result: { ok: true } }),
    }
    const init = vi.fn(() => app)
    const api = createWebCloudbaseApi({
      env: { envId: 'test-env', accessKey: 'public-access-key' },
      loadSdk: async () => ({ default: { init } }),
    })

    await expect(api.getLoginState()).resolves.toBe(loginState)
    await expect(api.signIn({ username: 'alice', password: 'secret' })).resolves.toBe(loginState)
    await expect(api.signOut()).resolves.toBeUndefined()
    await expect(api.callFunction('post', { action: 'get', postId: 'p1' })).resolves.toEqual({ ok: true })

    expect(init).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledWith({ env: 'test-env', accessKey: 'public-access-key' })
    expect(app.auth).toHaveBeenCalledTimes(1)
    expect(auth.signIn).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(app.callFunction).toHaveBeenCalledWith({
      name: 'post',
      data: { action: 'get', postId: 'p1' },
    })
  })

  test.each([
    [{ envId: '', accessKey: 'public-access-key' }, 'VITE_CLOUDBASE_ENV_ID'],
    [{ envId: 'test-env', accessKey: '' }, 'VITE_CLOUDBASE_ACCESS_KEY'],
  ])('reports missing public Web SDK configuration when first called', async (env, missingName) => {
    const loadSdk = vi.fn()
    const api = createWebCloudbaseApi({ env, loadSdk })

    await expect(api.getLoginState()).rejects.toThrow(missingName)
    expect(loadSdk).not.toHaveBeenCalled()
  })
})
