import { afterEach, describe, expect, test, vi } from 'vitest'

describe('callCloud', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
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
})
