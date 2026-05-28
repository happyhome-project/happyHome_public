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
  increment: jest.fn(),
}))

jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
  requestUploadMetadata: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

import { main } from '../index'
import * as db from '../../../lib/db'
import * as storage from '../../../lib/storage'

beforeEach(() => jest.clearAllMocks())

const SUPER_CTX = {
  accountId: 'admin-1',
  role: 'superAdmin',
  userId: 'admin-openid-1',
  username: 'super',
}

describe('video.requestUpload', () => {
  test('校验 fileName 不能为空', async () => {
    await expect(main({ action: 'video.requestUpload', _actAs: SUPER_CTX, fileName: '' }))
      .rejects.toThrow('fileName 不能为空')
  })

  test('拒绝非法扩展名', async () => {
    await expect(main({ action: 'video.requestUpload', _actAs: SUPER_CTX, fileName: 'evil.exe' }))
      .rejects.toThrow('不支持的文件类型')
  })

  test('视频扩展名走 posts/videos/ 路径', async () => {
    ;(storage.requestUploadMetadata as jest.Mock).mockResolvedValue({
      cloudPath: 'posts/videos/x.mp4',
      fileId: 'cloud://env/posts/videos/x.mp4',
      url: 'https://cos/upload',
      token: 'tk', authorization: 'auth', cosFileId: 'cosId',
    })
    await main({ action: 'video.requestUpload', _actAs: SUPER_CTX, fileName: 'lecture.MP4' })
    const path = (storage.requestUploadMetadata as jest.Mock).mock.calls[0][0]
    expect(path).toMatch(/^posts\/videos\/\d+_[a-z0-9]+\.mp4$/)
  })

  test('封面扩展名走 posts/covers/ 路径', async () => {
    ;(storage.requestUploadMetadata as jest.Mock).mockResolvedValue({} as any)
    await main({ action: 'video.requestUpload', _actAs: SUPER_CTX, fileName: 'cover.JPG' })
    const path = (storage.requestUploadMetadata as jest.Mock).mock.calls[0][0]
    expect(path).toMatch(/^posts\/covers\/\d+_[a-z0-9]+\.jpg$/)
  })
})

describe('audio.requestUpload', () => {
  test('校验 fileName 不能为空', async () => {
    await expect(main({ action: 'audio.requestUpload', _actAs: SUPER_CTX, fileName: '' }))
      .rejects.toThrow('fileName 不能为空')
  })

  test('拒绝非法扩展名', async () => {
    await expect(main({ action: 'audio.requestUpload', _actAs: SUPER_CTX, fileName: 'voice.flac' }))
      .rejects.toThrow('不支持的文件类型')
  })

  test('音频扩展名走 posts/audios/ 路径', async () => {
    ;(storage.requestUploadMetadata as jest.Mock).mockResolvedValue({
      cloudPath: 'posts/audios/x.mp3',
      fileId: 'cloud://env/posts/audios/x.mp3',
      url: 'https://cos/upload',
      token: 'tk', authorization: 'auth', cosFileId: 'cosId',
    })
    await main({ action: 'audio.requestUpload', _actAs: SUPER_CTX, fileName: 'episode.M4A' })
    const path = (storage.requestUploadMetadata as jest.Mock).mock.calls[0][0]
    expect(path).toMatch(/^posts\/audios\/\d+_[a-z0-9]+\.m4a$/)
  })

})

describe('image.requestUpload', () => {
  test('校验 fileName 不能为空', async () => {
    await expect(main({ action: 'image.requestUpload', _actAs: SUPER_CTX, fileName: '' }))
      .rejects.toThrow('fileName 不能为空')
  })

  test('拒绝非图片扩展名', async () => {
    await expect(main({ action: 'image.requestUpload', _actAs: SUPER_CTX, fileName: 'doc.pdf' }))
      .rejects.toThrow('不支持的文件类型')
  })

  test('图片扩展名走 posts/images/ 路径', async () => {
    ;(storage.requestUploadMetadata as jest.Mock).mockResolvedValue({
      cloudPath: 'posts/images/x.png',
      fileId: 'cloud://env/posts/images/x.png',
      url: 'https://cos/upload',
      token: 'tk', authorization: 'auth', cosFileId: 'cosId',
    })
    await main({ action: 'image.requestUpload', _actAs: SUPER_CTX, fileName: 'note.PNG' })
    const path = (storage.requestUploadMetadata as jest.Mock).mock.calls[0][0]
    expect(path).toMatch(/^posts\/images\/\d+_[a-z0-9]+\.png$/)
  })
})

