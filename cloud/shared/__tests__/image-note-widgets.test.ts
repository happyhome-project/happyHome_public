import {
  IMAGE_NOTE_LOCKED_WIDGETS,
  buildDefaultImageNoteWidgets,
  isImageNoteSection,
  normalizeImageNoteWidgets,
} from '../image-note-widgets'
import { normalizeSectionDisplayTemplate } from '../guide-note-widgets'
import { normalizeTopics } from '../topics'
import { normalizeSectionTemplates } from '../section-templates'

describe('normalizeTopics', () => {
  test('normalizes hashes and Unicode, then deduplicates case-insensitively', () => {
    expect(normalizeTopics([' ##周末遛娃 ', '周末遛娃', ' 公园野餐 ', 'ＡＢＣ', 'abc'])).toEqual([
      '周末遛娃',
      '公园野餐',
      'ABC',
    ])
  })

  test('rejects malformed, overlong, and overflowing topic values', () => {
    expect(() => normalizeTopics('周末遛娃')).toThrow('话题必须是数组')
    expect(normalizeTopics(['😀'.repeat(20)])).toEqual(['😀'.repeat(20)])
    expect(() => normalizeTopics(['😀'.repeat(21)])).toThrow('每个话题不能超过 20 个字符')
    expect(() => normalizeTopics(['一'.repeat(21)])).toThrow('每个话题不能超过 20 个字符')
    expect(() => normalizeTopics(['一', '二', '三', '四', '五', '六'])).toThrow('最多添加 5 个话题')
  })
})

describe('image-note template contract', () => {
  test('normalizes the explicit image-note display template', () => {
    expect(normalizeSectionDisplayTemplate('image_note')).toBe('image_note')
    expect(normalizeSectionDisplayTemplate('unknown')).toBe('default')
    expect(isImageNoteSection({ displayTemplate: 'image_note' })).toBe(true)
    expect(isImageNoteSection({ displayTemplate: 'guide_note' })).toBe(false)
  })

  test('defines exactly the approved five locked widgets', () => {
    expect(IMAGE_NOTE_LOCKED_WIDGETS).toEqual([
      {
        widgetId: 'image_note_images',
        type: 'image_group',
        label: '添加图片',
        fieldKey: 'images',
        required: true,
        order: 0,
        showInList: false,
        locked: true,
      },
      {
        widgetId: 'image_note_title',
        type: 'short_text',
        label: '主题',
        fieldKey: 'title',
        required: true,
        order: 1,
        showInList: true,
        locked: true,
      },
      {
        widgetId: 'image_note_body',
        type: 'rich_note',
        label: '正文',
        fieldKey: 'body',
        required: false,
        order: 2,
        showInList: false,
        locked: true,
      },
      {
        widgetId: 'image_note_topics',
        type: 'topic',
        label: '话题',
        fieldKey: 'topics',
        required: false,
        order: 3,
        showInList: false,
        locked: true,
      },
      {
        widgetId: 'image_note_location',
        type: 'location',
        label: '设置地点',
        fieldKey: 'location',
        required: false,
        order: 4,
        showInList: false,
        locked: true,
      },
    ])
    expect(buildDefaultImageNoteWidgets()).not.toBe(IMAGE_NOTE_LOCKED_WIDGETS)
  })

  test('restores exactly the five locked widgets and removes custom fields', () => {
    const section = {
      displayTemplate: 'image_note',
      widgets: [
        {
          widgetId: 'custom_summary',
          type: 'summary',
          label: '补充说明',
          fieldKey: 'customSummary',
          required: false,
          order: 0,
          showInList: true,
          locked: true,
        },
        {
          ...IMAGE_NOTE_LOCKED_WIDGETS[1],
          label: '被篡改的主题',
          required: false,
        },
      ],
    } as any

    const normalized = normalizeImageNoteWidgets(section)
    expect(normalized).toEqual(IMAGE_NOTE_LOCKED_WIDGETS)
  })

  test('the public section normalizer restores image-note widgets for member APIs', () => {
    const section = normalizeSectionTemplates({
      displayTemplate: 'image_note',
      widgets: [{
        widgetId: 'legacy-extra',
        type: 'summary',
        label: '补充说明',
        fieldKey: 'summary',
        required: false,
        order: 0,
        showInList: false,
      }],
    } as any)

    expect(section.widgets).toEqual(IMAGE_NOTE_LOCKED_WIDGETS)
  })
})
