import { createHash } from 'crypto'
import {
  MAX_MEMBER_VIDEO_BYTES,
  deriveMemberVideoScope,
  inspectRemoteObjectWithFetch,
  requestMemberVideoUpload,
  validateMemberArchiveVideoContent,
} from '../member-video-upload'

const openid = 'member-openid-123'
const scope = createHash('sha256').update(openid, 'utf8').digest('hex').slice(0, 24)
const videoFileID = `cloud://test-env/posts/member-videos/${scope}/clip.mp4`
const coverFileID = `cloud://test-env/posts/member-video-covers/${scope}/cover.jpg`

describe('member video upload authorization', () => {
  test('derives an opaque stable scope and issues member-scoped video metadata', async () => {
    const requestUploadMetadata = jest.fn(async (cloudPath: string) => ({
      cloudPath,
      fileId: `cloud://test-env/${cloudPath}`,
      url: 'https://upload.example',
      token: 'token',
      authorization: 'authorization',
      cosFileId: 'cos-file-id',
    }))

    const result = await requestMemberVideoUpload(
      { kind: 'video', fileName: 'Family.MP4' },
      openid,
      { requestUploadMetadata, now: () => 1234, randomId: () => 'abc123' },
    )

    expect(deriveMemberVideoScope(openid)).toBe(scope)
    expect(scope).not.toContain(openid)
    expect(requestUploadMetadata).toHaveBeenCalledWith(
      `posts/member-videos/${scope}/1234_abc123.mp4`,
    )
    expect(result).toEqual(expect.objectContaining({
      cloudPath: `posts/member-videos/${scope}/1234_abc123.mp4`,
      fileId: `cloud://test-env/posts/member-videos/${scope}/1234_abc123.mp4`,
    }))
  })

  test('issues covers under a separate member-scoped static-image prefix', async () => {
    const requestUploadMetadata = jest.fn(async (cloudPath: string) => ({ cloudPath }))

    await requestMemberVideoUpload(
      { kind: 'cover', fileName: 'Cover.WEBP' },
      openid,
      { requestUploadMetadata: requestUploadMetadata as any, now: () => 5678, randomId: () => 'cover1' },
    )

    expect(requestUploadMetadata).toHaveBeenCalledWith(
      `posts/member-video-covers/${scope}/5678_cover1.webp`,
    )
  })

  test.each([
    ['video', 'clip.exe'],
    ['video', 'clip.jpg'],
    ['cover', 'cover.gif'],
    ['cover', 'cover.mp4'],
  ] as const)('rejects unsupported %s extension before metadata issuance', async (kind, fileName) => {
    const requestUploadMetadata = jest.fn()

    await expect(requestMemberVideoUpload(
      { kind, fileName },
      openid,
      { requestUploadMetadata, now: () => 1, randomId: () => 'x' },
    )).rejects.toThrow('不支持的文件类型')
    expect(requestUploadMetadata).not.toHaveBeenCalled()
  })
})

