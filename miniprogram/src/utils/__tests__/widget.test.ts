import { afterEach, describe, expect, test, vi } from 'vitest'
import { formatWidgetValue, getArchiveHomeMeta, getCarpoolListSummary, getCarpoolLiveMeta, getFamilyLetterListSummary, getGuideNoteCard, getHomeLiveMeta, getListPreview, getPostHomeTitle, getPostHomeTitleIssue } from '../widget'
import type { Section, Post } from '../../../../cloud/shared/types'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatWidgetValue', () => {
  test('undefined/null/空字符串返回空', () => {
    expect(formatWidgetValue(undefined, 'short_text')).toBe('')
    expect(formatWidgetValue(null, 'short_text')).toBe('')
    expect(formatWidgetValue('', 'number')).toBe('')
  })

  test('short_text 返回原字符串', () => {
    expect(formatWidgetValue('hello', 'short_text')).toBe('hello')
  })

  test('number 转为字符串', () => {
    expect(formatWidgetValue(42, 'number')).toBe('42')
    expect(formatWidgetValue(0, 'number')).toBe('0')
  })

  test('datetime 格式化为月日时分', () => {
    const result = formatWidgetValue('2024-03-15T09:05:00.000Z', 'datetime')
    expect(result).toMatch(/\d+月\d+日 \d+:\d{2}/)
  })

  test('datetime 无效日期时返回原值', () => {
    expect(formatWidgetValue('not-a-date', 'datetime')).toBe('not-a-date')
  })

  test('image_group 不在列表里显示', () => {
    expect(formatWidgetValue(['img1.png', 'img2.png'], 'image_group')).toBe('')
  })

  test('location 返回 address', () => {
    expect(formatWidgetValue({ address: '北京市海淀区', lat: 39.9, lng: 116.3 }, 'location')).toBe('北京市海淀区')
  })

  test('rich_text 返回解码后的纯文本摘要', () => {
    expect(formatWidgetValue('<p>第一段</p><p>第二段 &amp; 补充</p>', 'rich_text'))
      .toBe('第一段 第二段 & 补充')
  })

  test('rich_text 对象不泄漏为对象字符串', () => {
    expect(formatWidgetValue({ nodes: [] }, 'rich_text')).toBe('')
  })
})

describe('getListPreview', () => {
  const section: Section = {
    _id: 's1',
    communityId: 'c1',
    name: '活动',
    icon: 'activity',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2024-01-01',
    type: 'realtime',
    status: 'active',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'w4', type: 'short_text', label: '集合地点', fieldKey: 'meetingPlace', required: false, order: 1, showInList: true },
      { widgetId: 'w2', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 2, showInList: true, capacity: 5 },
      { widgetId: 'w3', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 3, showInList: false },
    ],
  }

  test('返回普通字段和 attendance 摘要，但不重复展示标题字段', () => {
    const post: Post = {
      _id: 'p1',
      communityId: 'c1',
      sectionId: 's1',
      authorId: 'u1',
      status: 'active',
      content: { w1: '周六爬山', w3: '正文', w4: '青山村口' },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
      attendanceSummaryByWidget: {
        w2: {
          count: 3,
          isFull: false,
          isJoined: false,
          previewUsers: [
            { userId: 'u1', nickName: 'A', avatarUrl: 'a.png' },
          ],
        },
      },
    }

    const result = getListPreview(post, section)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ label: '集合地点', value: '青山村口', type: 'text' })
    expect(result[1]).toMatchObject({ label: '活动参与', value: '3人参与', type: 'attendance' })
    expect(result[1].previewUsers).toHaveLength(1)
  })

  test('attendance 人数为 0 时不会显示', () => {
    const post: Post = {
      _id: 'p1',
      communityId: 'c1',
      sectionId: 's1',
      authorId: 'u1',
      status: 'active',
      content: { w1: '周六爬山', w4: '青山村口' },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
      attendanceSummaryByWidget: {
        w2: {
          count: 0,
          isFull: false,
          isJoined: false,
          previewUsers: [],
        },
      },
    }

    const result = getListPreview(post, section)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('集合地点')
  })

  test('audio_group 不进入列表摘要', () => {
    const sectionWithAudio: Section = {
      ...section,
      widgets: [
        ...section.widgets,
        {
          widgetId: 'w-audio',
          type: 'audio_group',
          label: '音频',
          fieldKey: 'audio',
          required: false,
          order: 3,
          showInList: true,
        },
      ],
    }
    const post: Post = {
      _id: 'p1',
      communityId: 'c1',
      sectionId: 's1',
      authorId: 'u1',
      status: 'active',
      content: {
        w1: '课程通知',
        'w-audio': [
          { title: '第一讲', fileID: 'cloud://env/audios/1.mp3', duration: 120, size: 1024, ext: 'mp3' },
        ],
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    const result = getListPreview(post, sectionWithAudio)

    expect(result.some((item) => item.label === '音频')).toBe(false)
    expect(result).toEqual([])
  })
})

