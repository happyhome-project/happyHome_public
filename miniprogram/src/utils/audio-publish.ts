import {
  AUDIO_ALLOWED_EXTS,
  AUDIO_MAX_SIZE_BYTES,
  type AudioExt,
  type AudioTrack,
} from '../../../cloud/shared/types'

export type AudioUploadKind = 'audio' | 'cover'
export type AudioOperationStatus = 'idle' | 'pending' | 'uploading' | 'error' | 'ready'
export type AudioOperationEvent = 'retry' | 'start' | 'fail' | 'resolve'

export interface AudioPublishFile {
  source: string | Blob
  name: string
  title: string
  ext: AudioExt
  size: number
}

export interface AudioPublishTrackState {
  id: string
  title: string
  fileID: string
  duration: number | null
  size: number
  ext: AudioExt
  cover?: string
  audioStatus: AudioOperationStatus
  coverStatus: AudioOperationStatus
  audioGeneration?: number
  coverGeneration?: number
}

export interface PendingAudioUpload {
  fileID: string
  kind: AudioUploadKind
  owned: boolean
}

export type AudioPublishReadinessReason =
  | ''
  | 'post-title-missing'
  | 'tracks-missing'
  | 'track-title-missing'
  | 'audio-pending'
  | 'audio-error'
  | 'cover-pending'
  | 'cover-error'

export interface AudioPublishReadiness {
  ready: boolean
  reason: AudioPublishReadinessReason
}

const EXTENSION_SET = new Set<string>(AUDIO_ALLOWED_EXTS)
const AUDIO_MIME_EXTENSIONS: Record<string, AudioExt> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
}

