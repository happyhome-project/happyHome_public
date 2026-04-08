import { describe, test, expect } from 'vitest'
import { formatWidgetValue, getListPreview } from '../widget'
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

  test('datetime 格式化为 M月D日 H:MM', () => {
    const result = formatWidgetValue('2024-03-15T09:05:00.000Z', 'datetime')
    // 结果取决于本地时区，只验证格式
    expect(result).toMatch(/\d+月\d+日 \d+:\d{2}/)
  })

  test('datetime 无效日期返回原值字符串', () => {
    expect(formatWidgetValue('not-a-date', 'datetime')).toBe('not-a-date')
  })

  test('数组类型（image_group）返回空字符串', () => {
    expect(formatWidgetValue(['img1.png', 'img2.png'], 'image_group')).toBe('')
  })

  test('location 对象返回 address 字段', () => {
    expect(formatWidgetValue({ address: '北京市海淀区', lat: 39.9, lng: 116.3 }, 'location')).toBe('北京市海淀区')
  })

  test('location 对象无 address 时返回空', () => {
    expect(formatWidgetValue({ lat: 39.9, lng: 116.3 }, 'location')).toBe('')
  })

  test('location 非对象值返回空', () => {
    expect(formatWidgetValue('some string', 'location')).toBe('')
  })
})

describe('getListPreview', () => {
  const section: Section = {
    _id: 's1',
    communityId: 'c1',
    name: '日记',
    icon: 'book',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2024-01-01',
    widgets: [
      { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      { widgetId: 'w2', type: 'number', label: '数量', fieldKey: 'qty', required: false, order: 1, showInList: true },
      { widgetId: 'w3', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false },
    ],
  }

  test('只返回 showInList 为 true 的控件', () => {
    const post: Post = {
      _id: 'p1', communityId: 'c1', sectionId: 's1', authorId: 'u1',
      status: 'active', content: { w1: '标题值', w2: 10, w3: '正文' },
      commentCount: 0, likeCount: 0, createdAt: '', updatedAt: '',
    }
    const result = getListPreview(post, section)
    expect(result).toHaveLength(2)
    expect(result[0].label).toBe('标题')
    expect(result[1].label).toBe('数量')
  })

  test('按 order 排序', () => {
    const reversedSection: Section = {
      ...section,
      widgets: [
        { widgetId: 'w2', type: 'number', label: '数量', fieldKey: 'qty', required: false, order: 2, showInList: true },
        { widgetId: 'w1', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true },
      ],
    }
    const post: Post = {
      _id: 'p1', communityId: 'c1', sectionId: 's1', authorId: 'u1',
      status: 'active', content: { w1: '标题值', w2: 5 },
      commentCount: 0, likeCount: 0, createdAt: '', updatedAt: '',
    }
    const result = getListPreview(post, reversedSection)
    expect(result[0].label).toBe('标题')
    expect(result[1].label).toBe('数量')
  })

  test('空值的控件被过滤掉', () => {
    const post: Post = {
      _id: 'p1', communityId: 'c1', sectionId: 's1', authorId: 'u1',
      status: 'active', content: { w1: '标题值' }, // w2 is undefined
      commentCount: 0, likeCount: 0, createdAt: '', updatedAt: '',
    }
    const result = getListPreview(post, section)
    expect(result).toHaveLength(1)
    expect(result[0].label).toBe('标题')
  })

  test('没有 showInList 控件时返回空数组', () => {
    const noListSection: Section = {
      ...section,
      widgets: [
        { widgetId: 'w3', type: 'rich_text', label: '正文', fieldKey: 'body', required: false, order: 0, showInList: false },
      ],
    }
    const post: Post = {
      _id: 'p1', communityId: 'c1', sectionId: 's1', authorId: 'u1',
      status: 'active', content: { w3: '正文' },
      commentCount: 0, likeCount: 0, createdAt: '', updatedAt: '',
    }
    expect(getListPreview(post, noListSection)).toEqual([])
  })
})
