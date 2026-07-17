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

type MemberVideoContent = {
  videos?: Array<{
    source?: unknown
    fileID?: unknown
    cover?: unknown
  }>
}

export function deriveMemberVideoScope(openid: string): string {
  const identity = String(openid || '').trim()
  if (!identity) throw new Error('Missing OPENID')
  return createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 24)
}

function extensionOf(fileName: string): string {
  const match = String(fileName || '').trim().match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1].toLowerCase() : ''
}

export async function requestMemberVideoUpload(
  input: { kind: 'video' | 'cover'; fileName: string },
  openid: string,
  dependencies: UploadDependencies,
): Promise<UploadMetadata> {
  const extension = extensionOf(input.fileName)
  const allowed = input.kind === 'video' ? VIDEO_EXTENSIONS : COVER_EXTENSIONS
  if (!allowed.has(extension)) throw new Error('不支持的文件类型')

  const scope = deriveMemberVideoScope(openid)
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

function assertOwnedFile(
  fileID: string,
  openid: string,
  kind: 'video' | 'cover',
): { cloudPath: string; extension: string } {
  const scope = deriveMemberVideoScope(openid)
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
  kind: 'video' | 'cover',
  dependencies: VerificationDependencies,
): Promise<void> {
  const { cloudPath, extension } = assertOwnedFile(fileID, openid, kind)
  const expected = await dependencies.requestUploadMetadata(cloudPath)
  if (String(expected?.fileId || '') !== fileID) {
    throw new Error(kind === 'video' ? '视频文件不属于当前应用' : '封面图片不属于当前应用')
  }
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

export async function validateMemberArchiveVideoContent(
  content: MemberVideoContent,
  openid: string,
  dependencies: VerificationDependencies,
): Promise<void> {
  const videos = content?.videos
  if (!Array.isArray(videos) || videos.length !== 1) throw new Error('视频内容无效')
  const video = videos[0]
  if (video?.source !== 'cos' || typeof video.fileID !== 'string') throw new Error('视频内容无效')
  await verifyObject(video.fileID, openid, 'video', dependencies)
  if (video.cover !== undefined) {
    if (typeof video.cover !== 'string') throw new Error('封面图片无效')
    await verifyObject(video.cover, openid, 'cover', dependencies)
  }
}
