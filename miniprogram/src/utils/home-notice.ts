const DEFAULT_NOTICE_KIND = '公告'
const MAX_NOTICE_KIND_CHARS = 2

export function normalizeHomeNoticeKind(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return DEFAULT_NOTICE_KIND
  if (Array.from(text).length <= MAX_NOTICE_KIND_CHARS) return text
  if (text.includes('通知')) return '通知'
  if (text.includes('公告')) return '公告'
  if (text.includes('提醒')) return '提醒'
  return DEFAULT_NOTICE_KIND
}
