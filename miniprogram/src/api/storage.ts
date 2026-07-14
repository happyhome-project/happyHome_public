import { clientLog } from '../utils/client-log'
import { sanitizePerformanceTrace, type PerformanceTrace } from '../utils/performance-trace'

export type StorageUploadProgress = {
  progress: number
  loaded: number
  total: number
}

export type StorageUploadSource = string | Blob

export type StorageTempFile = {
  fileID: string
  tempFileURL: string
}

type UploadOptions = {
  cloudPath: string
  source: StorageUploadSource
  onProgress?: (progress: StorageUploadProgress) => void
  trace?: PerformanceTrace
}

// @ts-ignore wx is injected only by the mini-program runtime.
const wxRuntime: any = typeof wx !== 'undefined' ? wx : undefined

function normalizeProgress(loadedValue: unknown, totalValue: unknown, progressValue?: unknown): StorageUploadProgress {
  const loaded = Number(loadedValue) || 0
  const total = Number(totalValue) || 0
  const calculated = total > 0 ? (loaded / total) * 100 : 0
  const progress = Math.max(0, Math.min(100, Number(progressValue) || calculated))
  return { progress, loaded, total }
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

function safeFileExtension(name: string): string {
  const match = String(name || '').match(/\.([a-z0-9]{1,10})$/i)
  return match ? match[1].toLowerCase() : ''
}

function replaceCloudPathExtension(cloudPath: string, extension: string): string {
  if (!extension) return cloudPath
  const slashIndex = cloudPath.lastIndexOf('/')
  const dotIndex = cloudPath.lastIndexOf('.')
  const stem = dotIndex > slashIndex ? cloudPath.slice(0, dotIndex) : cloudPath
  return `${stem}.${extension}`
}

function normalizeWebCloudPath(cloudPath: string, source: Blob): string {
  const mimeExtension = MIME_EXTENSIONS[String(source.type || '').toLowerCase()]
  if (mimeExtension) return replaceCloudPathExtension(cloudPath, mimeExtension)
  if (!source.type && typeof File !== 'undefined' && source instanceof File) {
    return replaceCloudPathExtension(cloudPath, safeFileExtension(source.name))
  }
  return cloudPath
}

function requireFileID(result: any): { fileID: string } {
  const fileID = String(result?.fileID || '').trim()
  if (!fileID) throw new Error('[storage] upload returned an empty fileID')
  return { fileID }
}

async function resolveWebSource(source: StorageUploadSource): Promise<Blob> {
  if (typeof Blob !== 'undefined' && source instanceof Blob) return source
  if (typeof source === 'string' && source.startsWith('blob:')) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`[storage] failed to read H5 blob URL: ${response.status}`)
    return response.blob()
  }
  throw new Error('[storage] unsupported H5 upload source; expected Blob, File, or blob URL')
}

export async function uploadCloudFile(options: UploadOptions): Promise<{ fileID: string }> {
  const startedAt = Date.now()
  const trace = sanitizePerformanceTrace(options.trace)
  clientLog('debug', 'storage.upload.start', { trace })
  if (wxRuntime?.cloud?.uploadFile) {
    if (typeof options.source !== 'string') {
      throw new Error('[storage] unsupported mini-program upload source; expected a local file path')
    }
    return new Promise((resolve, reject) => {
      const task = wxRuntime.cloud.uploadFile({
        cloudPath: options.cloudPath,
        filePath: options.source,
        success: (result: any) => {
          try {
            const normalized = requireFileID(result)
            clientLog('debug', 'storage.upload.success', {
              durationMs: Date.now() - startedAt,
              requestId: result?.requestId || result?.requestID || '',
              trace,
            })
            resolve(normalized)
          } catch (error) { reject(error) }
        },
        fail: (error: any) => {
          clientLog('error', 'storage.upload.fail', {
            durationMs: Date.now() - startedAt,
            errorCode: error?.errCode || error?.code || '',
            trace,
          })
          reject(error)
        },
      })
      if (options.onProgress && task?.onProgressUpdate) {
        task.onProgressUpdate((event: any) => options.onProgress?.(normalizeProgress(
          event?.totalBytesSent,
          event?.totalBytesExpectedToSend,
          event?.progress,
        )))
      }
    })
  }

  // #ifdef H5
  const filePath = await resolveWebSource(options.source)
  const { uploadFile } = await import('./web-cloudbase')
  const result = await uploadFile({
    cloudPath: normalizeWebCloudPath(options.cloudPath, filePath),
    filePath,
    onUploadProgress: options.onProgress
      ? (event) => options.onProgress?.(normalizeProgress(event?.loaded, event?.total))
      : undefined,
  })
  const normalized = requireFileID(result)
  clientLog('debug', 'storage.upload.success', {
    durationMs: Date.now() - startedAt,
    requestId: (result as any)?.requestId || (result as any)?.requestID || '',
    trace,
  })
  return normalized
  // #endif
}

export async function getCloudTempFileURL(fileIDs: string[]): Promise<StorageTempFile[]> {
  let fileList: any[]
  if (wxRuntime?.cloud?.getTempFileURL) {
    const result: any = await new Promise((resolve, reject) => {
      wxRuntime.cloud.getTempFileURL({ fileList: fileIDs, success: resolve, fail: reject })
    })
    fileList = result?.fileList || []
  } else {
    // #ifdef H5
    const { getTempFileURL } = await import('./web-cloudbase')
    const result = await getTempFileURL(fileIDs)
    fileList = result?.fileList || []
    // #endif
  }
  const entries = new Map(fileList.map((item) => [String(item?.fileID || ''), item]))
  return fileIDs.map((fileID) => {
    const item: any = entries.get(fileID)
    if (!item) throw new Error(`[storage] temporary URL missing for ${fileID}`)
    if (item.code !== undefined && String(item.code).toUpperCase() !== 'SUCCESS') {
      throw new Error(`[storage] temporary URL failed for ${fileID}`)
    }
    const tempFileURL = String(item.tempFileURL || item.download_url || '').trim()
    if (!tempFileURL) throw new Error(`[storage] temporary URL missing for ${fileID}`)
    return { fileID, tempFileURL }
  })
}
