import type { Section, Widget } from './types'

export const ACTIVITY_INVITE_SYSTEM_KEY = 'activity_invite'
export const ACTIVITY_INVITE_SECTION_NAME = '出游邀约'
export const ACTIVITY_INVITE_SOURCE_WIDGET_ID = 'guide_activity_invite'

export const ACTIVITY_INVITE_WIDGET_IDS = {
  title: 'activity_invite_title',
  startsAt: 'activity_invite_starts_at',
  location: 'activity_invite_location',
  contact: 'activity_invite_contact',
  capacity: 'activity_invite_capacity',
  note: 'activity_invite_note',
  attendance: 'activity_invite_attendance',
} as const

export function buildActivityInviteSourceWidget(): Widget {
  return {
    widgetId: ACTIVITY_INVITE_SOURCE_WIDGET_ID,
    type: 'activity_invite',
    label: '活动召集',
    fieldKey: 'activityInvite',
    required: false,
    order: 10,
    showInList: false,
    locked: true,
  }
}

export function buildActivityInviteSectionWidgets(): Widget[] {
  return [
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.title,
      type: 'short_text',
      label: '邀约主题',
      fieldKey: 'title',
      required: true,
      order: 0,
      showInList: true,
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.startsAt,
      type: 'datetime',
      label: '出发时间',
      fieldKey: 'startsAt',
      required: true,
      order: 1,
      showInList: true,
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.location,
      type: 'location',
      label: '集合地点',
      fieldKey: 'location',
      required: true,
      order: 2,
      showInList: false,
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.contact,
      type: 'short_text',
      label: '联系电话',
      fieldKey: 'contact',
      required: true,
      order: 3,
      showInList: false,
      visibility: 'member',
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.capacity,
      type: 'number',
      label: '人数上限',
      fieldKey: 'capacity',
      required: true,
      order: 4,
      showInList: false,
      unit: '人',
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.note,
      type: 'note_blocks',
      label: '补充说明',
      fieldKey: 'note',
      required: false,
      order: 5,
      showInList: false,
    },
    {
      widgetId: ACTIVITY_INVITE_WIDGET_IDS.attendance,
      type: 'attendance',
      label: '我要参与',
      fieldKey: 'attendance',
      required: false,
      order: 6,
      showInList: true,
      capacityWidgetId: ACTIVITY_INVITE_WIDGET_IDS.capacity,
    },
  ]
}

export function isActivityInviteSection(section: Pick<Section, 'systemKey' | 'name' | 'type'> | null | undefined): boolean {
  return section?.systemKey === ACTIVITY_INVITE_SYSTEM_KEY ||
    ((section?.type || '') === 'realtime' && section?.name === ACTIVITY_INVITE_SECTION_NAME)
}

export function isActivityInviteInProgress(post: { status?: string; auditStatus?: string; eventStartsAt?: string }, now = Date.now()): boolean {
  if (!post || post.status === 'deleted') return false
  if (post.auditStatus && post.auditStatus !== 'pass') return false
  const startsAt = Date.parse(String(post.eventStartsAt || ''))
  return Number.isFinite(startsAt) && startsAt > now
}
