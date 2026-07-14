import { normalizeGuideNoteSection } from './guide-note-widgets'
import { normalizeImageNoteSection } from './image-note-widgets'
import { normalizeTextNoteSection } from './text-note-widgets'
import type { Widget } from './types'

export function normalizeSectionTemplates<
  T extends { displayTemplate?: unknown; widgets?: Widget[] } | null | undefined,
>(section: T): T {
  return normalizeTextNoteSection(normalizeImageNoteSection(normalizeGuideNoteSection(section)))
}
