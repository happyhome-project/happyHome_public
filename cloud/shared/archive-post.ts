import type { GeoLocation, RichNoteContent, TextNoteTheme } from './types'
import { normalizeTextNoteTheme } from './text-note-widgets'

export const ARCHIVE_POST_FORMATS = ['image_text', 'text'] as const
export const MAX_ARCHIVE_TOPIC_IDS = 5

export type ArchivePostFormat = typeof ARCHIVE_POST_FORMATS[number]

export interface ArchiveImageTextContent {
  title: string
  images: string[]
  body?: RichNoteContent
  location?: GeoLocation
}

export interface ArchiveTextContent {
  title: string
  body: RichNoteContent
}

export interface ArchivePostPresentation {
  textNoteTheme?: TextNoteTheme
}

export type ArchivePostCreateInput =
  | {
      area: 'archive'
      format: 'image_text'
      topicIds: string[]
      content: ArchiveImageTextContent
      presentation?: never
    }
  | {
      area: 'archive'
      format: 'text'
      topicIds: string[]
      content: ArchiveTextContent
      presentation: ArchivePostPresentation & { textNoteTheme: TextNoteTheme }
    }

export class ArchivePostContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ArchivePostContractError'
  }
}

type PlainObject = Record<string, unknown>

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fail(code: string): never {
  throw new ArchivePostContractError(code)
}

function normalizeTopicIds(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    return fail('archive_topic_ids_invalid')
  }
  const topicIds = [...new Set(value.map((item) => item.trim()))]
  if (topicIds.length > MAX_ARCHIVE_TOPIC_IDS) return fail('archive_topic_limit')
  return topicIds
}

function requireTitle(content: PlainObject): string {
  if (typeof content.title !== 'string' || content.title.trim() === '') return fail('archive_title_required')
  return content.title.trim()
}

function isRichNoteContent(value: unknown): value is RichNoteContent {
  return isPlainObject(value)
    && value.format === 'markdown'
    && typeof value.markdown === 'string'
    && typeof value.html === 'string'
    && typeof value.text === 'string'
    && Array.isArray(value.imageFileIDs)
    && value.imageFileIDs.every((fileID) => typeof fileID === 'string' && fileID.trim() !== '')
    && value.schemaVersion === 1
}

function isGeoLocation(value: unknown): value is GeoLocation {
  if (
    !isPlainObject(value)
    || typeof value.address !== 'string'
    || typeof value.lat !== 'number'
    || !Number.isFinite(value.lat)
    || typeof value.lng !== 'number'
    || !Number.isFinite(value.lng)
  ) return false

  const stringFields = ['name', 'amapPoiId', 'province', 'city', 'district'] as const
  if (stringFields.some((field) => value[field] !== undefined && typeof value[field] !== 'string')) return false
  if (value.adjusted !== undefined && typeof value.adjusted !== 'boolean') return false
  if (value.coordSystem !== undefined && value.coordSystem !== 'gcj02') return false
  if (value.source !== undefined && !['amap', 'wechat', 'manual'].includes(value.source as string)) return false
  return true
}

export function parseArchivePostCreateInput(value: unknown): ArchivePostCreateInput {
  if (!isPlainObject(value) || value.area !== 'archive') return fail('invalid_input')
  if (
    Object.prototype.hasOwnProperty.call(value, 'sectionId')
    && value.sectionId !== undefined
    && value.sectionId !== null
    && value.sectionId !== ''
  ) {
    return fail('archive_section_forbidden')
  }
  if (!ARCHIVE_POST_FORMATS.includes(value.format as ArchivePostFormat)) return fail('archive_format_invalid')

  const topicIds = normalizeTopicIds(value.topicIds)
  if (!isPlainObject(value.content)) return fail('invalid_input')
  const content = value.content
  const title = requireTitle(content)

  if (value.format === 'image_text') {
    if (value.presentation !== undefined) return fail('archive_presentation_invalid')
    if (
      !Array.isArray(content.images)
      || content.images.length === 0
      || content.images.some((image) => typeof image !== 'string' || image.trim() === '')
    ) {
      return fail('archive_images_required')
    }
    if (content.body !== undefined && !isRichNoteContent(content.body)) return fail('archive_body_required')
    if (content.location !== undefined && !isGeoLocation(content.location)) return fail('invalid_input')

    const parsedContent: ArchiveImageTextContent = {
      title,
      images: [...new Set(content.images.map((image) => image.trim()))],
    }
    if (content.body !== undefined) parsedContent.body = content.body
    if (content.location !== undefined) parsedContent.location = content.location
    return { area: 'archive', format: 'image_text', topicIds, content: parsedContent }
  }

  if (!isRichNoteContent(content.body) || content.body.text.trim() === '') {
    return fail('archive_body_required')
  }
  if (content.images !== undefined) {
    if (
      !Array.isArray(content.images)
      || content.images.some((image) => typeof image !== 'string' || image.trim() === '')
    ) return fail('invalid_input')
  }
  if (content.body.imageFileIDs.length > 0 || (Array.isArray(content.images) && content.images.length > 0)) {
    return fail('archive_text_images_forbidden')
  }
  if (value.presentation !== undefined && !isPlainObject(value.presentation)) {
    return fail('archive_presentation_invalid')
  }

  let textNoteTheme: TextNoteTheme
  try {
    textNoteTheme = normalizeTextNoteTheme(value.presentation?.textNoteTheme)
  } catch {
    return fail('archive_presentation_invalid')
  }

  return {
    area: 'archive',
    format: 'text',
    topicIds,
    content: { title, body: content.body },
    presentation: { textNoteTheme },
  }
}
