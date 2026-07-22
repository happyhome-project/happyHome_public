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

  test('postApi exposes section-free archive create, tabs, and cursor list actions', async () => {
    callWebFunction.mockResolvedValue({ posts: [], hasMore: false })
    vi.stubGlobal('uni', {})

    const { postApi } = await import('../cloud')
    expect((postApi as any).createArchive).toBeInstanceOf(Function)
    expect((postApi as any).listArchive).toBeInstanceOf(Function)
    expect((postApi as any).listArchiveTabs).toBeInstanceOf(Function)

    await (postApi as any).createArchive({
      communityId: 'community-1', area: 'archive', format: 'text', topics: ['成长'],
      content: { title: '家风', body: { text: '正文' } }, presentation: { textNoteTheme: 'paper' },
    })
    await (postApi as any).listArchiveTabs({ communityId: 'community-1' })
    await (postApi as any).listArchive({ communityId: 'community-1', topicKey: '成长', cursor: 'cursor-1', limit: 20 })

    expect(callWebFunction).toHaveBeenNthCalledWith(1, 'post', expect.objectContaining({
      action: 'create', area: 'archive', format: 'text', communityId: 'community-1',
    }))
    expect(callWebFunction).toHaveBeenNthCalledWith(2, 'post', {
      action: 'listArchiveTabs', communityId: 'community-1',
    })
    expect(callWebFunction).toHaveBeenNthCalledWith(3, 'post', {
      action: 'listArchive', communityId: 'community-1', topicKey: '成长', cursor: 'cursor-1', limit: 20,
    })
  })

  test('postApi forwards a bounded performance trace for archive tab requests', async () => {
    callWebFunction.mockResolvedValue({ posts: [], hasMore: false })
    vi.stubGlobal('uni', {})
    const { postApi } = await import('../cloud')

    await (postApi as any).listArchive({ communityId: 'community-1', topicKey: '成长' }, {
      requestId: 'archive-switch-1', stage: 'home.archive.feed', sample: 'warm',
    })

    expect(callWebFunction).toHaveBeenCalledWith('post', {
      action: 'listArchive',
      communityId: 'community-1',
      topicKey: '成长',
      _trace: { requestId: 'archive-switch-1', stage: 'home.archive.feed', sample: 'warm' },
    })
  })

  test('postApi requests server-owned upload paths for member videos and covers', async () => {
    callWebFunction.mockResolvedValue({ cloudPath: 'posts/member-videos/scope/video.mp4', fileId: 'cloud://env/posts/member-videos/scope/video.mp4' })
    vi.stubGlobal('uni', {})

    const { postApi } = await import('../cloud')
    await (postApi as any).requestMemberVideoUpload({ communityId: 'community-1', fileName: 'family.mp4' })
    await (postApi as any).requestMemberVideoCoverUpload({ communityId: 'community-1', fileName: 'cover.jpg' })
    await (postApi as any).deleteMemberVideoUpload({ communityId: 'community-1', fileID: 'cloud://env/pending.mp4', kind: 'video' })

    expect(callWebFunction).toHaveBeenNthCalledWith(1, 'post', {
      action: 'requestMemberVideoUpload', communityId: 'community-1', fileName: 'family.mp4',
    })
    expect(callWebFunction).toHaveBeenNthCalledWith(2, 'post', {
      action: 'requestMemberVideoCoverUpload', communityId: 'community-1', fileName: 'cover.jpg',
    })
    expect(callWebFunction).toHaveBeenNthCalledWith(3, 'post', {
      action: 'deleteMemberVideoUpload', communityId: 'community-1', fileID: 'cloud://env/pending.mp4', kind: 'video',
    })
  })

  test('exposes global collaboration templates and section-free collaboration post actions', async () => {
    callWebFunction.mockResolvedValue({ templates: [] })
    vi.stubGlobal('uni', {})

    const { collaborationTemplateApi, postApi } = await import('../cloud')
    await collaborationTemplateApi.listActive()
    await collaborationTemplateApi.get('collaboration-template-carpool')
    await postApi.createCollaboration({
      communityId: 'community-1',
      collaborationTemplateId: 'collaboration-template-carpool',
      content: { carpool_origin: '青山村' },
    })
    await postApi.listCollaboration('community-1', 'collaboration-template-carpool', 0)

    expect(callWebFunction).toHaveBeenNthCalledWith(1, 'collaboration-template', { action: 'listActive' })
    expect(callWebFunction).toHaveBeenNthCalledWith(2, 'collaboration-template', {
      action: 'get', templateId: 'collaboration-template-carpool',
    })
    expect(callWebFunction).toHaveBeenNthCalledWith(3, 'post', {
      action: 'createCollaboration',
      communityId: 'community-1',
      collaborationTemplateId: 'collaboration-template-carpool',
      content: { carpool_origin: '青山村' },
    })
    expect(callWebFunction).toHaveBeenNthCalledWith(4, 'post', {
      action: 'listCollaboration',
      communityId: 'community-1',
      collaborationTemplateId: 'collaboration-template-carpool',
      skip: 0,
      asGuest: false,
    })
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
