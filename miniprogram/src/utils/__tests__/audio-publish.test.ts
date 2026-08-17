import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  buildAudioTrackOutput,
  assertAudioTrackAdditionWithinLimit,
  capturePositiveAudioDurationBeforeCleanup,
  cleanupOwnedPendingAudioUploads,
  collectOwnedPendingAudioUploads,
  isAudioAsyncResultCurrent,
  moveAudioTrack,
  normalizeAudioPublishFile,
  reduceAudioOperationState,
  removeAudioTrack,
  removeAudioTrackCover,
  replaceAudioTrackCover,
  requirePositiveAudioDuration,
  resolveAudioPublishReadiness,
  shouldCleanupPendingAudioAfterSubmit,
  shouldBlockAudioNavigation,
  updateAudioTrackTitle,
  type AudioPublishTrackState,
  type PendingAudioUpload,
} from '../audio-publish'

function readyTrack(overrides: Partial<AudioPublishTrackState> = {}): AudioPublishTrackState {
  return {
    id: 'track-1',
    title: '第一轨',
    fileID: 'cloud://env/posts/member-audios/scope/first.mp3',
    duration: 12.5,
    size: 1024,
    ext: 'mp3',
    audioStatus: 'ready',
    coverStatus: 'idle',
    ...overrides,
  }
}

describe('audio publish file normalization', () => {
  afterEach(() => vi.unstubAllGlobals())

  test.each([
    ['晨间故事.MP3', 'audio/mpeg', 'mp3'],
    ['第二章.m4a', 'audio/mp4', 'm4a'],
    ['采访.aac', 'audio/aac', 'aac'],
    ['现场.wav', 'audio/wav', 'wav'],
  ] as const)('accepts supported audio %s and derives a title', (name, type, ext) => {
    expect(normalizeAudioPublishFile({ source: `wxfile://${name}`, name, type, size: 1024 })).toEqual({
      source: `wxfile://${name}`,
      name,
      title: name.replace(/\.[^.]+$/, ''),
      ext,
      size: 1024,
    })
  })

  test.each([
    [{ source: 'wxfile://empty.mp3', name: 'empty.mp3', type: 'audio/mpeg', size: 0 }, '为空'],
    [{ source: 'wxfile://large.mp3', name: 'large.mp3', type: 'audio/mpeg', size: 50 * 1024 * 1024 + 1 }, '50 MiB'],
    [{ source: 'wxfile://clip.ogg', name: 'clip.ogg', type: 'audio/ogg', size: 1 }, 'MP3'],
    [{ source: 'wxfile://renamed.mp3', name: 'renamed.mp3', type: 'audio/wav', size: 1 }, 'MIME'],
  ])('rejects invalid audio before upload: %o', (file, message) => {
    expect(() => normalizeAudioPublishFile(file)).toThrow(message)
  })

  test.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps missing or non-positive real duration unresolved: %s',
    (duration) => expect(() => requirePositiveAudioDuration(duration)).toThrow('时长'),
  )

  test('preserves a positive fractional duration without inventing a fallback', () => {
    expect(requirePositiveAudioDuration(61.25)).toBe(61.25)
  })

  test('captures media duration before source cleanup can reset it', () => {
    const calls: string[] = []
    let duration = 42.75
    expect(capturePositiveAudioDurationBeforeCleanup(
      () => { calls.push('read'); return duration },
      () => { calls.push('cleanup'); duration = Number.NaN },
    )).toBe(42.75)
    expect(calls).toEqual(['read', 'cleanup'])
  })

  test('normalizes mini-program string sources safely when Blob is not a runtime global', () => {
    vi.stubGlobal('Blob', undefined)
    expect(normalizeAudioPublishFile({
      source: 'wxfile://story.mp3', name: 'story.mp3', type: 'file', size: 1,
    })).toMatchObject({ title: 'story', ext: 'mp3' })
    expect(() => normalizeAudioPublishFile({
      source: {} as Blob, name: 'story.mp3', type: 'file', size: 1,
    })).toThrow('本地文件')
  })

  test('rejects a selection batch that would exceed the shared twenty-track limit', () => {
    expect(() => assertAudioTrackAdditionWithinLimit(0, 20)).not.toThrow()
    expect(() => assertAudioTrackAdditionWithinLimit(19, 1)).not.toThrow()
    expect(() => assertAudioTrackAdditionWithinLimit(20, 1)).toThrow('最多添加 20 条音频')
    expect(() => assertAudioTrackAdditionWithinLimit(19, 2)).toThrow('最多添加 20 条音频')
    expect(() => assertAudioTrackAdditionWithinLimit(0, 21)).toThrow('最多添加 20 条音频')
  })
})

