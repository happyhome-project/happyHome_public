import { AUDIO_ALLOWED_EXTS, AUDIO_MAX_SIZE_BYTES } from '../shared/types'
import type { PostContent, Section, Widget, WidgetType } from '../shared/types'

// 永远不进 post.content 的控件类型（无论 user 还是 admin 路径）：
//   attendance: 用户报名记录写在独立集合
//   admin_notice: 管理员维护的公告内容，挂在 widget 上而非 post 上
export const NEVER_IN_POST_CONTENT: Set<WidgetType> = new Set([
  'attendance',
  'admin_notice',
])

// 普通用户不能编辑、但 admin 代发帖时允许的控件类型：
//   video_group/audio_group: admin 在 admin-web 维护媒体内容后代发帖
export const ADMIN_ONLY_WIDGET_TYPES: Set<WidgetType> = new Set([
  'video_group',
  'audio_group',
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

export function validateContentValues(
  section: Section,
  content: PostContent,
  options: { allowAdminOnly?: boolean } = {}
): void {
  const allowAdminOnly = options.allowAdminOnly === true
  for (const widget of (section.widgets || []) as Widget[]) {
    if (!allowAdminOnly) continue

    const value = content[widget.widgetId]
    if (value === undefined || value === null || value === '') continue

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
}
