import type { Section, SectionDisplayTemplate, Widget } from './types'

export function normalizeSectionDisplayTemplate(value: unknown): SectionDisplayTemplate {
  if (value === 'guide_note' || value === 'image_note') return value
  return 'default'
}

export const GUIDE_NOTE_LOCKED_WIDGETS: Widget[] = [
  { widgetId: 'guide_title', type: 'short_text', label: '标题', fieldKey: 'title', required: true, order: 0, showInList: true, locked: true },
  { widgetId: 'guide_images', type: 'image_group', label: '封面/图片', fieldKey: 'images', required: true, order: 1, showInList: false, locked: true },
  { widgetId: 'guide_distance', type: 'short_text', label: '距离', fieldKey: 'distance', required: false, order: 2, showInList: false, locked: true },
  { widgetId: 'guide_highest_altitude', type: 'short_text', label: '最高海拔', fieldKey: 'highestAltitude', required: false, order: 3, showInList: false, locked: true },
  { widgetId: 'guide_total_climb', type: 'short_text', label: '累计爬升', fieldKey: 'totalClimb', required: false, order: 4, showInList: false, locked: true },
  { widgetId: 'guide_reference_duration', type: 'short_text', label: '参考用时', fieldKey: 'referenceDuration', required: false, order: 5, showInList: false, locked: true },
  { widgetId: 'guide_drive_duration', type: 'short_text', label: '驾车到达用时', fieldKey: 'driveDuration', required: true, order: 6, showInList: false, locked: true },
  { widgetId: 'guide_body', type: 'rich_note', label: '正文', fieldKey: 'body', required: false, order: 7, showInList: false, locked: true },
  { widgetId: 'guide_liangbulu_track_id', type: 'short_text', label: '两步路轨迹编号', fieldKey: 'liangbuluTrackId', required: false, order: 8, showInList: false, locked: true },
  { widgetId: 'guide_location', type: 'location', label: '目的地位置', fieldKey: 'location', required: true, order: 9, showInList: false, locked: true },
  { widgetId: 'guide_activity_invite', type: 'activity_invite', label: '活动召集', fieldKey: 'activityInvite', required: false, order: 10, showInList: false, locked: true },
]

const GUIDE_NOTE_LOCKED_BY_ID = new Map(GUIDE_NOTE_LOCKED_WIDGETS.map((widget) => [widget.widgetId, widget]))

export function buildDefaultGuideNoteWidgets(): Widget[] {
  return GUIDE_NOTE_LOCKED_WIDGETS.map((widget) => ({ ...widget }))
}

export function getGuideNoteLockedWidget(widgetId: string): Widget | undefined {
  return GUIDE_NOTE_LOCKED_BY_ID.get(widgetId)
}

export function isGuideNoteSection(section: Pick<Section, 'displayTemplate'> | null | undefined): boolean {
  return normalizeSectionDisplayTemplate(section?.displayTemplate) === 'guide_note'
}

export function normalizeGuideNoteWidgets(section: Pick<Section, 'displayTemplate' | 'widgets'> | null | undefined): Widget[] {
  const widgets = Array.isArray(section?.widgets) ? section.widgets : []
  if (!isGuideNoteSection(section)) return widgets

  const lockedIds = new Set(GUIDE_NOTE_LOCKED_WIDGETS.map((widget) => widget.widgetId))
  const customWidgets = widgets
    .filter((widget: any) => !lockedIds.has(String(widget?.widgetId || '')))
    .slice()
    .sort((a: any, b: any) => Number(a?.order || 0) - Number(b?.order || 0))
    .map((widget: any, index: number) => ({
      ...widget,
      order: GUIDE_NOTE_LOCKED_WIDGETS.length + index,
      locked: false,
    }))

  return [
    ...buildDefaultGuideNoteWidgets(),
    ...customWidgets,
  ]
}

export function normalizeGuideNoteSection<T extends { displayTemplate?: unknown; widgets?: Widget[] } | null | undefined>(section: T): T {
  if (!section) return section
  return {
    ...section,
    displayTemplate: normalizeSectionDisplayTemplate(section.displayTemplate),
    widgets: normalizeGuideNoteWidgets(section as any),
  } as T
}