describe('home live card formatting', () => {
  test('uses plain text when the only usable home title widget is rich text', () => {
    const section = {
      _id: 's-rich-title',
      communityId: 'c1',
      name: '社区动态',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'body', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 0, showInList: false },
      ],
    } as Section
    const post = {
      content: {
        body: '<p>第一段</p><p>第二段 &amp; 补充</p>',
      },
    } as Post

    expect(getPostHomeTitle(post, section)).toBe('第一段 第二段 & 补充')
    expect(getPostHomeTitle(post, section)).not.toMatch(/<[^>]+>/)
  })

  test('uses section name instead of object fallback when an activity has only attendance and location widgets', () => {
    const section: Section = {
      _id: 's-badminton',
      communityId: 'c1',
      name: '羽毛球活动',
      icon: 'books',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2026-06-24',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'att', type: 'attendance', label: '羽毛球活动', fieldKey: 'attendance', required: false, order: 0, showInList: true },
        { widgetId: 'loc', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 1, showInList: false },
        { widgetId: 'time', type: 'datetime', label: '时间', fieldKey: 'time', required: false, order: 2, showInList: false },
      ],
    }
    const post = {
      content: {
        loc: { name: '成都西站', address: '四川省成都市青羊区西站一路', lat: 30.685329, lng: 103.979102 },
        time: '2026-06-27T00:00:00',
      },
      createdAt: '2026-06-24T01:40:08.348Z',
    } as Post

    expect(getPostHomeTitle(post, section)).toBe('羽毛球活动')
    expect(getPostHomeTitle(post, section)).not.toContain('[object Object]')
    expect(getPostHomeTitleIssue(post, section)).toEqual(expect.objectContaining({
      code: 'missing_home_title_content',
      message: expect.stringContaining('缺少首页标题'),
    }))
  })

  test('does not expose personal author nickname on generic live activity cards', () => {
    const section = {
      _id: 's-activity',
      communityId: 'c1',
      name: '活动',
      type: 'realtime',
      status: 'active',
      widgets: [],
    } as Section
    const post = {
      authorNickname: '一年',
      createdAt: '2026-06-24T01:40:08.348Z',
      attendanceSummaryByWidget: {
        att: { count: 2, occupiedSeats: 2, isFull: false, isJoined: false, previewUsers: [] },
      },
    } as Post

    expect(getHomeLiveMeta(post, section)).not.toContain('一年')
    expect(getHomeLiveMeta(post, section)).toContain('2人参与')
  })

  test('uses configured showInList fields for generic live activity cards', () => {
    const section = {
      _id: 's-trip',
      communityId: 'c1',
      name: '活动召集',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'participants', type: 'short_text', label: '参与人数', fieldKey: 'participants', required: false, order: 1, showInList: true },
        { widgetId: 'time', type: 'datetime', label: '活动时间', fieldKey: 'activityTime', required: false, order: 2, showInList: true },
      ],
    } as Section
    const post = {
      content: {
        title: '6月30日出发 成都至川西大环线',
        participants: '4人参与',
        time: '2026-06-30T09:00:00+08:00',
      },
      authorNickname: '一年',
      createdAt: '2026-06-24T01:40:08.348Z',
    } as Post

    expect(getHomeLiveMeta(post, section)).toEqual([
      '4人参与',
      '活动时间：06月30日',
    ])
  })

  test('uses zero-padded hyphen date for generic live fallback meta', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T12:00:00+08:00'))
    const section = {
      _id: 's-generic',
      communityId: 'c1',
      name: '活动召集',
      type: 'realtime',
      status: 'active',
      widgets: [],
    } as Section
    const post = {
      content: {},
      createdAt: '2026-06-30T09:00:00+08:00',
    } as Post

    expect(getHomeLiveMeta(post, section)).toEqual(['06-30'])
  })
})