describe('post.createAdmin', () => {
  test('communityId 缺失抛错', async () => {
    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      sectionId: 's-1',
      content: {},
    })).rejects.toThrow('communityId 不能为空')
  })

  test('sectionId 缺失抛错', async () => {
    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      content: {},
    })).rejects.toThrow('sectionId 不能为空')
  })

  test('admin 未绑定 openId 抛错', async () => {
    await expect(main({
      action: 'post.createAdmin',
      _actAs: { ...SUPER_CTX, userId: '' },
      communityId: 'c-1',
      sectionId: 's-1',
      content: {},
    })).rejects.toThrow(/未绑定微信身份/)
  })

  test('section.communityId 与 params 不一致抛错', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-OTHER', widgets: [
        { widgetId: 'w-1', type: 'short_text', label: '标题', required: false, fieldKey: 'f1', order: 0, showInList: false },
      ],
    })
    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: {},
    })).rejects.toThrow('板块不属于当前社区')
  })

  test('必填项未填抛错', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-1', type: 'short_text', label: '标题', required: true, fieldKey: 'f1', order: 0, showInList: false },
      ],
    })
    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-1': '' },
    })).rejects.toThrow('必填项未填写：标题')
  })

  test('正常分支：authorId 落 ctx.userId，attendance 字段被过滤', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-1', type: 'short_text', label: '标题', required: true, fieldKey: 'f1', order: 0, showInList: false },
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 1, showInList: false },
        { widgetId: 'w-att', type: 'attendance', label: '报名', required: false, fieldKey: 'f3', order: 2, showInList: true },
      ],
    })
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-NEW')

    const result: any = await main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: {
        'w-1': 'Hello',
        'w-2': [{ itemId: 'i1', source: 'cos', title: 'Lesson 1', fileID: 'cloud://x.mp4' }],
        'w-att': 'should be dropped',
      },
    })

    expect(result.postId).toBe('post-NEW')
    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload.authorId).toBe('admin-openid-1')
    expect(payload.communityId).toBe('c-1')
    expect(payload.sectionId).toBe('s-1')
    expect(payload.status).toBe('active')
    expect(payload.content['w-1']).toBe('Hello')
    expect(payload.content['w-2']).toHaveLength(1)
    expect(payload.content['w-att']).toBeUndefined()
  })

  test('video_group 必须是数组', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-2': { source: 'cos', title: 'Lesson 1', fileID: 'cloud://x.mp4' } },
    })).rejects.toThrow('必须是视频条目数组')
  })

  test('video_group 拒绝未知来源', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-2': [{ itemId: 'i1', source: 'unknown', title: 'Lesson 1' }] },
    })).rejects.toThrow('来源不支持')
  })

  test('video_group 校验 cos 视频文件', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-2': [{ itemId: 'i1', source: 'cos', title: 'Lesson 1' }] },
    })).rejects.toThrow('视频文件不能为空')
  })

  test('video_group 校验外部链接', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-2': [{ itemId: 'i1', source: 'h5', title: 'Lesson 1' }] },
    })).rejects.toThrow('链接不能为空')
  })

  test('audio_group 接受合法音频条目', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-audio', type: 'audio_group', label: '音频', required: false, fieldKey: 'audio', order: 0, showInList: false },
      ],
    })
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-AUDIO')

    await main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: {
        'w-audio': [{ title: '第一讲', fileID: 'cloud://env/audios/1.mp3', cover: 'cloud://env/covers/1.jpg', duration: 120, size: 1024, ext: 'mp3' }],
      },
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload.content['w-audio']).toEqual([
      { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', cover: 'cloud://env/covers/1.jpg', duration: 120, size: 1024, ext: 'mp3' },
    ])
  })

  test('audio_group 必须是数组', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-audio', type: 'audio_group', label: '音频', required: false, fieldKey: 'audio', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: { 'w-audio': { title: '第一讲' } },
    })).rejects.toThrow('必须是音频条目数组')
  })

  test('audio_group 校验标题、文件、格式、时长和大小', async () => {
    const widgets = [
      { widgetId: 'w-audio', type: 'audio_group', label: '音频', required: false, fieldKey: 'audio', order: 0, showInList: false },
    ]

    for (const item of [
      { fileID: 'cloud://env/audios/1.mp3', duration: 120, size: 1024, ext: 'mp3' },
      { title: '第一讲', duration: 120, size: 1024, ext: 'mp3' },
      { title: '第一讲', fileID: 'https://cdn/1.mp3', duration: 120, size: 1024, ext: 'mp3' },
      { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', cover: 'https://cdn/cover.jpg', duration: 120, size: 1024, ext: 'mp3' },
      { title: '第一讲', fileID: 'cloud://env/audios/1.flac', duration: 120, size: 1024, ext: 'flac' },
      { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', duration: 0, size: 1024, ext: 'mp3' },
      { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', duration: 120, size: 51 * 1024 * 1024, ext: 'mp3' },
    ]) {
      ;(db.getById as jest.Mock).mockResolvedValueOnce({
        _id: 's-1', communityId: 'c-1', widgets,
      })
      await expect(main({
        action: 'post.createAdmin',
        _actAs: SUPER_CTX,
        communityId: 'c-1',
        sectionId: 's-1',
        content: { 'w-audio': [item] },
      })).rejects.toThrow()
    }
  })
})

describe('post.updateAdmin', () => {
  const COMMUNITY_ADMIN_CTX = {
    accountId: 'community-admin-1',
    role: 'communityAdmin',
    userId: 'community-admin-openid',
    username: 'community-admin',
  }

  test('updates supported fields, preserves current unsupported fields, and records admin editor', async () => {
    const existingLocation = { address: 'old address', lat: 1, lng: 2 }
    const existingPost = {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-openid',
      status: 'active',
      commentCount: 3,
      likeCount: 4,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      content: {
        title: 'old title',
        location: existingLocation,
        audio: [{ title: 'old audio', fileID: 'cloud://env/audios/old.mp3', duration: 60, size: 1000, ext: 'mp3' }],
        legacyRemovedWidget: 'should be cleaned',
      },
    }
    const section = {
      _id: 'section-1',
      communityId: 'community-1',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: 'Title', required: true, fieldKey: 'title', order: 0, showInList: true },
        { widgetId: 'location', type: 'location', label: 'Location', required: false, fieldKey: 'location', order: 1, showInList: false },
        { widgetId: 'audio', type: 'audio_group', label: 'Audio', required: false, fieldKey: 'audio', order: 2, showInList: false },
      ],
    }
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce(existingPost)
      .mockResolvedValueOnce(section)
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const result: any = await main({
      action: 'post.updateAdmin',
      _actAs: SUPER_CTX,
      postId: 'post-1',
      content: {
        title: 'new title',
        location: { address: 'malicious overwrite', lat: 9, lng: 9 },
        audio: [{ title: 'new audio', fileID: 'cloud://env/audios/new.mp3', cover: 'cloud://env/covers/new.jpg', duration: 120, size: 2048, ext: 'mp3' }],
      },
    })

    expect(result.success).toBe(true)
    expect(result.updatedAt).toBeTruthy()
    expect(result.adminEditedAt).toBe(result.updatedAt)
    expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
      content: {
        title: 'new title',
        location: existingLocation,
        audio: [{ title: 'new audio', fileID: 'cloud://env/audios/new.mp3', cover: 'cloud://env/covers/new.jpg', duration: 120, size: 2048, ext: 'mp3' }],
      },
      updatedAt: expect.any(String),
      adminEditedAt: expect.any(String),
      adminEditedByAccountId: 'admin-1',
      adminEditedByUsername: 'super',
    }))
    const [, , patch] = (db.updateById as jest.Mock).mock.calls[0]
    expect(patch.authorId).toBeUndefined()
    expect(patch.sectionId).toBeUndefined()
    expect(patch.commentCount).toBeUndefined()
    expect(patch.likeCount).toBeUndefined()
    expect(patch.content.legacyRemovedWidget).toBeUndefined()
  })

  test('rejects deleted posts', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-openid',
      status: 'deleted',
      content: {},
    })

    await expect(main({
      action: 'post.updateAdmin',
      _actAs: SUPER_CTX,
      postId: 'post-1',
      content: {},
    })).rejects.toThrow('deleted')
    expect(db.updateById).not.toHaveBeenCalled()
  })

  test('community admin can edit posts in owned community', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1' })
      .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'someone-else' })
      .mockResolvedValueOnce({
        _id: 'post-1',
        communityId: 'community-1',
        sectionId: 'section-1',
        authorId: 'author-openid',
        status: 'active',
        content: { title: 'old title' },
      })
      .mockResolvedValueOnce({
        _id: 'section-1',
        communityId: 'community-1',
        widgets: [
          { widgetId: 'title', type: 'short_text', label: 'Title', required: true, fieldKey: 'title', order: 0, showInList: true },
        ],
      })
    ;(db.query as jest.Mock).mockResolvedValueOnce([
      { _id: 'member-admin', communityId: 'community-1', userId: 'community-admin-openid', role: 'admin', status: 'active' },
    ])
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const result: any = await main({
      action: 'post.updateAdmin',
      _actAs: COMMUNITY_ADMIN_CTX,
      postId: 'post-1',
      content: { title: 'new title' },
    })

    expect(result.success).toBe(true)
    expect(db.updateById).toHaveBeenCalledWith('posts', 'post-1', expect.objectContaining({
      content: { title: 'new title' },
      adminEditedByAccountId: 'community-admin-1',
      adminEditedByUsername: 'community-admin',
    }))
  })

  test('community admin cannot edit posts in another community', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-other' })
      .mockResolvedValueOnce({ _id: 'community-other', creatorId: 'someone-else' })
    ;(db.query as jest.Mock).mockResolvedValueOnce([])

    await expect(main({
      action: 'post.updateAdmin',
      _actAs: COMMUNITY_ADMIN_CTX,
      postId: 'post-1',
      content: { title: 'new title' },
    })).rejects.toThrow()
    expect(db.updateById).not.toHaveBeenCalled()
  })
})