describe('member archive video object verification', () => {
  function dependencies(metadata: Record<string, { contentLength: number; contentType: string }>) {
    return {
      environmentId: 'test-env',
      getTempUrl: jest.fn(async (fileID: string) => `https://download.example/${encodeURIComponent(fileID)}`),
      inspectRemoteObject: jest.fn(async (url: string) => {
        const fileID = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
        const value = metadata[fileID]
        if (!value) throw new Error('missing metadata')
        return value
      }),
    }
  }

  test('checks actual video and cover metadata from temporary URLs', async () => {
    const deps = dependencies({
      [videoFileID]: { contentLength: MAX_MEMBER_VIDEO_BYTES, contentType: 'video/mp4' },
      [coverFileID]: { contentLength: 10 * 1024 * 1024, contentType: 'image/jpeg' },
    })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID, cover: coverFileID }],
    }, openid, deps)).resolves.toBeUndefined()

    expect(deps.getTempUrl).toHaveBeenCalledTimes(2)
    expect(deps.inspectRemoteObject).toHaveBeenCalledTimes(2)
  })

  test('accepts an actual video/* response for an allowed video extension', async () => {
    const deps = dependencies({
      [videoFileID]: { contentLength: 1024, contentType: 'video/vendor-specific' },
    })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID }],
    }, openid, deps)).resolves.toBeUndefined()
  })

  test('accepts the CloudBase authority form envId.bucket for the current application', async () => {
    const bucketFileID = `cloud://test-env.bucket-name/posts/member-videos/${scope}/clip.mp4`
    const deps = dependencies({
      [bucketFileID]: { contentLength: 1024, contentType: 'video/mp4' },
    })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: bucketFileID }],
    }, openid, deps)).resolves.toBeUndefined()
  })

  test('rejects a file from another member before resolving any URL', async () => {
    const otherScope = deriveMemberVideoScope('another-member')
    const deps = dependencies({})

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: `cloud://test-env/posts/member-videos/${otherScope}/clip.mp4` }],
    }, openid, deps)).rejects.toThrow('视频文件不属于当前用户')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('rejects the same scoped path from another CloudBase environment', async () => {
    const deps = dependencies({})

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: `cloud://other-env.bucket/posts/member-videos/${scope}/clip.mp4` }],
    }, openid, deps)).rejects.toThrow('视频文件不属于当前应用')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test.each([
    [{ contentLength: MAX_MEMBER_VIDEO_BYTES + 1, contentType: 'video/mp4' }, '视频文件不能超过 200MiB'],
    [{ contentLength: 1024, contentType: 'application/pdf' }, '视频文件类型不受支持'],
  ])('rejects untrusted actual video metadata %#', async (actual, message) => {
    const deps = dependencies({ [videoFileID]: actual })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID }],
    }, openid, deps)).rejects.toThrow(message)
  })

  test.each([
    [{ contentLength: 10 * 1024 * 1024 + 1, contentType: 'image/jpeg' }, '封面图片不能超过 10MiB'],
    [{ contentLength: 1024, contentType: 'text/html' }, '封面图片类型不受支持'],
    [{ contentLength: 1024, contentType: 'image/svg+xml' }, '封面图片类型不受支持'],
  ])('rejects untrusted actual cover metadata %#', async (actual, message) => {
    const deps = dependencies({
      [videoFileID]: { contentLength: 1024, contentType: 'video/mp4' },
      [coverFileID]: actual,
    })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID, cover: coverFileID }],
    }, openid, deps)).rejects.toThrow(message)
  })
})

describe('remote object metadata inspection', () => {
  function response(status: number, headers: Record<string, string>) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      body: { cancel: jest.fn(async () => undefined) },
    }
  }

  test('reads size and type with HEAD only when metadata is complete', async () => {
    const fetch = jest.fn(async () => response(200, {
      'content-length': '4096',
      'content-type': 'video/mp4',
    }))

    await expect(inspectRemoteObjectWithFetch('https://download.example/video', fetch))
      .resolves.toEqual({ contentLength: 4096, contentType: 'video/mp4' })
    expect(fetch).toHaveBeenCalledWith('https://download.example/video', expect.objectContaining({ method: 'HEAD' }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('falls back to a one-byte range GET when HEAD metadata is unavailable', async () => {
    const head = response(405, {})
    const get = response(206, {
      'content-range': 'bytes 0-0/8192',
      'content-length': '1',
      'content-type': 'video/webm',
    })
    const fetch = jest.fn()
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(get)

    await expect(inspectRemoteObjectWithFetch('https://download.example/video', fetch))
      .resolves.toEqual({ contentLength: 8192, contentType: 'video/webm' })
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://download.example/video', expect.objectContaining({
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    }))
    expect(get.body.cancel).toHaveBeenCalled()
  })

  test('uses the same bounded GET fallback when the endpoint refuses HEAD', async () => {
    const get = response(206, {
      'content-range': 'bytes 0-0/2048',
      'content-type': 'video/mp4',
    })
    const fetch = jest.fn()
      .mockRejectedValueOnce(new Error('HEAD refused'))
      .mockResolvedValueOnce(get)

    await expect(inspectRemoteObjectWithFetch('https://download.example/video', fetch))
      .resolves.toEqual({ contentLength: 2048, contentType: 'video/mp4' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('does not mistake a 206 range length for the total object size', async () => {
    const fetch = jest.fn()
      .mockResolvedValueOnce(response(405, {}))
      .mockResolvedValueOnce(response(206, {
        'content-length': '1',
        'content-type': 'video/mp4',
      }))

    await expect(inspectRemoteObjectWithFetch('https://download.example/video', fetch))
      .rejects.toThrow('无法确认上传文件元数据')
  })

  test('rejects a server that ignores the bounded Range request', async () => {
    const ignoredRange = response(200, {
      'content-length': String(MAX_MEMBER_VIDEO_BYTES),
      'content-type': 'video/mp4',
    })
    const fetch = jest.fn()
      .mockResolvedValueOnce(response(405, {}))
      .mockResolvedValueOnce(ignoredRange)

    await expect(inspectRemoteObjectWithFetch('https://download.example/video', fetch))
      .rejects.toThrow('不支持安全的分段读取')
    expect(ignoredRange.body.cancel).toHaveBeenCalled()
  })
})