describe('audio publish state reducers', () => {
  test('edits titles, reorders tracks, and removes a track without changing the others', () => {
    const first = readyTrack()
    const second = readyTrack({ id: 'track-2', title: '第二轨', fileID: 'cloud://env/second.m4a', ext: 'm4a' })
    const third = readyTrack({ id: 'track-3', title: '第三轨', fileID: 'cloud://env/third.wav', ext: 'wav' })

    const renamed = updateAudioTrackTitle([first, second, third], 'track-2', '新的第二轨')
    expect(renamed.map((track) => track.title)).toEqual(['第一轨', '新的第二轨', '第三轨'])
    const moved = moveAudioTrack(renamed, 'track-3', -1)
    expect(moved.map((track) => track.id)).toEqual(['track-1', 'track-3', 'track-2'])
    expect(removeAudioTrack(moved, 'track-1').map((track) => track.id)).toEqual(['track-3', 'track-2'])
    expect(first.title).toBe('第一轨')
  })

  test('replaces and removes an optional per-track cover immutably', () => {
    const track = Object.assign(readyTrack({ cover: 'cloud://env/existing-cover.jpg' }), { clientToken: 'keep-me' })
    const replacement = replaceAudioTrackCover(track, 'cloud://env/new-cover.webp')
    expect(replacement.cover).toBe('cloud://env/new-cover.webp')
    expect(replacement.clientToken).toBe('keep-me')
    expect(track.cover).toBe('cloud://env/existing-cover.jpg')
    const removed = removeAudioTrackCover(replacement)
    expect(removed.cover).toBeUndefined()
    expect(removed.clientToken).toBe('keep-me')
  })

  test('moves failed work back to pending for retry and resolves only after success', () => {
    expect(reduceAudioOperationState('error', 'retry')).toBe('pending')
    expect(reduceAudioOperationState('pending', 'start')).toBe('uploading')
    expect(reduceAudioOperationState('uploading', 'fail')).toBe('error')
    expect(reduceAudioOperationState('uploading', 'resolve')).toBe('ready')
  })

  test('rejects stale async completion after replacement, removal, or unmount', () => {
    const tracks = [readyTrack({ id: 'track-1', audioGeneration: 4, coverGeneration: 7 })]
    expect(isAudioAsyncResultCurrent(tracks, 'track-1', 'audio', 4, false)).toBe(true)
    expect(isAudioAsyncResultCurrent(tracks, 'track-1', 'audio', 3, false)).toBe(false)
    expect(isAudioAsyncResultCurrent(tracks, 'track-1', 'cover', 6, false)).toBe(false)
    expect(isAudioAsyncResultCurrent([], 'track-1', 'audio', 4, false)).toBe(false)
    expect(isAudioAsyncResultCurrent(tracks, 'track-1', 'audio', 4, true)).toBe(false)
  })
})

