import type { Section, Widget } from '../../../cloud/shared/types'
import { isImageNoteSectionContract } from './image-note'

function findWidget(widgets: Widget[], widgetId: string): Widget | null {
  return widgets.find((widget) => widget.widgetId === widgetId) || null
}

export function buildImageNoteCreateBlocks(
  section: Pick<Section, 'displayTemplate'> | null | undefined,
  widgets: Widget[],
): Array<Record<string, any>> {
  if (!isImageNoteSectionContract(section, widgets)) return []

  const imageWidget = findWidget(widgets, 'image_note_images')
  const titleWidget = findWidget(widgets, 'image_note_title')
  const bodyWidget = findWidget(widgets, 'image_note_body')
  const topicWidget = findWidget(widgets, 'image_note_topics')
  const locationWidget = findWidget(widgets, 'image_note_location')

  const blocks: Array<Record<string, any>> = []
  if (imageWidget || titleWidget || bodyWidget) {
    blocks.push({
      type: 'imageNoteMain',
      key: 'image-note-main',
      imageWidget,
      titleWidget,
      bodyWidget,
    })
  }
  if (topicWidget || locationWidget) {
    blocks.push({
      type: 'imageNoteTools',
      key: 'image-note-tools',
      topicWidget,
      locationWidget,
    })
  }
  return blocks
}
