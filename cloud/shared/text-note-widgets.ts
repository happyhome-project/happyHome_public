import type { Section, TextNoteTheme, Widget } from './types'
import { normalizeSectionDisplayTemplate } from './guide-note-widgets'

export const TEXT_NOTE_THEMES: TextNoteTheme[] = ['paper', 'mint', 'slate', 'headline', 'quote', 'notice']

export const TEXT_NOTE_LOCKED_WIDGETS: Widget[] = [
  { widgetId: 'text_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
  { widgetId: 'text_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: true, order: 2, showInList: false, locked: true },
  { widgetId: 'text_topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false, locked: true },
  { widgetId: 'text_location', type: 'location', label: '设置地点', fieldKey: 'location', required: false, order: 4, showInList: false, locked: true },
]

export function buildDefaultTextNoteWidgets(): Widget[] {
  return TEXT_NOTE_LOCKED_WIDGETS.map((widget) => ({ ...widget }))
}

export function isTextNoteSection(section: Pick<Section, 'displayTemplate'> | null | undefined): boolean {
  return normalizeSectionDisplayTemplate(section?.displayTemplate) === 'text_note'
}

export function normalizeTextNoteWidgets(section: Pick<Section, 'displayTemplate' | 'widgets'> | null | undefined): Widget[] {
  const widgets = Array.isArray(section?.widgets) ? section.widgets : []
  if (!isTextNoteSection(section)) return widgets
  return buildDefaultTextNoteWidgets()
}

export function normalizeTextNoteSection<T extends { displayTemplate?: unknown; widgets?: Widget[] } | null | undefined>(section: T): T {
  if (!section) return section
  return {
    ...section,
    displayTemplate: normalizeSectionDisplayTemplate(section.displayTemplate),
    widgets: normalizeTextNoteWidgets(section as any),
  } as T
}

export function normalizeTextNoteTheme(value: unknown): TextNoteTheme {
  if (value === undefined) return 'paper'
  if (TEXT_NOTE_THEMES.includes(value as TextNoteTheme)) return value as TextNoteTheme
  throw new Error('不支持的纯文字笔记主题')
}