describe('audio publish output, cleanup, and readiness', () => {
  test.each([undefined, '', 'pass', 'pending', 'review'])(
    'cleans pending source objects only for accepted submit status: %s',
    (status) => expect(shouldCleanupPendingAudioAfterSubmit(status)).toBe(true),
  )

  test('retains pending source ownership when audit rejection leaves the editor open', () => {
    expect(shouldCleanupPendingAudioAfterSubmit('rejected')).toBe(false)
  })

  test('builds ordered server tracks only when every title, duration, and upload is ready', () => {
    const tracks = [
      readyTrack({ id: 'track-2', title: '开场', cover: 'cloud://env/cover.jpg' }),
      readyTrack({ id: 'track-1', title: '收尾', fileID: 'cloud://env/end.wav', ext: 'wav', duration: 3, size: 2048 }),
    ]
    expect(buildAudioTrackOutput(tracks)).toEqual([
      { title: '开场', fileID: tracks[0].fileID, duration: 12.5, size: 1024, ext: 'mp3', cover: 'cloud://env/cover.jpg' },
      { title: '收尾', fileID: 'cloud://env/end.wav', duration: 3, size: 2048, ext: 'wav' },
    ])
    expect(() => buildAudioTrackOutput([readyTrack({ title: ' ' })])).toThrow('曲目标题')
    expect(() => buildAudioTrackOutput([readyTrack({ duration: 0 })])).toThrow('时长')
    expect(() => buildAudioTrackOutput([readyTrack({ audioStatus: 'error' })])).toThrow('未完成')
    expect(() => buildAudioTrackOutput(Array.from({ length: 21 }, (_, index) => readyTrack({
      id: `track-${index}`,
      fileID: `cloud://env/track-${index}.mp3`,
    })))).toThrow('最多添加 20 条音频')
  })

  test('selects only owned new pending IDs and never existing finalized media', () => {
    const uploads: PendingAudioUpload[] = [
      { fileID: 'cloud://env/posts/member-audios/scope/new.mp3', kind: 'audio', owned: true },
      { fileID: 'cloud://env/posts/member-audio-covers/scope/new.jpg', kind: 'cover', owned: true },
      { fileID: 'cloud://env/posts/member-audios-finalized/scope/existing.mp3', kind: 'audio', owned: false },
    ]
    expect(collectOwnedPendingAudioUploads(uploads).map((item) => item.fileID)).toEqual([
      uploads[0].fileID,
      uploads[1].fileID,
    ])
  })

  test('removes successful pending-source cleanup and retains failures for an unmount retry', async () => {
    const uploads: PendingAudioUpload[] = [
      { fileID: 'cloud://env/posts/member-audios/scope/new.mp3', kind: 'audio', owned: true },
      { fileID: 'cloud://env/posts/member-audio-covers/scope/new.jpg', kind: 'cover', owned: true },
      { fileID: 'cloud://env/posts/member-audios-finalized/scope/existing.mp3', kind: 'audio', owned: false },
    ]
    const attempted: string[] = []
    const result = await cleanupOwnedPendingAudioUploads(uploads, async (upload) => {
      attempted.push(upload.fileID)
      if (upload.kind === 'cover') throw new Error('temporary network failure')
    })

    expect(attempted).toEqual([uploads[0].fileID, uploads[1].fileID])
    expect(result.cleaned).toEqual([uploads[0]])
    expect(result.failed).toEqual([uploads[1]])
  })

  test('blocks submit for missing post/track titles and all unresolved audio or cover work', () => {
    expect(resolveAudioPublishReadiness({ postTitle: '', tracks: [readyTrack()] })).toEqual({ ready: false, reason: 'post-title-missing' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: [] })).toEqual({ ready: false, reason: 'tracks-missing' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: Array.from({ length: 21 }, (_, index) => readyTrack({ id: `track-${index}` })) })).toEqual({ ready: false, reason: 'tracks-limit' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: [readyTrack({ title: '' })] })).toEqual({ ready: false, reason: 'track-title-missing' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: [readyTrack({ duration: null, audioStatus: 'pending' })] })).toEqual({ ready: false, reason: 'audio-pending' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: [readyTrack({ coverStatus: 'error' })] })).toEqual({ ready: false, reason: 'cover-error' })
    expect(resolveAudioPublishReadiness({ postTitle: '帖子', tracks: [readyTrack()] })).toEqual({ ready: true, reason: '' })
  })

  test('blocks leaving only for unresolved or failed duration/upload/cover operations', () => {
    expect(shouldBlockAudioNavigation([readyTrack({ audioStatus: 'pending' })])).toBe(true)
    expect(shouldBlockAudioNavigation([readyTrack({ coverStatus: 'uploading' })])).toBe(true)
    expect(shouldBlockAudioNavigation([readyTrack({ audioStatus: 'error' })])).toBe(true)
    expect(shouldBlockAudioNavigation([readyTrack({ title: '' })])).toBe(false)
    expect(shouldBlockAudioNavigation([readyTrack()])).toBe(false)
  })
})
