import { createHash } from 'crypto'
import {
  MAX_MEMBER_AUDIO_BYTES,
  assertOwnedMemberAudioUpload,
  deriveMemberAudioScope,
  finalizeMemberArchiveAudioContent,
  requestMemberAudioUpload,
} from '../member-audio-upload'

const openid = 'member-openid-123'
const communityId = 'community-1'
const scope = createHash('sha256').update(`${communityId}\u0000${openid}`, 'utf8').digest('hex').slice(0, 24)

function pending(kind: 'audio' | 'cover', name: string) {
  const directory = kind === 'audio' ? 'member-audios' : 'member-audio-covers'
  return `cloud://test-env/posts/${directory}/${scope}/${name}`
}

function dependencies(metadata: Record<string, { contentLength: number; contentType: string }>) {
  return {
    requestUploadMetadata: jest.fn(async (cloudPath: string) => ({
      cloudPath,
      fileId: `cloud://test-env/${cloudPath}`,
      url: '', token: '', authorization: '', cosFileId: '',
    })),
    getTempUrl: jest.fn(async (fileID: string) => `https://download.example/${encodeURIComponent(fileID)}`),
    inspectRemoteObject: jest.fn(async (url: string) => {
      const fileID = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
      const value = metadata[fileID]
      if (!value) throw new Error(`missing metadata for ${fileID}`)
      return value
    }),
    materializeFile: jest.fn(async (source: string, destination: string) => {
      const fileID = `cloud://test-env/${destination}`
      metadata[fileID] = metadata[source]
      return fileID
    }),
    deleteFile: jest.fn(async () => undefined),
    now: () => 1234,
    randomId: (kind: 'audio' | 'cover', index: number) => `${kind}-${index}`,
  }
}

describe('member audio upload authorization', () => {
  test.each([
    ['audio', 'Family.MP3', 'member-audios', 'mp3'],
    ['cover', 'Cover.WEBP', 'member-audio-covers', 'webp'],
  ] as const)('derives an opaque community-and-member scope for %s metadata', async (kind, fileName, directory, ext) => {
    const requestUploadMetadata = jest.fn(async (cloudPath: string) => ({ cloudPath }))

    const result = await requestMemberAudioUpload(
      { kind, communityId, fileName },
      openid,
      { requestUploadMetadata: requestUploadMetadata as any, now: () => 1234, randomId: () => 'safe' },
    )

    expect(deriveMemberAudioScope(openid, communityId)).toBe(scope)
    expect(scope).not.toContain(openid)
    expect(requestUploadMetadata).toHaveBeenCalledWith(`posts/${directory}/${scope}/1234_safe.${ext}`)
    expect(result).toEqual({ cloudPath: `posts/${directory}/${scope}/1234_safe.${ext}` })
  })

  test.each([
    ['audio', 'track.exe'], ['audio', 'track.mp4'], ['cover', 'cover.gif'], ['cover', 'cover.mp3'],
  ] as const)('rejects unsupported %s extensions before metadata issuance', async (kind, fileName) => {
    const requestUploadMetadata = jest.fn()
    await expect(requestMemberAudioUpload(
      { kind, communityId, fileName }, openid, { requestUploadMetadata },
    )).rejects.toThrow('不支持的文件类型')
    expect(requestUploadMetadata).not.toHaveBeenCalled()
  })

  test.each([
    ['another member', pending('audio', 'clip.mp3').replace(scope, deriveMemberAudioScope('other', communityId))],
    ['another community', pending('audio', 'clip.mp3').replace(scope, deriveMemberAudioScope(openid, 'community-2'))],
    ['nested traversal', `cloud://test-env/posts/member-audios/${scope}/nested/clip.mp3`],
    ['dot traversal', `cloud://test-env/posts/member-audios/${scope}/../clip.mp3`],
    ['encoded traversal', `cloud://test-env/posts/member-audios/${scope}/..%2fclip.mp3`],
    ['backslash traversal', `cloud://test-env/posts/member-audios/${scope}\\clip.mp3`],
  ])('rejects %s paths before remote inspection', (_label, fileID) => {
    expect(() => assertOwnedMemberAudioUpload(fileID, openid, communityId, 'audio'))
      .toThrow('音频文件不属于当前用户')
  })
})

