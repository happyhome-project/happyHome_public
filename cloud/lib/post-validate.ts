import { AUDIO_ALLOWED_EXTS, AUDIO_MAX_SIZE_BYTES } from '../shared/types'
import type { PostContent, Section, Widget, WidgetType } from '../shared/types'
import { isGuideNoteSection } from '../shared/guide-note-widgets'
import { isTextNoteSection } from '../shared/text-note-widgets'

const MarkdownIt = require('markdown-it')
const markdownParser = new MarkdownIt({ html: true })
import { isImageNoteSection } from '../shared/image-note-widgets'
import { normalizeTopics } from '../shared/topics'

// 永远不进 post.content 的控件类型（无论 user 还是 admin 路径）：
//   attendance: 用户报名记录写在独立集合
//   admin_notice: 管理员维护的公告内容，挂在 widget 上而非 post 上
//   activity_invite: 沉淀帖上的跨板块动作入口，不是帖子正文
export const NEVER_IN_POST_CONTENT: Set<WidgetType> = new Set([
  'attendance',
  'admin_notice',
  'activity_invite',
])

// 普通用户不能编辑、但 admin 代发帖时允许的控件类型：
//   video_group/audio_group: admin 在 admin-web 维护媒体内容后代发帖
export const ADMIN_ONLY_WIDGET_TYPES: Set<WidgetType> = new Set([
  'video_group',
  'audio_group',
])

type ContentValidationOptions = {
  allowAdminOnly?: boolean
  memberEditableVideoWidgetIds?: readonly string[]
}

function isAdminOnlyWidgetEnabled(widget: Widget, options: ContentValidationOptions): boolean {
  if (!ADMIN_ONLY_WIDGET_TYPES.has(widget.type)) return true
  if (options.allowAdminOnly === true) return true
  return widget.type === 'video_group'
    && new Set(options.memberEditableVideoWidgetIds || []).has(widget.widgetId)
}

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
  const widgetById = new Map((section.widgets || []).map((widget) => [widget.widgetId, widget]))
  const sanitizedEntries: Array<[string, PostContent[string]]> = []

  for (const [key, value] of Object.entries(content || {})) {
    if (!allowedIds.has(key)) continue
    const widget = widgetById.get(key)
    if (widget?.type === 'rich_note' && isEmptyRichNoteContent(value)) continue
    if (widget?.type === 'topic') {
      const normalizedTopics = normalizeTopics(value)
      if (normalizedTopics.length === 0) continue
      sanitizedEntries.push([key, normalizedTopics])
      continue
    }
    sanitizedEntries.push([key, value])
  }

  return Object.fromEntries(sanitizedEntries) as PostContent
}

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasValidLocationCoordinate(value: Record<string, unknown>): boolean {
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

function isEmptyRequiredLocation(value: unknown): boolean {
  if (!isRecord(value)) return true
  const text = String(value.address || value.name || '').trim()
  return !text || !hasValidLocationCoordinate(value)
}

export function validateRequiredWidgets(
  section: Section,
  content: PostContent,
  options: ContentValidationOptions = {}
): void {
  for (const widget of (section.widgets || []) as Widget[]) {
    if (NEVER_IN_POST_CONTENT.has(widget.type)) continue
    if (!isAdminOnlyWidgetEnabled(widget, options)) continue
    if (!widget.required) continue
    const value = content[widget.widgetId]
    if (
      isEmptyValue(value) ||
      (widget.type === 'location' && isEmptyRequiredLocation(value)) ||
      (widget.type === 'rich_note' && isEmptyRichNoteContent(value))
    ) {
      throw new Error(`必填项未填写：${widget.label}`)
    }
  }
}

const VIDEO_SOURCES = new Set([
  'cos',
  'channels_feed',
  'channels_live',
  'miniprogram',
  'h5',
  'app_link',
])

const AUDIO_EXTS = new Set<string>(AUDIO_ALLOWED_EXTS)

function requireText(value: unknown, message: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message)
  }
}

