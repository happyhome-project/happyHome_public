import { normalizeSectionDisplayTemplate } from '../guide-note-widgets'
import {
  buildDefaultTextNoteWidgets,
  isTextNoteSection,
  normalizeTextNoteWidgets,
} from '../text-note-widgets'

test.each(['default', 'guide_note', 'text_note'] as const)(
  'normalizeSectionDisplayTemplate preserves %s',
  (template) => expect(normalizeSectionDisplayTemplate(template)).toBe(template),
)

test('normalizeSectionDisplayTemplate falls back to default', () => {
  expect(normalizeSectionDisplayTemplate('unknown')).toBe('default')
})

test('text note defaults contain required content and optional publish tools', () => {
  expect(buildDefaultTextNoteWidgets()).toEqual([
    { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
    { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
    { widgetId: 'text_topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false, locked: true },
    { widgetId: 'text_location', type: 'location', label: '设置地点', fieldKey: 'location', required: false, order: 4, showInList: false, locked: true },
  ])
})

test('normalizeTextNoteWidgets restores the exact fixed contract and discards custom widgets', () => {
  const section = {
    displayTemplate: 'text_note' as const,
    widgets: [
      { widgetId: 'custom', type: 'summary' as const, label: '摘要', fieldKey: 'summary', required: false, order: 0, showInList: true },
      { widgetId: 'text_title', type: 'summary' as const, label: '篡改', fieldKey: 'bad', required: false, order: 99, showInList: false },
    ],
  }
  expect(normalizeTextNoteWidgets(section)).toEqual(buildDefaultTextNoteWidgets())
  expect(isTextNoteSection(section)).toBe(true)
})
