import type { Post, Section } from '../../../cloud/shared/types'
import { normalizeTopics } from '../../../cloud/shared/topics'
import {
  isRichNoteEmpty,
  normalizeRichNoteContent,
  type RichNoteContent,
} from './rich-note'

type ImageNoteField = 'images' | 'title' | 'body' | 'topics' | 'location'

type ImageNoteFieldContract = {
  widgetId: string
  fieldKey: ImageNoteField
  type: Section['widgets'][number]['type']
}

export interface ImageNoteLocation {
  name: string
  address: string
  lat: number
  lng: number
}

export interface ImageNoteCard {
  coverImage: string
  images: string[]
  title: string
  authorName: string
  authorAvatarUrl: string
  likeCount: number
  createdAt: string
}

export interface ImageNoteDetail extends ImageNoteCard {
  body: RichNoteContent | null
  topics: string[]
  location: ImageNoteLocation | null
}

const IMAGE_NOTE_FIELDS: Record<ImageNoteField, ImageNoteFieldContract> = {
  images: { widgetId: 'image_note_images', fieldKey: 'images', type: 'image_group' },
  title: { widgetId: 'image_note_title', fieldKey: 'title', type: 'short_text' },
  body: { widgetId: 'image_note_body', fieldKey: 'body', type: 'rich_note' },
  topics: { widgetId: 'image_note_topics', fieldKey: 'topics', type: 'topic' },
  location: { widgetId: 'image_note_location', fieldKey: 'location', type: 'location' },
}

export const IMAGE_NOTE_WIDGET_IDS = Object.freeze([
  IMAGE_NOTE_FIELDS.images.widgetId,
  IMAGE_NOTE_FIELDS.title.widgetId,
  IMAGE_NOTE_FIELDS.body.widgetId,
  IMAGE_NOTE_FIELDS.topics.widgetId,
  IMAGE_NOTE_FIELDS.location.widgetId,
])

type ImageNoteSectionLike = {
  displayTemplate?: unknown
  widgets?: Array<{ widgetId?: unknown }> | null
} | null | undefined

/**
 * During a rolling deployment an older member API can downgrade the new
 * displayTemplate to "default" while still returning the complete namespaced
 * widget contract. The fixed IDs are a safe compatibility signal; section
 * names deliberately are not.
 */
export function isImageNoteSectionContract(
  section: ImageNoteSectionLike,
  widgets: Array<{ widgetId?: unknown }> | null | undefined = section?.widgets,
): boolean {
  if (section?.displayTemplate === 'image_note') return true
  const widgetIds = new Set((widgets || []).map((widget) => String(widget?.widgetId || '').trim()))
  return IMAGE_NOTE_WIDGET_IDS.every((widgetId) => widgetIds.has(widgetId))
}

export function getImageNoteCard(post: Post, section: Section): ImageNoteCard {
  const images = normalizeImages(readImageNoteValue(post, section, IMAGE_NOTE_FIELDS.images))

  return {
    coverImage: images[0] || '',
    images,
    title: normalizeText(readImageNoteValue(post, section, IMAGE_NOTE_FIELDS.title)) || '无标题',
    authorName: normalizeText(post.authorNickname) || '社区邻居',
    authorAvatarUrl: normalizeText(post.authorAvatarUrl),
    likeCount: normalizeCount(post.likeCount),
    createdAt: normalizeText(post.createdAt),
  }
}

export function buildImageNoteDetail(post: Post, section: Section): ImageNoteDetail {
  const bodyValue = readImageNoteValue(post, section, IMAGE_NOTE_FIELDS.body)
  const body = isRichNoteEmpty(bodyValue) ? null : normalizeRichNoteContent(bodyValue)
  const card = getImageNoteCard(post, section)

  return {
    coverImage: card.coverImage,
    images: card.images,
    title: card.title,
    authorName: card.authorName,
    authorAvatarUrl: card.authorAvatarUrl,
    likeCount: card.likeCount,
    createdAt: card.createdAt,
    body,
    topics: normalizeDisplayTopics(readImageNoteValue(post, section, IMAGE_NOTE_FIELDS.topics)),
    location: normalizeLocation(readImageNoteValue(post, section, IMAGE_NOTE_FIELDS.location)),
  }
}

function readImageNoteValue(
  post: Post,
  section: Section,
  contract: ImageNoteFieldContract,
): unknown {
  const content = post.content || {}
  if (Object.prototype.hasOwnProperty.call(content, contract.widgetId)) {
    return content[contract.widgetId]
  }

  if (!isImageNoteSectionContract(section)) return undefined

  const legacyWidget = (section.widgets || [])
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .find((widget) =>
      Object.prototype.hasOwnProperty.call(content, widget.widgetId) &&
      widget.type === contract.type &&
      normalizeFieldKey(widget.fieldKey) === contract.fieldKey
    )

  return legacyWidget ? content[legacyWidget.widgetId] : undefined
}

function normalizeImages(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const images: string[] = []
  value.forEach((item) => {
    if (typeof item !== 'string') return
    const image = item.trim()
    if (image && !images.includes(image)) images.push(image)
  })
  return images
}

function normalizeDisplayTopics(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return []
  try {
    return normalizeTopics(value)
  } catch {
    return []
  }
}

function normalizeLocation(value: unknown): ImageNoteLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const location = value as Record<string, unknown>
  const lat = Number(location.lat)
  const lng = Number(location.lng)
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) return null

  return {
    name: normalizeText(location.name),
    address: normalizeText(location.address),
    lat,
    lng,
  }
}

function normalizeCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFieldKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}