function validateVideoItem(item: unknown, widgetLabel: string, index: number): void {
  const prefix = `视频控件「${widgetLabel || '未命名'}」第 ${index + 1} 条`
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`${prefix}数据格式不正确`)
  }

  const video = item as Record<string, unknown>
  requireText(video.title, `${prefix}标题不能为空`)
  requireText(video.source, `${prefix}来源不能为空`)
  if (!VIDEO_SOURCES.has(String(video.source))) {
    throw new Error(`${prefix}来源不支持`)
  }

  if (video.source === 'cos') {
    requireText(video.fileID, `${prefix}视频文件不能为空`)
  } else if (video.source === 'channels_feed') {
    requireText(video.finderUserName, `${prefix}视频号 ID 不能为空`)
    requireText(video.feedId, `${prefix}视频 ID 不能为空`)
  } else if (video.source === 'channels_live') {
    requireText(video.finderUserName, `${prefix}视频号 ID 不能为空`)
    requireText(video.nonceId, `${prefix}直播 nonceId 不能为空`)
  } else if (video.source === 'miniprogram') {
    requireText(video.appId, `${prefix}小程序 appId 不能为空`)
  } else if (video.source === 'h5' || video.source === 'app_link') {
    requireText(video.url, `${prefix}链接不能为空`)
  }
}

function validatePositiveNumber(value: unknown, message: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(message)
  }
}

function validateAudioTrack(item: unknown, widgetLabel: string, index: number): void {
  const prefix = `音频控件「${widgetLabel || '未命名'}」第 ${index + 1} 条`
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`${prefix}数据格式不正确`)
  }

  const audio = item as Record<string, unknown>
  requireText(audio.title, `${prefix}标题不能为空`)
  requireText(audio.fileID, `${prefix}音频文件不能为空`)
  if (!String(audio.fileID).startsWith('cloud://')) {
    throw new Error(`${prefix}音频文件必须是 cloud:// 文件`)
  }

  if (audio.cover !== undefined && audio.cover !== '') {
    if (typeof audio.cover !== 'string' || !String(audio.cover).startsWith('cloud://')) {
      throw new Error(`${prefix}cover must be a cloud:// file`)
    }
  }

  const ext = String(audio.ext || '').toLowerCase()
  if (!AUDIO_EXTS.has(ext)) {
    throw new Error(`${prefix}格式不支持`)
  }

  validatePositiveNumber(audio.duration, `${prefix}时长不正确`)
  validatePositiveNumber(audio.size, `${prefix}文件大小不正确`)
  if (Number(audio.size) > AUDIO_MAX_SIZE_BYTES) {
    throw new Error(`${prefix}文件不能超过 50MB`)
  }
}

function validateNoteBlock(item: unknown, widgetLabel: string, index: number): void {
  const prefix = `图文笔记控件「${widgetLabel || '未命名'}」第 ${index + 1} 块`
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`${prefix}数据格式不正确`)
  }

  const block = item as Record<string, unknown>
  requireText(block.blockId, `${prefix} blockId 不能为空`)
  if (block.type === 'text') {
    if (typeof block.text !== 'string') {
      throw new Error(`${prefix}文字内容必须是字符串`)
    }
    return
  }
  if (block.type === 'image') {
    requireText(block.fileID, `${prefix}图片不能为空`)
    if (!String(block.fileID).startsWith('cloud://')) {
      throw new Error(`${prefix}图片必须是 cloud:// 文件`)
    }
    return
  }
  throw new Error(`${prefix}类型不支持`)
}

function stripHtmlNoise(html: string): string {
  return html
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, '')
    .trim()
}

function isEmptyRichNoteContent(value: unknown): boolean {
  if (!isRecord(value)) return false
  const markdown = typeof value.markdown === 'string' ? value.markdown.trim() : ''
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const html = typeof value.html === 'string' ? stripHtmlNoise(value.html) : ''
  const imageFileIDs = Array.isArray(value.imageFileIDs) ? value.imageFileIDs.filter(Boolean) : []
  return markdown === '' && text === '' && html === '' && imageFileIDs.length === 0
}

function extractImageSrcs(html: string): string[] {
  const srcs: string[] = []
  const imgPattern = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = imgPattern.exec(html))) {
    srcs.push(match[2])
  }
  return srcs
}

