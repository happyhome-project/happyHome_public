export const DEFAULT_WIDGET_LABELS: Record<string, string> = {
  rich_note: '富图文',
  short_text: '短文字',
  summary: '简介',
  datetime: '日期时间',
  number: '数字',
  image_group: '图片组',
  note_blocks: '图文笔记',
  rich_text: '正文',
  location: '位置',
  attendance: '活动参与',
  admin_notice: '公告',
  video_group: '视频列表',
  audio_group: '音频列表',
}

export function isPlaceholderWidgetLabel(label: unknown): boolean {
  const text = String(label || '').trim().toLowerCase()
  return text === '' || text === '新控件' || text === 'new widget'
}

export function resolveWidgetLabel(widget: { type?: string; label?: string }): string {
  const raw = String(widget?.label || '').trim()
  if (!isPlaceholderWidgetLabel(raw)) return raw
  return DEFAULT_WIDGET_LABELS[String(widget?.type || '')] || '内容'
}

export function resolveAttendanceWidgetLabel(widget: { type?: string; label?: string }): string {
  const raw = String(widget?.label || '').trim()
  if (isPlaceholderWidgetLabel(raw)) return ''

  const genericWidgetLabels = Object.keys(DEFAULT_WIDGET_LABELS).map((key) => DEFAULT_WIDGET_LABELS[key])

  return genericWidgetLabels.includes(raw) ? '' : raw
}

export function splitDateTimeValue(value: unknown): { date: string; time: string } {
  const raw = String(value || '').trim()
  if (!raw) return { date: '', time: '' }

  const normalized = raw.replace(' ', 'T')
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (match) {
    return { date: match[1], time: match[2] }
  }

  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return { date, time }
}

export function buildDateTimeValue(date: string, time: string): string {
  const d = String(date || '').trim()
  const t = String(time || '').trim()
  if (!d || !t) return ''
  return `${d}T${t}:00`
}
