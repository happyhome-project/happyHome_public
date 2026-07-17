import { createHash } from 'crypto'
import {
  MAX_MEMBER_VIDEO_BYTES,
  deriveMemberVideoScope,
  finalizeMemberArchiveVideoContent,
  inspectRemoteObjectWithFetch,
  requestMemberVideoUpload,
  validateMemberArchiveVideoContent,
} from '../member-video-upload'

const openid = 'member-openid-123'
const communityId = 'community-1'
const scope = createHash('sha256').update(`${communityId}\u0000${openid}`, 'utf8').digest('hex').slice(0, 24)
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
      { kind: 'video', communityId, fileName: 'Family.MP4' },
      openid,
      { requestUploadMetadata, now: () => 1234, randomId: () => 'abc123' },
    )

    expect(deriveMemberVideoScope(openid, communityId)).toBe(scope)
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
      { kind: 'cover', communityId, fileName: 'Cover.WEBP' },
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
      { kind, communityId, fileName },
      openid,
      { requestUploadMetadata, now: () => 1, randomId: () => 'x' },
    )).rejects.toThrow('不支持的文件类型')
    expect(requestUploadMetadata).not.toHaveBeenCalled()
  })
})

describe('member archive video object verification', () => {
  function dependencies(
    metadata: Record<string, { contentLength: number; contentType: string }>,
    canonicalAuthority = 'test-env',
  ) {
    return {
      environmentId: 'test-env',
      requestUploadMetadata: jest.fn(async (cloudPath: string) => ({
        cloudPath,
        fileId: `cloud://${canonicalAuthority}/${cloudPath}`,
        url: '', token: '', authorization: '', cosFileId: '',
      })),
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
    }, openid, communityId, deps)).resolves.toBeUndefined()

    expect(deps.getTempUrl).toHaveBeenCalledTimes(2)
    expect(deps.inspectRemoteObject).toHaveBeenCalledTimes(2)
  })

  test.each([
    ['clip.mp4', 'video/mp4'],
    ['clip.m4v', 'video/x-m4v'],
    ['clip.m4v', 'video/mp4'],
    ['clip.mov', 'video/quicktime'],
    ['clip.webm', 'video/webm'],
  ])('accepts %s only with its allowlisted MIME %s', async (fileName, contentType) => {
    const fileID = `cloud://test-env/posts/member-videos/${scope}/${fileName}`
    const deps = dependencies({ [fileID]: { contentLength: 1024, contentType } })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID }],
    }, openid, communityId, deps)).resolves.toBeUndefined()
  })

  test('accepts the CloudBase authority form envId.bucket for the current application', async () => {
    const bucketFileID = `cloud://test-env.bucket-name/posts/member-videos/${scope}/clip.mp4`
    const deps = dependencies({
      [bucketFileID]: { contentLength: 1024, contentType: 'video/mp4' },
    }, 'test-env.bucket-name')

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: bucketFileID }],
    }, openid, communityId, deps)).resolves.toBeUndefined()
  })

  test('rejects a file from another member before resolving any URL', async () => {
    const otherScope = deriveMemberVideoScope('another-member', communityId)
    const deps = dependencies({})

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: `cloud://test-env/posts/member-videos/${otherScope}/clip.mp4` }],
    }, openid, communityId, deps)).rejects.toThrow('视频文件不属于当前用户')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('rejects the same member upload when it was authorized for another community', async () => {
    const otherCommunityScope = deriveMemberVideoScope(openid, 'community-2')
    const deps = dependencies({})

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: `cloud://test-env/posts/member-videos/${otherCommunityScope}/clip.mp4` }],
    }, openid, communityId, deps)).rejects.toThrow('视频文件不属于当前用户')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('rejects the same scoped path from another CloudBase environment', async () => {
    const deps = dependencies({})

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: `cloud://other-env.bucket/posts/member-videos/${scope}/clip.mp4` }],
    }, openid, communityId, deps)).rejects.toThrow('视频文件不属于当前应用')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('rejects an arbitrary bucket authority even when its env prefix looks valid', async () => {
    const forgedFileID = `cloud://test-env.attacker-bucket/posts/member-videos/${scope}/clip.mp4`
    const deps = dependencies({}, 'test-env.real-bucket')

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: forgedFileID }],
    }, openid, communityId, deps)).rejects.toThrow('视频文件不属于当前应用')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test.each([
    [{ contentLength: MAX_MEMBER_VIDEO_BYTES + 1, contentType: 'video/mp4' }, '视频文件不能超过 200MiB'],
    [{ contentLength: 1024, contentType: 'application/pdf' }, '视频文件类型不受支持'],
    [{ contentLength: 1024, contentType: 'video/webm' }, '视频文件类型不受支持'],
    [{ contentLength: 1024, contentType: 'video/vendor-specific' }, '视频文件类型不受支持'],
  ])('rejects untrusted actual video metadata %#', async (actual, message) => {
    const deps = dependencies({ [videoFileID]: actual })

    await expect(validateMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID }],
    }, openid, communityId, deps)).rejects.toThrow(message)
  })

  test.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects a non-positive or unsafe actual content length: %s',
    async (contentLength) => {
      const deps = dependencies({
        [videoFileID]: { contentLength, contentType: 'video/mp4' },
      })

      await expect(validateMemberArchiveVideoContent({
        videos: [{ source: 'cos', fileID: videoFileID }],
      }, openid, communityId, deps)).rejects.toThrow('无法确认上传文件大小')
    },
  )

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
    }, openid, communityId, deps)).rejects.toThrow(message)
  })
})

