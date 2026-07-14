export type PerformanceSample = 'cold' | 'warm'

export type PerformanceTrace = {
  requestId: string
  stage: string
  sample?: PerformanceSample
  counts?: Record<string, number>
}

const SAFE_TEXT = /[^a-zA-Z0-9._:/-]/g

function safeText(value: unknown, maxLength: number): string {
  return String(value || '').trim().replace(SAFE_TEXT, '').slice(0, maxLength)
}

export function sanitizePerformanceTrace(value: unknown): PerformanceTrace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, any>
  const requestId = safeText(source.requestId, 80)
  const stage = safeText(source.stage, 80)
  if (!requestId || !stage) return undefined

  const result: PerformanceTrace = { requestId, stage }
  if (source.sample === 'cold' || source.sample === 'warm') result.sample = source.sample

  if (source.counts && typeof source.counts === 'object') {
    const counts: Record<string, number> = {}
    for (const rawKey of Object.keys(source.counts)) {
      const rawValue = source.counts[rawKey]
      const key = safeText(rawKey, 40)
      const value = Number(rawValue)
      if (!key || !Number.isFinite(value) || value < 0) continue
      counts[key] = Math.round(value)
    }
    if (Object.keys(counts).length > 0) result.counts = counts
  }
  return result
}

export function createPerformanceRequestId(prefix = 'perf'): string {
  const safePrefix = safeText(prefix, 24) || 'perf'
  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createLatestEpoch() {
  let current = 0
  return {
    begin() { current += 1; return current },
    isCurrent(epoch: number) { return epoch === current },
    invalidate() { current += 1 },
  }
}

type AvatarUploadResult = { fileID: string }

type AdaptiveAvatarUploaderDependencies = {
  getSize: (source: string) => Promise<number>
  compress: (source: string, quality: number) => Promise<string>
  upload: (source: string) => Promise<AvatarUploadResult>
  now?: () => number
}

export const AVATAR_COMPRESS_SIZE_BYTES = 512 * 1024
export const AVATAR_SLOW_UPLOAD_MS = 800
export const AVATAR_COMPRESS_QUALITY = 80

/**
 * Learns from a slow large upload without creating a second successful object.
 * Compression is used on a later upload, or as the retry after a slow failure.
 */
export function createAdaptiveAvatarUploader(dependencies: AdaptiveAvatarUploaderDependencies) {
  const now = dependencies.now || Date.now
  let preferCompressed = false

  async function compressOrOriginal(source: string): Promise<string> {
    try {
      return await dependencies.compress(source, AVATAR_COMPRESS_QUALITY)
    } catch (_error) {
      return source
    }
  }

  return {
    async upload(source: string): Promise<AvatarUploadResult> {
      const size = await dependencies.getSize(source).catch(() => 0)
      const isLarge = size > AVATAR_COMPRESS_SIZE_BYTES

      if (preferCompressed && isLarge) {
        return dependencies.upload(await compressOrOriginal(source))
      }

      const startedAt = now()
      try {
        const result = await dependencies.upload(source)
        if (isLarge && now() - startedAt > AVATAR_SLOW_UPLOAD_MS) preferCompressed = true
        return result
      } catch (error) {
        const wasSlow = now() - startedAt > AVATAR_SLOW_UPLOAD_MS
        if (!isLarge || !wasSlow) throw error
        preferCompressed = true
        return dependencies.upload(await compressOrOriginal(source))
      }
    },
  }
}