function fileNameFromPath(path: string): string {
  const clean = String(path || '').split(/[?#]/, 1)[0]
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function extensionOf(value: string): string {
  const match = String(value || '').match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
  return match ? match[1].toLowerCase() : ''
}

export function normalizeAudioPublishFile(input: {
  source?: string | Blob
  name?: string
  type?: string
  size?: number
}): AudioPublishFile {
  const source = input?.source
  const isBlobSource = typeof Blob !== 'undefined' && source instanceof Blob
  if (!(typeof source === 'string' ? source.trim() : isBlobSource)) {
    throw new Error('音频缺少本地文件')
  }
  const validSource = source as string | Blob
  const name = String(input.name || (typeof source === 'string' ? fileNameFromPath(source) : '')).trim()
  const ext = extensionOf(name || (typeof source === 'string' ? source : ''))
  if (!EXTENSION_SET.has(ext)) throw new Error('音频仅支持 MP3、M4A、AAC 或 WAV 格式')

  const size = Number(input.size)
  if (!Number.isFinite(size) || size <= 0) throw new Error('音频文件为空')
  if (size > AUDIO_MAX_SIZE_BYTES) throw new Error('单个音频不能超过 50 MiB')

  const mime = String(input.type || '').trim().toLowerCase()
  if (mime && mime !== 'audio' && mime !== 'file' && mime !== 'mix' && mime !== 'all') {
    const mimeExt = AUDIO_MIME_EXTENSIONS[mime]
    if (!mimeExt || mimeExt !== ext) throw new Error('音频 MIME 类型与文件扩展名不一致')
  }

  const title = name.replace(/\.[^.]+$/, '').trim()
  if (!title) throw new Error('无法从文件名生成曲目标题')
  return { source: validSource, name, title, ext: ext as AudioExt, size }
}

export function requirePositiveAudioDuration(value: unknown): number {
  const duration = Number(value)
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取有效音频时长，请重试或移除该曲目')
  return duration
}

export function capturePositiveAudioDurationBeforeCleanup(
  readDuration: () => unknown,
  cleanup: () => void,
): number {
  let duration: unknown
  try {
    duration = readDuration()
  } finally {
    cleanup()
  }
  return requirePositiveAudioDuration(duration)
}

export function updateAudioTrackTitle<T extends AudioPublishTrackState>(
  tracks: readonly T[],
  trackId: string,
  title: string,
): T[] {
  return tracks.map((track) => track.id === trackId ? { ...track, title } : track) as T[]
}

export function moveAudioTrack<T extends AudioPublishTrackState>(
  tracks: readonly T[],
  trackId: string,
  direction: -1 | 1,
): T[] {
  const result = tracks.slice() as T[]
  const index = result.findIndex((track) => track.id === trackId)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= result.length) return result
  const item = result[index]
  result.splice(index, 1)
  result.splice(destination, 0, item)
  return result
}

export function removeAudioTrack<T extends AudioPublishTrackState>(tracks: readonly T[], trackId: string): T[] {
  return tracks.filter((track) => track.id !== trackId) as T[]
}

export function replaceAudioTrackCover<T extends AudioPublishTrackState>(track: T, cover: string): T {
  const normalized = String(cover || '').trim()
  return { ...track, cover: normalized || undefined }
}

export function removeAudioTrackCover<T extends AudioPublishTrackState>(track: T): T {
  const result = { ...track }
  delete result.cover
  return result
}

export function reduceAudioOperationState(
  state: AudioOperationStatus,
  event: AudioOperationEvent,
): AudioOperationStatus {
  if (event === 'retry') return 'pending'
  if (event === 'start') return 'uploading'
  if (event === 'fail') return 'error'
  if (event === 'resolve') return 'ready'
  return state
}

export function isAudioAsyncResultCurrent(
  tracks: readonly AudioPublishTrackState[],
  trackId: string,
  kind: AudioUploadKind,
  generation: number,
  unmounted: boolean,
): boolean {
  if (unmounted) return false
  const track = tracks.find((item) => item.id === trackId)
  if (!track) return false
  return Number(kind === 'audio' ? track.audioGeneration : track.coverGeneration) === generation
}

export function buildAudioTrackOutput(tracks: readonly AudioPublishTrackState[]): AudioTrack[] {
  return tracks.map((track) => {
    const title = String(track.title || '').trim()
    if (!title) throw new Error('请填写曲目标题')
    if (track.audioStatus !== 'ready' || track.coverStatus === 'pending' || track.coverStatus === 'uploading' || track.coverStatus === 'error') {
      throw new Error('音频或封面处理未完成')
    }
    const fileID = String(track.fileID || '').trim()
    if (!fileID) throw new Error('音频上传未完成')
    const output: AudioTrack = {
      title,
      fileID,
      duration: requirePositiveAudioDuration(track.duration),
      size: Number(track.size),
      ext: track.ext,
    }
    const cover = String(track.cover || '').trim()
    if (cover) output.cover = cover
    return output
  })
}

export function collectOwnedPendingAudioUploads(uploads: readonly PendingAudioUpload[]): PendingAudioUpload[] {
  return uploads.filter((upload) => upload.owned && Boolean(String(upload.fileID || '').trim()))
}

export async function cleanupOwnedPendingAudioUploads(
  uploads: readonly PendingAudioUpload[],
  cleanup: (upload: PendingAudioUpload) => Promise<void>,
): Promise<{ cleaned: PendingAudioUpload[]; failed: PendingAudioUpload[] }> {
  const candidates = collectOwnedPendingAudioUploads(uploads)
  const results = await Promise.all(candidates.map(async (upload) => {
    try {
      await cleanup(upload)
      return { upload, cleaned: true as const }
    } catch {
      return { upload, cleaned: false as const }
    }
  }))
  return {
    cleaned: results.filter((result) => result.cleaned).map((result) => result.upload),
    failed: results.filter((result) => !result.cleaned).map((result) => result.upload),
  }
}

export function shouldCleanupPendingAudioAfterSubmit(auditStatus: unknown): boolean {
  return String(auditStatus || 'pass').trim().toLowerCase() !== 'rejected'
}

function isPending(status: AudioOperationStatus): boolean {
  return status === 'pending' || status === 'uploading'
}

export function resolveAudioPublishReadiness(input: {
  postTitle: unknown
  tracks: readonly AudioPublishTrackState[]
}): AudioPublishReadiness {
  if (!String(input.postTitle || '').trim()) return { ready: false, reason: 'post-title-missing' }
  if (input.tracks.length === 0) return { ready: false, reason: 'tracks-missing' }
  if (input.tracks.some((track) => !String(track.title || '').trim())) return { ready: false, reason: 'track-title-missing' }
  if (input.tracks.some((track) => track.audioStatus === 'error')) return { ready: false, reason: 'audio-error' }
  if (input.tracks.some((track) => isPending(track.audioStatus) || track.audioStatus !== 'ready' || !track.fileID || !Number.isFinite(Number(track.duration)) || Number(track.duration) <= 0)) {
    return { ready: false, reason: 'audio-pending' }
  }
  if (input.tracks.some((track) => track.coverStatus === 'error')) return { ready: false, reason: 'cover-error' }
  if (input.tracks.some((track) => isPending(track.coverStatus))) return { ready: false, reason: 'cover-pending' }
  return { ready: true, reason: '' }
}

export function shouldBlockAudioNavigation(tracks: readonly AudioPublishTrackState[]): boolean {
  return tracks.some((track) => (
    track.audioStatus === 'error'
    || isPending(track.audioStatus)
    || track.audioStatus !== 'ready'
    || !Number.isFinite(Number(track.duration))
    || Number(track.duration) <= 0
    || track.coverStatus === 'error'
    || isPending(track.coverStatus)
  ))
}