describe('member archive video finalization', () => {
  test('reuses only an explicitly allowed finalized object during post updates', async () => {
    const existing = `cloud://test-env/posts/member-videos-finalized/${scope}/existing.mp4`
    const materializeFile = jest.fn()
    const content = await finalizeMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: existing }],
    }, openid, communityId, {
      requestUploadMetadata: jest.fn(),
      materializeFile,
      getTempUrl: jest.fn(),
      inspectRemoteObject: jest.fn(),
      existingFinalizedFileIDs: { video: new Set([existing]) },
    })

    expect(content.videos?.[0].fileID).toBe(existing)
    expect(materializeFile).not.toHaveBeenCalled()
  })

  test('does not accept a finalized object that was not already bound to the updated post', async () => {
    const borrowed = `cloud://test-env/posts/member-videos-finalized/${scope}/borrowed.mp4`
    await expect(finalizeMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: borrowed }],
    }, openid, communityId, {
      requestUploadMetadata: jest.fn(),
      materializeFile: jest.fn(),
      getTempUrl: jest.fn(),
      inspectRemoteObject: jest.fn(),
      existingFinalizedFileIDs: { video: new Set() },
    })).rejects.toThrow('视频文件不属于当前用户')
  })

  test('does not delete a reused published video when finalizing a replacement cover fails', async () => {
    const existing = `cloud://test-env/posts/member-videos-finalized/${scope}/existing.mp4`
    const deleteFile = jest.fn(async () => undefined)
    await expect(finalizeMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: existing, cover: coverFileID }],
    }, openid, communityId, {
      requestUploadMetadata: jest.fn(async (cloudPath: string) => ({
        cloudPath,
        fileId: `cloud://test-env/${cloudPath}`,
        url: '', token: '', authorization: '', cosFileId: '',
      })),
      materializeFile: jest.fn(async () => { throw new Error('copy failed') }),
      deleteFile,
      getTempUrl: jest.fn(),
      inspectRemoteObject: jest.fn(),
      existingFinalizedFileIDs: { video: new Set([existing]) },
    })).rejects.toThrow('copy failed')

    expect(deleteFile).not.toHaveBeenCalled()
  })

  test('materializes video and cover to finalized paths and verifies only the finalized objects', async () => {
    const finalizedVideo = `cloud://test-env/posts/member-videos-finalized/${scope}/1234_final-video.mp4`
    const finalizedCover = `cloud://test-env/posts/member-video-covers-finalized/${scope}/1234_final-cover.jpg`
    const requestUploadMetadata = jest.fn(async (cloudPath: string) => ({
      cloudPath,
      fileId: `cloud://test-env/${cloudPath}`,
      url: '', token: '', authorization: '', cosFileId: '',
    }))
    const materializeFile = jest.fn(async (sourceFileID: string, destinationPath: string) => {
      expect([videoFileID, coverFileID]).toContain(sourceFileID)
      return `cloud://test-env/${destinationPath}`
    })
    const getTempUrl = jest.fn(async (fileID: string) => `https://download.example/${encodeURIComponent(fileID)}`)
    const inspectRemoteObject = jest.fn(async (url: string) => {
      const fileID = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
      expect([finalizedVideo, finalizedCover]).toContain(fileID)
      return fileID === finalizedVideo
        ? { contentLength: 1024, contentType: 'video/mp4' }
        : { contentLength: 512, contentType: 'image/jpeg' }
    })

    const content = await finalizeMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID, cover: coverFileID }],
    }, openid, communityId, {
      requestUploadMetadata,
      materializeFile,
      getTempUrl,
      inspectRemoteObject,
      now: () => 1234,
      randomId: (kind: 'video' | 'cover') => kind === 'video' ? 'final-video' : 'final-cover',
    })

    expect(content).toEqual({ videos: [{ source: 'cos', fileID: finalizedVideo, cover: finalizedCover }] })
    expect(materializeFile).toHaveBeenNthCalledWith(1, videoFileID, `posts/member-videos-finalized/${scope}/1234_final-video.mp4`)
    expect(materializeFile).toHaveBeenNthCalledWith(2, coverFileID, `posts/member-video-covers-finalized/${scope}/1234_final-cover.jpg`)
    expect(inspectRemoteObject).toHaveBeenCalledTimes(2)
  })

  test('rejects a finalized object whose metadata changed before persistence', async () => {
    const requestUploadMetadata = jest.fn(async (cloudPath: string) => ({
      cloudPath,
      fileId: `cloud://test-env/${cloudPath}`,
      url: '', token: '', authorization: '', cosFileId: '',
    }))
    const materializeFile = jest.fn(async (_sourceFileID: string, destinationPath: string) => `cloud://test-env/${destinationPath}`)

    await expect(finalizeMemberArchiveVideoContent({
      videos: [{ source: 'cos', fileID: videoFileID }],
    }, openid, communityId, {
      requestUploadMetadata,
      materializeFile,
      getTempUrl: jest.fn(async () => 'https://download.example/finalized'),
      inspectRemoteObject: jest.fn(async () => ({
        contentLength: MAX_MEMBER_VIDEO_BYTES + 1,
        contentType: 'video/mp4',
      })),
      now: () => 1,
      randomId: () => 'final',
    })).rejects.toThrow('视频文件不能超过 200MiB')

    expect(materializeFile).toHaveBeenCalledTimes(1)
  })
})