function markdownTokens(markdown: string): any[] {
  return markdownParser.parse(markdown, {})
}

function extractMarkdownImageSrcs(markdown: string): string[] {
  const srcs: string[] = []
  const visit = (tokens: any[]) => {
    for (const token of tokens) {
      if (token.type === 'image') {
        const src = String(token.attrGet?.('src') || '').trim()
        if (src) srcs.push(src)
      }
      if (Array.isArray(token.children)) visit(token.children)
    }
  }
  visit(markdownTokens(markdown))
  return srcs
}

function markdownHasImage(markdown: string): boolean {
  const visit = (tokens: any[]): boolean => {
    for (const token of tokens) {
      if (token.type === 'image') return true
      if ((token.type === 'html_inline' || token.type === 'html_block') && /<\s*img\b/i.test(String(token.content || ''))) {
        return true
      }
      if (Array.isArray(token.children) && visit(token.children)) return true
    }
    return false
  }
  return visit(markdownTokens(markdown))
}

function validateRichNoteContent(value: unknown, widgetLabel: string): void {
  const prefix = `rich_note widget "${widgetLabel || 'untitled'}": `
  if (!isRecord(value)) {
    throw new Error(`${prefix}content must be an object`)
  }
  if (isEmptyRichNoteContent(value)) return

  if (value.format !== 'markdown') {
    throw new Error(`${prefix}format must be markdown`)
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`${prefix}schemaVersion must be 1`)
  }
  if (typeof value.markdown !== 'string') {
    throw new Error(`${prefix}markdown must be a string`)
  }
  if (typeof value.html !== 'string') {
    throw new Error(`${prefix}html must be a string`)
  }
  if (typeof value.text !== 'string') {
    throw new Error(`${prefix}text must be a string`)
  }
  if (!Array.isArray(value.imageFileIDs)) {
    throw new Error(`${prefix}imageFileIDs must be an array`)
  }

  const html = value.html
  const markdown = value.markdown
  if (/<\s*(script|iframe|object|embed)\b/i.test(html) || /<\s*(script|iframe|object|embed)\b/i.test(markdown)) {
    throw new Error(`${prefix}unsafe html tag`)
  }
  if (/\son[a-z]+\s*=/i.test(html) || /javascript\s*:/i.test(html) || /\son[a-z]+\s*=/i.test(markdown) || /javascript\s*:/i.test(markdown)) {
    throw new Error(`${prefix}unsafe html attribute`)
  }

  const imageFileIDs = value.imageFileIDs.map((fileID) => String(fileID || '').trim())
  for (const fileID of imageFileIDs) {
    if (!fileID.startsWith('cloud://')) {
      throw new Error(`${prefix}images must be cloud:// files`)
    }
  }

  const imageSet = new Set(imageFileIDs)
  for (const src of [...extractImageSrcs(html), ...extractMarkdownImageSrcs(markdown)]) {
    if (!src.startsWith('cloud://')) {
      throw new Error(`${prefix}images must be cloud:// files`)
    }
    if (!imageSet.has(src)) {
      throw new Error(`${prefix}images must be listed in imageFileIDs`)
    }
  }
}

function getFixedImageCanvasBodyTemplate(section: Section, widget: Widget): 'guide_note' | 'image_note' | null {
  const isBody = widget.fieldKey === 'body' || widget.label === '正文'
  if (isGuideNoteSection(section) && (widget.widgetId === 'guide_body' || isBody)) return 'guide_note'
  if (isImageNoteSection(section) && (widget.widgetId === 'image_note_body' || isBody)) return 'image_note'
  return null
}

function isTextNoteBodyWidget(section: Section, widget: Widget): boolean {
  if (!isTextNoteSection(section)) return false
  return widget.widgetId === 'text_body' || widget.fieldKey === 'body' || widget.label === '正文'
}

function richNoteHasImages(value: unknown): boolean {
  if (!isRecord(value)) return false
  const imageFileIDs = Array.isArray(value.imageFileIDs) ? value.imageFileIDs.filter(Boolean) : []
  if (imageFileIDs.length > 0) return true
  const markdown = typeof value.markdown === 'string' ? value.markdown : ''
  const html = typeof value.html === 'string' ? value.html : ''
  return (
    /<\s*img\b/i.test(html) ||
    markdownHasImage(markdown) ||
    extractImageSrcs(html).length > 0
  )
}

