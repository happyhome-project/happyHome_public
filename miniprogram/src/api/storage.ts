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
  if (wxRuntime?.cloud?.uploadFile) {
    if (typeof options.source !== 'string') {
      throw new Error('[storage] unsupported mini-program upload source; expected a local file path')
    }
    return new Promise((resolve, reject) => {
      const task = wxRuntime.cloud.uploadFile({
        cloudPath: options.cloudPath,
        filePath: options.source,
        success: (result: any) => resolve({ fileID: String(result?.fileID || '') }),
        fail: reject,
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
    cloudPath: options.cloudPath,
    filePath,
    onUploadProgress: options.onProgress
      ? (event) => options.onProgress?.(normalizeProgress(event?.loaded, event?.total))
      : undefined,
  })
  return { fileID: String(result?.fileID || '') }
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
  return fileList.map((item) => ({
    fileID: String(item?.fileID || ''),
    tempFileURL: String(item?.tempFileURL || item?.download_url || ''),
  }))
}
