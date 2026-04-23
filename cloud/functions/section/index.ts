import cloud from 'wx-server-sdk'
import { v4 as uuidv4 } from 'uuid'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertCommunityAdmin } from '../../lib/auth'
import type { Widget, Section, SectionType, SectionStatus } from '../../shared/types'
import { LIST_DISPLAYABLE_TYPES } from '../../shared/types'

function normalizeSection(s: any): Section {
  return {
    ...s,
    type: (s.type as SectionType) || 'evergreen',
    status: (s.status as SectionStatus) || 'active',
    enableComment: s.enableComment !== false,
    enableLike: s.enableLike !== false,
  }
}

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function normalizeWidget(widget: Widget): Widget {
  const normalized: Widget = {
    ...widget,
    required: widget.type === 'attendance' ? false : widget.required,
  }
  if (normalized.type !== 'attendance') {
    delete normalized.capacity
  } else if (typeof normalized.capacity === 'number') {
    normalized.capacity = Number.isFinite(normalized.capacity) && normalized.capacity > 0
      ? Math.floor(normalized.capacity)
      : undefined
  }
  return normalized
}

function validateWidgets(sectionType: SectionType, widgets: Widget[]) {
  const showInListCount = widgets.filter((widget) => widget.showInList).length
  if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')

  const attendanceWidgets = widgets.filter((widget) => widget.type === 'attendance')
  if (attendanceWidgets.length > 1) throw new Error('每个板块最多只能配置 1 个活动参与控件')
  if (attendanceWidgets.length > 0 && sectionType !== 'realtime') {
    throw new Error('活动参与控件只能用于 realtime 板块')
  }

  for (const widget of widgets) {
    if (widget.showInList && !LIST_DISPLAYABLE_TYPES.includes(widget.type)) {
      throw new Error(`控件类型 ${widget.type} 不支持在列表展示`)
    }
    if (widget.type === 'attendance' && widget.required) {
      throw new Error('活动参与控件不支持设为必填')
    }
  }
}

export async function handleCreate(
  params: {
    communityId: string
    name: string
    icon: string
    order: number
    enableComment?: boolean
    enableLike?: boolean
    type?: SectionType
    accentColor?: string
  },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

  const sectionId = await db.create('sections', {
    communityId: params.communityId,
    name: params.name,
    icon: params.icon,
    order: params.order,
    enableComment: params.enableComment ?? true,
    enableLike: params.enableLike ?? true,
    widgets: [],
    createdAt: new Date().toISOString(),
    type: params.type ?? 'evergreen',
    status: 'active',
    ...(params.accentColor ? { accentColor: params.accentColor } : {}),
  })

  return { sectionId }
}

export async function handleGet(params: { sectionId: string }) {
  const raw = await db.getById('sections', params.sectionId)
  return { section: raw ? normalizeSection(raw) : null }
}

export async function handleList(params: { communityId: string; withPostCount?: boolean }) {
  const raw = await db.query('sections', { communityId: params.communityId }, {
    orderBy: ['order', 'asc'],
  })
  const sections = raw.map(normalizeSection)

  if (params.withPostCount) {
    const withCount = await Promise.all(
      sections.map(async (section: Section) => ({
        ...section,
        postCount: await db.count('posts', { sectionId: section._id, status: 'active' }),
      }))
    )
    return { sections: withCount }
  }

  return { sections }
}

export async function handleUpdateWidgets(
  params: { communityId: string; sectionId: string; widgets: Widget[] },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

  const section = normalizeSection(await db.getById('sections', params.sectionId))
  const updatedWidgets = params.widgets.map((widget) => normalizeWidget({
    ...widget,
    widgetId: widget.widgetId ? widget.widgetId : uuidv4(),
  }))
  validateWidgets(section.type, updatedWidgets)

  await db.updateById('sections', params.sectionId, { widgets: updatedWidgets })
  return { widgets: updatedWidgets }
}

export async function handleUpdate(
  params: {
    sectionId: string
    communityId: string
    name?: string
    icon?: string
    order?: number
    enableComment?: boolean
    enableLike?: boolean
    type?: SectionType
    status?: SectionStatus
    accentColor?: string
  },
  openid: string,
) {
  if (!openid) throw new Error('Missing OPENID')
  await assertCommunityAdmin(openid, params.communityId)

  const { sectionId, communityId, ...updates } = params
  if (updates.type === 'evergreen') updates.status = 'active'
  await db.updateById('sections', sectionId, updates)
  return { success: true }
}

export const main = async (event: any) => {
  const openid = resolveOpenId(event)
  const { action, _testOpenid, ...params } = event
  if (action === 'create') return handleCreate(params, openid)
  if (action === 'get') return handleGet(params)
  if (action === 'list') return handleList(params)
  if (action === 'updateWidgets') return handleUpdateWidgets(params, openid)
  if (action === 'update') return handleUpdate(params, openid)
  throw new Error(`Unknown action: ${action}`)
}
