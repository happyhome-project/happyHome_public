import { normalizeSectionDisplayTemplate } from './guide-note-widgets'
import type { Section, Widget } from './types'

export const IMAGE_NOTE_LOCKED_WIDGETS: Widget[] = [
  { widgetId: 'image_note_images', type: 'image_group', label: '添加图片', fieldKey: 'images', required: true, order: 0, showInList: false, locked: true },
  { widgetId: 'image_note_title', type: 'short_text', label: '主题', fieldKey: 'title', required: true, order: 1, showInList: true, locked: true },
  { widgetId: 'image_note_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 2, showInList: false, locked: true },
  { widgetId: 'image_note_topics', type: 'topic', label: '话题', fieldKey: 'topics', required: false, order: 3, showInList: false, locked: true },
  { widgetId: 'image_note_location', type: 'location', label: '设置地点', fieldKey: 'location', required: false, order: 4, showInList: false, locked: true },
]

const IMAGE_NOTE_LOCKED_BY_ID = new Map(IMAGE_NOTE_LOCKED_WIDGETS.map((widget) => [widget.widgetId, widget]))

export function buildDefaultImageNoteWidgets(): Widget[] {
  return IMAGE_NOTE_LOCKED_WIDGETS.map((widget) => ({ ...widget }))
}

export function getImageNoteLockedWidget(widgetId: string): Widget | undefined {
  return IMAGE_NOTE_LOCKED_BY_ID.get(widgetId)
}

export function isImageNoteSection(section: Pick<Section, 'displayTemplate'> | null | undefined): boolean {
  return normalizeSectionDisplayTemplate(section?.displayTemplate) === 'image_note'
}

export function normalizeImageNoteWidgets(section: Pick<Section, 'displayTemplate' | 'widgets'> | null | undefined): Widget[] {
  const widgets = Array.isArray(section?.widgets) ? section.widgets : []
  if (!isImageNoteSection(section)) return widgets

  const lockedIds = new Set(IMAGE_NOTE_LOCKED_WIDGETS.map((widget) => widget.widgetId))
  const customWidgets = widgets
    .filter((widget) => !lockedIds.has(String(widget?.widgetId || '')))
    .slice()
    .sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
    .map((widget, index) => ({
      ...widget,
      order: IMAGE_NOTE_LOCKED_WIDGETS.length + index,
      locked: false,
    }))

  return [
    ...buildDefaultImageNoteWidgets(),
    ...customWidgets,
  ]
}

export function normalizeImageNoteSection<T extends { displayTemplate?: unknown; widgets?: Widget[] } | null | undefined>(section: T): T {
  if (!section) return section
  return {
    ...section,
    displayTemplate: normalizeSectionDisplayTemplate(section.displayTemplate),
    widgets: normalizeImageNoteWidgets(section as any),
  } as T
}
