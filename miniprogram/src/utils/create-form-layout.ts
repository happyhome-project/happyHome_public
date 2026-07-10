import type { Section, Widget } from '../../../cloud/shared/types'

export interface ActivityAnnouncementMainLayout {
  titleWidget: Widget
  bodyWidget: Widget
  remainingWidgets: Widget[]
}

const TITLE_TYPES: Widget['type'][] = ['short_text', 'summary']
const BODY_TYPES: Widget['type'][] = ['rich_text', 'rich_note', 'note_blocks', 'summary']

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
    || bodyCandidates[0]
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
  return ['title', 'name'].some((item) => fieldKey.includes(item))
    || ['活动名称', '标题', '名称'].some((item) => label.includes(item))
}

function isBodySemantic(widget: Widget): boolean {
  const fieldKey = normalizeKey(widget.fieldKey)
  const label = normalizeLabel(widget.label)
  return ['detail', 'body', 'content'].some((item) => fieldKey.includes(item))
    || ['详情', '正文', '说明'].some((item) => label.includes(item))
}

function normalizeLabel(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s/g, '').toLowerCase()
}

function normalizeKey(value: string): string {
  return String(value || '').normalize('NFKC').trim().toLowerCase()
}
