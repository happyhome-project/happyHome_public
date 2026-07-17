import { createHash, randomBytes } from 'crypto'
import type { UploadMetadata } from './storage'

export const MAX_MEMBER_VIDEO_BYTES = 200 * 1024 * 1024
export const MAX_MEMBER_VIDEO_COVER_BYTES = 10 * 1024 * 1024

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm'])
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const VIDEO_CONTENT_TYPES: Record<string, Set<string>> = {
  mp4: new Set(['video/mp4']),
  m4v: new Set(['video/mp4', 'video/x-m4v']),
  mov: new Set(['video/quicktime']),
  webm: new Set(['video/webm']),
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

export type RemoteObjectMetadata = {
  contentLength: number
  contentType: string
}

type MetadataFetchResponse = {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body?: { cancel(): Promise<unknown> } | null
}

export type MetadataFetch = (
  url: string,
  init: { method: 'HEAD' | 'GET'; headers?: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<MetadataFetchResponse>

type VerificationDependencies = {
  requestUploadMetadata(cloudPath: string): Promise<UploadMetadata>
  getTempUrl(fileID: string): Promise<string>
  inspectRemoteObject(url: string): Promise<RemoteObjectMetadata>
}

type FinalizationDependencies = VerificationDependencies & {
  materializeFile(sourceFileID: string, destinationPath: string): Promise<string>
  deleteFile?(fileIDs: string[]): Promise<void>
  now?: () => number
  randomId?: (kind: 'video' | 'cover') => string
  existingFinalizedFileIDs?: Partial<Record<'video' | 'cover', ReadonlySet<string>>>
}

type MemberVideoContent = {
  videos?: Array<{
    source?: unknown
    fileID?: unknown
    cover?: unknown
  }>
}

export function deriveMemberVideoScope(openid: string, communityId: string): string {
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

export async function requestMemberVideoUpload(
  input: { kind: 'video' | 'cover'; communityId: string; fileName: string },
  openid: string,
  dependencies: UploadDependencies,
): Promise<UploadMetadata> {
  const extension = extensionOf(input.fileName)
  const allowed = input.kind === 'video' ? VIDEO_EXTENSIONS : COVER_EXTENSIONS
  if (!allowed.has(extension)) throw new Error('不支持的文件类型')

  const scope = deriveMemberVideoScope(openid, input.communityId)
  const directory = input.kind === 'video' ? 'member-videos' : 'member-video-covers'
  const now = dependencies.now?.() ?? Date.now()
  const randomId = dependencies.randomId?.() ?? randomBytes(6).toString('hex')
  const cloudPath = `posts/${directory}/${scope}/${now}_${randomId}.${extension}`
  return dependencies.requestUploadMetadata(cloudPath)
}

function cloudFileParts(fileID: string): { environmentId: string; path: string } | null {
  const match = fileID.match(/^cloud:\/\/([^/]+)\/(.+)$/)
  if (!match) return null
  const environmentId = match[1]
  const path = match[2]
  if (path.includes('\\') || /(?:^|\/)\.\.?(?:\/|$)/.test(path) || /%2f|%5c/i.test(path)) return null
  return { environmentId, path }
}

export function assertOwnedMemberVideoUpload(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'video' | 'cover',
): { cloudPath: string; extension: string } {
  const scope = deriveMemberVideoScope(openid, communityId)
  const directory = kind === 'video' ? 'member-videos' : 'member-video-covers'
  const prefix = `posts/${directory}/${scope}/`
  const parts = cloudFileParts(fileID)
  const cloudPath = parts?.path || ''
  const relativePath = cloudPath.startsWith(prefix) ? cloudPath.slice(prefix.length) : ''
  if (!relativePath || relativePath.includes('/')) {
    throw new Error(kind === 'video' ? '视频文件不属于当前用户' : '封面图片不属于当前用户')
  }
  const extension = extensionOf(relativePath)
  const allowed = kind === 'video' ? VIDEO_EXTENSIONS : COVER_EXTENSIONS
  if (!allowed.has(extension)) {
    throw new Error(kind === 'video' ? '视频文件类型不受支持' : '封面图片类型不受支持')
  }
  return { cloudPath, extension }
}

function isOwnedFinalizedFile(fileID: string, openid: string, communityId: string, kind: 'video' | 'cover'): boolean {
  const scope = deriveMemberVideoScope(openid, communityId)
  const directory = kind === 'video' ? 'member-videos-finalized' : 'member-video-covers-finalized'
  const prefix = `posts/${directory}/${scope}/`
  const path = cloudFileParts(fileID)?.path || ''
  const relativePath = path.startsWith(prefix) ? path.slice(prefix.length) : ''
  if (!relativePath || relativePath.includes('/')) return false
  const extension = extensionOf(relativePath)
  return (kind === 'video' ? VIDEO_EXTENSIONS : COVER_EXTENSIONS).has(extension)
}

function normalizedContentType(value: string): string {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function metadataFromResponse(response: MetadataFetchResponse, allowContentRange: boolean): RemoteObjectMetadata | null {
  const contentType = String(response.headers.get('content-type') || '').trim()
  const range = allowContentRange ? String(response.headers.get('content-range') || '') : ''
  const rangeMatch = range.match(/^bytes\s+0-0\/(\d+)$/i)
  if (allowContentRange && (response.status !== 206 || !rangeMatch)) return null
  const lengthValue = rangeMatch?.[1] || response.headers.get('content-length') || ''
  if (!/^[1-9]\d*$/.test(lengthValue)) return null
  const contentLength = Number(lengthValue)
  if (!contentType || !Number.isSafeInteger(contentLength) || contentLength <= 0) return null
  return { contentLength, contentType }
}

export async function inspectRemoteObjectWithFetch(
  url: string,
  fetchImpl: MetadataFetch,
): Promise<RemoteObjectMetadata> {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase()
  const trustedCosHost = /^[a-z0-9][a-z0-9.-]*\.cos(?:-[a-z0-9-]+|\.[a-z0-9-]+)\.myqcloud\.com$/.test(host)
  const trustedCloudBaseHost = /^[a-z0-9][a-z0-9.-]*\.(?:tcb\.qcloud\.la|cloudbase\.net|tcloudbaseapp\.com)$/.test(host)
  if (parsed.protocol !== 'https:' || (!trustedCosHost && !trustedCloudBaseHost)) {
    throw new Error('临时文件地址无效')
  }

  const signal = AbortSignal.timeout(5_000)
  let head: MetadataFetchResponse | undefined

  try {
    head = await fetchImpl(url, { method: 'HEAD', redirect: 'manual', signal })
  } catch {
    // Some object endpoints reject HEAD; the bounded range request below is the safe fallback.
  }
  if (head && head.status >= 300 && head.status < 400) throw new Error('上传文件地址不允许重定向')
  if (head?.ok) {
    const metadata = metadataFromResponse(head, false)
    if (metadata) return metadata
  }

  const ranged = await fetchImpl(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    redirect: 'manual',
    signal,
  })
  try {
    if (ranged.status >= 300 && ranged.status < 400) throw new Error('上传文件地址不允许重定向')
    if (!ranged.ok) throw new Error(`无法读取上传文件元数据 (${ranged.status})`)
    if (ranged.status !== 206) throw new Error('上传文件地址不支持安全的分段读取')
    const metadata = metadataFromResponse(ranged, true)
    if (!metadata) throw new Error('无法确认上传文件元数据')
    return metadata
  } finally {
    await ranged.body?.cancel().catch(() => undefined)
  }
}

async function verifyObject(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'video' | 'cover',
  dependencies: VerificationDependencies,
): Promise<void> {
  const { cloudPath, extension } = assertOwnedMemberVideoUpload(fileID, openid, communityId, kind)
  await verifyObjectAtPath(fileID, cloudPath, extension, kind, dependencies)
}

async function verifyObjectAtPath(
  fileID: string,
  cloudPath: string,
  extension: string,
  kind: 'video' | 'cover',
  dependencies: VerificationDependencies,
): Promise<void> {
  await assertCanonicalFileID(fileID, cloudPath, kind, dependencies)
  const url = await dependencies.getTempUrl(fileID)
  const metadata = await dependencies.inspectRemoteObject(url)
  const contentLength = Number(metadata.contentLength)
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error('无法确认上传文件大小')

  const contentType = normalizedContentType(metadata.contentType)
  if (kind === 'video') {
    if (contentLength > MAX_MEMBER_VIDEO_BYTES) throw new Error('视频文件不能超过 200MiB')
    if (!VIDEO_CONTENT_TYPES[extension]?.has(contentType)) {
      throw new Error('视频文件类型不受支持')
    }
    return
  }

  if (contentLength > MAX_MEMBER_VIDEO_COVER_BYTES) throw new Error('封面图片不能超过 10MiB')
  if (!contentType.startsWith('image/') || !COVER_CONTENT_TYPES[extension]?.has(contentType)) {
    throw new Error('封面图片类型不受支持')
  }
}

async function assertCanonicalFileID(
  fileID: string,
  cloudPath: string,
  kind: 'video' | 'cover',
  dependencies: Pick<VerificationDependencies, 'requestUploadMetadata'>,
): Promise<void> {
  const expected = await dependencies.requestUploadMetadata(cloudPath)
  if (String(expected?.fileId || '') !== fileID) {
    throw new Error(kind === 'video' ? '视频文件不属于当前应用' : '封面图片不属于当前应用')
  }
}

async function materializeObject(
  fileID: string,
  openid: string,
  communityId: string,
  kind: 'video' | 'cover',
  dependencies: FinalizationDependencies,
): Promise<{ fileID: string; created: boolean }> {
  if (dependencies.existingFinalizedFileIDs?.[kind]?.has(fileID) && isOwnedFinalizedFile(fileID, openid, communityId, kind)) {
    return { fileID, created: false }
  }
  const { cloudPath: sourcePath, extension } = assertOwnedMemberVideoUpload(fileID, openid, communityId, kind)
  await assertCanonicalFileID(fileID, sourcePath, kind, dependencies)
  const scope = deriveMemberVideoScope(openid, communityId)
  const directory = kind === 'video' ? 'member-videos-finalized' : 'member-video-covers-finalized'
  const now = dependencies.now?.() ?? Date.now()
  const randomId = dependencies.randomId?.(kind) ?? randomBytes(12).toString('hex')
  const cloudPath = `posts/${directory}/${scope}/${now}_${randomId}.${extension}`
  const finalizedFileID = await dependencies.materializeFile(fileID, cloudPath)
  await verifyObjectAtPath(finalizedFileID, cloudPath, extension, kind, dependencies)
  return { fileID: finalizedFileID, created: true }
}

export async function finalizeMemberArchiveVideoContent<T extends MemberVideoContent>(
  content: T,
  openid: string,
  communityId: string,
  dependencies: FinalizationDependencies,
): Promise<T> {
  const videos = content?.videos
  if (!Array.isArray(videos) || videos.length !== 1) throw new Error('视频内容无效')
  const video = videos[0]
  if (video?.source !== 'cos' || typeof video.fileID !== 'string') throw new Error('视频内容无效')

  const finalized: string[] = []
  try {
    const finalizedVideo = await materializeObject(video.fileID, openid, communityId, 'video', dependencies)
    const videoFileID = finalizedVideo.fileID
    if (finalizedVideo.created) finalized.push(videoFileID)
    let coverFileID: string | undefined
    if (video.cover !== undefined) {
      if (typeof video.cover !== 'string') throw new Error('封面图片无效')
      const finalizedCover = await materializeObject(video.cover, openid, communityId, 'cover', dependencies)
      coverFileID = finalizedCover.fileID
      if (finalizedCover.created) finalized.push(coverFileID)
    }
    return {
      ...content,
      videos: [{ ...video, fileID: videoFileID, ...(coverFileID ? { cover: coverFileID } : {}) }],
    } as T
  } catch (error) {
    if (finalized.length > 0 && dependencies.deleteFile) {
      await dependencies.deleteFile(finalized).catch(() => undefined)
    }
    throw error
  }
}

export async function validateMemberArchiveVideoContent(
  content: MemberVideoContent,
  openid: string,
  communityId: string,
  dependencies: VerificationDependencies,
): Promise<void> {
  const videos = content?.videos
  if (!Array.isArray(videos) || videos.length !== 1) throw new Error('视频内容无效')
  const video = videos[0]
  if (video?.source !== 'cos' || typeof video.fileID !== 'string') throw new Error('视频内容无效')
  await verifyObject(video.fileID, openid, communityId, 'video', dependencies)
  if (video.cover !== undefined) {
    if (typeof video.cover !== 'string') throw new Error('封面图片无效')
    await verifyObject(video.cover, openid, communityId, 'cover', dependencies)
  }
}
