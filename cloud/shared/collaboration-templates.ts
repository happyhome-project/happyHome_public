import {
  ACTIVITY_INVITE_SECTION_NAME,
  ACTIVITY_INVITE_SYSTEM_KEY,
  buildActivityInviteSectionWidgets,
} from './activity-invite'
import type { CollaborationTemplate, Section, Widget } from './types'

export const CARPOOL_SYSTEM_KEY = 'carpool'
export const CARPOOL_TEMPLATE_NAME = '拼车出行'
export const CARPOOL_TEMPLATE_ID = 'collaboration-template-carpool'
export const ACTIVITY_INVITE_TEMPLATE_ID = 'collaboration-template-activity-invite'

export const CARPOOL_WIDGET_IDS = {
  origin: 'carpool_origin',
  destination: 'carpool_destination',
  departureTime: 'carpool_departure_time',
  seats: 'carpool_seats',
  contact: 'carpool_contact',
  attendance: 'carpool_attendance',
  location: 'carpool_location',
  note: 'carpool_note',
} as const

export type UnsafeCollaborationTemplateChange =
  | 'widget_removed'
  | 'widget_id_changed'
  | 'widget_type_changed'
  | 'widget_field_key_changed'
  | 'required_widget_added'

function buildCarpoolWidgets(): Widget[] {
  return [
    {
      widgetId: CARPOOL_WIDGET_IDS.origin,
      type: 'short_text',
      label: '出发地',
      fieldKey: 'origin',
      required: true,
      order: 0,
      showInList: true,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.destination,
      type: 'short_text',
      label: '目的地',
      fieldKey: 'destination',
      required: true,
      order: 1,
      showInList: true,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.departureTime,
      type: 'datetime',
      label: '出发时间',
      fieldKey: 'departureTime',
      required: true,
      order: 2,
      showInList: true,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.seats,
      type: 'short_text',
      label: '空余座位',
      fieldKey: 'seats',
      required: true,
      order: 3,
      showInList: false,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.contact,
      type: 'short_text',
      label: '联系人',
      fieldKey: 'contact',
      required: true,
      order: 4,
      showInList: false,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.attendance,
      type: 'attendance',
      label: '上车',
      fieldKey: 'attendance',
      required: false,
      order: 5,
      showInList: false,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.location,
      type: 'location',
      label: '地图位置',
      fieldKey: 'location',
      required: true,
      order: 6,
      showInList: false,
    },
    {
      widgetId: CARPOOL_WIDGET_IDS.note,
      type: 'note_blocks',
      label: '补充说明',
      fieldKey: 'note',
      required: false,
      order: 7,
      showInList: false,
    },
  ]
}

function initialTemplate(
  systemKey: string,
  name: string,
  icon: string,
  order: number,
  widgets: Widget[],
): CollaborationTemplate {
  return {
    _id: `collaboration-template-${systemKey.replace(/_/g, '-')}`,
    systemKey,
    name,
    icon,
    order,
    status: 'active',
    enableComment: true,
    enableLike: true,
    widgets: widgets.map((widget) => ({ ...widget })),
    protectedSystemKey: true,
    createdAt: '',
    updatedAt: '',
  }
}

export function buildInitialCollaborationTemplates(): CollaborationTemplate[] {
  return [
    initialTemplate(CARPOOL_SYSTEM_KEY, CARPOOL_TEMPLATE_NAME, '🚗', 0, buildCarpoolWidgets()),
    initialTemplate(ACTIVITY_INVITE_SYSTEM_KEY, ACTIVITY_INVITE_SECTION_NAME, '👣', 1, buildActivityInviteSectionWidgets()),
  ]
}

export function normalizeCollaborationTemplate(template: CollaborationTemplate): CollaborationTemplate {
  return {
    ...template,
    systemKey: String(template.systemKey || '').trim(),
    name: String(template.name || '').trim(),
    icon: String(template.icon || '').trim(),
    order: Number.isFinite(Number(template.order)) ? Number(template.order) : 0,
    status: template.status === 'disabled' ? 'disabled' : 'active',
    enableComment: template.enableComment !== false,
    enableLike: template.enableLike !== false,
    widgets: (template.widgets || [])
      .map((widget) => ({ ...widget }))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((widget, order) => ({ ...widget, order })),
  }
}

export function collaborationTemplateAsSection(template: CollaborationTemplate, communityId = ''): Section {
  const normalized = normalizeCollaborationTemplate(template)
  return {
    _id: normalized._id,
    communityId,
    name: normalized.name,
    icon: normalized.icon,
    order: normalized.order,
    enableComment: normalized.enableComment,
    enableLike: normalized.enableLike,
    widgets: normalized.widgets,
    createdAt: normalized.createdAt,
    type: 'realtime',
    status: normalized.status === 'active' ? 'active' : 'archived',
    displayTemplate: 'default',
    systemKey: normalized.systemKey,
  }
}

export function findUnsafeCollaborationTemplateChanges(
  currentWidgets: Widget[],
  nextWidgets: Widget[],
): UnsafeCollaborationTemplateChange[] {
  const issues = new Set<UnsafeCollaborationTemplateChange>()
  const currentById = new Map(currentWidgets.map((widget) => [widget.widgetId, widget]))
  const nextById = new Map(nextWidgets.map((widget) => [widget.widgetId, widget]))
  const nextByFieldKey = new Map(nextWidgets.map((widget) => [widget.fieldKey, widget]))

  for (const current of currentWidgets) {
    const next = nextById.get(current.widgetId)
    if (!next) {
      issues.add('widget_removed')
      if (nextByFieldKey.has(current.fieldKey)) issues.add('widget_id_changed')
      continue
    }
    if (next.type !== current.type) issues.add('widget_type_changed')
    if (next.fieldKey !== current.fieldKey) issues.add('widget_field_key_changed')
    if (!current.required && next.required) issues.add('required_widget_added')
  }

  for (const next of nextWidgets) {
    if (!currentById.has(next.widgetId) && next.required) issues.add('required_widget_added')
  }

  return [...issues]
}
