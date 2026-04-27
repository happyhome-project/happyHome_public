import type { PostContent, Section, Widget } from '../shared/types'

export function getEditableWidgetIds(section: Section): Set<string> {
  return new Set(
    (section.widgets || [])
      .filter((widget) => widget.type !== 'attendance')
      .map((widget) => widget.widgetId)
  )
}

export function sanitizeContent(content: PostContent | undefined, section: Section): PostContent {
  const allowedIds = getEditableWidgetIds(section)
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

export function validateRequiredWidgets(section: Section, content: PostContent): void {
  for (const widget of (section.widgets || []) as Widget[]) {
    if (widget.type === 'attendance' || !widget.required) continue
    const value = content[widget.widgetId]
    if (isEmptyValue(value)) {
      throw new Error(`必填项未填写：${widget.label}`)
    }
  }
}
