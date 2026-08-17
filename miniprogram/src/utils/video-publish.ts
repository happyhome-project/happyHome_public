import type { VideoItemCos } from '../../../cloud/shared/types'
import { AUDIO_ALLOWED_EXTS, AUDIO_MAX_SIZE_BYTES as SHARED_AUDIO_MAX_SIZE_BYTES } from '../../../cloud/shared/types'

export const VIDEO_ALLOWED_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm'] as const
export const VIDEO_MAX_SIZE_BYTES = 200 * 1024 * 1024
export const VIDEO_COVER_MAX_SIZE_BYTES = 10 * 1024 * 1024
export const AUDIO_ALLOWED_EXTENSIONS = AUDIO_ALLOWED_EXTS
export const AUDIO_MAX_SIZE_BYTES = SHARED_AUDIO_MAX_SIZE_BYTES

export type PublishMediaType = 'image' | 'video' | 'audio'

export interface ChosenVideo {
  tempFilePath: string
  size: number
  duration: number
  thumbTempFilePath: string
  name: string
  type: 'video'
}

export interface PlatformThumbnailFile {
  source: string
  name: string
  type: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
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

export type ArchiveMediaEditorFormat = 'image_text' | 'video' | 'audio'

export interface ArchiveMediaEditorState {
  format: ArchiveMediaEditorFormat
  formData: Record<string, unknown>
  initialMedia: unknown
  hasSelectedMedia: boolean
}

export type ArchiveMediaEditorTransition =
  | { status: 'confirm'; state: ArchiveMediaEditorState }
  | { status: 'cancelled'; state: ArchiveMediaEditorState }
  | { status: 'replaced'; state: ArchiveMediaEditorState }
  | { status: 'switched'; state: ArchiveMediaEditorState }

export type ArchiveVideoIntentState = 'idle' | 'selected' | 'pending' | 'failed'
export type ArchiveVideoIntentEvent = 'selected' | 'started' | 'failed' | 'resolved'
export type CoverNavigationEvent = 'selected' | 'failed' | 'resolved' | 'removed' | 'replaced'

export interface ArchiveVideoRetentionState {
  file: unknown
  generation: number
  status: ArchiveVideoIntentState
}

export interface ArchiveVideoRetentionEvent {
  type: 'selected' | 'pending' | 'failed' | 'resolved'
  file: unknown
  generation: number
}

export function reduceCoverNavigationBlock(
  _blocked: boolean,
  event: CoverNavigationEvent,
): boolean {
  return event === 'selected' || event === 'failed'
}

const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_ALLOWED_EXTENSIONS)
const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_ALLOWED_EXTENSIONS)
const AUDIO_MIME_EXTENSION_MAP = new Map<string, string>([
  ['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3'],
  ['audio/mp4', 'm4a'], ['audio/m4a', 'm4a'], ['audio/x-m4a', 'm4a'],
  ['audio/aac', 'aac'], ['audio/x-aac', 'aac'],
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'], ['audio/wave', 'wav'],
])
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

export function buildPlatformThumbnailFile(path: string): PlatformThumbnailFile | null {
  const source = String(path || '').trim()
  if (!source) return null
  const originalName = fileNameFromPath(source)
  const extension = fileExtension(originalName)
  const normalizedExtension = extension === 'png' || extension === 'webp' ? extension : 'jpg'
  const name = extension === normalizedExtension && originalName
    ? originalName
    : 'video-thumbnail.jpg'
  return {
    source,
    name,
    type: normalizedExtension === 'png' ? 'image/png' : (normalizedExtension === 'webp' ? 'image/webp' : 'image/jpeg'),
    // chooseMedia does not report thumbnail size. The upload service verifies the actual object.
    size: 1,
  }
}

function declaredMediaTypes(file: Record<string, any>): string[] {
  return [file.fileType, file.type]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => Boolean(value) && value !== 'file' && value !== 'mix' && value !== 'all')
}

function classifyDeclaredMediaType(type: string): PublishMediaType | null {
  if (type === 'image' || type.startsWith('image/')) return 'image'
  if (type === 'video' || type.startsWith('video/')) return 'video'
  if (type === 'audio' || type.startsWith('audio/')) return 'audio'
  return null
}

function classifyFile(file: Record<string, any>): PublishMediaType | null {
  const declarations = declaredMediaTypes(file)
  const declaredTypes = declarations
    .map(classifyDeclaredMediaType)
    .filter((type): type is PublishMediaType => type !== null)
  const declaredType = new Set(declaredTypes)
  if (declaredType.size > 1) return null
  const extension = fileExtension(String(file.name || file.tempFilePath || file.path || ''))
  const extensionType = VIDEO_EXTENSION_SET.has(extension)
    ? 'video'
    : (AUDIO_EXTENSION_SET.has(extension) ? 'audio' : (IMAGE_EXTENSION_SET.has(extension) ? 'image' : null))
  const typeFromDeclaration = declaredType.values().next().value || null
  const declaredAudioExtensions = declarations
    .filter((type) => type.startsWith('audio/'))
    .map((type) => AUDIO_MIME_EXTENSION_MAP.get(type) || null)
  if (declaredAudioExtensions.some((extension) => extension === null)) return null
  const declaredAudioExtension = new Set(declaredAudioExtensions).values().next().value || null
  if (new Set(declaredAudioExtensions).size > 1) return null
  if (typeFromDeclaration === 'audio' && (extensionType !== 'audio' || (declaredAudioExtension && extension !== declaredAudioExtension))) return null
  if (typeFromDeclaration && extensionType && typeFromDeclaration !== extensionType) return null
  return extensionType || typeFromDeclaration
}

