import type { Section, Widget } from '../../../cloud/shared/types'

export interface ActivityAnnouncementMainLayout {
  titleWidget: Widget
  bodyWidget: Widget
  remainingWidgets: Widget[]
}

const TITLE_TYPES: Widget['type'][] = ['short_text', 'summary']
const BODY_TYPES: Widget['type'][] = ['rich_text', 'rich_note', 'note_blocks', 'summary']
const TITLE_FIELD_KEYS = new Set(['title', 'activitytitle', 'name', 'activityname'])
const BODY_FIELD_KEYS = new Set(['detail', 'activitydetail', 'body', 'content', 'activitycontent'])
const TITLE_LABELS = new Set(['活动名称', '活动标题', '标题', '名称'])
const BODY_LABELS = new Set(['活动详情', '活动正文', '活动说明', '详情', '正文', '说明'])
const FIELD_SEMANTIC_PARTS = ['title', 'name', 'detail', 'body', 'content']
const LABEL_SEMANTIC_PARTS = ['标题', '名称', '详情', '正文', '说明']

export function resolveActivityAnnouncementMain(
  section: Pick<Section, 'name'>,
  widgets: readonly Widget[],
): ActivityAnnouncementMainLayout | null {
  if (!normalizeLabel(section.name).includes('活动公告')) return null

  const titleIndex = widgets.findIndex((widget) =>
    TITLE_TYPES.includes(widget.type) && isTitleSemantic(widget)
  )
  if (titleIndex < 0) return null

  const bodyCandidates = widgets
    .map((widget, index) => ({ widget, index }))
    .filter(({ widget, index }) => index !== titleIndex && BODY_TYPES.includes(widget.type))
  const bodyCandidate = bodyCandidates.find(({ widget }) => isBodySemantic(widget))
    || bodyCandidates.find(({ widget }) => widget.type !== 'summary' && isNeutralBodyFallback(widget))
    || bodyCandidates.find(({ widget }) => widget.type === 'summary' && isNeutralBodyFallback(widget))
  if (!bodyCandidate) return null

  return {
    titleWidget: widgets[titleIndex],
    bodyWidget: bodyCandidate.widget,
    remainingWidgets: widgets.filter((_, index) =>
      index !== titleIndex && index !== bodyCandidate.index
    ),
  }
}

function isTitleSemantic(widget: Widget): boolean {
  const fieldKey = normalizeKey(widget.fieldKey)
  const label = normalizeLabel(widget.label)
  return TITLE_FIELD_KEYS.has(fieldKey) || TITLE_LABELS.has(label)
}

function isBodySemantic(widget: Widget): boolean {
  const fieldKey = normalizeKey(widget.fieldKey)
  const label = normalizeLabel(widget.label)
  return BODY_FIELD_KEYS.has(fieldKey) || BODY_LABELS.has(label)
}

function isNeutralBodyFallback(widget: Widget): boolean {
  const fieldKey = normalizeKey(widget.fieldKey)
  const label = normalizeLabel(widget.label)
  return !FIELD_SEMANTIC_PARTS.some((item) => fieldKey.includes(item))
    && !LABEL_SEMANTIC_PARTS.some((item) => label.includes(item))
}

function normalizeLabel(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s/g, '').toLowerCase()
}

function normalizeKey(value: string): string {
  return String(value || '').normalize('NFKC').trim().toLowerCase().replace(/[\s._-]+/g, '')
}
