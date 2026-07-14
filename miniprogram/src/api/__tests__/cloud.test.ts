import { afterEach, describe, expect, test, vi } from 'vitest'

const callWebFunction = vi.fn()

vi.mock('../web-cloudbase', () => ({
  callFunction: callWebFunction,
}))

describe('callCloud', () => {
  afterEach(() => {
    callWebFunction.mockReset()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  test('routes H5 calls through the CloudBase Web SDK without gateway credentials', async () => {
    callWebFunction.mockResolvedValue({ post: { _id: 'p1' } })
    const fetch = vi.fn()
    const request = vi.fn()
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn(() => 'legacy-test-openid'),
      request,
    })

    const { callCloud } = await import('../cloud')

    await expect(callCloud('post', 'get', { postId: 'p1' })).resolves.toEqual({ post: { _id: 'p1' } })
    expect(callWebFunction).toHaveBeenCalledWith('post', { action: 'get', postId: 'p1' })
    expect(fetch).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  test('sends flat wx.cloud payload matching cloud function main()', async () => {
    const callFunction = vi.fn(({ success }: { success: (value: any) => void }) => {
      success({ result: { post: { _id: 'p1' } } })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { callCloud } = await import('../cloud')

    await expect(callCloud('post', 'get', { postId: 'p1' })).resolves.toEqual({ post: { _id: 'p1' } })
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'post',
      data: { action: 'get', postId: 'p1' },
    }))
  })

  test('forwards only whitelisted performance trace fields to the cloud function', async () => {
    const callFunction = vi.fn(({ success }: { success: (value: any) => void }) => {
      success({ result: { ok: true }, requestId: 'server-request-1' })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { callCloud } = await import('../cloud')

    await callCloud('user', 'login', {}, {
      requestId: 'login-123',
      stage: 'login.submit',
      sample: 'warm',
      counts: { communityCount: 2, invalid: Number.NaN },
      nickName: '不得透传',
      openid: '不得透传',
    } as any)

    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'user',
      data: {
        action: 'login',
        _trace: {
          requestId: 'login-123',
          stage: 'login.submit',
          sample: 'warm',
          counts: { communityCount: 2 },
        },
      },
    }))
  })

  test('ignores stale dev-gateway flag for normal miniprogram calls', async () => {
    const callFunction = vi.fn(({ success }: { success: (value: any) => void }) => {
      success({ result: { user: { _id: 'real-openid', role: 'user' }, isNew: true } })
    })
    const request = vi.fn()
    vi.stubGlobal('wx', { cloud: { callFunction } })
    vi.stubGlobal('uni', {
      getStorageSync: (key: string) => (key === 'dev-gateway' ? '1' : ''),
      request,
    })

    const { userApi } = await import('../cloud')

    await userApi.login({ nickName: '真实用户', avatarUrl: '' })

    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'user',
      data: { action: 'login', nickName: '真实用户', avatarUrl: '' },
    }))
    expect(request).not.toHaveBeenCalled()
  })

  test('rejects cloud function business errors returned from success callback', async () => {
    const callFunction = vi.fn(({ success }: { success: (value: any) => void }) => {
      success({ result: { success: false, message: 'postId missing' } })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { callCloud } = await import('../cloud')

    await expect(callCloud('post', 'get', { postId: 'p1' })).rejects.toThrow('postId missing')
  })

  test('rejects explicit error payloads returned from success callback', async () => {
    const callFunction = vi.fn(({ success }: { success: (value: any) => void }) => {
      success({ result: { error: 'Missing OPENID' } })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { callCloud } = await import('../cloud')

    await expect(callCloud('post', 'get', { postId: 'p1' })).rejects.toThrow('Missing OPENID')
  })

  test('preserves wx.cloud fail errCode and action context for diagnostics', async () => {
    const callFunction = vi.fn(({ fail }: { fail: (value: any) => void }) => {
      fail({
        errCode: -504002,
        errMsg: 'cloud.callFunction:fail Error: errCode: -504002 functions execute fail',
      })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { callCloud } = await import('../cloud')

    await expect(callCloud('member', 'saveNotificationSubscription', {})).rejects.toMatchObject({
      errCode: -504002,
      cloudFunction: 'member',
      action: 'saveNotificationSubscription',
    })
    await expect(callCloud('member', 'saveNotificationSubscription', {}))
      .rejects.toThrow('member/saveNotificationSubscription')
  })

  test('loads approval reminder config and status from member cloud function at runtime', async () => {
    const callFunction = vi.fn(({ data, success }: { data: any; success: (value: any) => void }) => {
      if (data.action === 'notificationConfig') {
        success({ result: { templates: [{ eventType: 'member_join_pending', templateId: 'tmpl-1' }] } })
        return
      }
      success({ result: { needsAuthorization: false, subscriptions: [] } })
    })
    vi.stubGlobal('wx', { cloud: { callFunction } })

    const { notificationApi } = await import('../cloud')

    await expect(notificationApi.config()).resolves.toEqual({
      templates: [{ eventType: 'member_join_pending', templateId: 'tmpl-1' }],
    })
    await expect(notificationApi.status()).resolves.toEqual({
      needsAuthorization: false,
      subscriptions: [],
    })
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'member',
      data: { action: 'notificationConfig' },
    }))
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'member',
      data: { action: 'notificationStatus' },
    }))
  })
})
