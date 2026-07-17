import type { VideoItemCos } from '../../../cloud/shared/types'

export const VIDEO_ALLOWED_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'] as const
export const VIDEO_MAX_SIZE_BYTES = 200 * 1024 * 1024

export type PublishMediaType = 'image' | 'video'

export interface ChosenVideo {
  tempFilePath: string
  size: number
  duration: number
  thumbTempFilePath: string
  name: string
  type: 'video'
}

export interface BuildCosVideoItemsOptions {
  fileID: string
  title: string
  cover?: string
  duration?: number
  itemId?: string
  createItemId?: () => string
}

export interface MediaTypeSwitchDecision {
  requiresConfirmation: boolean
  shouldClear: boolean
}

export interface VideoPublishReadinessState {
  uploading: boolean
  videoReady: boolean
  coverPending: boolean
  error?: string
}

export interface VideoPublishReadiness {
  ready: boolean
  reason: '' | 'uploading' | 'video-missing' | 'cover-pending'
}

const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_ALLOWED_EXTENSIONS)
const IMAGE_EXTENSION_SET = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif',
])

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' ? value as Record<string, any> : null
}

function fileNameFromPath(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0]
  const parts = cleanPath.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function fileExtension(nameOrPath: string): string {
  const match = String(nameOrPath || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
  return match ? match[1].toLowerCase() : ''
}

function declaredMediaTypes(file: Record<string, any>, result?: Record<string, any> | null): string[] {
  const aggregateType = String(result?.type || '').trim().toLowerCase()
  return [file.fileType, file.type, aggregateType === 'mix' ? '' : aggregateType]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
}

function classifyDeclaredMediaType(type: string): PublishMediaType | null {
  if (type === 'image' || type.startsWith('image/')) return 'image'
  if (type === 'video' || type.startsWith('video/')) return 'video'
  return null
}

function classifyFile(file: Record<string, any>, result?: Record<string, any> | null): PublishMediaType | null {
  const declarations = declaredMediaTypes(file, result)
  if (declarations.length > 0) {
    const classified = declarations.map(classifyDeclaredMediaType)
    if (classified.some((type) => type === null)) return null
    const mediaTypes = new Set(classified as PublishMediaType[])
    return mediaTypes.size === 1 ? Array.from(mediaTypes)[0] : null
  }

  const extension = fileExtension(String(file.name || file.tempFilePath || file.path || ''))
  if (VIDEO_EXTENSION_SET.has(extension)) return 'video'
  if (IMAGE_EXTENSION_SET.has(extension)) return 'image'
  return null
}

function createDefaultItemId(): string {
  const runtimeCrypto = (globalThis as any)?.crypto
  if (typeof runtimeCrypto?.randomUUID === 'function') return runtimeCrypto.randomUUID()
  return `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeChosenVideo(value: unknown): ChosenVideo {
  const result = asRecord(value)
  const resultTempFiles = result?.tempFiles
  const tempFiles = Array.isArray(resultTempFiles) ? resultTempFiles : []
  if (tempFiles.length !== 1) throw new Error('Please select exactly one video')

  const file = asRecord(tempFiles[0])
  if (!file || classifyFile(file, result) !== 'video') {
    throw new Error('Selected media must be a video')
  }

  const tempFilePath = String(file.tempFilePath || file.path || '').trim()
  if (!tempFilePath) throw new Error('Selected video is missing a local path')

  const name = String(file.name || fileNameFromPath(tempFilePath)).trim()
  const extension = fileExtension(name || tempFilePath)
  if (!VIDEO_EXTENSION_SET.has(extension)) {
    throw new Error(`Selected video uses an unsupported extension: ${extension || 'unknown'}`)
  }

  const size = Number(file.size)
  if (!Number.isFinite(size) || size <= 0) throw new Error('Selected video is empty')
  if (size > VIDEO_MAX_SIZE_BYTES) throw new Error('Selected video exceeds 200 MiB')

  const duration = Number(file.duration)
  return {
    tempFilePath,
    size,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
    thumbTempFilePath: String(file.thumbTempFilePath || '').trim(),
    name,
    type: 'video',
  }
}

export function buildCosVideoItems(options: BuildCosVideoItemsOptions): [VideoItemCos] {
  const fileID = String(options.fileID || '').trim()
  if (!fileID) throw new Error('Video fileID is required')

  const title = String(options.title || '').trim()
  if (!title) throw new Error('Video title is required')
  const itemId = String(options.itemId || options.createItemId?.() || createDefaultItemId()).trim()
  if (!itemId) throw new Error('Video itemId is required')

  const video: VideoItemCos = {
    itemId,
    title,
    source: 'cos',
    fileID,
  }
  const cover = String(options.cover || '').trim()
  if (cover) video.cover = cover
  if (Number.isFinite(options.duration) && Number(options.duration) >= 0) {
    video.duration = Number(options.duration)
  }
  return [video]
}

export function detectFirstMediaType(value: unknown): PublishMediaType | null {
  const result = asRecord(value)
  const resultTempFiles = result?.tempFiles
  const tempFiles = Array.isArray(resultTempFiles) ? resultTempFiles : []
  const firstFile = asRecord(tempFiles[0])
  return firstFile ? classifyFile(firstFile, result) : null
}

export function decideMediaTypeSwitch(
  currentType: PublishMediaType | null | undefined,
  nextType: PublishMediaType | null | undefined,
  hasSelectedMedia: boolean,
): MediaTypeSwitchDecision {
  const changesSelectedType = Boolean(currentType && nextType && currentType !== nextType && hasSelectedMedia)
  return {
    requiresConfirmation: changesSelectedType,
    shouldClear: changesSelectedType,
  }
}

export function resolveVideoPublishReadiness(state: VideoPublishReadinessState): VideoPublishReadiness {
  if (state.uploading) return { ready: false, reason: 'uploading' }
  if (state.coverPending) return { ready: false, reason: 'cover-pending' }
  if (!state.videoReady) return { ready: false, reason: 'video-missing' }
  return { ready: true, reason: '' }
}
