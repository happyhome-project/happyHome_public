import { describe, expect, test } from 'vitest'
import type { Section, Widget } from '../../../../cloud/shared/types'
import { resolveActivityAnnouncementMain } from '../create-form-layout'

function baseSection(name: string): Section {
  return {
    _id: 's-activity-announcement',
    communityId: 'c1',
    name,
    icon: 'notice',
    order: 1,
    enableComment: true,
    enableLike: true,
    widgets: [],
    createdAt: '2026-07-10',
    type: 'realtime',
    status: 'active',
  }
}

function widget(
  widgetId: string,
  type: Widget['type'],
  label: string,
  fieldKey: string,
  order: number,
): Widget {
  return {
    widgetId,
    type,
    label,
    fieldKey,
    required: false,
    order,
    showInList: false,
  }
}

describe('resolveActivityAnnouncementMain', () => {
  test('activates for a normalized activity-announcement name and prefers semantic title and body widgets', () => {
    const introWidget = widget('intro', 'short_text', '导语', 'intro', 0)
    const titleWidget = widget('activity-name', 'summary', '活动 名称', 'field_1', 1)
    const genericBodyWidget = widget('generic-body', 'rich_text', '补充信息', 'notes', 2)
    const bodyWidget = widget('activity-body', 'note_blocks', '活动内容', 'activityContent', 3)
    const laterTitleWidget = widget('later-title', 'short_text', '标题', 'title', 4)
    const widgets = [introWidget, titleWidget, genericBodyWidget, bodyWidget, laterTitleWidget]

    const result = resolveActivityAnnouncementMain(baseSection(' 社区 活动 公告 '), widgets)

    expect(result).toEqual({
      titleWidget,
      bodyWidget,
      remainingWidgets: [introWidget, genericBodyWidget, laterTitleWidget],
    })
  })

  test('matches title field keys and body labels case-insensitively', () => {
    const titleWidget = widget('title', 'short_text', '主题', 'AnnouncementTitle', 0)
    const bodyWidget = widget('body', 'rich_note', '活动 详情', 'field_2', 1)

    const result = resolveActivityAnnouncementMain(
      baseSection('活动公告（社区）'),
      [titleWidget, bodyWidget],
    )

    expect(result?.titleWidget).toBe(titleWidget)
    expect(result?.bodyWidget).toBe(bodyWidget)
    expect(result?.remainingWidgets).toEqual([])
  })

  test('uses a remaining summary as the body fallback', () => {
    const titleWidget = widget('title', 'summary', '标题', 'title', 0)
    const bodyWidget = widget('summary', 'summary', '摘要', 'summary', 1)

    expect(resolveActivityAnnouncementMain(
      baseSection('活动公告'),
      [titleWidget, bodyWidget],
    )).toEqual({
      titleWidget,
      bodyWidget,
      remainingWidgets: [],
    })
  })

  test('preserves the input array and the original order of unselected widgets', () => {
    const firstExtra = widget('first-extra', 'datetime', '活动时间', 'activityTime', 30)
    const titleWidget = widget('title', 'short_text', '标题', 'title', 10)
    const secondExtra = widget('second-extra', 'image_group', '图片', 'images', 20)
    const bodyWidget = widget('body', 'rich_text', '正文', 'body', 0)
    const widgets = Object.freeze([firstExtra, titleWidget, secondExtra, bodyWidget])
    const snapshot = [...widgets]

    const result = resolveActivityAnnouncementMain(baseSection('活动公告'), widgets)

    expect(widgets).toEqual(snapshot)
    expect(result?.remainingWidgets).toEqual([firstExtra, secondExtra])
    expect(result?.remainingWidgets[0]).toBe(firstExtra)
    expect(result?.remainingWidgets[1]).toBe(secondExtra)
  })

  test('returns null for a non-activity-announcement section', () => {
    const widgets = [
      widget('title', 'short_text', '标题', 'title', 0),
      widget('body', 'rich_text', '正文', 'body', 1),
    ]

    expect(resolveActivityAnnouncementMain(baseSection('社区公告'), widgets)).toBeNull()
  })

  test('returns null when no eligible title widget exists', () => {
    const widgets = [
      widget('wrong-title-type', 'rich_text', '标题', 'title', 0),
      widget('body', 'rich_note', '正文', 'body', 1),
    ]

    expect(resolveActivityAnnouncementMain(baseSection('活动公告'), widgets)).toBeNull()
  })

  test('returns null when no eligible body widget exists', () => {
    const widgets = [
      widget('title', 'short_text', '活动名称', 'name', 0),
      widget('wrong-body-type', 'short_text', '活动说明', 'content', 1),
    ]

    expect(resolveActivityAnnouncementMain(baseSection('活动公告'), widgets)).toBeNull()
  })
})
