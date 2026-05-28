import { describe, expect, test } from 'vitest'
import { formatWidgetValue, getCarpoolListSummary, getCarpoolLiveMeta, getListPreview } from '../widget'
import type { Section, Post } from '../../../../cloud/shared/types'

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
      { widgetId: 'w2', type: 'attendance', label: '活动参与', fieldKey: 'attendance', required: false, order: 1, showInList: true, capacity: 5 },
      { widgetId: 'w3', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false },
    ],
  }

  test('返回普通字段和 attendance 摘要', () => {
    const post: Post = {
      _id: 'p1',
      communityId: 'c1',
      sectionId: 's1',
      authorId: 'u1',
      status: 'active',
      content: { w1: '周六爬山', w3: '正文' },
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
    expect(result[0]).toMatchObject({ label: '标题', value: '周六爬山', type: 'text' })
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
      content: { w1: '周六爬山' },
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
    expect(result[0].label).toBe('标题')
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
    expect(result).toEqual([{ label: '标题', value: '课程通知', type: 'text' }])
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
})
