import { createHash, randomBytes } from 'crypto'
import type { UploadMetadata } from './storage'
import { AUDIO_ALLOWED_EXTS, AUDIO_MAX_SIZE_BYTES, type AudioExt, type AudioTrack } from '../shared/types'
import type { RemoteObjectMetadata } from './member-video-upload'

export const MAX_MEMBER_AUDIO_BYTES = AUDIO_MAX_SIZE_BYTES
export const MAX_MEMBER_AUDIO_COVER_BYTES = 10 * 1024 * 1024

const AUDIO_EXTENSIONS = new Set<string>(AUDIO_ALLOWED_EXTS)
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const AUDIO_CONTENT_TYPES: Record<AudioExt, Set<string>> = {
  mp3: new Set(['audio/mpeg', 'audio/mp3']),
  m4a: new Set(['audio/mp4', 'audio/x-m4a']),
  aac: new Set(['audio/aac', 'audio/x-aac']),
  wav: new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
}
const COVER_CONTENT_TYPES: Record<string, Set<string>> = {
  jpg: new Set(['image/jpeg', 'image/jpg']),
  jpeg: new Set(['image/jpeg', 'image/jpg']),
  png: new Set(['image/png']),
  webp: new Set(['image/webp']),
}

type UploadDependencies = {
  requestUploadMetadata(cloudPath: string): Promise<UploadMetadata>
  now?: () => number
  randomId?: () => string
}

type FinalizationDependencies = {
  requestUploadMetadata(cloudPath: string): Promise<UploadMetadata>
  getTempUrl(fileID: string): Promise<string>
  inspectRemoteObject(url: string): Promise<RemoteObjectMetadata>
  materializeFile(sourceFileID: string, destinationPath: string): Promise<string>
  deleteFile?(fileIDs: string[]): Promise<void>
  now?: () => number
  randomId?: (kind: 'audio' | 'cover', index: number) => string
  existingFinalizedFileIDs?: Partial<Record<'audio' | 'cover', ReadonlySet<string>>>
}

type MemberAudioContent = {
  audios?: AudioTrack[]
}

export function deriveMemberAudioScope(openid: string, communityId: string): string {
  const identity = String(openid || '').trim()
  if (!identity) throw new Error('Missing OPENID')
  const community = String(communityId || '').trim()
  if (!community) throw new Error('communityId 不能为空')
  return createHash('sha256').update(`${community}\u0000${identity}`, 'utf8').digest('hex').slice(0, 24)
}

function extensionOf(fileName: string): string {
  const match = String(fileName || '').trim().match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : ''
}

function directoryFor(kind: 'audio' | 'cover', finalized = false): string {
  if (kind === 'audio') return finalized ? 'member-audios-finalized' : 'member-audios'
  return finalized ? 'member-audio-covers-finalized' : 'member-audio-covers'
}

function allowedExtensions(kind: 'audio' | 'cover'): ReadonlySet<string> {
  return kind === 'audio' ? AUDIO_EXTENSIONS : COVER_EXTENSIONS
}

function ownershipError(kind: 'audio' | 'cover'): string {
  return kind === 'audio' ? '音频文件不属于当前用户' : '封面图片不属于当前用户'
}

function applicationError(kind: 'audio' | 'cover'): string {
  return kind === 'audio' ? '音频文件不属于当前应用' : '封面图片不属于当前应用'
}

export async function requestMemberAudioUpload(
  input: { kind: 'audio' | 'cover'; communityId: string; fileName: string },
  openid: string,
  dependencies: UploadDependencies,
): Promise<UploadMetadata> {
  const extension = extensionOf(input.fileName)
  if (!allowedExtensions(input.kind).has(extension)) throw new Error('不支持的文件类型')
  const scope = deriveMemberAudioScope(openid, input.communityId)
  const now = dependencies.now?.() ?? Date.now()
  const randomId = dependencies.randomId?.() ?? randomBytes(6).toString('hex')
  return dependencies.requestUploadMetadata(
    `posts/${directoryFor(input.kind)}/${scope}/${now}_${randomId}.${extension}`,
  )
}

function cloudFileParts(fileID: string): { path: string } | null {
  const match = String(fileID || '').match(/^cloud:\/\/([^/]+)\/(.+)$/)
  if (!match) return null
  const path = match[2]
  if (path.includes('\\') || /(?:^|\/)\.\.?(?:\/|$)/.test(path) || /%2f|%5c/i.test(path)) return null
  return { path }
}

function ownedObjectPath(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'audio' | 'cover',
  finalized: boolean,
): { cloudPath: string; extension: string } | null {
  const scope = deriveMemberAudioScope(openid, communityId)
  const prefix = `posts/${directoryFor(kind, finalized)}/${scope}/`
  const cloudPath = cloudFileParts(fileID)?.path || ''
  const relativePath = cloudPath.startsWith(prefix) ? cloudPath.slice(prefix.length) : ''
  if (!relativePath || relativePath.includes('/')) return null
  const extension = extensionOf(relativePath)
  if (!allowedExtensions(kind).has(extension)) return null
  return { cloudPath, extension }
}

