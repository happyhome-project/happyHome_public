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
      uploadFile: vi.fn().mockResolvedValue({ fileID: 'cloud://env/a.txt', requestId: 'r1' }),
      getTempFileURL: vi.fn().mockResolvedValue({ fileList: [{ fileID: 'cloud://env/a.txt', tempFileURL: 'https://temp/a.txt' }] }),
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
    const blob = new Blob(['hello'])
    const onUploadProgress = vi.fn()
    await expect(api.uploadFile({ cloudPath: 'a.txt', filePath: blob, onUploadProgress }))
      .resolves.toEqual({ fileID: 'cloud://env/a.txt', requestId: 'r1' })
    await expect(api.getTempFileURL(['cloud://env/a.txt'])).resolves.toEqual({
      fileList: [{ fileID: 'cloud://env/a.txt', tempFileURL: 'https://temp/a.txt' }],
    })

    expect(init).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledWith({ env: 'test-env', accessKey: 'public-access-key' })
    expect(app.auth).toHaveBeenCalledTimes(1)
    expect(auth.signIn).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(app.callFunction).toHaveBeenCalledWith({
      name: 'post',
      data: { action: 'get', postId: 'p1' },
      parse: true,
    })
    expect(app.uploadFile).toHaveBeenCalledWith({ cloudPath: 'a.txt', filePath: blob, onUploadProgress })
    expect(app.getTempFileURL).toHaveBeenCalledWith({ fileList: ['cloud://env/a.txt'] })
  })

  test('rejects a non-object function result instead of leaking a string as the typed result', async () => {
    const app = {
      auth: vi.fn(() => ({
        getLoginState: vi.fn(),
        signIn: vi.fn(),
        signOut: vi.fn(),
      })),
      callFunction: vi.fn().mockResolvedValue({ result: 'not-json' }),
    }
    const api = createWebCloudbaseApi({
      env: { envId: 'test-env', accessKey: 'public-access-key' },
      loadSdk: async () => ({ default: { init: () => app } }),
    })

    await expect(api.callFunction('post', { action: 'get' }))
      .rejects.toThrow('[web-cloudbase] post returned a non-object result')
  })

  test('retries initialization after the current singleton promise rejects', async () => {
    const auth = {
      getLoginState: vi.fn().mockResolvedValue({ user: { uid: 'recovered' } }),
      signIn: vi.fn(),
      signOut: vi.fn(),
    }
    const app = { auth: vi.fn(() => auth), callFunction: vi.fn() }
    const loadSdk = vi.fn()
      .mockRejectedValueOnce(new Error('temporary SDK load failure'))
      .mockResolvedValueOnce({ default: { init: () => app } })
    const api = createWebCloudbaseApi({
      env: { envId: 'test-env', accessKey: 'public-access-key' },
      loadSdk,
    })

    await expect(api.getLoginState()).rejects.toThrow('temporary SDK load failure')
    await expect(api.getLoginState()).resolves.toEqual({ user: { uid: 'recovered' } })
    expect(loadSdk).toHaveBeenCalledTimes(2)
  })

  test('shares one initialization promise across concurrent callers', async () => {
    let resolveSdk!: (sdk: any) => void
    const loadSdk = vi.fn(() => new Promise<any>((resolve) => { resolveSdk = resolve }))
    const auth = {
      getLoginState: vi.fn().mockResolvedValue({ user: { uid: 'shared' } }),
      signIn: vi.fn(),
      signOut: vi.fn(),
    }
    const app = { auth: vi.fn(() => auth), callFunction: vi.fn() }
    const api = createWebCloudbaseApi({
      env: { envId: 'test-env', accessKey: 'public-access-key' },
      loadSdk,
    })

    const first = api.getLoginState()
    const second = api.getLoginState()
    expect(loadSdk).toHaveBeenCalledTimes(1)
    resolveSdk({ default: { init: () => app } })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { user: { uid: 'shared' } },
      { user: { uid: 'shared' } },
    ])
    expect(app.auth).toHaveBeenCalledTimes(1)
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