const HOME_TITLE_WIDGET_TYPES = new Set<WidgetType>([
  'short_text',
  'summary',
  'number',
  'rich_text',
  'rich_note',
])

function normalizeTitleText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (typeof value === 'string') return value.trim()
  if (isRecord(value)) {
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    if (text) return text
    const markdown = typeof value.markdown === 'string' ? value.markdown.replace(/[#*_`>\-\[\]()!]/g, ' ').replace(/\s+/g, ' ').trim() : ''
    if (markdown) return markdown
  }
  return ''
}

function validateRealtimeHomeTitle(section: Section, content: PostContent): void {
  if (section.type !== 'realtime') return
  const titleWidgets = ((section.widgets || []) as Widget[])
    .filter((widget) => HOME_TITLE_WIDGET_TYPES.has(widget.type))
    .sort((a, b) => a.order - b.order)

  if (titleWidgets.length === 0) {
    throw new Error('该板块缺少可用于首页标题的字段，请管理员添加「短文字」或「摘要」控件后再发布')
  }

  const filledWidget = titleWidgets.find((widget) => normalizeTitleText(content[widget.widgetId]) !== '')
  if (!filledWidget) {
    const firstLabel = String(titleWidgets[0]?.label || '标题').trim() || '标题'
    throw new Error(`首页标题不能为空：请填写「${firstLabel}」后再发布`)
  }
}

export function validateContentValues(
  section: Section,
  content: PostContent,
  options: ContentValidationOptions = {}
): void {
  for (const widget of (section.widgets || []) as Widget[]) {
    const value = content[widget.widgetId]
    if (value === undefined || value === null || value === '') continue

    if (widget.type === 'topic') {
      const normalizedTopics = normalizeTopics(value)
      const isCanonical = Array.isArray(value) &&
        value.length === normalizedTopics.length &&
        value.every((topic, index) => topic === normalizedTopics[index])
      if (!isCanonical) {
        throw new Error(`话题控件「${widget.label || '未命名'}」的话题格式未规范化`)
      }
      continue
    }

    if (widget.type === 'note_blocks') {
      if (!Array.isArray(value)) {
        throw new Error(`图文笔记控件「${widget.label || '未命名'}」必须是内容块数组`)
      }
      value.forEach((item, index) => validateNoteBlock(item, widget.label, index))
      continue
    }

    if (widget.type === 'rich_note') {
      const fixedImageCanvasTemplate = getFixedImageCanvasBodyTemplate(section, widget)
      if (fixedImageCanvasTemplate && richNoteHasImages(value)) {
        throw new Error(fixedImageCanvasTemplate === 'guide_note'
          ? '图文攻略正文不支持插入图片，请将图片上传到「封面/图片」'
          : '图文_new 正文不支持插入图片，请将图片上传到「添加图片」')
      }
      if (isTextNoteBodyWidget(section, widget) && richNoteHasImages(value)) {
        throw new Error('纯文字笔记正文不支持插入图片')
      }
      validateRichNoteContent(value, widget.label)
      continue
    }

    if (widget.type === 'location') {
      if (!isRecord(value) || !hasValidLocationCoordinate(value)) {
        throw new Error(`位置控件「${widget.label || '未命名'}」坐标不正确`)
      }
      continue
    }

    if (!isAdminOnlyWidgetEnabled(widget, options)) continue

    if (widget.type === 'video_group') {
      if (!Array.isArray(value)) {
        throw new Error(`视频控件「${widget.label || '未命名'}」必须是视频条目数组`)
      }
      value.forEach((item, index) => validateVideoItem(item, widget.label, index))
    }

    if (widget.type === 'audio_group') {
      if (!Array.isArray(value)) {
        throw new Error(`音频控件「${widget.label || '未命名'}」必须是音频条目数组`)
      }
      value.forEach((item, index) => validateAudioTrack(item, widget.label, index))
    }
  }
  validateRealtimeHomeTitle(section, content)
}
