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

export interface GuideNoteCard {
  title: string
  coverImage: string
  excerpt: string
  location: string
  author: string
  when: string
  hasCover: boolean
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

export function getArchiveHomeMeta(post: Post, section: Section): string {
  if (section?.enableLike !== false && Number(post?.likeCount || 0) > 0) {
    return `${post.likeCount} 赞`
  }
  if (section?.enableComment !== false && Number(post?.commentCount || 0) > 0) {
    return `${post.commentCount} 评论`
  }
  return ''
}

export function getGuideNoteCard(post: Post, section: Section): GuideNoteCard {
  const titleWidget = findWidgetByLabel(section, ['标题', '名称', '名字'])
    || findFirstWidgetByTypes(section, ['short_text', 'summary'])
  const imageWidget = findFirstWidgetByTypes(section, ['image_group'])
  const bodyWidget = findFirstWidgetByTypes(section, ['rich_note', 'rich_text', 'summary'])
  const locationWidget = findFirstWidgetByTypes(section, ['location'])

  const coverImage = imageWidget ? firstImageValue(post.content?.[imageWidget.widgetId]) : ''
  const title = (titleWidget ? getWidgetValue(post, titleWidget) : '').trim() || '无标题'
  const excerpt = bodyWidget && bodyWidget.widgetId !== titleWidget?.widgetId
    ? getTextExcerpt(post.content?.[bodyWidget.widgetId])
    : ''
  const location = locationWidget ? getWidgetValue(post, locationWidget) : ''

  return {
    title,
    coverImage,
    excerpt,
    location,
    author: String((post as any)?.authorNickname || '').trim(),
    when: formatShortDate(post.createdAt),
    hasCover: coverImage !== '',
  }
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
  return (section.widgets || []).slice()
    .sort((a, b) => a.order - b.order)
    .find((widget) => {
      const label = String(widget.label || '').replace(/\s/g, '')
      return labels.some((item) => label.includes(item))
    })
}

function findFirstWidgetByTypes(section: Section, types: string[]) {
  return (section.widgets || []).slice()
    .sort((a, b) => a.order - b.order)
    .find((widget) => types.includes(widget.type))
}

function getWidgetValue(post: Post, widget: Section['widgets'][number]): string {
  return formatWidgetValue(post.content?.[widget.widgetId], widget.type).trim()
}

function firstImageValue(value: unknown): string {
  if (!Array.isArray(value)) return ''
  const first = value.find((item) => String(item || '').trim())
  return first ? String(first).trim() : ''
}

function getTextExcerpt(value: unknown): string {
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else if (value && typeof value === 'object' && !Array.isArray(value)) {
    text = String((value as any).text || (value as any).markdown || '')
  }
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#>*_`~\-[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
}

function formatShortDate(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}
