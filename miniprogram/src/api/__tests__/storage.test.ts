import { afterEach, describe, expect, test, vi } from 'vitest'

const webUploadFile = vi.fn()
const webGetTempFileURL = vi.fn()

vi.mock('../web-cloudbase', () => ({
  uploadFile: webUploadFile,
  getTempFileURL: webGetTempFileURL,
}))

describe('storage API', () => {
  afterEach(() => {
    webUploadFile.mockReset()
    webGetTempFileURL.mockReset()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  test('routes mini-program path uploads through wx.cloud.uploadFile', async () => {
    const uploadTask = { onProgressUpdate: vi.fn() }
    const uploadFile = vi.fn(({ success }) => {
      success({ fileID: 'cloud://env/posts/a.jpg' })
      return uploadTask
    })
    vi.stubGlobal('wx', { cloud: { uploadFile } })
    const onProgress = vi.fn()
    const { uploadCloudFile } = await import('../storage')

    await expect(uploadCloudFile({
      cloudPath: 'posts/a.jpg',
      source: 'wxfile://tmp/a.jpg',
      onProgress,
    })).resolves.toEqual({ fileID: 'cloud://env/posts/a.jpg' })
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      cloudPath: 'posts/a.jpg',
      filePath: 'wxfile://tmp/a.jpg',
    }))
    expect(uploadTask.onProgressUpdate).toHaveBeenCalledWith(expect.any(Function))
    uploadTask.onProgressUpdate.mock.calls[0][0]({ progress: 42, totalBytesSent: 21, totalBytesExpectedToSend: 50 })
    expect(onProgress).toHaveBeenCalledWith({ progress: 42, loaded: 21, total: 50 })
  })

  test('uploads an H5 Blob through the Web SDK and normalizes progress', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    webUploadFile.mockImplementation(async ({ onUploadProgress }) => {
      onUploadProgress({ loaded: 3, total: 5 })
      return { fileID: 'cloud://env/posts/a.txt', requestId: 'r1' }
    })
    const onProgress = vi.fn()
    const { uploadCloudFile } = await import('../storage')

    await expect(uploadCloudFile({ cloudPath: 'posts/a.txt', source: blob, onProgress }))
      .resolves.toEqual({ fileID: 'cloud://env/posts/a.txt' })
    expect(webUploadFile).toHaveBeenCalledWith(expect.objectContaining({
      cloudPath: 'posts/a.txt',
      filePath: blob,
    }))
    expect(onProgress).toHaveBeenCalledWith({ progress: 60, loaded: 3, total: 5 })
  })

  test('uploads an H5 File through the Web SDK without replacing the File object', async () => {
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
    webUploadFile.mockResolvedValue({ fileID: 'cloud://env/avatars/avatar.png', requestId: 'r-file' })
    const { uploadCloudFile } = await import('../storage')

    await expect(uploadCloudFile({ cloudPath: 'avatars/avatar.png', source: file }))
      .resolves.toEqual({ fileID: 'cloud://env/avatars/avatar.png' })
    expect(webUploadFile).toHaveBeenCalledWith(expect.objectContaining({
      cloudPath: 'avatars/avatar.png',
      filePath: file,
    }))
    expect(webUploadFile.mock.calls[0][0].filePath).toBe(file)
  })

  test.each([
    ['image/png', 'posts/image.jpg', 'posts/image.png'],
    ['image/webp', 'posts/image.jpg', 'posts/image.webp'],
  ])('aligns an H5 Blob cloudPath extension with MIME %s', async (type, requestedPath, expectedPath) => {
    const blob = new Blob(['image'], { type })
    webUploadFile.mockResolvedValue({ fileID: `cloud://env/${expectedPath}` })
    const { uploadCloudFile } = await import('../storage')

    await uploadCloudFile({ cloudPath: requestedPath, source: blob })

    expect(webUploadFile).toHaveBeenCalledWith(expect.objectContaining({ cloudPath: expectedPath }))
  })

  test('uses a safe File name extension when MIME is empty', async () => {
    const file = new File(['image'], 'avatar.GIF', { type: '' })
    webUploadFile.mockResolvedValue({ fileID: 'cloud://env/avatars/avatar.gif' })
    const { uploadCloudFile } = await import('../storage')

    await uploadCloudFile({ cloudPath: 'avatars/avatar.jpg', source: file })

    expect(webUploadFile).toHaveBeenCalledWith(expect.objectContaining({ cloudPath: 'avatars/avatar.gif' }))
  })

  test('fetches an H5 blob URL before uploading it through the Web SDK', async () => {
    const blob = new Blob(['image'], { type: 'image/png' })
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetch)
    webUploadFile.mockResolvedValue({ fileID: 'cloud://env/avatars/a.png' })
    const { uploadCloudFile } = await import('../storage')

    await uploadCloudFile({ cloudPath: 'avatars/a.png', source: 'blob:https://example.test/id' })

    expect(fetch).toHaveBeenCalledWith('blob:https://example.test/id')
    expect(webUploadFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: blob }))
  })

  test('normalizes temporary file URLs on mini-program and H5', async () => {
    const getTempFileURL = vi.fn(({ success }) => success({
      fileList: [{ fileID: 'cloud://env/a.mp3', tempFileURL: 'https://mp/a.mp3' }],
    }))
    vi.stubGlobal('wx', { cloud: { getTempFileURL } })
    let storage = await import('../storage')
    await expect(storage.getCloudTempFileURL(['cloud://env/a.mp3'])).resolves.toEqual([
      { fileID: 'cloud://env/a.mp3', tempFileURL: 'https://mp/a.mp3' },
    ])

    vi.unstubAllGlobals()
    vi.resetModules()
    webGetTempFileURL.mockResolvedValue({
      fileList: [{ fileID: 'cloud://env/a.mp3', download_url: 'https://h5/a.mp3' }],
    })
    storage = await import('../storage')
    await expect(storage.getCloudTempFileURL(['cloud://env/a.mp3'])).resolves.toEqual([
      { fileID: 'cloud://env/a.mp3', tempFileURL: 'https://h5/a.mp3' },
    ])
  })

  test('rejects failed and missing temporary file URL entries', async () => {
    webGetTempFileURL.mockResolvedValueOnce({
      fileList: [{ fileID: 'cloud://env/failed.mp3', code: 'STORAGE_ERROR', message: 'internal detail' }],
    })
    const { getCloudTempFileURL } = await import('../storage')

    await expect(getCloudTempFileURL(['cloud://env/failed.mp3']))
      .rejects.toThrow('[storage] temporary URL failed for cloud://env/failed.mp3')

    webGetTempFileURL.mockResolvedValueOnce({ fileList: [] })
    await expect(getCloudTempFileURL(['cloud://env/missing.mp3']))
      .rejects.toThrow('[storage] temporary URL missing for cloud://env/missing.mp3')

    webGetTempFileURL.mockResolvedValueOnce({
      fileList: [{ fileID: 'cloud://env/empty.mp3', code: 'SUCCESS', tempFileURL: '' }],
    })
    await expect(getCloudTempFileURL(['cloud://env/empty.mp3']))
      .rejects.toThrow('[storage] temporary URL missing for cloud://env/empty.mp3')
  })

  test('rejects an upload result without a fileID', async () => {
    webUploadFile.mockResolvedValue({ fileID: '', requestId: 'r-empty' })
    const { uploadCloudFile } = await import('../storage')

    await expect(uploadCloudFile({ cloudPath: 'posts/a.txt', source: new Blob(['a'], { type: 'text/plain' }) }))
      .rejects.toThrow('[storage] upload returned an empty fileID')
  })

  test('rejects unsupported H5 upload sources with a clear error', async () => {
    const { uploadCloudFile } = await import('../storage')

    await expect(uploadCloudFile({ cloudPath: 'posts/a.jpg', source: 'https://example.test/a.jpg' }))
      .rejects.toThrow('[storage] unsupported H5 upload source')
    await expect(uploadCloudFile({ cloudPath: 'posts/a.jpg', source: 42 as any }))
      .rejects.toThrow('[storage] unsupported H5 upload source')
    expect(webUploadFile).not.toHaveBeenCalled()
  })
})
