import type { PostContent, Section, Widget, WidgetType } from '../shared/types'

// 永远不进 post.content 的控件类型（无论 user 还是 admin 路径）：
//   attendance: 用户报名记录写在独立集合
//   admin_notice: 管理员维护的公告内容，挂在 widget 上而非 post 上
export const NEVER_IN_POST_CONTENT: Set<WidgetType> = new Set([
  'attendance',
  'admin_notice',
])

// 普通用户不能编辑、但 admin 代发帖时允许的控件类型：
//   video_group: admin 在 admin-web 上传视频后代发帖
export const ADMIN_ONLY_WIDGET_TYPES: Set<WidgetType> = new Set([
  'video_group',
])

export function getEditableWidgetIds(section: Section, allowAdminOnly = false): Set<string> {
  return new Set(
    (section.widgets || [])
      .filter((widget) => {
        if (NEVER_IN_POST_CONTENT.has(widget.type)) return false
        if (!allowAdminOnly && ADMIN_ONLY_WIDGET_TYPES.has(widget.type)) return false
        return true
      })
      .map((widget) => widget.widgetId)
  )
}

export function sanitizeContent(
  content: PostContent | undefined,
  section: Section,
  options: { allowAdminOnly?: boolean } = {}
): PostContent {
  const allowedIds = getEditableWidgetIds(section, options.allowAdminOnly === true)
  return Object.fromEntries(
    Object.entries(content || {}).filter(([key]) => allowedIds.has(key))
  ) as PostContent
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

export function validateRequiredWidgets(
  section: Section,
  content: PostContent,
  options: { allowAdminOnly?: boolean } = {}
): void {
  const allowAdminOnly = options.allowAdminOnly === true
  for (const widget of (section.widgets || []) as Widget[]) {
    if (NEVER_IN_POST_CONTENT.has(widget.type)) continue
    if (!allowAdminOnly && ADMIN_ONLY_WIDGET_TYPES.has(widget.type)) continue
    if (!widget.required) continue
    const value = content[widget.widgetId]
    if (isEmptyValue(value)) {
      throw new Error(`必填项未填写：${widget.label}`)
    }
  }
}
