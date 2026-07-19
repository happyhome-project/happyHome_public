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
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  runTransaction: jest.fn(async callback => callback({
    collection: (name: string) => ({
      doc: (id: string) => ({ update: async ({ data }: any) => (require('../../../lib/db').updateById)(name, id, data) }),
      add: async ({ data }: any) => ({ _id: await (require('../../../lib/db').create)(name, data) }),
    }),
  })),
}))
jest.mock('../../../lib/post-rag-sync', () => ({
  schedulePostRagSync: jest.fn(),
  schedulePostRagSyncForCurrentPosts: jest.fn(),
  schedulePostRagSyncInTransaction: jest.fn(),
}))


jest.mock('../../../lib/storage', () => ({
  deleteFile: jest.fn(),
  getTempUrl: jest.fn(),
  requestUploadMetadata: jest.fn(),
}))

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('mocked-uuid'),
}))

jest.mock('../../../lib/post-search', () => ({
  backfillPostSearchIndexesForCommunity: jest.fn(),
  backfillPostSearchIndexesForSection: jest.fn(),
  refreshPostSearchIndexById: jest.fn(),
  removePostSearchIndex: jest.fn(),
  removePostSearchIndexesForSection: jest.fn(),
}))

jest.mock('../../../lib/post-rag', () => ({
  enqueuePostRagJob: jest.fn(),
}))

import { main as rawMain } from '../index'
import * as db from '../../../lib/db'
import * as storage from '../../../lib/storage'
import * as postSearch from '../../../lib/post-search'

const TEST_INTERNAL_TOKEN = 'admin-video-unit-internal-token'
process.env.ADMIN_INTERNAL_CALL_TOKEN = TEST_INTERNAL_TOKEN
const main = (event: any) => rawMain({ ...event, _internalToken: TEST_INTERNAL_TOKEN })

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

