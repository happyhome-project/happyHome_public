import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { _setAudioStoreDepsForTesting, useAudioStore } from '../audio'
import type { AudioBackend, AudioBackendEvent, AudioBackendMeta } from '../../utils/audio-manager'

function makeMockBackend(options: {
  emitPlayEvent?: boolean
  setSrcError?: Error
  playError?: Error
} = {}) {
  const handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}
  const calls = {
    setSrc: [] as Array<{ url: string; title: string; meta?: AudioBackendMeta }>,
    play: 0,
    pause: 0,
    stop: 0,
    seek: [] as number[],
    sequence: [] as string[],
  }
  const backend: AudioBackend = {
    setSrc(url, title, meta) {
      calls.setSrc.push({ url, title, meta })
      calls.sequence.push('setSrc')
      if (options.setSrcError) throw options.setSrcError
    },
    play() {
      calls.play += 1
      calls.sequence.push('play')
      if (options.playError) throw options.playError
      if (options.emitPlayEvent !== false) handlers.onPlay?.()
    },
    pause() { calls.pause += 1; handlers.onPause?.() },
    stop() { calls.stop += 1 },
    seek(seconds) {
      calls.seek.push(seconds)
      calls.sequence.push(`seek:${seconds}`)
    },
    destroy() {},
    bind(nextHandlers) {
      for (const event of Object.keys(handlers) as AudioBackendEvent[]) delete handlers[event]
      Object.assign(handlers, nextHandlers)
    },
  }
  return { backend, handlers, calls }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function makeStorage() {
  const data = new Map<string, unknown>()
  return {
    data,
    storage: {
      get: (key: string) => data.get(key) ?? null,
      set: (key: string, value: unknown) => { data.set(key, value) },
    },
  }
}

const TRACKS = [
  { fileID: 'cloud://audio/1.mp3', title: 'Lesson 1', duration: 100, cover: 'cloud://covers/1.png' },
  { fileID: 'cloud://audio/2.mp3', title: 'Lesson 2', duration: 120 },
]

const META = {
  postId: 'post-1',
  postTitle: 'Course',
  sectionId: 'section-1',
  communityId: 'community-1',
}

beforeEach(() => {
  setActivePinia(createPinia())
  _setAudioStoreDepsForTesting({
    backend: makeMockBackend().backend,
    storage: makeStorage().storage,
    getTempFileURL: async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: fileID })),
  })
})

