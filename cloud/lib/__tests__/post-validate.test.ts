import { validateContentValues, validateRequiredWidgets } from '../post-validate'
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

function textNoteSection(): Section {
  return {
    ...sectionWithRequiredDestination(),
    _id: 'section-text-note',
    displayTemplate: 'text_note',
    widgets: [
      { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
      { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
    ],
  }
}

test.each([
  [{ text_body: { format: 'markdown', markdown: '正文', html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1 } }, '必填项未填写：标题'],
  [{ text_title: '标题' }, '必填项未填写：正文'],
] as const)('validateRequiredWidgets: text note rejects an empty required field', (content, message) => {
  expect(() => validateRequiredWidgets(textNoteSection(), content as any)).toThrow(message)
})

test('validateContentValues: text note body rejects embedded images', () => {
  expect(() => validateContentValues(textNoteSection(), {
    text_title: '标题',
    text_body: {
      format: 'markdown', markdown: '![图](cloud://env/body.jpg)', html: '<img src="cloud://env/body.jpg">',
      text: '', imageFileIDs: ['cloud://env/body.jpg'], schemaVersion: 1,
    },
  })).toThrow('纯文字笔记正文不支持插入图片')
})

test.each([
  '<img src=cloud://env/body.jpg>',
  '![图][cover]\n\n[cover]: cloud://env/body.jpg',
  '![cover]\n\n[cover]: cloud://env/body.jpg',
  '前文 ~~~ ![图](cloud://env/body.jpg) ~~~ 后文',
])('validateContentValues: text note body rejects an image token in markdown: %s', (markdown) => {
  expect(() => validateContentValues(textNoteSection(), {
    text_title: '标题',
    text_body: {
      format: 'markdown', markdown, html: '<p>正文</p>',
      text: '正文', imageFileIDs: [], schemaVersion: 1,
    },
  })).toThrow('纯文字笔记正文不支持插入图片')
})

test.each([
  '\\![只是字面](cloud://env/not-an-image.jpg)',
  '普通字面 ![尚未完成的图片标记]',
  '`![代码示例](cloud://env/not-an-image.jpg)`',
  '```markdown\n![代码块示例][cover]\n[cover]: cloud://env/not-an-image.jpg\n```',
])('validateContentValues: text note body accepts non-image markdown literals: %s', (markdown) => {
  expect(() => validateContentValues(textNoteSection(), {
    text_title: '标题',
    text_body: {
      format: 'markdown', markdown, html: '<p>正文</p>',
      text: markdown, imageFileIDs: [], schemaVersion: 1,
    },
  })).not.toThrow()
})

test('validateContentValues: guide body accepts escaped and code image literals', () => {
  const guide = {
    ...textNoteSection(),
    displayTemplate: 'guide_note' as const,
    widgets: [{ widgetId: 'guide_body', type: 'rich_note' as const, label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false }],
  }
  expect(() => validateContentValues(guide, {
    guide_body: {
      format: 'markdown',
      markdown: '\\![字面](cloud://env/a.jpg) `![代码](cloud://env/b.jpg)`',
      html: '<p>正文</p>', text: '正文', imageFileIDs: [], schemaVersion: 1,
    },
  })).not.toThrow()
})

test.each([
  '<img src=cloud://env/body.jpg>',
  '<IMG   SRC = cloud://env/body.jpg >',
])('validateContentValues: text note body rejects an image tag with an unquoted src: %s', (html) => {
  expect(() => validateContentValues(textNoteSection(), {
    text_title: '标题',
    text_body: {
      format: 'markdown', markdown: '', html,
      text: '', imageFileIDs: [], schemaVersion: 1,
    },
  })).toThrow('纯文字笔记正文不支持插入图片')
})
