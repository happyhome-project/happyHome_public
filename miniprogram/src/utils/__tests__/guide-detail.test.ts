import { describe, expect, test } from 'vitest'
import type { Post, Section } from '../../../../cloud/shared/types'
import { buildGuideRouteDetail } from '../guide-detail'

function baseSection(widgets: Section['widgets']): Section {
  return {
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
    widgets,
  }
}

function basePost(content: Post['content']): Post {
  return {
    _id: 'p-guide',
    communityId: 'c1',
    sectionId: 's-guide',
    authorId: 'u1',
    authorNickname: '小雨妈妈',
    status: 'active',
    content,
    commentCount: 0,
    likeCount: 0,
    createdAt: '2026-06-02T08:00:00.000Z',
    updatedAt: '2026-06-02T08:00:00.000Z',
  }
}

describe('buildGuideRouteDetail', () => {
  test('固定路线数据为距离、最高海拔、累计爬升、参考用时，缺项留空', () => {
    const section = baseSection([
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false },
      { widgetId: 'distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false },
      { widgetId: 'climb', type: 'short_text', label: '累计爬升', fieldKey: 'climb', required: false, order: 3, showInList: false },
      { widgetId: 'duration', type: 'short_text', label: '参考用时', fieldKey: 'duration', required: false, order: 4, showInList: false },
      { widgetId: 'type', type: 'short_text', label: '类型', fieldKey: 'type', required: false, order: 5, showInList: false },
      { widgetId: 'difficulty', type: 'short_text', label: '难度', fieldKey: 'difficulty', required: false, order: 6, showInList: false },
    ])
    const post = basePost({
      title: '九溪茶山亲子轻徒步',
      images: ['cloud://env/cover.jpg', 'cloud://env/second.jpg'],
      distance: '4.2km',
      climb: '128m',
      duration: '1h50m',
      type: '环线',
      difficulty: '轻中',
    })

    expect(buildGuideRouteDetail(post, section).stats).toEqual([
      { key: 'distance', label: '距离', value: '4.2km' },
      { key: 'highestAltitude', label: '最高海拔', value: '' },
      { key: 'totalClimb', label: '累计爬升', value: '128m' },
      { key: 'referenceDuration', label: '参考用时', value: '1h50m' },
    ])
  })

  test('驾车到达用时作为独立攻略信息，不进入路线数据四格', () => {
    const section = baseSection([
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'driveDuration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 1, showInList: false },
      { widgetId: 'distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false },
    ])
    const post = basePost({
      title: '太平水库亲子游',
      driveDuration: '青山村约30分钟车程',
      distance: '约1.5-2km',
    })

    const detail = buildGuideRouteDetail(post, section)

    expect(detail.driveDuration).toBe('青山村约30分钟车程')
    expect(detail.stats).toEqual([
      { key: 'distance', label: '距离', value: '约1.5-2km' },
      { key: 'highestAltitude', label: '最高海拔', value: '' },
      { key: 'totalClimb', label: '累计爬升', value: '' },
      { key: 'referenceDuration', label: '参考用时', value: '' },
    ])
  })

  test('封面图片用于顶部，正文交给通用富图文渲染并保留原始 Markdown', () => {
    const section = baseSection([
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false },
      { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false },
    ])
    const post = basePost({
      title: '九溪茶山亲子轻徒步',
      images: ['cloud://env/cover.jpg'],
      body: {
        format: 'markdown',
        markdown: '线路概述：经过桂溪公园、中和湿地公园，寻找网红白房子\n\n![图片](cloud://env/body.jpg)\n\n线路行程：11+公里',
        html: '',
        text: '线路概述：经过桂溪公园、中和湿地公园，寻找网红白房子 线路行程：11+公里',
        imageFileIDs: ['cloud://env/body.jpg'],
        schemaVersion: 1,
      },
    })

    const detail = buildGuideRouteDetail(post, section)

    expect(detail.images).toEqual(['cloud://env/cover.jpg'])
    expect(detail.bodySections).toEqual([
      {
        title: '正文',
        type: 'rich_note',
        value: expect.objectContaining({
          markdown: '线路概述：经过桂溪公园、中和湿地公园，寻找网红白房子\n\n![图片](cloud://env/body.jpg)\n\n线路行程：11+公里',
        }),
      },
    ])
  })

  test('图文攻略正文保留普通富图文的多次换行和排版语法', () => {
    const markdown = '第一行\n\n\n第二行\n\n**加粗提醒**\n\n- 第一项\n- 第二项'
    const section = baseSection([
      { widgetId: 'title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 1, showInList: false },
    ])
    const post = basePost({
      title: '太平水库亲子游',
      body: {
        format: 'markdown',
        markdown,
        html: '',
        text: '第一行 第二行 加粗提醒 第一项 第二项',
        imageFileIDs: [],
        schemaVersion: 1,
      },
    })

    const [body] = buildGuideRouteDetail(post, section).bodySections

    expect(body).toEqual({
      title: '正文',
      type: 'rich_note',
      value: expect.objectContaining({ markdown }),
    })
  })
})
