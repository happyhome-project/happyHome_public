import type { GeoLocation, RichNoteContent, TextNoteTheme, VideoItemCos } from './types'
import { normalizeTextNoteTheme } from './text-note-widgets'
import { normalizeTopics } from './topics'

export const ARCHIVE_POST_FORMATS = ['image_text', 'text', 'video'] as const

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

export interface ArchiveVideoContent {
  title: string
  body?: RichNoteContent
  videos: [VideoItemCos]
  location?: GeoLocation
}

export interface ArchivePostPresentation {
  textNoteTheme?: TextNoteTheme
}

export type ArchivePostCreateInput =
  | {
      area: 'archive'
      format: 'image_text'
      topics: string[]
      content: ArchiveImageTextContent
      presentation?: never
    }
  | {
      area: 'archive'
      format: 'text'
      topics: string[]
      content: ArchiveTextContent
      presentation: ArchivePostPresentation & { textNoteTheme: TextNoteTheme }
    }
  | {
      area: 'archive'
      format: 'video'
      topics: string[]
      content: ArchiveVideoContent
      presentation?: never
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

function parseTopics(value: unknown): string[] {
  try {
    return normalizeTopics(value === undefined ? [] : value)
  } catch (error) {
    if (error instanceof Error && error.message.includes('最多添加')) return fail('archive_topic_limit')
    return fail('archive_topics_invalid')
  }
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

function parseCosVideo(value: unknown): VideoItemCos {
  if (
    !isPlainObject(value)
    || value.source !== 'cos'
    || typeof value.itemId !== 'string'
    || value.itemId.trim() === ''
    || typeof value.title !== 'string'
    || value.title.trim() === ''
    || typeof value.fileID !== 'string'
    || value.fileID.trim() === ''
    || (value.cover !== undefined && (typeof value.cover !== 'string' || value.cover.trim() === ''))
    || (value.duration !== undefined && (typeof value.duration !== 'number' || !Number.isFinite(value.duration)))
    || (value.description !== undefined && typeof value.description !== 'string')
    || (value.allowDownload !== undefined && typeof value.allowDownload !== 'boolean')
    || (value.allowShare !== undefined && typeof value.allowShare !== 'boolean')
  ) return fail('archive_video_invalid')

  const video: VideoItemCos = {
    source: 'cos',
    itemId: value.itemId.trim(),
    title: value.title.trim(),
    fileID: value.fileID.trim(),
  }
  if (value.cover !== undefined) video.cover = value.cover.trim()
  if (value.duration !== undefined) video.duration = value.duration
  if (value.description !== undefined) video.description = value.description.trim()
  if (value.allowDownload !== undefined) video.allowDownload = value.allowDownload
  if (value.allowShare !== undefined) video.allowShare = value.allowShare
  return video
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

  if (Object.prototype.hasOwnProperty.call(value, 'topicIds')) return fail('archive_topics_invalid')
  const topics = parseTopics(value.topics)
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
    return { area: 'archive', format: 'image_text', topics, content: parsedContent }
  }

  if (value.format === 'video') {
    if (value.presentation !== undefined) return fail('archive_presentation_invalid')
    const allowedContentFields = new Set(['title', 'body', 'videos', 'location'])
    if (Object.keys(content).some((field) => !allowedContentFields.has(field))) return fail('invalid_input')
    if (!Array.isArray(content.videos) || content.videos.length !== 1) {
      return fail('archive_videos_required')
    }
    if (content.body !== undefined && !isRichNoteContent(content.body)) return fail('archive_body_required')
    if (content.location !== undefined && !isGeoLocation(content.location)) return fail('invalid_input')

    const parsedContent: ArchiveVideoContent = {
      title,
      videos: [parseCosVideo(content.videos[0])],
    }
    if (content.body !== undefined) parsedContent.body = content.body
    if (content.location !== undefined) parsedContent.location = content.location
    return { area: 'archive', format: 'video', topics, content: parsedContent }
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
    topics,
    content: { title, body: content.body },
    presentation: { textNoteTheme },
  }
}
