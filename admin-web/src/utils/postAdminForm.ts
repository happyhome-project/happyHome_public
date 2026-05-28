import { ElMessage } from 'element-plus'

export const ADMIN_POST_EDITABLE_WIDGET_TYPES = new Set([
  'short_text',
  'summary',
  'number',
  'datetime',
  'rich_text',
  'note_blocks',
  'video_group',
  'audio_group',
])

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav'])
const AUDIO_MAX_BYTES = 50 * 1024 * 1024

export function isAdminPostEditableWidget(widget: any) {
  return ADMIN_POST_EDITABLE_WIDGET_TYPES.has(String(widget?.type || ''))
}

export function editableWidgetsFor(section: any) {
  return ((section?.widgets || []) as any[]).filter(isAdminPostEditableWidget)
}

export function unsupportedContentWidgetsFor(section: any) {
  return ((section?.widgets || []) as any[]).filter((widget) => {
    const type = String(widget?.type || '')
    return !isAdminPostEditableWidget(widget) && !['attendance', 'admin_notice'].includes(type)
  })
}

export function widgetHint(type: string) {
  if (type === 'video_group') return '由管理员上传 / 配置视频列表'
  if (type === 'audio_group') return '由管理员上传 / 配置音频列表'
  if (type === 'note_blocks') return '按顺序添加文字和图片，适合家书、笔记、课程材料'
  if (type === 'attendance') return '活动参与控件由成员点击参与产生数据，不在帖子内容中填写'
  return ''
}

export function createDefaultVideoItem(itemId: string) {
  return {
    itemId,
    source: 'cos',
    title: '',
    duration: undefined,
    description: '',
    cover: '',
    fileID: '',
    allowDownload: false,
    allowShare: false,
  }
}

export function hydrateAdminPostFormData(formData: Record<string, any>, widgets: any[], content: Record<string, any> = {}) {
  Object.keys(formData).forEach((key) => delete formData[key])
  for (const widget of widgets) {
    const existing = content?.[widget.widgetId]
    if (existing !== undefined) {
      formData[widget.widgetId] = JSON.parse(JSON.stringify(existing))
    } else if (widget.type === 'video_group' || widget.type === 'audio_group' || widget.type === 'note_blocks') {
      formData[widget.widgetId] = []
    } else if (widget.type === 'number') {
      formData[widget.widgetId] = 0
    } else {
      formData[widget.widgetId] = ''
    }
  }
}

export function validateAdminPostForm(widgets: any[], formData: Record<string, any>) {
  for (const widget of widgets) {
    if (widget.required && isEmptyValue(formData[widget.widgetId])) {
      ElMessage.error(`请填写「${widget.label}」`)
      return false
    }
    if (widget.type === 'video_group' && !validateVideoItems(widget, formData)) return false
    if (widget.type === 'audio_group' && !validateAudioItems(widget, formData)) return false
    if (widget.type === 'note_blocks' && !validateNoteBlocks(widget, formData)) return false
  }
  return true
}

export function formatReadonlyContentValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0 ? `共 ${value.length} 项` : '空'
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value || '空')
}

function isEmptyValue(value: unknown) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

function validateVideoItems(widget: any, formData: Record<string, any>) {
  const list = (formData[widget.widgetId] as any[]) || []
  for (const [index, item] of list.entries()) {
    if (!item.title) return fail(widget, index, '视频标题为空')
    if (item.source === 'cos' && !item.fileID) return fail(widget, index, '视频文件未上传')
    if (item.source === 'channels_feed' && (!item.finderUserName || !item.feedId)) return fail(widget, index, '视频号 feed 信息不全')
    if (item.source === 'channels_live' && (!item.finderUserName || !item.nonceId)) return fail(widget, index, '视频号直播信息不全')
    if (item.source === 'miniprogram' && !item.appId) return fail(widget, index, '小程序 appId 为空')
    if ((item.source === 'h5' || item.source === 'app_link') && !item.url) return fail(widget, index, 'URL 为空')
  }
  return true
}

function validateAudioItems(widget: any, formData: Record<string, any>) {
  const list = (formData[widget.widgetId] as any[]) || []
  for (const [index, item] of list.entries()) {
    if (!item.title) return fail(widget, index, '音频标题为空')
    if (!item.fileID) return fail(widget, index, '音频文件未上传')
    if (!String(item.fileID).startsWith('cloud://')) return fail(widget, index, '音频文件格式不正确')
    if (item.cover && !String(item.cover).startsWith('cloud://')) return fail(widget, index, '系统播放卡片图片格式不正确')
    if (!AUDIO_EXTS.has(String(item.ext || '').toLowerCase())) return fail(widget, index, '音频格式不支持')
    if (!Number.isFinite(Number(item.duration)) || Number(item.duration) <= 0) return fail(widget, index, '音频时长不正确')
    if (!Number.isFinite(Number(item.size)) || Number(item.size) <= 0 || Number(item.size) > AUDIO_MAX_BYTES) return fail(widget, index, '音频大小不正确')
  }
  return true
}

function validateNoteBlocks(widget: any, formData: Record<string, any>) {
  const list = (formData[widget.widgetId] as any[]) || []
  for (const [index, item] of list.entries()) {
    if (!item?.blockId) return fail(widget, index, '内容块缺少 blockId')
    if (item.type === 'text') {
      if (typeof item.text !== 'string') return fail(widget, index, '文字内容不正确')
      continue
    }
    if (item.type === 'image') {
      if (!String(item.fileID || '').startsWith('cloud://')) return fail(widget, index, '图片未上传成功')
      continue
    }
    return fail(widget, index, '内容块类型不支持')
  }
  return true
}

function fail(widget: any, index: number, message: string) {
  ElMessage.error(`「${widget.label}」第 ${index + 1} 项${message}`)
  return false
}