describe('member archive audio verification and finalization', () => {
  test.each([
    ['mp3', 'audio/mpeg'], ['mp3', 'audio/mp3'],
    ['m4a', 'audio/mp4'], ['m4a', 'audio/x-m4a'],
    ['aac', 'audio/aac'], ['aac', 'audio/x-aac'],
    ['wav', 'audio/wav'], ['wav', 'audio/x-wav'], ['wav', 'audio/wave'],
  ])('accepts .%s only with allowlisted MIME %s and replaces client size/ext', async (ext, contentType) => {
    const fileID = pending('audio', `track.${ext}`)
    const deps = dependencies({ [fileID]: { contentLength: 4096, contentType } })

    const result = await finalizeMemberArchiveAudioContent({
      title: '家庭录音',
      audios: [{ title: '第一段', fileID, duration: 12, size: 1, ext: ext === 'mp3' ? 'wav' : 'mp3' }],
    }, openid, communityId, deps)

    expect(result.content.audios).toEqual([expect.objectContaining({
      title: '第一段', duration: 12, size: 4096, ext,
      fileID: expect.stringContaining(`/posts/member-audios-finalized/${scope}/`),
    })])
    expect(result.createdFileIDs).toEqual([result.content.audios[0].fileID])
  })

  test.each([
    ['mp3', 'audio/mp4'], ['m4a', 'audio/mpeg'], ['aac', 'audio/wav'], ['wav', 'audio/aac'],
  ])('rejects extension/MIME mismatch for .%s served as %s', async (ext, contentType) => {
    const fileID = pending('audio', `track.${ext}`)
    const deps = dependencies({ [fileID]: { contentLength: 4096, contentType } })
    await expect(finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '第一段', fileID, duration: 12, size: 1, ext: 'mp3' }],
    }, openid, communityId, deps)).rejects.toThrow('音频文件类型不受支持')
    expect(deps.materializeFile).not.toHaveBeenCalled()
  })

  test('enforces the actual 50 MiB boundary instead of the client-reported size', async () => {
    const fileID = pending('audio', 'track.mp3')
    const deps = dependencies({ [fileID]: { contentLength: MAX_MEMBER_AUDIO_BYTES + 1, contentType: 'audio/mpeg' } })
    await expect(finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '第一段', fileID, duration: 12, size: 1, ext: 'mp3' }],
    }, openid, communityId, deps)).rejects.toThrow('音频文件不能超过 50MiB')
    expect(deps.materializeFile).not.toHaveBeenCalled()
  })

  test('rejects a forged application authority before materializing', async () => {
    const fileID = pending('audio', 'track.mp3').replace('cloud://test-env/', 'cloud://other-env/')
    const deps = dependencies({ [fileID]: { contentLength: 1024, contentType: 'audio/mpeg' } })
    await expect(finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '第一段', fileID, duration: 12, size: 1, ext: 'mp3' }],
    }, openid, communityId, deps)).rejects.toThrow('音频文件不属于当前应用')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('finalizes multiple tracks and optional covers in order while preserving authored fields', async () => {
    const first = pending('audio', 'first.mp3')
    const firstCover = pending('cover', 'first.jpg')
    const second = pending('audio', 'second.m4a')
    const deps = dependencies({
      [first]: { contentLength: 111, contentType: 'audio/mpeg' },
      [firstCover]: { contentLength: 222, contentType: 'image/jpeg' },
      [second]: { contentLength: 333, contentType: 'audio/mp4' },
    })

    const result = await finalizeMemberArchiveAudioContent({
      title: '家庭声音',
      audios: [
        { title: '清晨', fileID: first, duration: 10, size: 9, ext: 'wav', cover: firstCover },
        { title: '夜晚', fileID: second, duration: 20, size: 8, ext: 'mp3' },
      ],
    }, openid, communityId, deps)

    expect(result.content).toEqual({
      title: '家庭声音',
      audios: [
        { title: '清晨', fileID: expect.stringContaining('/member-audios-finalized/'), duration: 10, size: 111, ext: 'mp3', cover: expect.stringContaining('/member-audio-covers-finalized/') },
        { title: '夜晚', fileID: expect.stringContaining('/member-audios-finalized/'), duration: 20, size: 333, ext: 'm4a' },
      ],
    })
    expect(deps.materializeFile.mock.calls.map(([source]) => source)).toEqual([first, firstCover, second])
    expect(result.createdFileIDs).toHaveLength(3)
  })

  test('best-effort deletes every newly finalized object when a later cover or track fails', async () => {
    const first = pending('audio', 'first.mp3')
    const cover = pending('cover', 'cover.jpg')
    const metadata: Record<string, { contentLength: number; contentType: string }> = {
      [first]: { contentLength: 111, contentType: 'audio/mpeg' },
      [cover]: { contentLength: 222, contentType: 'image/jpeg' },
    }
    const deps = dependencies(metadata)
    deps.materializeFile
      .mockImplementationOnce(async (_source, destination) => {
        const fileID = `cloud://test-env/${destination}`
        metadata[fileID] = metadata[first]
        return fileID
      })
      .mockRejectedValueOnce(new Error('cover copy failed'))

    await expect(finalizeMemberArchiveAudioContent({
      title: '家庭声音',
      audios: [{ title: '清晨', fileID: first, duration: 10, size: 9, ext: 'mp3', cover }],
    }, openid, communityId, deps)).rejects.toThrow('cover copy failed')
    expect(deps.deleteFile).toHaveBeenCalledWith([
      `cloud://test-env/posts/member-audios-finalized/${scope}/1234_audio-0.mp3`,
    ])
  })

  test('reuses only finalized files explicitly bound to the current post', async () => {
    const existing = `cloud://test-env/posts/member-audios-finalized/${scope}/existing.mp3`
    const existingCover = `cloud://test-env/posts/member-audio-covers-finalized/${scope}/existing.jpg`
    const deps = dependencies({
      [existing]: { contentLength: 2048, contentType: 'audio/mpeg' },
      [existingCover]: { contentLength: 512, contentType: 'image/jpeg' },
    })
    const result = await finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '旧录音', fileID: existing, duration: 12, size: 100, ext: 'wav', cover: existingCover }],
    }, openid, communityId, {
      ...deps,
      existingFinalizedFileIDs: { audio: new Set([existing]), cover: new Set([existingCover]) },
    })
    expect(result.content.audios[0]).toEqual({ title: '旧录音', fileID: existing, duration: 12, size: 2048, ext: 'mp3', cover: existingCover })
    expect(result.createdFileIDs).toEqual([])
    expect(deps.materializeFile).not.toHaveBeenCalled()
  })

  test('rejects an explicitly bound finalized file from another application authority', async () => {
    const forged = `cloud://other-env/posts/member-audios-finalized/${scope}/existing.mp3`
    const deps = dependencies({ [forged]: { contentLength: 1024, contentType: 'audio/mpeg' } })
    await expect(finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '旧录音', fileID: forged, duration: 12, size: 1024, ext: 'mp3' }],
    }, openid, communityId, {
      ...deps,
      existingFinalizedFileIDs: { audio: new Set([forged]) },
    })).rejects.toThrow('音频文件不属于当前应用')
    expect(deps.getTempUrl).not.toHaveBeenCalled()
  })

  test('rejects an owned finalized file that is not bound to the current post', async () => {
    const borrowed = `cloud://test-env/posts/member-audios-finalized/${scope}/borrowed.mp3`
    const deps = dependencies({})
    await expect(finalizeMemberArchiveAudioContent({
      title: '录音', audios: [{ title: '借用', fileID: borrowed, duration: 12, size: 100, ext: 'mp3' }],
    }, openid, communityId, { ...deps, existingFinalizedFileIDs: { audio: new Set(), cover: new Set() } }))
      .rejects.toThrow('音频文件不属于当前用户')
    expect(deps.materializeFile).not.toHaveBeenCalled()
  })
})
