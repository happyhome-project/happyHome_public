import { describe, expect, test } from 'vitest'
import type { Section, Widget } from '../../../../cloud/shared/types'
import { buildImageNoteCreateBlocks } from '../image-note-create'
import { appendTopic } from '../topics'

const widgets: Widget[] = [
  { widgetId: 'image_note_images', type: 'image_group', label: '添加图片', fieldKey: 'images', required: true, order: 0, showInList: false, locked: true },
  { widgetId: 'image_note_title', type: 'short_text', label: '主题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
  { widgetId: 'image_note_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
  { widgetId: 'image_note_topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false, locked: true },
  { widgetId: 'image_note_location', type: 'location', label: '设置地点', fieldKey: 'location', required: false, order: 4, showInList: false, locked: true },
  { widgetId: 'custom-distance', type: 'number', label: '距离', fieldKey: 'distance', required: false, order: 5, showInList: false },
]

function section(displayTemplate: Section['displayTemplate']): Section {
  return {
    _id: 'section-image-note',
    communityId: 'community-1',
    name: '图文_new',
    icon: 'image',
    order: 1,
    enableComment: true,
    enableLike: true,
    widgets,
    createdAt: '2026-07-14T00:00:00.000Z',
    type: 'evergreen',
    status: 'active',
    displayTemplate,
  }
}

describe('buildImageNoteCreateBlocks', () => {
  test('creates one media canvas and one compact topic/location tool row', () => {
    const blocks = buildImageNoteCreateBlocks(section('image_note'), widgets)

    expect(blocks.map((block) => block.type)).toEqual([
      'imageNoteMain',
      'imageNoteTools',
    ])
    expect(blocks[0]).toEqual(expect.objectContaining({
      imageWidget: widgets[0],
      titleWidget: widgets[1],
      bodyWidget: widgets[2],
    }))
    expect(blocks[1]).toEqual(expect.objectContaining({
      topicWidget: widgets[3],
      locationWidget: widgets[4],
    }))
    expect(blocks.some((block) => block.type === 'routeStats')).toBe(false)
    expect(blocks.some((block) => block.widget?.widgetId === 'custom-distance')).toBe(false)
  })

  test('supports a stale displayTemplate only when the fixed widget contract is complete', () => {
    expect(buildImageNoteCreateBlocks(section('default'), widgets)).not.toEqual([])
    expect(buildImageNoteCreateBlocks(
      { ...section('default'), name: '图文_new' },
      widgets.slice(0, 4),
    )).toEqual([])
    expect(buildImageNoteCreateBlocks(
      { ...section('default'), name: '图文_new' },
      [],
    )).toEqual([])
  })
})

describe('appendTopic', () => {
  test('normalizes a Xiaohongshu-style #话题 entry', () => {
    expect(appendTopic(['周末遛娃'], ' ## 公园野餐 ')).toEqual(['周末遛娃', '公园野餐'])
  })

  test('prevents a sixth topic', () => {
    expect(() => appendTopic(['一', '二', '三', '四', '五'], '六')).toThrow('最多添加 5 个话题')
  })
})
