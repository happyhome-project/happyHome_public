import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { _setAudioStoreDepsForTesting, useAudioStore } from '../audio'
import type { AudioBackend, AudioBackendEvent, AudioBackendMeta } from '../../utils/audio-manager'

function makeMockBackend(options: { emitPlayEvent?: boolean } = {}) {
  const handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}
  const calls = {
    setSrc: [] as Array<{ url: string; title: string; meta?: AudioBackendMeta }>,
    play: 0,
    pause: 0,
    stop: 0,
    seek: [] as number[],
  }
  const backend: AudioBackend = {
    setSrc(url, title, meta) { calls.setSrc.push({ url, title, meta }) },
    play() {
      calls.play += 1
      if (options.emitPlayEvent !== false) handlers.onPlay?.()
    },
    pause() { calls.pause += 1; handlers.onPause?.() },
    stop() { calls.stop += 1 },
    seek(seconds) { calls.seek.push(seconds) },
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

    await store.togglePlay()
    await store.togglePlay()

    expect(getTempFileURL).toHaveBeenCalledTimes(1)
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

  test('lets toggle cancel autoplay after setSrc while the backend is still waiting to play', async () => {
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
    expect(mock.calls.pause).toBe(1)
    expect(store.isPlaying).toBe(false)
  })

  test('treats toggle during URL resolution as cancellation of pending autoplay', async () => {
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
    const cancelRequest = store.togglePlay()
    signer.resolve([{ fileID: track.fileID, tempFileURL: 'https://signed/pending.mp3' }])
    await Promise.all([playRequest, cancelRequest])

    expect(mock.calls.setSrc).toEqual([])
    expect(mock.calls.play).toBe(0)
    expect(store.isPlaying).toBe(false)
    expect(store.currentTrack?.fileID).toBe(track.fileID)
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
