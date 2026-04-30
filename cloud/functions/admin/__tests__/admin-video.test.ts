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
        'w-audio': [{ title: '第一讲', fileID: 'cloud://env/audios/1.mp3', duration: 120, size: 1024, ext: 'mp3' }],
      },
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload.content['w-audio']).toEqual([
      { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', duration: 120, size: 1024, ext: 'mp3' },
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
