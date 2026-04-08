import type { Section, Post } from '../../../cloud/shared/types'

export function getListPreview(
  post: Post,
  section: Section
): Array<{ label: string; value: string }> {
  return section.widgets
    .filter((w) => w.showInList)
    .sort((a, b) => a.order - b.order)
    .map((w) => ({
      label: w.label,
      value: formatWidgetValue(post.content[w.widgetId], w.type),
    }))
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
    if (isNaN(d.getTime())) return String(value)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (Array.isArray(value)) return '' // images not shown in list
  return String(value)
}
