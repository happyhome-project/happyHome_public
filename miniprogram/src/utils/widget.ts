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
  driveDuration: string
  author: string
  when: string
  hasCover: boolean
  routeStats: Array<{ label: string; value: string }>
}

export interface PostHomeTitleIssue {
  code: 'missing_home_title_content'
  message: string
}

const HOME_TITLE_WIDGET_TYPES = ['short_text', 'summary', 'number', 'rich_text', 'rich_note']

export function getPostHomeTitle(post: Post, section: Section): string {
  const carpoolSummary = getCarpoolListSummary(post, section)
  if (carpoolSummary?.route) return carpoolSummary.route

  const widgets = (section.widgets || []).slice().sort((a, b) => a.order - b.order)
  const titleWidget = widgets.find((widget) => {
    if (!['short_text', 'summary', 'number'].includes(widget.type)) return false
    const fieldKey = String(widget.fieldKey || '').toLowerCase()
    const label = String(widget.label || '').replace(/\s/g, '')
    return fieldKey === 'title' ||
      fieldKey.includes('title') ||
      ['标题', '名称', '名字'].some((item) => label.includes(item))
  }) || widgets.find((widget) => ['short_text', 'summary', 'number'].includes(widget.type))

  if (titleWidget) {
    const value = getWidgetValue(post, titleWidget)
    if (value) return value
  }

  for (const widget of widgets.filter((item) => HOME_TITLE_WIDGET_TYPES.includes(item.type))) {
    const value = getWidgetValue(post, widget)
    if (value) return value
  }

  const attendanceWidget = widgets.find((widget) => widget.type === 'attendance' && String(widget.label || '').trim())
  return String(attendanceWidget?.label || section.name || '无标题').trim()
}

export function getPostHomeTitleIssue(post: Post, section: Section): PostHomeTitleIssue | null {
  if (section.type !== 'realtime') return null
  if (getCarpoolListSummary(post, section)?.route) return null
  const widgets = (section.widgets || []).slice().sort((a, b) => a.order - b.order)
  const hasTitleContent = widgets
    .filter((widget) => HOME_TITLE_WIDGET_TYPES.includes(widget.type))
    .some((widget) => getWidgetValue(post, widget) !== '')
  if (hasTitleContent) return null
  return {
    code: 'missing_home_title_content',
    message: '帖子缺少首页标题内容，已使用活动/板块名称临时展示。',
  }
}

export function getHomeLiveMeta(post: Post, section: Section): string[] {
  const meta: string[] = []
  const carpoolSummary = getCarpoolListSummary(post, section)
  if (carpoolSummary) {
    meta.push(...(getCarpoolLiveMeta(post, section) || []))
  } else {
    meta.push(...getConfiguredLiveMeta(post, section))
    if (meta.length === 0) {
      const timeText = formatRelativeTime(post.createdAt)
      if (timeText) meta.push(timeText)
    }
  }

  const attendanceText = getAttendanceMeta(post)
  if (attendanceText && !meta.includes(attendanceText)) meta.push(attendanceText)
  return meta
}

export function getCarpoolLiveMeta(post: Post, section: Section): string[] | null {
  const summary = getCarpoolListSummary(post, section)
  if (!summary) return null
  return [`出发时间：${summary.departureTime}`]
}

