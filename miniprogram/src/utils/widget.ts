import type { AttendancePreviewUser, Section, Post } from '../../../cloud/shared/types'

export interface ListPreviewItem {
  label: string
  value: string
  type: 'text' | 'attendance'
  previewUsers?: AttendancePreviewUser[]
}

export interface CarpoolListSummary {
  route: string
  departureTime: string
}

export interface FamilyLetterListSummary {
  title: string
  author: string
}

export function getCarpoolLiveMeta(post: Post, section: Section): string[] | null {
  const summary = getCarpoolListSummary(post, section)
  if (!summary) return null
  return [`出发时间：${summary.departureTime}`]
}

export function getListPreview(post: Post, section: Section): ListPreviewItem[] {
  return section.widgets
    .filter((widget) => widget.showInList && !['admin_notice', 'video_group', 'audio_group', 'note_blocks', 'rich_note'].includes(widget.type))
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

export function getCarpoolListSummary(post: Post, section: Section): CarpoolListSummary | null {
  if (!isCarpoolSection(section)) return null

  const originWidget = findWidgetByLabel(section, ['出发地', '起点'])
  const destinationWidget = findWidgetByLabel(section, ['目的地', '终点'])
  const timeWidget = findWidgetByLabel(section, ['出发时间', '时间'])
  const origin = originWidget ? getWidgetValue(post, originWidget) : ''
  const destination = destinationWidget ? getWidgetValue(post, destinationWidget) : ''
  const departureTime = timeWidget ? getWidgetValue(post, timeWidget) : ''

  if (!origin || !destination || !departureTime) return null
  return { route: `${origin} -- ${destination}`, departureTime }
}

export function getFamilyLetterListSummary(post: Post, section: Section): FamilyLetterListSummary | null {
  if (!isFamilyLetterSection(section)) return null

  const titleWidget = findWidgetByLabel(section, ['家书名称', '家书标题', '家书名', '标题'])
  const authorWidget = findWidgetByLabel(section, ['家书作者', '作者'])

  return {
    title: titleWidget ? getWidgetValue(post, titleWidget) : '',
    author: authorWidget ? getWidgetValue(post, authorWidget) : '',
  }
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

function isCarpoolSection(section: Section): boolean {
  if (String(section.name || '').includes('拼车')) return true
  return Boolean(findWidgetByLabel(section, ['出发地', '起点']) && findWidgetByLabel(section, ['目的地', '终点']))
}

function isFamilyLetterSection(section: Section): boolean {
  if (String(section.name || '').includes('家书')) return true
  return Boolean(findWidgetByLabel(section, ['家书名称', '家书标题', '家书名']) && findWidgetByLabel(section, ['家书作者']))
}

function findWidgetByLabel(section: Section, labels: string[]) {
  return [...(section.widgets || [])]
    .sort((a, b) => a.order - b.order)
    .find((widget) => {
      const label = String(widget.label || '').replace(/\s/g, '')
      return labels.some((item) => label.includes(item))
    })
}

function getWidgetValue(post: Post, widget: Section['widgets'][number]): string {
  return formatWidgetValue(post.content?.[widget.widgetId], widget.type).trim()
}