export function assertOwnedMemberAudioUpload(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'audio' | 'cover',
): { cloudPath: string; extension: string } {
  const owned = ownedObjectPath(fileID, openid, communityId, kind, false)
  if (!owned) throw new Error(ownershipError(kind))
  return owned
}

function normalizedContentType(value: string): string {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

async function verifyObjectAtPath(
  fileID: string,
  cloudPath: string,
  extension: string,
  kind: 'audio' | 'cover',
  dependencies: Pick<FinalizationDependencies, 'requestUploadMetadata' | 'getTempUrl' | 'inspectRemoteObject'>,
): Promise<{ contentLength: number; extension: string }> {
  const expected = await dependencies.requestUploadMetadata(cloudPath)
  if (String(expected?.fileId || '') !== fileID) throw new Error(applicationError(kind))
  const url = await dependencies.getTempUrl(fileID)
  const metadata = await dependencies.inspectRemoteObject(url)
  const contentLength = Number(metadata.contentLength)
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error('无法确认上传文件大小')
  const contentType = normalizedContentType(metadata.contentType)

  if (kind === 'audio') {
    if (contentLength > MAX_MEMBER_AUDIO_BYTES) throw new Error('音频文件不能超过 50MiB')
    if (!AUDIO_CONTENT_TYPES[extension as AudioExt]?.has(contentType)) throw new Error('音频文件类型不受支持')
  } else {
    if (contentLength > MAX_MEMBER_AUDIO_COVER_BYTES) throw new Error('封面图片不能超过 10MiB')
    if (!COVER_CONTENT_TYPES[extension]?.has(contentType)) throw new Error('封面图片类型不受支持')
  }
  return { contentLength, extension }
}

function reusableFinalizedObject(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'audio' | 'cover',
  dependencies: FinalizationDependencies,
): { cloudPath: string; extension: string } | null {
  if (!dependencies.existingFinalizedFileIDs?.[kind]?.has(fileID)) return null
  return ownedObjectPath(fileID, openid, communityId, kind, true)
}

export async function finalizeMemberArchiveAudioContent<T extends MemberAudioContent>(
  content: T,
  openid: string,
  communityId: string,
  dependencies: FinalizationDependencies,
): Promise<{ content: T; createdFileIDs: string[] }> {
  if (!Array.isArray(content?.audios) || content.audios.length === 0) throw new Error('音频内容无效')
  const createdFileIDs: string[] = []
  let artifactIndex = 0

  const materialize = async (fileID: string, kind: 'audio' | 'cover') => {
    const reusable = reusableFinalizedObject(fileID, openid, communityId, kind, dependencies)
    if (reusable) {
      const verified = await verifyObjectAtPath(fileID, reusable.cloudPath, reusable.extension, kind, dependencies)
      return { fileID, created: false, contentLength: verified.contentLength, extension: verified.extension }
    }
    const source = assertOwnedMemberAudioUpload(fileID, openid, communityId, kind)
    const verified = await verifyObjectAtPath(fileID, source.cloudPath, source.extension, kind, dependencies)
    const scope = deriveMemberAudioScope(openid, communityId)
    const now = dependencies.now?.() ?? Date.now()
    const index = artifactIndex++
    const randomId = dependencies.randomId?.(kind, index) ?? randomBytes(12).toString('hex')
    const destination = `posts/${directoryFor(kind, true)}/${scope}/${now}_${randomId}.${source.extension}`
    const finalizedFileID = await dependencies.materializeFile(fileID, destination)
    createdFileIDs.push(finalizedFileID)
    const finalized = await verifyObjectAtPath(finalizedFileID, destination, source.extension, kind, dependencies)
    return { fileID: finalizedFileID, created: true, contentLength: finalized.contentLength, extension: source.extension || verified.extension }
  }

  try {
    const audios: AudioTrack[] = []
    for (const track of content.audios) {
      const finalizedAudio = await materialize(track.fileID, 'audio')
      let cover: string | undefined
      if (track.cover !== undefined) cover = (await materialize(track.cover, 'cover')).fileID
      audios.push({
        title: track.title,
        fileID: finalizedAudio.fileID,
        duration: track.duration,
        size: finalizedAudio.contentLength,
        ext: finalizedAudio.extension as AudioExt,
        ...(cover ? { cover } : {}),
      })
    }
    return { content: { ...content, audios } as T, createdFileIDs: [...createdFileIDs] }
  } catch (error) {
    if (createdFileIDs.length > 0 && dependencies.deleteFile) {
      await dependencies.deleteFile([...createdFileIDs]).catch(() => undefined)
    }
    throw error
  }
}
