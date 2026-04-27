import type { AttendancePreviewUser, Section, Post } from '../../../cloud/shared/types'

export interface ListPreviewItem {
  label: string
  value: string
  type: 'text' | 'attendance'
  previewUsers?: AttendancePreviewUser[]
}

export function getListPreview(post: Post, section: Section): ListPreviewItem[] {
  return section.widgets
    .filter((widget) => widget.showInList && widget.type !== 'admin_notice' && widget.type !== 'video_group')
    .sort((a, b) => a.order - b.order)
    .map((widget) => {
      if (widget.type === 'attendance') {
        const summary = post.attendanceSummaryByWidget?.[widget.widgetId]
        const count = Number(summary?.count || 0)
        return {
          label: widget.label,
          value: count > 0 ? `${count}人参与` : '',
          type: 'attendance' as const,
          previewUsers: summary?.previewUsers || [],
        }
      }
      return {
        label: widget.label,
        value: formatWidgetValue(post.content[widget.widgetId], widget.type),
        type: 'text' as const,
      }
    })
    .filter((item) => item.value !== '')
}

export function formatWidgetValue(value: any, type: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (type === 'location') {
    if (typeof value === 'object' && value !== null) {
      return String(value.address || '')
    }
    return ''
  }
  if (type === 'datetime') {
    const d = new Date(value as string)
    if (Number.isNaN(d.getTime())) return String(value)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (Array.isArray(value)) return ''
  return String(value)
}
