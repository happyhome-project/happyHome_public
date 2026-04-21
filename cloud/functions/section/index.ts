import cloud from 'wx-server-sdk'
import { v4 as uuidv4 } from 'uuid'
import * as db from '../../lib/db'
import { resolveOpenId } from '../../lib/ctx'
import { assertCommunityAdmin } from '../../lib/auth'
import type { Widget, Section, SectionType, SectionStatus } from '../../shared/types'
import { LIST_DISPLAYABLE_TYPES } from '../../shared/types'

// 老数据没有 type/status 字段时的默认值（避免一次性 migration）
// evergreen + active 表示"沉淀常驻"，对老数据语义最安全
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

  // 首页需要每个 section 的活跃帖子数（N+1 查询；单社区 section 数量不大，可接受）
  if (params.withPostCount) {
    const withCount = await Promise.all(
      sections.map(async (s: Section) => ({
        ...s,
        postCount: await db.count('posts', { sectionId: s._id, status: 'active' }),
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

  const widgets = params.widgets

  // Validate showInList count <= 3
  const showInListCount = widgets.filter(w => w.showInList).length
  if (showInListCount > 3) throw new Error('showInList 最多只能有 3 个控件')

  // Validate showInList only allowed for LIST_DISPLAYABLE_TYPES
  for (const widget of widgets) {
    if (widget.showInList && !LIST_DISPLAYABLE_TYPES.includes(widget.type)) {
      throw new Error(`控件类型 ${widget.type} 不支持在列表展示`)
    }
  }

  // Assign UUID to new widgets (widgetId empty/missing)
  const updatedWidgets = widgets.map(w => ({
    ...w,
    widgetId: w.widgetId ? w.widgetId : uuidv4(),
  }))

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
  // evergreen 类型的 status 强制为 active（语义：永远常驻）
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