describe('media.getUrls', () => {
  test('returns temporary urls for cloud fileIDs only', async () => {
    ;(storage.getTempUrl as jest.Mock).mockImplementation(async (fileID: string) => `https://tmp.example/${encodeURIComponent(fileID)}`)

    const res = await main({
      action: 'media.getUrls',
      _actAs: SUPER_CTX,
      fileIDs: ['cloud://env/posts/a.jpg', 'https://cdn/b.jpg', 'cloud://env/posts/a.jpg'],
    }) as any

    expect(storage.getTempUrl).toHaveBeenCalledTimes(1)
    expect(res.urls).toEqual({
      'cloud://env/posts/a.jpg': 'https://tmp.example/cloud%3A%2F%2Fenv%2Fposts%2Fa.jpg',
    })
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
    expect(payload.adminCreatedAt).toEqual(expect.any(String))
    expect(payload.adminCreatedByAccountId).toBe('admin-1')
    expect(payload.adminCreatedByUsername).toBe('super')
    expect(payload.communityId).toBe('c-1')
    expect(payload.sectionId).toBe('s-1')
    expect(payload.status).toBe('active')
    expect(payload.content['w-1']).toBe('Hello')
    expect(payload.content['w-2']).toHaveLength(1)
    expect(payload.content['w-att']).toBeUndefined()
    expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-NEW')
  })

  test('normalizes old guide_note sections before admin-created posts are saved', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 'section-guide',
      communityId: 'community-1',
      displayTemplate: 'guide_note',
      widgets: [
        { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
        { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
        { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
        { widgetId: 'guide_location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false, locked: true },
      ],
    })
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-GUIDE')

    await main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'community-1',
      sectionId: 'section-guide',
      content: {
        guide_title: '太平水库亲子游',
        guide_images: ['cloud://env/posts/new-cover.jpg'],
        guide_drive_duration: '青山村约35分钟到达入口',
        guide_location: { address: '太平水库入口', lat: 30.2, lng: 104.2 },
      },
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload.content).toEqual(expect.objectContaining({
      guide_title: '太平水库亲子游',
      guide_images: ['cloud://env/posts/new-cover.jpg'],
      guide_drive_duration: '青山村约35分钟到达入口',
      guide_location: { address: '太平水库入口', lat: 30.2, lng: 104.2 },
    }))
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

  test('rich_note accepts valid admin-created content', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-rich-note', type: 'rich_note', label: '富图文', required: false, fieldKey: 'richNote', order: 0, showInList: false },
      ],
    })
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-RICH')

    await main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: {
        'w-rich-note': {
          format: 'markdown',
          markdown: '**Hello**\n\n![图片](cloud://env/posts/rich-1.jpg)',
          html: '<p><strong>Hello</strong></p><p><img src="cloud://env/posts/rich-1.jpg"></p>',
          text: 'Hello',
          imageFileIDs: ['cloud://env/posts/rich-1.jpg'],
          schemaVersion: 1,
        },
      },
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload.content['w-rich-note'].text).toBe('Hello')
    expect(payload.content['w-rich-note'].imageFileIDs).toEqual(['cloud://env/posts/rich-1.jpg'])
  })

  test('rich_note rejects unsafe admin-created content', async () => {
    ;(db.getById as jest.Mock).mockResolvedValueOnce({
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-rich-note', type: 'rich_note', label: '富图文', required: false, fieldKey: 'richNote', order: 0, showInList: false },
      ],
    })

    await expect(main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'c-1',
      sectionId: 's-1',
      content: {
        'w-rich-note': {
          format: 'markdown',
          markdown: 'bad',
          html: '<p onclick="alert(1)">bad</p>',
          text: 'bad',
          imageFileIDs: [],
          schemaVersion: 1,
        },
      },
    })).rejects.toThrow('unsafe html attribute')
    expect(db.create).not.toHaveBeenCalled()
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
      pendingContent: { __set: {
        title: 'new title',
        location: { address: 'malicious overwrite', lat: 9, lng: 9 },
        audio: [{ title: 'new audio', fileID: 'cloud://env/audios/new.mp3', cover: 'cloud://env/covers/new.jpg', duration: 120, size: 2048, ext: 'mp3' }],
      } },
      pendingAuditStatus: 'pending',
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
    expect(patch.pendingContent.__set.legacyRemovedWidget).toBeUndefined()
    expect(postSearch.refreshPostSearchIndexById).toHaveBeenCalledWith('post-1')
  })

  test('normalizes old guide_note sections before saving admin edits', async () => {
    const existingPost = {
      _id: 'post-guide',
      communityId: 'community-1',
      sectionId: 'section-guide',
      authorId: 'author-openid',
      status: 'active',
      auditStatus: 'pass',
      content: {
        guide_title: '旧标题',
        guide_images: ['cloud://env/posts/old-cover.jpg'],
        guide_location: { address: '旧地点', lat: 30.1, lng: 104.1 },
      },
    }
    const oldGuideSection = {
      _id: 'section-guide',
      communityId: 'community-1',
      displayTemplate: 'guide_note',
      widgets: [
        { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
        { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
        { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
        { widgetId: 'guide_location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 3, showInList: false, locked: true },
      ],
    }
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce(existingPost)
      .mockResolvedValueOnce(oldGuideSection)
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const result: any = await main({
      action: 'post.updateAdmin',
      _actAs: SUPER_CTX,
      postId: 'post-guide',
      content: {
        guide_title: '太平水库亲子游',
        guide_images: ['cloud://env/posts/new-cover.jpg'],
        guide_drive_duration: '青山村约35分钟到达入口',
        guide_location: { address: '太平水库入口', lat: 30.2, lng: 104.2 },
      },
    })

    expect(result.success).toBe(true)
    const pendingPatch = (db.updateById as jest.Mock).mock.calls.find(([, , patch]) => patch.pendingContent)?.[2]
    expect(pendingPatch.pendingContent.__set).toEqual(expect.objectContaining({
      guide_title: '太平水库亲子游',
      guide_images: ['cloud://env/posts/new-cover.jpg'],
      guide_drive_duration: '青山村约35分钟到达入口',
      guide_location: { address: '太平水库入口', lat: 30.2, lng: 104.2 },
    }))
  })

  test('updates rich_note content instead of preserving the old value', async () => {
    const existingPost = {
      _id: 'post-rich',
      communityId: 'community-1',
      sectionId: 'section-rich',
      authorId: 'author-openid',
      status: 'active',
      content: {
        rich: {
          format: 'markdown',
          markdown: 'old text',
          html: '<p>old text</p>',
          text: 'old text',
          imageFileIDs: [],
          schemaVersion: 1,
        },
      },
    }
    const section = {
      _id: 'section-rich',
      communityId: 'community-1',
      widgets: [
        { widgetId: 'rich', type: 'rich_note', label: 'Rich note', required: true, fieldKey: 'rich', order: 0, showInList: false },
      ],
    }
    const nextRichNote = {
      format: 'markdown',
      markdown: 'old text\n\nnew admin edit\n\n![image](cloud://env/posts/images/new.png)',
      html: '<p>old text</p><p>new admin edit</p><p><img src="cloud://env/posts/images/new.png"></p>',
      text: 'old text new admin edit',
      imageFileIDs: ['cloud://env/posts/images/new.png'],
      schemaVersion: 1,
    }
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce(existingPost)
      .mockResolvedValueOnce(section)
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const result: any = await main({
      action: 'post.updateAdmin',
      _actAs: SUPER_CTX,
      postId: 'post-rich',
      content: { rich: nextRichNote },
    })

    expect(result.success).toBe(true)
    expect(db.updateById).toHaveBeenCalledWith('posts', 'post-rich', expect.objectContaining({
      pendingContent: { __set: { rich: nextRichNote } },
      pendingAuditStatus: 'pending',
    }))
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
      pendingContent: { __set: { title: 'new title' } },
      pendingAuditStatus: 'pending',
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

describe('archive post admin editing', () => {
  const richBody = (text: string) => ({
    format: 'markdown',
    markdown: text,
    html: `<p>${text}</p>`,
    text,
    imageFileIDs: [],
    schemaVersion: 1,
  })

  test('post.getAdmin returns an editable image-text contract with images and topics', async () => {
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({
        _id: 'archive-image-1',
        communityId: 'community-1',
        area: 'archive',
        format: 'image_text',
        topics: ['通勤出行'],
        authorId: 'author-1',
        status: 'active',
        auditStatus: 'pass',
        content: {
          title: '早高峰怎么走',
          images: ['cloud://env/posts/images/commute.png'],
          body: richBody('正文'),
        },
      })
      .mockResolvedValueOnce({ nickName: '邻居甲' })
    ;(db.query as jest.Mock).mockResolvedValue([])

    const result: any = await main({
      action: 'post.getAdmin',
      _actAs: SUPER_CTX,
      postId: 'archive-image-1',
    })

    expect(result.section).toEqual(expect.objectContaining({
      name: '图文',
      displayTemplate: 'image_note',
      widgets: expect.arrayContaining([
        expect.objectContaining({ widgetId: 'images', type: 'image_group' }),
        expect.objectContaining({ widgetId: 'title', type: 'short_text' }),
        expect.objectContaining({ widgetId: 'body', type: 'rich_note' }),
        expect.objectContaining({ widgetId: 'topics', type: 'topic' }),
      ]),
    }))
    expect(result.post.content).toEqual(expect.objectContaining({
      images: ['cloud://env/posts/images/commute.png'],
      topics: ['通勤出行'],
    }))
  })

  test('post.updateAdmin keeps archive topics outside content while sending images through audit', async () => {
    const existingPost = {
      _id: 'archive-image-1',
      communityId: 'community-1',
      area: 'archive',
      format: 'image_text',
      topics: ['旧话题'],
      authorId: 'author-1',
      status: 'active',
      auditStatus: 'pass',
      createdAt: '2026-07-17T10:00:00.000Z',
      content: {
        title: '旧标题',
        images: ['cloud://env/posts/images/old.png'],
        body: richBody('旧正文'),
      },
    }
    ;(db.getById as jest.Mock).mockResolvedValue(existingPost)
    ;(db.query as jest.Mock).mockResolvedValue([])
    ;(db.updateById as jest.Mock).mockResolvedValue({})

    const result: any = await main({
      action: 'post.updateAdmin',
      _actAs: SUPER_CTX,
      postId: 'archive-image-1',
      content: {
        title: '新标题',
        images: ['cloud://env/posts/images/new.png'],
        body: richBody('新正文'),
        topics: ['通勤出行', '小区日常'],
      },
    })

    expect(result.success).toBe(true)
    const pendingPatch = (db.updateById as jest.Mock).mock.calls
      .map(([, , patch]) => patch)
      .find((patch) => patch?.pendingContent)
    expect(pendingPatch).toEqual(expect.objectContaining({
      pendingContent: { __set: expect.objectContaining({
        title: '新标题',
        images: ['cloud://env/posts/images/new.png'],
      }) },
      pendingTopics: { __set: ['通勤出行', '小区日常'] },
    }))
    expect(pendingPatch.pendingContent.__set.topics).toBeUndefined()
  })
})