export type MediaSelectionFailure = 'empty' | 'unsupported' | 'mixed' | 'audio-empty' | 'audio-too-large'

export type MediaSelectionInspection =
  | { valid: true; mediaType: PublishMediaType; files: Record<string, any>[] }
  | { valid: false; reason: MediaSelectionFailure }

export function inspectSelectedMedia(value: unknown): MediaSelectionInspection {
  const result = asRecord(value)
  const resultTempFiles = result?.tempFiles
  const tempFiles = Array.isArray(resultTempFiles) ? resultTempFiles : []
  const files = tempFiles.map(asRecord)
  if (files.length === 0 || files.some((file) => !file)) return { valid: false, reason: 'empty' }
  const classified = files.map((file) => classifyFile(file!))
  if (classified.some((mediaType) => !mediaType)) return { valid: false, reason: 'unsupported' }
  const mediaTypes = new Set(classified as PublishMediaType[])
  if (mediaTypes.size !== 1) return { valid: false, reason: 'mixed' }
  const mediaType = mediaTypes.values().next().value as PublishMediaType
  if (mediaType === 'audio') {
    for (const file of files) {
      const size = Number(file!.size)
      if (!Number.isFinite(size) || size <= 0) return { valid: false, reason: 'audio-empty' }
      if (size > AUDIO_MAX_SIZE_BYTES) return { valid: false, reason: 'audio-too-large' }
    }
  }
  return { valid: true, mediaType, files: files as Record<string, any>[] }
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
  if (!file || classifyFile(file) !== 'video') {
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
  const inspection = inspectSelectedMedia(value)
  return inspection.valid ? inspection.mediaType : null
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

export function shouldBlockVideoNavigation(state: { navigationBlocked: boolean; uploading: boolean }): boolean {
  return state.navigationBlocked || state.uploading
}

export function validateVideoCoverFile(file: { name?: string; type?: string; size?: number }): string | null {
  const size = Number(file.size)
  if (!Number.isFinite(size) || size <= 0) return '封面图片为空'
  if (size > VIDEO_COVER_MAX_SIZE_BYTES) return '封面图片不能超过 10 MiB'
  const extension = fileExtension(String(file.name || ''))
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp'])
  if (!allowed.has(extension)) return '封面仅支持 JPG、PNG 或 WebP 格式'
  const mime = String(file.type || '').toLowerCase()
  if (mime && mime !== 'image') {
    const expected = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
    if (mime !== expected) return '封面 MIME 类型与文件扩展名不一致'
  }
  return null
}

export function transitionArchiveMediaEditorState(
  state: ArchiveMediaEditorState,
  nextType: PublishMediaType,
  confirmation: boolean | null,
): ArchiveMediaEditorTransition {
  const currentType: PublishMediaType = state.format === 'video' ? 'video' : (state.format === 'audio' ? 'audio' : 'image')
  if (currentType === nextType) return { status: 'replaced', state }
  const decision = decideMediaTypeSwitch(currentType, nextType, state.hasSelectedMedia)
  if (decision.requiresConfirmation && confirmation === null) return { status: 'confirm', state }
  if (decision.requiresConfirmation && confirmation === false) return { status: 'cancelled', state }
  return {
    status: 'switched',
    state: {
      format: nextType === 'video' ? 'video' : (nextType === 'audio' ? 'audio' : 'image_text'),
      formData: {},
      initialMedia: null,
      hasSelectedMedia: false,
    },
  }
}

export function hasValidUploadedVideo(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 1) return false
  const item = asRecord(value[0])
  return Boolean(item && item.source === 'cos' && String(item.fileID || '').trim())
}

export function shouldConsumeInitialVideo(
  modelValue: unknown,
  initialFile: unknown,
  alreadyAcknowledged: boolean,
  intentState: ArchiveVideoIntentState = 'selected',
): boolean {
  return Boolean(initialFile) && !alreadyAcknowledged && intentState === 'selected' && !hasValidUploadedVideo(modelValue)
}

export function reduceArchiveVideoIntentState(
  _state: ArchiveVideoIntentState,
  event: ArchiveVideoIntentEvent,
): ArchiveVideoIntentState {
  if (event === 'selected') return 'selected'
  if (event === 'started') return 'pending'
  if (event === 'failed') return 'failed'
  return 'idle'
}

export function isVideoUploadResultCurrent(
  operationGeneration: number,
  currentGeneration: number,
  unmounted: boolean,
): boolean {
  return !unmounted && operationGeneration === currentGeneration
}

export function reduceArchiveVideoRetention(
  state: ArchiveVideoRetentionState,
  event: ArchiveVideoRetentionEvent,
): ArchiveVideoRetentionState {
  if (event.type === 'selected') {
    return { file: event.file, generation: event.generation, status: 'selected' }
  }
  if (event.generation !== state.generation) return state
  if (event.type === 'pending') return { file: state.file, generation: state.generation, status: 'pending' }
  if (event.type === 'failed') return { file: state.file, generation: state.generation, status: 'failed' }
  return { file: null, generation: state.generation, status: 'idle' }
}