describe('audio store', () => {
  test('playPlaylist starts backend without showing the custom floating card', async () => {
    const mock = makeMockBackend()
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://cdn/${fileID}` })),
    )
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()

    await store.playPlaylist(TRACKS, 0, META)

    expect(store.isVisible).toBe(false)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTrack?.title).toBe('Lesson 1')
    expect(mock.calls.setSrc[0]).toEqual({
      url: 'https://cdn/cloud://audio/1.mp3',
      title: 'Lesson 1',
      meta: {
        coverImgUrl: 'https://cdn/cloud://covers/1.png',
        epname: 'Course',
        singer: '',
      },
    })
    expect(mock.calls.play).toBe(1)
  })

  test('starts the selected track before warming the rest of the playlist', async () => {
    const mock = makeMockBackend()
    const selectedSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const backgroundSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const getTempFileURL = vi.fn((fileIDs: string[]) => (
      fileIDs.includes(TRACKS[0].fileID) ? selectedSigner.promise : backgroundSigner.promise
    ))
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()

    const playRequest = store.playPlaylist(TRACKS, 0, META)

    expect(getTempFileURL).toHaveBeenCalledTimes(1)
    expect(getTempFileURL).toHaveBeenNthCalledWith(1, [TRACKS[0].fileID, TRACKS[0].cover])
    expect(mock.calls.play).toBe(0)

    selectedSigner.resolve([
      { fileID: TRACKS[0].fileID, tempFileURL: 'https://signed/one.mp3' },
      { fileID: TRACKS[0].cover, tempFileURL: 'https://signed/one.png' },
    ])
    await playRequest

    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/one.mp3',
      title: 'Lesson 1',
      meta: {
        coverImgUrl: 'https://signed/one.png',
        epname: 'Course',
        singer: '',
      },
    }])
    expect(mock.calls.play).toBe(1)
    expect(store.isPlaying).toBe(true)
    expect(getTempFileURL).toHaveBeenCalledTimes(2)
    expect(getTempFileURL).toHaveBeenNthCalledWith(2, [TRACKS[1].fileID])

    backgroundSigner.resolve([
      { fileID: TRACKS[1].fileID, tempFileURL: 'https://signed/two.mp3' },
    ])
  })

  test('next and prev switch tracks', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    await store.next()
    expect(store.currentIndex).toBe(1)
    expect(store.currentTrack?.title).toBe('Lesson 2')

    await store.prev()
    expect(store.currentIndex).toBe(0)
    expect(store.currentTrack?.title).toBe('Lesson 1')
  })

  test('ended event automatically advances to next track', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    mock.handlers.onEnded?.()
    await vi.waitFor(() => {
      expect(mock.calls.setSrc.at(-1)).toEqual({
        url: 'cloud://audio/2.mp3',
        title: 'Lesson 2',
        meta: { coverImgUrl: '', epname: 'Course', singer: '' },
      })
    })

    expect(store.currentIndex).toBe(1)
    expect(store.currentTrack?.title).toBe('Lesson 2')
    expect(mock.calls.play).toBe(2)
  })

  test('replays a naturally ended single track from zero without seeking to its duration', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/replay-single.mp3',
      title: 'Replay single',
      duration: 60,
    }], 0, { ...META, postId: 'replay-single-post' })
    const endedGenerationHandlers = { ...mock.handlers }
    endedGenerationHandlers.onTimeUpdate?.(60)
    endedGenerationHandlers.onEnded?.()
    endedGenerationHandlers.onEnded?.()

    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(60)

    await store.togglePlay()

    expect(store.isPlaying).toBe(true)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([0])
    expect(mock.calls.seek).not.toContain(60)
    expect(mock.calls.play).toBe(2)

    endedGenerationHandlers.onTimeUpdate?.(59)
    endedGenerationHandlers.onEnded?.()
    await Promise.resolve()
    expect(store.currentTime).toBe(0)
    expect(store.isPlaying).toBe(true)
    expect(mock.calls.play).toBe(2)
  })

  test('continues from an explicit middle seek after natural end', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/replay-from-selection.mp3',
      title: 'Replay from selection',
      duration: 60,
    }], 0, { ...META, postId: 'replay-from-selection-post' })
    mock.handlers.onTimeUpdate?.(60)
    mock.handlers.onEnded?.()

    store.seek(24)
    await store.togglePlay()

    expect(store.currentTime).toBe(24)
    expect(mock.calls.seek).toEqual([24, 24])
    expect(store.isPlaying).toBe(true)
  })

  test('restarts from zero when physical onPlay follows natural end', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/physical-replay.mp3',
      title: 'Physical replay',
      duration: 60,
    }], 0, { ...META, postId: 'physical-replay-post' })
    mock.handlers.onPlay?.()
    mock.handlers.onTimeUpdate?.(60)
    mock.handlers.onEnded?.()

    mock.handlers.onPlay?.()

    expect(store.isPlaying).toBe(true)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([0])

    mock.handlers.onPlay?.()
    expect(mock.calls.seek).toEqual([0])
  })

  test('keeps exact-duration selection ended so toggle replays from zero', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/replay-after-duration-seek.mp3',
      title: 'Replay after duration seek',
      duration: 60,
    }], 0, { ...META, postId: 'replay-after-duration-seek-post' })
    mock.handlers.onTimeUpdate?.(60)
    mock.handlers.onEnded?.()

    store.seek(60)
    await store.togglePlay()

    expect(store.isPlaying).toBe(true)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([60, 0])
  })

  test('late ended-generation events cannot advance or retime the automatic next track', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)
    const endedGenerationHandlers = { ...mock.handlers }
    endedGenerationHandlers.onTimeUpdate?.(100)
    endedGenerationHandlers.onEnded?.()
    await vi.waitFor(() => expect(store.currentIndex).toBe(1))
    const setSrcCount = mock.calls.setSrc.length
    const playCount = mock.calls.play

    endedGenerationHandlers.onEnded?.()
    endedGenerationHandlers.onTimeUpdate?.(99)
    await Promise.resolve()

    expect(store.currentIndex).toBe(1)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.setSrc).toHaveLength(setSrcCount)
    expect(mock.calls.play).toBe(playCount)
  })

  test('keeps lockscreen callbacks current after a UI pause', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)
    mock.handlers.onTimeUpdate?.(12)

    await store.togglePlay()
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(12)

    mock.handlers.onPlay?.()
    expect(store.isPlaying).toBe(true)
    mock.handlers.onTimeUpdate?.(18)
    expect(store.currentTime).toBe(18)

    mock.handlers.onEnded?.()
    await vi.waitFor(() => expect(store.currentIndex).toBe(1))
    expect(store.currentTime).toBe(0)
    expect(store.currentTrack?.title).toBe('Lesson 2')
  })

  test('togglePlay pauses and resumes', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    await store.togglePlay()
    expect(store.isPlaying).toBe(false)
    expect(mock.calls.pause).toBe(1)

    await store.togglePlay()
    expect(store.isPlaying).toBe(true)
    expect(mock.calls.play).toBe(2)
  })

  test('reuses cached temporary URL while resuming current track', async () => {
    const mock = makeMockBackend()
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://cdn/${fileID}` })),
    )
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)
    const signingCallCount = getTempFileURL.mock.calls.length

    await store.togglePlay()
    await store.togglePlay()

    expect(getTempFileURL).toHaveBeenCalledTimes(signingCallCount)
    expect(mock.calls.setSrc.at(-1)).toEqual({
      url: 'https://cdn/cloud://audio/1.mp3',
      title: 'Lesson 1',
      meta: {
        coverImgUrl: 'https://cdn/cloud://covers/1.png',
        epname: 'Course',
        singer: '',
      },
    })
  })

  test('passes already-resolved HTTPS, blob, and static URLs through without cloud signing', async () => {
    const mock = makeMockBackend()
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://signed.example/${fileID}` })),
    )
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()

    await store.playPlaylist([
      { fileID: 'https://cdn.example/audio.mp3', title: '直连音频', duration: 45, cover: 'blob:https://app.example/cover' },
      { fileID: '/static/audio/sample.mp3', title: '本地音频', duration: 30, cover: '/static/audio/cover.jpg' },
    ], 0, META)

    expect(getTempFileURL).not.toHaveBeenCalled()
    expect(mock.calls.setSrc[0]).toEqual({
      url: 'https://cdn.example/audio.mp3',
      title: '直连音频',
      meta: { coverImgUrl: 'blob:https://app.example/cover', epname: 'Course', singer: '' },
    })
    await store.next()
    expect(mock.calls.setSrc.at(-1)).toEqual({
      url: '/static/audio/sample.mp3',
      title: '本地音频',
      meta: { coverImgUrl: '/static/audio/cover.jpg', epname: 'Course', singer: '' },
    })
  })

  test('applies a seek requested during URL resolution when the current generation starts playing', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => signer.promise),
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/seek-pending.mp3', title: 'Seek pending', duration: 90 }

    const request = store.playPlaylist([track], 0, { ...META, postId: 'seek-pending-post' })
    store.seek(37)

    expect(store.currentTime).toBe(37)
    expect(mock.calls.seek).toEqual([])

    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/seek-pending.mp3' }])
    await request

    expect(mock.calls.setSrc[0]?.url).toBe('https://signed/seek-pending.mp3')
    expect(mock.calls.seek).toEqual([])
    expect(mock.calls.sequence).toEqual(['setSrc', 'play'])

    mock.handlers.onPlay?.()

    expect(mock.calls.sequence).toEqual(['setSrc', 'play', 'seek:37'])

    mock.handlers.onPlay?.()
    expect(mock.calls.sequence).toEqual(['setSrc', 'play', 'seek:37'])
  })

  test('keeps only the newest generation seek when a pending playlist is replaced', async () => {
    const mock = makeMockBackend()
    const slowSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => slowSigner.promise),
    })
    const store = useAudioStore()
    const slowTrack = { fileID: 'cloud://audio/seek-slow.mp3', title: 'Seek slow', duration: 80 }
    const fastTrack = { fileID: 'https://cdn/seek-fast.mp3', title: 'Seek fast', duration: 100 }

    const slowRequest = store.playPlaylist([slowTrack], 0, { ...META, postId: 'seek-slow-post' })
    store.seek(11)
    const fastRequest = store.playPlaylist([fastTrack], 0, { ...META, postId: 'seek-fast-post' })
    store.seek(22)

    await fastRequest
    slowSigner.resolve([{ fileID: slowTrack.fileID, tempFileURL: 'https://signed/seek-slow.mp3' }])
    await slowRequest

    expect(mock.calls.seek).toEqual([22])
    expect(mock.calls.sequence).toEqual(['setSrc', 'play', 'seek:22'])
    expect(store.currentTrack?.fileID).toBe(fastTrack.fileID)
    expect(store.currentTime).toBe(22)
  })

  test.each([
    ['next', 0, 1],
    ['prev', 1, 0],
  ] as const)('does not leak a pending seek through %s', async (action, startIndex, expectedIndex) => {
    const mock = makeMockBackend()
    const firstSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const secondSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    let signerCallCount = 0
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => {
        signerCallCount += 1
        return signerCallCount === 1 ? firstSigner.promise : secondSigner.promise
      }),
    })
    const store = useAudioStore()

    const initialRequest = store.playPlaylist(TRACKS, startIndex, META)
    store.seek(15)
    const switchRequest = action === 'next' ? store.next() : store.prev()
    secondSigner.resolve(TRACKS.map(track => ({
      fileID: track.fileID,
      tempFileURL: `https://new/${track.fileID}`,
    })))
    await switchRequest
    firstSigner.resolve(TRACKS.map(track => ({
      fileID: track.fileID,
      tempFileURL: `https://old/${track.fileID}`,
    })))
    await initialRequest

    expect(mock.calls.seek).toEqual([])
    expect(store.currentIndex).toBe(expectedIndex)
    expect(mock.calls.setSrc).toHaveLength(1)
    expect(mock.calls.setSrc[0]?.title).toBe(TRACKS[expectedIndex].title)
  })

  test('repeated toggle preserves a seek queued during URL resolution', async () => {
    const mock = makeMockBackend()
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => signer.promise),
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/seek-toggle.mp3', title: 'Seek toggle', duration: 60 }

    const request = store.playPlaylist([track], 0, { ...META, postId: 'seek-toggle-post' })
    store.seek(33)
    await store.togglePlay()
    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/seek-toggle.mp3' }])
    await request

    expect(mock.calls.seek).toEqual([33])
    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/seek-toggle.mp3',
      title: 'Seek toggle',
      meta: { coverImgUrl: '', epname: 'Course', singer: '' },
    }])
    expect(mock.calls.play).toBe(1)
    expect(store.currentTime).toBe(33)
  })

  test('close discards a seek queued during URL resolution', async () => {
    const mock = makeMockBackend()
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => signer.promise),
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/seek-close.mp3', title: 'Seek close', duration: 60 }

    const request = store.playPlaylist([track], 0, { ...META, postId: 'seek-close-post' })
    store.seek(44)
    store.close()
    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/seek-close.mp3' }])
    await request

    expect(mock.calls.seek).toEqual([])
    expect(mock.calls.setSrc).toEqual([])
    expect(mock.calls.play).toBe(0)
  })

  test('keeps seek pending after source install until onPlay, then later seeks are immediate', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/seek-active.mp3',
      title: 'Seek active',
      duration: 60,
    }], 0, { ...META, postId: 'seek-active-post' })

    expect(store.playbackPending).toBe(true)
    store.seek(18)

    expect(mock.calls.seek).toEqual([])
    expect(store.currentTime).toBe(18)

    mock.handlers.onPlay?.()
    expect(mock.calls.seek).toEqual([18])

    store.seek(24)
    expect(mock.calls.seek).toEqual([18, 24])
    expect(store.currentTime).toBe(24)
  })

  test('does not seek the old active source after the replacement has no playable URL', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(async () => []),
    })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/source-a.mp3',
      title: 'Source A',
      duration: 60,
    }], 0, { ...META, postId: 'source-a-post' })
    mock.handlers.onTimeUpdate?.(14)

    await store.playPlaylist([{
      fileID: 'cloud://audio/missing-b.mp3',
      title: 'Missing B',
      duration: 80,
    }], 0, { ...META, postId: 'missing-b-post' })
    store.seek(25)

    expect(store.currentTrack?.title).toBe('Missing B')
    expect(store.playbackPending).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([])
  })

  test('makes a pre-onPlay error terminal and resets optimistic pending seek time', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/error-before-play.mp3',
      title: 'Error before play',
      duration: 60,
    }], 0, { ...META, postId: 'error-before-play-post' })
    store.seek(31)

    mock.handlers.onError?.(new Error('source failed before play'))

    expect(store.playbackPending).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([])

    mock.handlers.onPlay?.()
    expect(store.isPlaying).toBe(false)
    expect(mock.calls.seek).toEqual([])
  })

  test('exposes a retryable playback error and clears it when retry starts', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    const track = {
      fileID: 'https://cdn/retry-after-error.mp3',
      title: 'Retry after error',
      duration: 60,
    }

    await store.playPlaylist([track], 0, { ...META, postId: 'retry-after-error-post' })
    mock.handlers.onError?.(new Error('network failed'))

    expect(store.playbackPending).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.playbackError).toBe('音频加载失败，请重试')

    await store.togglePlay()

    expect(store.playbackError).toBe('')
    expect(store.playbackPending).toBe(true)
    mock.handlers.onPlay?.()
    expect(store.isPlaying).toBe(true)
  })

  test('makes a synchronous setSrc failure terminal and ignores late onPlay', async () => {
    const mock = makeMockBackend({
      emitPlayEvent: false,
      setSrcError: new Error('setSrc failed'),
    })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()

    const request = store.playPlaylist([{
      fileID: 'https://cdn/set-src-throws.mp3',
      title: 'setSrc throws',
      duration: 60,
    }], 0, { ...META, postId: 'set-src-throws-post' })
    store.seek(17)

    await expect(request).resolves.toBeUndefined()
    expect(store.playbackPending).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([])

    mock.handlers.onPlay?.()
    expect(store.isPlaying).toBe(false)
    expect(mock.calls.seek).toEqual([])
  })

  test('makes a synchronous play failure terminal and ignores late onPlay', async () => {
    const mock = makeMockBackend({
      emitPlayEvent: false,
      playError: new Error('play failed'),
    })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()

    const request = store.playPlaylist([{
      fileID: 'https://cdn/play-throws.mp3',
      title: 'play throws',
      duration: 60,
    }], 0, { ...META, postId: 'play-throws-post' })
    store.seek(19)

    await expect(request).resolves.toBeUndefined()
    expect(store.playbackPending).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.seek).toEqual([])

    mock.handlers.onPlay?.()
    expect(store.isPlaying).toBe(false)
    expect(mock.calls.seek).toEqual([])
  })

  test('repeated toggle preserves optimistic time for an unactivated request', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/cancel-before-play.mp3',
      title: 'Cancel before play',
      duration: 60,
    }], 0, { ...META, postId: 'cancel-before-play-post' })
    store.seek(33)

    await store.togglePlay()

    expect(store.playbackPending).toBe(true)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTime).toBe(33)
    expect(mock.calls.seek).toEqual([])
  })

  test('retries an unready source from zero and accepts only the retry generation seek', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    const retrySigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    let retrying = false
    const getTempFileURL = vi.fn(() => (
      retrying ? retrySigner.promise : Promise.resolve([])
    ))
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/retry.mp3', title: 'Retry', duration: 70 }
    await store.playPlaylist([track], 0, { ...META, postId: 'retry-post' })

    retrying = true
    const retryRequest = store.togglePlay()
    expect(store.currentTime).toBe(0)
    store.seek(22)
    retrySigner.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/retry.mp3' }])
    await retryRequest

    expect(mock.calls.seek).toEqual([])
    mock.handlers.onPlay?.()
    expect(mock.calls.seek).toEqual([22])
    expect(store.currentTime).toBe(22)
  })

  test('preserves an active position across normal pause and resume', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/pause-resume.mp3',
      title: 'Pause resume',
      duration: 90,
    }], 0, { ...META, postId: 'pause-resume-post' })
    mock.handlers.onTimeUpdate?.(27)

    await store.togglePlay()
    expect(store.currentTime).toBe(27)

    await store.togglePlay()

    expect(store.currentTime).toBe(27)
    expect(mock.calls.seek).toEqual([27])
    expect(store.isPlaying).toBe(true)
  })

  test('allows only the latest fast playlist switch to reach the backend', async () => {
    const mock = makeMockBackend()
    const slowSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const fastSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const getTempFileURL = vi.fn((fileIDs: string[]) => (
      fileIDs.includes('cloud://audio/slow.mp3') ? slowSigner.promise : fastSigner.promise
    ))
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    const slowTrack = { fileID: 'cloud://audio/slow.mp3', title: 'Slow', duration: 10, cover: 'cloud://cover/slow.jpg' }
    const fastTrack = { fileID: 'cloud://audio/fast.mp3', title: 'Fast', duration: 20, cover: 'cloud://cover/fast.jpg' }
    const slowMeta = { ...META, postId: 'post-slow', postTitle: 'Slow post' }
    const fastMeta = { ...META, postId: 'post-fast', postTitle: 'Fast post' }

    const slowRequest = store.playPlaylist([slowTrack], 0, slowMeta)
    const fastRequest = store.playPlaylist([fastTrack], 0, fastMeta)

    expect(mock.calls.pause).toBe(1)
    expect(store.isPlaying).toBe(false)
    fastSigner.resolve([
      { fileID: fastTrack.fileID, tempFileURL: 'https://signed/fast.mp3' },
      { fileID: fastTrack.cover, tempFileURL: 'https://signed/fast.jpg' },
    ])
    await fastRequest
    slowSigner.resolve([
      { fileID: slowTrack.fileID, tempFileURL: 'https://signed/slow.mp3' },
      { fileID: slowTrack.cover, tempFileURL: 'https://signed/slow.jpg' },
    ])
    await slowRequest

    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/fast.mp3',
      title: 'Fast',
      meta: { coverImgUrl: 'https://signed/fast.jpg', epname: 'Fast post', singer: '' },
    }])
    expect(mock.calls.play).toBe(1)
    expect(store.currentMeta?.postId).toBe('post-fast')
  })

  test('ignores callbacks captured from an older active track', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([
      { fileID: 'https://cdn/old.mp3', title: 'Old', duration: 10 },
    ], 0, { ...META, postId: 'old-post' })
    const staleHandlers = { ...mock.handlers }

    await store.playPlaylist([
      { fileID: 'https://cdn/new-1.mp3', title: 'New 1', duration: 20 },
      { fileID: 'https://cdn/new-2.mp3', title: 'New 2', duration: 30 },
    ], 0, { ...META, postId: 'new-post' })
    const setSrcCount = mock.calls.setSrc.length
    const playCount = mock.calls.play

    staleHandlers.onTimeUpdate?.(88)
    staleHandlers.onError?.(new Error('stale source failed'))
    staleHandlers.onEnded?.()
    await Promise.resolve()

    expect(store.currentIndex).toBe(0)
    expect(store.currentTime).toBe(0)
    expect(store.isPlaying).toBe(true)
    expect(mock.calls.setSrc).toHaveLength(setSrcCount)
    expect(mock.calls.play).toBe(playCount)
  })

  test('ignores queued ended and time updates routed to new handlers before the new source plays', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([
      { fileID: 'https://cdn/old.mp3', title: 'Old', duration: 10 },
    ], 0, { ...META, postId: 'old-post' })
    mock.handlers.onPlay?.()

    await store.playPlaylist([
      { fileID: 'https://cdn/new-1.mp3', title: 'New 1', duration: 20 },
      { fileID: 'https://cdn/new-2.mp3', title: 'New 2', duration: 30 },
    ], 0, { ...META, postId: 'new-post' })
    const setSrcCount = mock.calls.setSrc.length
    const playCount = mock.calls.play

    mock.handlers.onTimeUpdate?.(88)
    mock.handlers.onEnded?.()
    await Promise.resolve()

    expect(store.currentIndex).toBe(0)
    expect(store.currentTime).toBe(0)
    expect(mock.calls.setSrc).toHaveLength(setSrcCount)
    expect(mock.calls.play).toBe(playCount)

    mock.handlers.onPlay?.()
    mock.handlers.onTimeUpdate?.(6)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTime).toBe(6)
  })

  test('keeps the pending play intent when toggle is tapped again before onPlay', async () => {
    const mock = makeMockBackend({ emitPlayEvent: false })
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist([
      { fileID: 'https://cdn/pending-start.mp3', title: 'Pending start', duration: 20 },
    ], 0, { ...META, postId: 'pending-start-post' })
    const setSrcCount = mock.calls.setSrc.length
    const playCount = mock.calls.play

    await store.togglePlay()
    mock.handlers.onPlay?.()

    expect(mock.calls.setSrc).toHaveLength(setSrcCount)
    expect(mock.calls.play).toBe(playCount)
    expect(mock.calls.pause).toBe(0)
    expect(store.isPlaying).toBe(true)
  })

  test('keeps the pending play intent when toggle is tapped again during URL resolution', async () => {
    const mock = makeMockBackend()
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const getTempFileURL = vi.fn(() => signer.promise)
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/pending.mp3', title: 'Pending', duration: 40 }

    const playRequest = store.playPlaylist([track], 0, { ...META, postId: 'pending-post' })
    const duplicateRequest = store.togglePlay()
    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/pending.mp3' }])
    await Promise.all([playRequest, duplicateRequest])

    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/pending.mp3',
      title: 'Pending',
      meta: { coverImgUrl: '', epname: 'Course', singer: '' },
    }])
    expect(mock.calls.play).toBe(1)
    expect(mock.calls.pause).toBe(0)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTrack?.fileID).toBe(track.fileID)
  })

  test('keeps a repeated request for the same pending track idempotent', async () => {
    const mock = makeMockBackend()
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    const getTempFileURL = vi.fn(() => signer.promise)
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()

    const firstRequest = store.playPlaylist(TRACKS, 1, META)
    const duplicateRequest = store.playPlaylist(TRACKS, 1, META)

    expect(getTempFileURL).toHaveBeenCalledTimes(1)
    expect(mock.calls.pause).toBe(0)

    signer.resolve([
      { fileID: TRACKS[1].fileID, tempFileURL: 'https://signed/two.mp3' },
    ])
    await Promise.all([firstRequest, duplicateRequest])

    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/two.mp3',
      title: 'Lesson 2',
      meta: { coverImgUrl: '', epname: 'Course', singer: '' },
    }])
    expect(mock.calls.play).toBe(1)
    expect(store.isPlaying).toBe(true)
  })

  test('keeps URL, title, cover, and post metadata from one immutable request snapshot', async () => {
    const mock = makeMockBackend()
    const preload = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    let signerCallCount = 0
    const getTempFileURL = vi.fn((fileIDs: string[]) => {
      signerCallCount += 1
      if (signerCallCount === 1) return preload.promise
      return Promise.resolve(fileIDs.map(fileID => ({ fileID, tempFileURL: `https://signed/${fileID}` })))
    })
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    const track = {
      fileID: 'cloud://audio/original.mp3',
      title: 'Original title',
      duration: 50,
      cover: 'cloud://cover/original.jpg',
    }
    const meta = { ...META, postId: 'snapshot-post', postTitle: 'Original post' }

    const request = store.playPlaylist([track], 0, meta)
    track.title = 'Mutated title'
    track.cover = 'cloud://cover/mutated.jpg'
    meta.postTitle = 'Mutated post'
    preload.resolve([
      { fileID: 'cloud://audio/original.mp3', tempFileURL: 'https://signed/original.mp3' },
      { fileID: 'cloud://cover/original.jpg', tempFileURL: 'https://signed/original.jpg' },
    ])
    await request

    expect(getTempFileURL).toHaveBeenCalledTimes(1)
    expect(mock.calls.setSrc).toEqual([{
      url: 'https://signed/original.mp3',
      title: 'Original title',
      meta: { coverImgUrl: 'https://signed/original.jpg', epname: 'Original post', singer: '' },
    }])
  })

  test('close cancels a request waiting for its signed cover', async () => {
    const mock = makeMockBackend()
    const coverSigner = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    let signerCallCount = 0
    const getTempFileURL = vi.fn((fileIDs: string[]) => {
      signerCallCount += 1
      if (signerCallCount === 1) {
        return Promise.resolve([{
          fileID: 'cloud://audio/closing.mp3',
          tempFileURL: 'https://signed/closing.mp3',
        }])
      }
      return coverSigner.promise
    })
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL,
    })
    const store = useAudioStore()
    const request = store.playPlaylist([{
      fileID: 'cloud://audio/closing.mp3',
      title: 'Closing',
      duration: 60,
      cover: 'cloud://cover/closing.jpg',
    }], 0, { ...META, postId: 'closing-post' })
    await vi.waitFor(() => expect(getTempFileURL).toHaveBeenCalledTimes(2))

    store.close()
    coverSigner.resolve([{
      fileID: 'cloud://cover/closing.jpg',
      tempFileURL: 'https://signed/closing.jpg',
    }])

    await expect(request).resolves.toBeUndefined()
    expect(mock.calls.setSrc).toEqual([])
    expect(mock.calls.play).toBe(0)
    expect(store.currentPlaylist).toEqual([])
    expect(store.currentMeta).toBeNull()
  })

  test('detail leave cancels only a matching pending playback request', async () => {
    const mock = makeMockBackend()
    const signer = deferred<Array<{ fileID: string; tempFileURL: string }>>()
    _setAudioStoreDepsForTesting({
      backend: mock.backend,
      storage: makeStorage().storage,
      getTempFileURL: vi.fn(() => signer.promise),
    })
    const store = useAudioStore()
    const track = { fileID: 'cloud://audio/leaving.mp3', title: 'Leaving', duration: 60 }
    const request = store.playPlaylist([track], 0, { ...META, postId: 'leaving-post' })

    store.cancelPendingPlaybackForPost('another-post')
    expect(store.playbackPending).toBe(true)
    expect(mock.calls.stop).toBe(0)

    store.cancelPendingPlaybackForPost('leaving-post')
    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/leaving.mp3' }])
    await request

    expect(mock.calls.stop).toBe(1)
    expect(mock.calls.setSrc).toEqual([])
    expect(mock.calls.play).toBe(0)
    expect(store.currentPlaylist).toEqual([])
    expect(store.currentMeta).toBeNull()
  })

  test('detail leave keeps established background playback running', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    store.cancelPendingPlaybackForPost(META.postId)

    expect(mock.calls.stop).toBe(0)
    expect(store.isPlaying).toBe(true)
    expect(store.currentPlaylist).toEqual(TRACKS)
    expect(store.currentMeta).toEqual(META)
  })

  test('close stops backend and clears audio state', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    store.close()

    expect(mock.calls.stop).toBe(1)
    expect(store.isVisible).toBe(false)
    expect(store.isPlaying).toBe(false)
    expect(store.currentPlaylist).toEqual([])
    expect(store.currentMeta).toBeNull()
    expect(store.currentIndex).toBe(0)
    expect(store.currentTime).toBe(0)
  })

  test('float position persists for backward compatibility', () => {
    const storage = makeStorage()
    _setAudioStoreDepsForTesting({ backend: makeMockBackend().backend, storage: storage.storage })
    const store = useAudioStore()

    store.setFloatPosition(88, 166)

    expect(store.floatPosition).toEqual({ x: 88, y: 166 })
    expect(storage.data.get('audio_float_position')).toEqual({ x: 88, y: 166 })
  })
})