export function getListPreview(post: Post, section: Section): ListPreviewItem[] {
  return section.widgets
    .filter((widget) =>
      widget.showInList &&
      !isTitleLikeWidget(widget) &&
      !['admin_notice', 'video_group', 'audio_group', 'note_blocks', 'rich_note'].includes(widget.type)
    )
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

function isTitleLikeWidget(widget: Section['widgets'][number]): boolean {
  const fieldKey = String(widget.fieldKey || '').toLowerCase()
  const label = String(widget.label || '').replace(/\s/g, '')
  return fieldKey === 'title' ||
    fieldKey.includes('title') ||
    ['标题', '名称', '名字'].some((item) => label.includes(item))
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
  const driveDurationWidget = findWidgetByFieldOrLabel(
    section,
    ['driveDuration', 'driveTime', 'drivingTime', 'arrivalDuration', 'arrivalTime'],
    ['驾车到达用时', '驾车时间', '自驾时间', '到达时间', '车程'],
  )
  const routeStats = getGuideRouteStats(post, section)

  const coverImage = imageWidget ? firstImageValue(post.content?.[imageWidget.widgetId]) : ''
  const title = (titleWidget ? getWidgetValue(post, titleWidget) : '').trim() || '无标题'
  const excerpt = bodyWidget && bodyWidget.widgetId !== titleWidget?.widgetId
    ? getTextExcerpt(post.content?.[bodyWidget.widgetId])
    : ''
  const driveDuration = driveDurationWidget ? getWidgetValue(post, driveDurationWidget) : ''

  return {
    title,
    coverImage,
    excerpt,
    driveDuration,
    author: String((post as any)?.authorNickname || '').trim(),
    when: formatShortDate(post.createdAt),
    hasCover: coverImage !== '',
    routeStats,
  }
}

function getGuideRouteStats(post: Post, section: Section): Array<{ label: string; value: string }> {
  return [
    { label: '距离', fieldKeys: ['distance', 'routeDistance', 'totalDistance', 'mileage'], labels: ['距离', '总公里', '总里程'] },
    { label: '最高海拔', fieldKeys: ['highestAltitude', 'altitude', 'maxAltitude'], labels: ['最高海拔'] },
    { label: '累计爬升', fieldKeys: ['totalClimb', 'climb', 'ascent'], labels: ['累计爬升', '爬升'] },
    { label: '参考用时', fieldKeys: ['referenceDuration', 'duration', 'timeCost'], labels: ['参考用时', '参考耗时', '耗时'] },
  ]
    .map((item) => {
      const widget = findWidgetByFieldOrLabel(section, item.fieldKeys, item.labels)
      return {
        label: item.label,
        value: widget ? getWidgetValue(post, widget) : '',
      }
    })
    .filter((item) => item.value)
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
  if (type === 'rich_note' && value && typeof value === 'object' && !Array.isArray(value)) {
    return getTextExcerpt(value)
  }
  if (type === 'datetime') {
    const d = new Date(value as string)
    if (Number.isNaN(d.getTime())) return String(value)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (Array.isArray(value)) return ''
  if (typeof value === 'object') return ''
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

function findWidgetByFieldOrLabel(section: Section, fieldKeys: string[], labels: string[]) {
  const normalizedFieldKeys = fieldKeys.map((item) => item.toLowerCase())
  const normalizedLabels = labels.map((item) => item.replace(/\s/g, ''))
  return (section.widgets || []).slice()
    .sort((a, b) => a.order - b.order)
    .find((widget) => {
      const fieldKey = String(widget.fieldKey || '').trim().toLowerCase()
      const label = String(widget.label || '').replace(/\s/g, '')
      return normalizedFieldKeys.includes(fieldKey) || normalizedLabels.some((item) => label.includes(item))
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

function getConfiguredLiveMeta(post: Post, section: Section): string[] {
  return (section.widgets || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((widget) =>
      widget.showInList &&
      !isTitleLikeWidget(widget) &&
      ['short_text', 'summary', 'number', 'datetime'].includes(widget.type)
    )
    .map((widget) => {
      const value = widget.type === 'datetime'
        ? formatLiveDateOnly(post.content?.[widget.widgetId]) || getWidgetValue(post, widget)
        : getWidgetValue(post, widget)
      if (!value) return ''
      if (widget.type === 'datetime') {
        const label = String(widget.label || '时间').trim() || '时间'
        return `${label}：${value}`
      }
      return value
    })
    .filter((item) => item !== '')
}

function formatLiveDateOnly(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
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

function getAttendanceMeta(post: Post): string {
  const summaries = (post?.attendanceSummaryByWidget || {}) as Record<string, any>
  let summary: any = null
  for (const key in summaries) {
    if (!Object.prototype.hasOwnProperty.call(summaries, key)) continue
    const item = summaries[key]
    if (Number(item?.occupiedSeats ?? item?.count ?? 0) > 0) {
      summary = item
      break
    }
  }
  if (!summary) return ''
  const occupiedSeats = Number(summary.occupiedSeats ?? summary.count ?? 0)
  return occupiedSeats > 0 ? `${occupiedSeats}人参与` : ''
}

function formatRelativeTime(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffH = (now.getTime() - d.getTime()) / 3600000
  if (diffH < 1) return '刚刚'
  if (diffH < 24) return `${Math.floor(diffH)}h`
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}`
}

function formatShortDate(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}