describe('remote object metadata inspection', () => {
  const trustedDownloadUrl = 'https://bucket.cos.ap-shanghai.myqcloud.com/video'

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

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
      .resolves.toEqual({ contentLength: 4096, contentType: 'video/mp4' })
    expect(fetch).toHaveBeenCalledWith(trustedDownloadUrl, expect.objectContaining({
      method: 'HEAD', redirect: 'manual', signal: expect.any(AbortSignal),
    }))
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

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
      .resolves.toEqual({ contentLength: 8192, contentType: 'video/webm' })
    expect(fetch).toHaveBeenNthCalledWith(2, trustedDownloadUrl, expect.objectContaining({
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'manual',
      signal: expect.any(AbortSignal),
    }))
    expect(fetch.mock.calls[0][1].signal).toBe(fetch.mock.calls[1][1].signal)
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

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
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

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
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

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
      .rejects.toThrow('不支持安全的分段读取')
    expect(ignoredRange.body.cancel).toHaveBeenCalled()
  })

  test.each([
    'https://localhost/video',
    'https://127.0.0.1/video',
    'https://10.0.0.1/video',
    'https://evil.example/video',
    'http://bucket.cos.ap-shanghai.myqcloud.com/video',
  ])('rejects an untrusted temporary URL before fetch: %s', async (url) => {
    const fetch = jest.fn()

    await expect(inspectRemoteObjectWithFetch(url, fetch)).rejects.toThrow('临时文件地址无效')
    expect(fetch).not.toHaveBeenCalled()
  })

  test('fails closed on redirects without following or attempting GET', async () => {
    const fetch = jest.fn(async () => response(302, { location: 'https://evil.example/video' }))

    await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch)).rejects.toThrow('不允许重定向')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(trustedDownloadUrl, expect.objectContaining({ redirect: 'manual' }))
  })

  test.each(['0', '1e3', '9007199254740992'])(
    'rejects a malformed or unsafe Content-Length header: %s',
    async (contentLength) => {
      const fetch = jest.fn()
        .mockResolvedValueOnce(response(200, {
          'content-length': contentLength,
          'content-type': 'video/mp4',
        }))
        .mockResolvedValueOnce(response(206, {
          'content-range': `bytes 0-0/${contentLength}`,
          'content-length': '1',
          'content-type': 'video/mp4',
        }))

      await expect(inspectRemoteObjectWithFetch(trustedDownloadUrl, fetch))
        .rejects.toThrow('无法确认上传文件元数据')
    },
  )
})