describe('getArchiveHomeMeta', () => {
  test('evergreen home meta does not expose system author nickname', () => {
    const section: Section = {
      _id: 's-archive',
      communityId: 'c1',
      name: '家书',
      icon: 'book',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2024-01-01',
      type: 'evergreen',
      status: 'active',
      widgets: [],
    }
    const post: Post = {
      _id: 'p-archive',
      communityId: 'c1',
      sectionId: 's-archive',
      authorId: 'u1',
      authorNickname: '东阳',
      status: 'active',
      content: {},
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(getArchiveHomeMeta(post, section)).toBe('')
  })

  test('evergreen home meta can still show engagement signals', () => {
    const section = {
      enableLike: true,
      enableComment: true,
    } as Section
    expect(getArchiveHomeMeta({ likeCount: 2, commentCount: 4 } as Post, section)).toBe('2 赞')

    const noLikeSection = {
      enableLike: false,
      enableComment: true,
    } as Section
    expect(getArchiveHomeMeta({ likeCount: 2, commentCount: 4 } as Post, noLikeSection)).toBe('4 评论')
  })
})

describe('getGuideNoteCard', () => {
  const section: Section = {
    _id: 's-guide',
    communityId: 'c1',
    name: '亲子出游',
    icon: 'walk',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2026-01-01',
    type: 'evergreen',
    status: 'active',
    displayTemplate: 'guide_note',
    widgets: [
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'images', type: 'image_group', label: '图片', fieldKey: 'images', required: false, order: 1, showInList: false },
      { widgetId: 'distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false },
      { widgetId: 'totalClimb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 3, showInList: false },
      { widgetId: 'referenceDuration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 4, showInList: false },
      { widgetId: 'driveDuration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 5, showInList: false },
      { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 6, showInList: false },
      { widgetId: 'location', type: 'location', label: '地点', fieldKey: 'location', required: false, order: 7, showInList: false },
    ],
  }

  test('从图文攻略控件中提取封面、标题、摘要、地点和作者', () => {
    const post: Post = {
      _id: 'p-guide',
      communityId: 'c1',
      sectionId: 's-guide',
      authorId: 'u1',
      authorNickname: '小雨妈妈',
      status: 'active',
      content: {
        title: '5 岁也能走完的溪边路线',
        images: ['cloud://env/images/cover.jpg', 'cloud://env/images/second.jpg'],
        distance: '4.2km',
        totalClimb: '128m',
        referenceDuration: '1h50m',
        driveDuration: '青山村约30分钟车程',
        body: {
          format: 'markdown',
          markdown: '从村口小桥出发，沿溪边慢慢走。\n\n孩子可以捡石头、看小鱼。',
          html: '<p>从村口小桥出发，沿溪边慢慢走。</p>',
          text: '从村口小桥出发，沿溪边慢慢走。孩子可以捡石头、看小鱼。',
          imageFileIDs: [],
          schemaVersion: 1,
        },
        location: { address: '青山村溪边', lat: 29.1, lng: 120.2 },
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '2026-06-02T08:00:00.000Z',
      updatedAt: '2026-06-02T08:00:00.000Z',
    }

    expect(getGuideNoteCard(post, section)).toEqual({
      title: '5 岁也能走完的溪边路线',
      coverImage: 'cloud://env/images/cover.jpg',
      excerpt: '从村口小桥出发，沿溪边慢慢走。孩子可以捡石头、看小鱼。',
      driveDuration: '青山村约30分钟车程',
      author: '小雨妈妈',
      when: '06-02',
      hasCover: true,
      routeStats: [
        { label: '距离', value: '4.2km' },
        { label: '累计爬升', value: '128m' },
        { label: '参考用时', value: '1h50m' },
      ],
    })
  })

  test('缺少图片和地点时返回安静占位所需的空值，不暴露表单空态文案', () => {
    const post = {
      content: { title: '油菜花田旁的小路' },
      createdAt: '2026-05-26T08:00:00.000Z',
    } as Post

    expect(getGuideNoteCard(post, section)).toEqual({
      title: '油菜花田旁的小路',
      coverImage: '',
      excerpt: '',
      driveDuration: '',
      author: '',
      when: '05-26',
      hasCover: false,
      routeStats: [],
    })
  })

  test('固定图文攻略控件 guide_drive_duration 会进入首页卡片自驾用时', () => {
    const guideSection: Section = {
      ...section,
      widgets: [
        { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
        { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false },
        { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false },
        { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false },
        { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 8, showInList: false },
      ],
    }
    const post = {
      content: {
        guide_title: '太平水库亲子游',
        guide_images: ['cloud://env/posts/cover.jpg'],
        guide_drive_duration: '青山村约35分钟到达入口',
      },
      createdAt: '2026-06-12T08:00:00.000Z',
    } as Post

    expect(getGuideNoteCard(post, guideSection).driveDuration).toBe('青山村约35分钟到达入口')
  })
})

describe('getCarpoolListSummary', () => {
  test('拼车板块优先生成路线和出发时间摘要', () => {
    const section: Section = {
      _id: 's-carpool',
      communityId: 'c1',
      name: '拼车出行',
      icon: 'car',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2024-01-01',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'origin', type: 'short_text', label: '出发地', fieldKey: 'origin', required: true, order: 0, showInList: true },
        { widgetId: 'destination', type: 'short_text', label: '目的地', fieldKey: 'destination', required: true, order: 1, showInList: true },
        { widgetId: 'time', type: 'datetime', label: '出发时间', fieldKey: 'departureTime', required: true, order: 2, showInList: true },
      ],
    }
    const post: Post = {
      _id: 'p-carpool',
      communityId: 'c1',
      sectionId: 's-carpool',
      authorId: 'u1',
      status: 'active',
      content: {
        origin: '青山村',
        destination: '东阳',
        time: '2024-03-15T09:05:00.000Z',
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    const result = getCarpoolListSummary(post, section)

    expect(result?.route).toBe('青山村 -- 东阳')
    expect(result?.departureTime).toMatch(/\d+月\d+日 \d+:\d{2}/)
  })

  test('使用明士班真实拼车字段，不能把发帖人名当目的地', () => {
    const section: Section = {
      _id: 'e20fd67f69ef325300d5c73466146167',
      communityId: 'dd0cb69969eb0baa006767350db40e50',
      name: '拼车出行',
      icon: '🚗',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: '67ae3194-6ca7-4efe-b9ec-078a606a4a11', type: 'short_text', label: '出发地', fieldKey: 'field_1777285499017', required: true, order: 0, showInList: true },
        { widgetId: '54b28893-55ce-4c30-bed5-af3eff9a845b', type: 'short_text', label: '目的地', fieldKey: 'field_1779967336796', required: true, order: 1, showInList: true },
        { widgetId: 'c1b09434-8aaa-4177-bf6e-042db23915ec', type: 'datetime', label: '出发时间', fieldKey: 'field_1777285527063', required: true, order: 2, showInList: true },
      ],
    }
    const post = {
      content: {
        '67ae3194-6ca7-4efe-b9ec-078a606a4a11': '青山村',
        '54b28893-55ce-4c30-bed5-af3eff9a845b': '成都软件园',
        'c1b09434-8aaa-4177-bf6e-042db23915ec': '2026-05-28T19:26:00',
      },
      authorNickname: '东阳',
    } as Post

    expect(getCarpoolListSummary(post, section)).toEqual({
      route: '青山村 -- 成都软件园',
      departureTime: '5月28日 19:26',
    })
    expect(getCarpoolLiveMeta(post, section)).toEqual(['出发时间：5月28日 19:26'])
  })

  test('缺少路线或出发时间时不生成拼车摘要', () => {
    const section: Section = {
      _id: 's-carpool',
      communityId: 'c1',
      name: '拼车出行',
      icon: 'car',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2024-01-01',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'origin', type: 'short_text', label: '出发地', fieldKey: 'origin', required: true, order: 0, showInList: true },
        { widgetId: 'destination', type: 'short_text', label: '目的地', fieldKey: 'destination', required: true, order: 1, showInList: true },
        { widgetId: 'time', type: 'datetime', label: '出发时间', fieldKey: 'departureTime', required: true, order: 2, showInList: true },
      ],
    }

    expect(getCarpoolListSummary({ content: { origin: '青山村', time: '2026-05-28T19:26:00' } } as Post, section)).toBeNull()
    expect(getCarpoolListSummary({ content: { origin: '青山村', destination: '成都软件园' } } as Post, section)).toBeNull()
  })

  test('非拼车板块不生成特殊摘要', () => {
    const section: Section = {
      _id: 's-normal',
      communityId: 'c1',
      name: '活动',
      icon: 'activity',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2024-01-01',
      type: 'realtime',
      status: 'active',
      widgets: [
        { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      ],
    }
    const post: Post = {
      _id: 'p-normal',
      communityId: 'c1',
      sectionId: 's-normal',
      authorId: 'u1',
      status: 'active',
      content: { title: '周末活动' },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(getCarpoolListSummary(post, section)).toBeNull()
  })

  test('家书板块列表摘要展示家书标题和作者', () => {
    const section: Section = {
      _id: 's-family-letter',
      communityId: 'c1',
      name: '家书十年传',
      icon: 'letter',
      order: 1,
      enableComment: true,
      enableLike: true,
      createdAt: '2024-01-01',
      type: 'evergreen',
      status: 'active',
      widgets: [
        { widgetId: 'author', type: 'short_text', label: '家书作者', fieldKey: 'author', required: true, order: 0, showInList: true },
        { widgetId: 'title', type: 'summary', label: '家书名', fieldKey: 'title', required: true, order: 1, showInList: true },
      ],
    }
    const post: Post = {
      _id: 'p-family-letter',
      communityId: 'c1',
      sectionId: 's-family-letter',
      authorId: 'u1',
      authorNickname: '东阳',
      status: 'active',
      content: {
        author: '王东阳',
        title: '写给十年后的家书',
      },
      commentCount: 0,
      likeCount: 0,
      createdAt: '',
      updatedAt: '',
    }

    expect(getFamilyLetterListSummary(post, section)).toEqual({
      title: '写给十年后的家书',
      author: '王东阳',
    })
  })
})
