jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test',
}))

jest.mock('../../../lib/db', () => ({
  getById: jest.fn(),
  getByIdOrNull: jest.fn(async () => null),
  create: jest.fn(),
  updateById: jest.fn(),
  updateWhere: jest.fn(),
  removeById: jest.fn(),
  softDelete: jest.fn(),
  query: jest.fn(),
  increment: jest.fn(),
  replaceValue: jest.fn((value) => ({ __set: value })),
  removeField: jest.fn(() => ({ __remove: true })),
  transactionGetByIdOrNull: jest.fn(async (_transaction, name, id) => {
    const mockedDb = require('../../../lib/db')
    let value = null
    if (name === 'posts') {
      const created = [...mockedDb.create.mock.calls].reverse().find(([collectionName]) => collectionName === 'posts')
      if (created) value = { _id: id, ...created[1] }
    }
    if (!value) {
      for (let index = mockedDb.getById.mock.calls.length - 1; index >= 0; index -= 1) {
        const call = mockedDb.getById.mock.calls[index]
        if (call[0] === name && call[1] === id) {
          value = await mockedDb.getById.mock.results[index].value
          break
        }
      }
    }
    if (!value) return null
    value = { ...value }
    for (const [collectionName, documentId, data] of mockedDb.updateById.mock.calls) {
      if (collectionName !== name || documentId !== id) continue
      for (const [key, fieldValue] of Object.entries(data)) {
        if (fieldValue && typeof fieldValue === 'object' && '__set' in fieldValue) value[key] = fieldValue.__set
        else if (fieldValue && typeof fieldValue === 'object' && '__remove' in fieldValue) delete value[key]
        else value[key] = fieldValue
      }
    }
    return value
  }),
  runTransaction: jest.fn(async callback => callback({
    collection: (name: string) => ({
      doc: (id: string) => ({
        update: async ({ data }: any) => (require('../../../lib/db').updateById)(name, id, data),
        set: async ({ data }: any) => (require('../../../lib/db').updateById)(name, id, data),
      }),
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
import * as postRagSync from '../../../lib/post-rag-sync'
import * as contentAudit from '../../../lib/content-audit'
import { buildInitialCollaborationTemplates } from '../../../shared/collaboration-templates'

const TEST_INTERNAL_TOKEN = 'admin-video-unit-internal-token'
process.env.ADMIN_INTERNAL_CALL_TOKEN = TEST_INTERNAL_TOKEN
const main = (event: any) => rawMain({ ...event, _internalToken: TEST_INTERNAL_TOKEN })

beforeEach(() => jest.clearAllMocks())

function withRecordedUpdates(document: any, collectionName: string, documentId: string) {
  const value = { ...document }
  for (const [collection, id, data] of (db.updateById as jest.Mock).mock.calls) {
    if (collection !== collectionName || id !== documentId) continue
    for (const [key, fieldValue] of Object.entries(data)) {
      if (fieldValue && typeof fieldValue === 'object' && '__set' in fieldValue) value[key] = (fieldValue as any).__set
      else if (fieldValue && typeof fieldValue === 'object' && '__remove' in fieldValue) delete value[key]
      else value[key] = fieldValue
    }
  }
  return value
}

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

test('post.getAdmin round-trips native archive audio through an audio_group section', async () => {
  const audios = [{
    title: '第一段', duration: 12, size: 1024, ext: 'mp3',
    fileID: 'cloud://env/posts/member-audios-finalized/scope/track.mp3',
    cover: 'cloud://env/posts/member-audio-covers-finalized/scope/cover.jpg',
  }]
  ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => {
    if (collectionName === 'posts') return {
      _id: 'archive-audio-1', communityId: 'community-1', authorId: 'member-1',
      area: 'archive', origin: 'native_archive', format: 'audio', status: 'active',
      topics: ['家声'], content: { title: '家庭声音', audios },
    }
    if (collectionName === 'users') return { _id: 'member-1', nickName: '成员' }
    return null
  })
  ;(db.query as jest.Mock).mockResolvedValue([])

  const result = await main({ action: 'post.getAdmin', _actAs: SUPER_CTX, postId: 'archive-audio-1' }) as any

  expect(result.post).toEqual(expect.objectContaining({
    format: 'audio', content: { title: '家庭声音', audios, topics: ['家声'] },
  }))
  expect(result.section).toEqual(expect.objectContaining({
    name: '音频', displayTemplate: 'default',
    widgets: expect.arrayContaining([expect.objectContaining({ widgetId: 'audios', type: 'audio_group', required: true })]),
  }))
  expect(result.section.widgets.map((widget: any) => widget.widgetId)).not.toContain('body')
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
  const richBody = {
    format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1,
  }

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

  test.each([
    ['图文', { title: '图文帖子', images: ['cloud://env/posts/images/cover.jpg'], body: richBody }],
    ['图片', { title: '图片帖子', images: ['cloud://env/posts/images/cover.jpg'] }],
  ])('创建 archive image_text %s帖子', async (_label, content) => {
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-ARCHIVE-IMAGE')

    const result: any = await main({
      action: 'post.createAdmin',
      _actAs: SUPER_CTX,
      communityId: 'community-1',
      area: 'archive',
      format: 'image_text',
      topics: ['邻里日常'],
      content,
    })

    expect(result.postId).toBe('post-ARCHIVE-IMAGE')
    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({
      communityId: 'community-1', area: 'archive', origin: 'native_archive', format: 'image_text',
      topics: ['邻里日常'], authorId: 'admin-openid-1',
    }))
    expect(payload.sectionId).toBeUndefined()
    expect(payload.content).toEqual(content)
  })

  test('创建 archive 视频帖子', async () => {
    ;(db.create as jest.Mock).mockResolvedValueOnce('post-ARCHIVE-VIDEO')
    const video = { itemId: 'video-1', source: 'cos', title: '夏日晚风', fileID: 'cloud://env/posts/videos/a.mp4' }

    await main({
      action: 'post.createAdmin', _actAs: SUPER_CTX, communityId: 'community-1',
      area: 'archive', format: 'video', topics: [],
      content: { title: '小区晚霞', videos: [video] },
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({ area: 'archive', origin: 'native_archive', format: 'video' }))
    expect(payload.content.videos).toEqual([video])
    expect(payload.sectionId).toBeUndefined()
  })

  test.each([
    ['carpool', {
      carpool_origin: '阳光花园东门', carpool_destination: '天府机场',
      carpool_departure_time: '2026-08-01T08:30:00', carpool_seats: '2', carpool_contact: '后台测试',
      carpool_location: { address: '阳光花园东门', lat: 30.67, lng: 104.05 },
      carpool_attendance: 'must be dropped',
    }],
    ['activity_invite', {
      activity_invite_title: '周末公园散步', activity_invite_starts_at: '2026-08-02T09:00:00',
      activity_invite_location: { address: '浣花溪公园', lat: 30.65, lng: 104.03 },
      activity_invite_contact: '后台测试', activity_invite_capacity: 8,
      activity_invite_attendance: 'must be dropped',
    }],
  ])('创建 collaboration %s 帖子', async (systemKey, content) => {
    const template = buildInitialCollaborationTemplates().find((item) => item.systemKey === systemKey)!
    ;(db.getById as jest.Mock).mockResolvedValueOnce(template)
    ;(db.create as jest.Mock).mockResolvedValueOnce(`post-${systemKey}`)

    await main({
      action: 'post.createAdmin', _actAs: SUPER_CTX, communityId: 'community-1',
      area: 'collaboration', collaborationTemplateId: template._id, content,
    })

    const [, payload] = (db.create as jest.Mock).mock.calls[0]
    expect(payload).toEqual(expect.objectContaining({
      area: 'collaboration', collaborationTemplateId: template._id,
      collaborationSystemKey: systemKey, authorId: 'admin-openid-1',
    }))
    expect(payload.sectionId).toBeUndefined()
    expect(payload.content[`${systemKey === 'carpool' ? 'carpool' : 'activity_invite'}_attendance`]).toBeUndefined()
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
    const section = {
      _id: 's-1', communityId: 'c-1', widgets: [
        { widgetId: 'w-1', type: 'short_text', label: '标题', required: true, fieldKey: 'f1', order: 0, showInList: false },
        { widgetId: 'w-2', type: 'video_group', label: '视频', required: false, fieldKey: 'f2', order: 1, showInList: false },
        { widgetId: 'w-att', type: 'attendance', label: '报名', required: false, fieldKey: 'f3', order: 2, showInList: true },
      ],
    }
    ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
      if (collectionName === 'sections') return section
      if (collectionName === 'posts') {
        const created = [...(db.create as jest.Mock).mock.calls].reverse().find(([collection]) => collection === 'posts')
        return created ? withRecordedUpdates({ _id: id, ...created[1] }, 'posts', id) : null
      }
      return null
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
    expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      postId: 'post-NEW', communityId: 'c-1', sectionId: 's-1', reason: 'post.created',
    }))
    expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
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
    ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
      if (collectionName === 'posts' && id === existingPost._id) return withRecordedUpdates(existingPost, 'posts', id)
      if (collectionName === 'sections' && id === section._id) return section
      return null
    })
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
    expect(postRagSync.schedulePostRagSyncInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.updated',
    }))
    expect(postSearch.refreshPostSearchIndexById).not.toHaveBeenCalled()
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
    ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
      if (collectionName === 'posts' && id === existingPost._id) return withRecordedUpdates(existingPost, 'posts', id)
      if (collectionName === 'sections' && id === oldGuideSection._id) return oldGuideSection
      return null
    })
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
    ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string, id: string) => {
      if (collectionName === 'posts' && id === existingPost._id) return withRecordedUpdates(existingPost, 'posts', id)
      if (collectionName === 'sections' && id === section._id) return section
      return null
    })
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
    const editablePost = {
      _id: 'post-1',
      communityId: 'community-1',
      sectionId: 'section-1',
      authorId: 'author-openid',
      status: 'active',
      content: { title: 'old title' },
    }
    const section = {
      _id: 'section-1',
      communityId: 'community-1',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: 'Title', required: true, fieldKey: 'title', order: 0, showInList: true },
      ],
    }
    ;(db.getById as jest.Mock)
      .mockResolvedValueOnce({ _id: 'post-1', communityId: 'community-1' })
      .mockResolvedValueOnce({ _id: 'community-1', creatorId: 'someone-else' })
      .mockResolvedValueOnce(editablePost)
      .mockResolvedValueOnce(section)
      .mockImplementation(async (collectionName: string, id: string) => {
        if (collectionName === 'posts' && id === editablePost._id) return withRecordedUpdates(editablePost, 'posts', id)
        if (collectionName === 'sections' && id === section._id) return section
        return null
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

  test('stale direct-content pass cannot overwrite newer archive topics for identical content', async () => {
    const sharedContent = {
      title: '相同标题',
      images: ['cloud://env/posts/images/shared.png'],
      body: richBody('相同正文'),
    }
    const currentPost: any = {
      _id: 'archive-direct-race', communityId: 'community-1', area: 'archive', origin: 'native_archive',
      format: 'image_text', topics: ['旧话题'], authorId: 'author-1', status: 'active', auditStatus: 'rejected',
      createdAt: '2026-07-17T10:00:00.000Z', content: { title: '旧标题', images: ['cloud://env/posts/images/old.png'], body: richBody('旧正文') },
    }
    ;(db.getById as jest.Mock).mockImplementation(async (collectionName: string) => collectionName === 'posts' ? currentPost : null)
    ;(db.updateById as jest.Mock).mockImplementation(async (collectionName: string, id: string, data: any) => {
      if (collectionName !== 'posts' || id !== currentPost._id) return
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && '__set' in value) currentPost[key] = (value as any).__set
        else if (value && typeof value === 'object' && '__remove' in value) delete currentPost[key]
        else currentPost[key] = value
      }
    })

    let signalAStarted!: () => void
    const aStarted = new Promise<void>((resolve) => { signalAStarted = resolve })
    let releaseA!: () => void
    const aGate = new Promise<void>((resolve) => { releaseA = resolve })
    let auditCall = 0
    const auditSpy = jest.spyOn(contentAudit, 'auditAndApply').mockImplementation(async (params: any) => {
      auditCall += 1
      if (auditCall === 1) {
        signalAStarted()
        await aGate
        return { status: 'pass', reason: '', applied: false, stale: true, contentRevision: params.contentRevision || 'revision-a' }
      }
      return { status: 'rejected', reason: 'revision B rejected', applied: true, stale: false, contentRevision: params.contentRevision || 'revision-b' }
    })

    try {
      const updateA = main({
        action: 'post.updateAdmin', _actAs: SUPER_CTX, postId: currentPost._id,
        content: { ...sharedContent, topics: ['话题 A'] },
      })
      await aStarted
      const updateB = main({
        action: 'post.updateAdmin', _actAs: SUPER_CTX, postId: currentPost._id,
        content: { ...sharedContent, topics: ['话题 B'] },
      })
      await updateB
      releaseA()
      await updateA

      const revisions = auditSpy.mock.calls.map(([params]) => String(params.contentRevision || ''))
      expect(revisions).toHaveLength(2)
      expect(revisions.every(Boolean)).toBe(true)
      expect(new Set(revisions).size).toBe(2)
      expect(currentPost.content).toEqual(sharedContent)
      expect(currentPost.topics).toEqual(['旧话题'])
    } finally {
      auditSpy.mockRestore()
    }
  })
})

