import { sanitizeContent, validateContentValues, validateRequiredWidgets } from '../post-validate'
import type { Section } from '../../shared/types'

function sectionWithRequiredDestination(): Section {
  return {
    _id: 'section-guide',
    communityId: 'community-1',
    name: '亲子出游',
    icon: 'walk',
    order: 1,
    enableComment: true,
    enableLike: true,
    createdAt: '2026-06-12T00:00:00.000Z',
    type: 'evergreen',
    status: 'active',
    displayTemplate: 'guide_note',
    widgets: [
      {
        widgetId: 'guide_location',
        type: 'location',
        label: '目的地位置',
        fieldKey: 'location',
        required: true,
        order: 7,
        showInList: false,
        locked: true,
      },
    ],
  }
}

test('validateRequiredWidgets: 必填目的地位置必须包含有效坐标', () => {
  const section = sectionWithRequiredDestination()

  expect(() => validateRequiredWidgets(section, {})).toThrow('必填项未填写：目的地位置')
  expect(() => validateRequiredWidgets(section, {
    guide_location: { address: '太平水库', lat: 0, lng: 0 },
  })).toThrow('必填项未填写：目的地位置')
  expect(() => validateRequiredWidgets(section, {
    guide_location: {
      name: '太平水库',
      address: '四川省德阳市绵竹市太平水库',
      lat: 31.405678,
      lng: 104.133456,
      coordSystem: 'gcj02',
      source: 'amap',
      adjusted: true,
    },
  } as any)).not.toThrow()
})

function imageNoteSection(): Section {
  return {
    _id: 'section-image-note',
    communityId: 'community-1',
    name: '图文_new',
    icon: 'image',
    order: 2,
    enableComment: true,
    enableLike: true,
    createdAt: '2026-07-14T00:00:00.000Z',
    type: 'evergreen',
    status: 'active',
    displayTemplate: 'image_note',
    widgets: [
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
    ],
  }
}

test('sanitizeContent: topic values are canonicalized once at the cloud boundary', () => {
  const section = imageNoteSection()

  expect(sanitizeContent({
    image_note_topics: [' #周末遛娃 ', '周末遛娃', ' 公园野餐 '],
    ignored: 'not configured',
  }, section)).toEqual({
    image_note_topics: ['周末遛娃', '公园野餐'],
  })
  expect(sanitizeContent({ image_note_topics: ['  ##  '] }, section)).toEqual({})
  expect(() => sanitizeContent({ image_note_topics: '周末遛娃' }, section)).toThrow('话题必须是数组')
})

test('validateContentValues: topic values must already be canonical arrays', () => {
  const section = imageNoteSection()

  expect(() => validateContentValues(section, {
    image_note_topics: ['周末遛娃', '公园野餐'],
  })).not.toThrow()
  expect(() => validateContentValues(section, {
    image_note_topics: ['#周末遛娃'],
  })).toThrow('话题格式未规范化')
  expect(() => validateContentValues(section, {
    image_note_topics: ['一', '二', '三', '四', '五', '六'],
  })).toThrow('最多添加 5 个话题')
})

test('validateContentValues: 图文_new 正文图片只能放在添加图片控件', () => {
  const section = imageNoteSection()
  section.widgets.push({
    widgetId: 'image_note_body',
    type: 'rich_note',
    label: '正文',
    fieldKey: 'body',
    required: false,
    order: 2,
    showInList: false,
    locked: true,
  })

  expect(() => validateContentValues(section, {
    image_note_body: {
      format: 'markdown',
      markdown: '![照片](cloud://env/image.jpg)',
      html: '<p><img src="cloud://env/image.jpg"></p>',
      text: '',
      imageFileIDs: ['cloud://env/image.jpg'],
      schemaVersion: 1,
    },
  })).toThrow('图文_new 正文不支持插入图片')
})
