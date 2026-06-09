import type { Post, Section } from '../../../cloud/shared/types'
import { normalizeRichNoteContent } from './rich-note'
import { formatWidgetValue } from './widget'

type SectionWidget = Section['widgets'][number]

export interface GuideRouteStat {
  key: 'distance' | 'highestAltitude' | 'totalClimb' | 'referenceDuration'
  label: string
  value: string
}

export interface GuideRouteLocation {
  address: string
  lat: number
  lng: number
}

export type GuideRouteBodyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'image'; src: string }

export interface GuideRouteBodySection {
  title: string
  blocks: GuideRouteBodyBlock[]
}

export interface GuideRouteDetail {
  title: string
  subtitle: string
  tags: string[]
  images: string[]
  stats: GuideRouteStat[]
  bodySections: GuideRouteBodySection[]
  location: GuideRouteLocation | null
}

const STAT_CONFIG: Array<{
  key: GuideRouteStat['key']
  label: string
  fieldKeys: string[]
  labels: string[]
}> = [
  { key: 'distance', label: '距离', fieldKeys: ['distance', 'routeDistance', 'totalDistance', 'mileage'], labels: ['距离', '总公里', '总里程'] },
  { key: 'highestAltitude', label: '最高海拔', fieldKeys: ['highestAltitude', 'altitude', 'maxAltitude'], labels: ['最高海拔'] },
  { key: 'totalClimb', label: '累计爬升', fieldKeys: ['totalClimb', 'climb', 'ascent'], labels: ['累计爬升', '爬升'] },
  { key: 'referenceDuration', label: '参考用时', fieldKeys: ['referenceDuration', 'duration', 'timeCost'], labels: ['参考用时', '参考耗时', '耗时'] },
]

export function buildGuideRouteDetail(post: Post, section: Section): GuideRouteDetail {
  const titleWidget = findFirstWidget(section, {
    fieldKeys: ['title', 'name'],
    labels: ['标题', '名称', '名字'],
    types: ['short_text', 'summary'],
  })
  const bodyWidgets = findWidgetsByTypes(section, ['rich_note', 'rich_text', 'summary'])
    .filter((widget) => widget.widgetId !== titleWidget?.widgetId)
  const summaryWidget = findFirstWidget(section, {
    fieldKeys: ['summary', 'subtitle', 'intro'],
    labels: ['摘要', '简介', '短摘要'],
    types: ['summary', 'rich_text', 'short_text'],
  })

  return {
    title: titleWidget ? widgetTextValue(post, titleWidget) : '',
    subtitle: summaryWidget && summaryWidget.widgetId !== titleWidget?.widgetId
      ? widgetTextValue(post, summaryWidget)
      : '',
    tags: collectTags(post, section),
    images: collectTopImages(post, section),
    stats: buildStats(post, section),
    bodySections: collectBodySections(post, bodyWidgets),
    location: collectLocation(post, section),
  }
}

function buildStats(post: Post, section: Section): GuideRouteStat[] {
  return STAT_CONFIG.map((item) => {
    const widget = findFirstWidget(section, {
      fieldKeys: item.fieldKeys,
      labels: item.labels,
    })
    return {
      key: item.key,
      label: item.label,
      value: widget ? widgetTextValue(post, widget) : '',
    }
  })
}

function collectTags(post: Post, section: Section): string[] {
  const tagWidget = findFirstWidget(section, {
    fieldKeys: ['tags', 'routeTags', 'playTypes', 'routeType'],
    labels: ['标签', '玩法', '路线类型', '类型'],
  })
  if (!tagWidget) return []
  const value = post.content?.[tagWidget.widgetId]
  if (Array.isArray(value)) return uniqueStrings(value)
  return splitTags(widgetTextValue(post, tagWidget))
}

function collectTopImages(post: Post, section: Section): string[] {
  const images: string[] = []
  findWidgetsByTypes(section, ['image_group']).forEach((widget) => {
    const value = post.content?.[widget.widgetId]
    if (Array.isArray(value)) pushUnique(images, uniqueStrings(value))
  })
  return images
}

function collectBodySections(post: Post, bodyWidgets: SectionWidget[]): GuideRouteBodySection[] {
  const blocks: GuideRouteBodyBlock[] = []
  bodyWidgets.forEach((widget) => {
    const value = post.content?.[widget.widgetId]
    if (widget.type === 'rich_note') {
      const rich = normalizeRichNoteContent(value)
      blocks.push(...markdownToBodyBlocks(rich.markdown || rich.text || ''))
      return
    }
    if (widget.type === 'rich_text') {
      blocks.push(...htmlToBodyBlocks(String(value || '')))
      return
    }
    const text = widgetTextValue(post, widget)
    if (text) blocks.push({ type: 'paragraph', text })
  })
  return blocks.length ? [{ title: '正文', blocks }] : []
}

function collectLocation(post: Post, section: Section): GuideRouteLocation | null {
  const widget = findFirstWidget(section, {
    fieldKeys: ['location', 'trackLocation'],
    labels: ['地点', '位置', '线路轨迹', '轨迹'],
    types: ['location'],
  })
  if (!widget) return null
  const raw = post.content?.[widget.widgetId]
  if (!raw || typeof raw !== 'object') return null
  const lat = Number((raw as any).lat)
  const lng = Number((raw as any).lng)
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return {
    address: String((raw as any).address || ''),
    lat,
    lng,
  }
}

function findWidgetsByTypes(section: Section, types: string[]): SectionWidget[] {
  return (section.widgets || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((widget) => types.includes(widget.type))
}

function findFirstWidget(
  section: Section,
  options: { fieldKeys?: string[]; labels?: string[]; types?: string[] },
): SectionWidget | undefined {
  const fieldKeys = (options.fieldKeys || []).map(normalizeKey)
  const labels = (options.labels || []).map(normalizeLabel)
  return (section.widgets || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .find((widget) => {
      if (options.types?.length && !options.types.includes(widget.type)) return false
      const fieldKey = normalizeKey(widget.fieldKey || '')
      const label = normalizeLabel(widget.label || '')
      return fieldKeys.includes(fieldKey) || labels.some((item) => label.includes(item))
    })
}

function widgetTextValue(post: Post, widget: SectionWidget): string {
  if (widget.type === 'rich_note') return normalizeRichNoteContent(post.content?.[widget.widgetId]).text.trim()
  return formatWidgetValue(post.content?.[widget.widgetId], widget.type).trim()
}

function normalizeLabel(value: string): string {
  return String(value || '').replace(/\s/g, '')
}

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function uniqueStrings(value: unknown[]): string[] {
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function pushUnique(target: string[], values: string[]) {
  values.forEach((value) => {
    if (value && !target.includes(value)) target.push(value)
  })
}

function splitTags(value: string): string[] {
  return value
    .split(/[,\s，、/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitParagraphs(value: string): string[] {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function markdownToBodyBlocks(value: string): GuideRouteBodyBlock[] {
  const blocks: GuideRouteBodyBlock[] = []
  splitParagraphs(value).forEach((paragraph) => {
    const image = /^!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(paragraph)
    if (image) {
      return
    } else {
      blocks.push({ type: 'paragraph', text: paragraph })
    }
  })
  return blocks
}

function htmlToBodyBlocks(value: string): GuideRouteBodyBlock[] {
  const text = String(value || '')
    .replace(/<img\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return splitParagraphs(text).map((paragraph) => ({ type: 'paragraph', text: paragraph }))
}