describe('audit.retryAdmin revision isolation', () => {
  const retryBody = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  const retryPost = {
    _id: 'retry-post-1',
    communityId: 'community-1',
    area: 'archive',
    format: 'image_text',
    authorId: 'author-1',
    status: 'active',
    auditStatus: 'pending',
    contentRevision: 'revision-a',
    contentRevisionDigest: contentAudit.computeContentRevisionDigest({ title: 'A', images: [], body: retryBody('A') } as any),
    content: { title: 'A', images: [], body: retryBody('A') },
  }

  test('fails closed without deleting tasks when the post changes after the retry snapshot', async () => {
    const changedPost = {
      ...retryPost,
      contentRevision: 'revision-b',
      contentRevisionDigest: contentAudit.computeContentRevisionDigest({ title: 'B', images: [], body: retryBody('B') } as any),
      content: { title: 'B', images: [], body: retryBody('B') },
    }
    ;(db.getById as jest.Mock).mockResolvedValue(retryPost)
    ;(db.query as jest.Mock).mockResolvedValue([
      { _id: 'task-a', postId: retryPost._id, contentSlot: 'content', contentRevision: 'revision-a', contentDigest: retryPost.contentRevisionDigest },
      { _id: 'task-b', postId: retryPost._id, contentSlot: 'content', contentRevision: 'revision-b', contentDigest: changedPost.contentRevisionDigest },
    ])
    ;(db.transactionGetByIdOrNull as jest.Mock).mockResolvedValueOnce(changedPost)
    const auditSpy = jest.spyOn(contentAudit, 'auditAndApply')

    try {
      await expect(main({ action: 'audit.retryAdmin', _actAs: SUPER_CTX, postId: retryPost._id }))
        .rejects.toThrow('post changed during audit retry')
      expect(db.removeById).not.toHaveBeenCalled()
      expect(auditSpy).not.toHaveBeenCalled()
    } finally {
      auditSpy.mockRestore()
    }
  })

  test('legacy revisionless retry removes only its revisionless task snapshot', async () => {
    const legacyPost = {
      ...retryPost,
      contentRevision: undefined,
      contentRevisionDigest: undefined,
    }
    ;(db.getById as jest.Mock).mockResolvedValue(legacyPost)
    ;(db.query as jest.Mock).mockResolvedValue([
      { _id: 'legacy-task', postId: legacyPost._id, contentSlot: 'content' },
      { _id: 'new-task', postId: legacyPost._id, contentSlot: 'content', contentRevision: 'new-concurrent-revision' },
    ])
    ;(db.removeById as jest.Mock).mockResolvedValue({})
    ;(db.transactionGetByIdOrNull as jest.Mock).mockResolvedValueOnce(legacyPost)
    const auditSpy = jest.spyOn(contentAudit, 'auditAndApply').mockResolvedValue({
      status: 'pending', reason: '', applied: false, stale: false, contentRevision: 'retry-revision',
    } as any)

    try {
      await main({ action: 'audit.retryAdmin', _actAs: SUPER_CTX, postId: legacyPost._id })
      expect(db.removeById).toHaveBeenCalledWith(contentAudit.AUDIT_TASKS, 'legacy-task')
      expect(db.removeById).not.toHaveBeenCalledWith(contentAudit.AUDIT_TASKS, 'new-task')
      const params = auditSpy.mock.calls[0][0] as any
      expect(params.contentRevision).toEqual(expect.any(String))
      expect(params.contentRevision).not.toBe('')
      expect(params.contentDigest).toBe(contentAudit.computeContentRevisionDigest(legacyPost.content as any))
    } finally {
      auditSpy.mockRestore()
    }
  })
})
