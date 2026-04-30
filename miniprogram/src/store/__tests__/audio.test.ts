import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { _setAudioStoreDepsForTesting, useAudioStore } from '../audio'
import type { AudioBackend, AudioBackendEvent } from '../../utils/audio-manager'

function makeMockBackend() {
  const handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}
  const calls = {
    setSrc: [] as Array<{ url: string; title: string }>,
    play: 0,
    pause: 0,
    stop: 0,
    seek: [] as number[],
  }
  const backend: AudioBackend = {
    setSrc(url, title) { calls.setSrc.push({ url, title }) },
    play() { calls.play += 1; handlers.onPlay?.() },
    pause() { calls.pause += 1; handlers.onPause?.() },
    stop() { calls.stop += 1 },
    seek(seconds) { calls.seek.push(seconds) },
    destroy() {},
    bind(nextHandlers) { Object.assign(handlers, nextHandlers) },
  }
  return { backend, handlers, calls }
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
  { fileID: 'cloud://audio/1.mp3', title: '第一讲', duration: 100 },
  { fileID: 'cloud://audio/2.mp3', title: '第二讲', duration: 120 },
]

const META = {
  postId: 'post-1',
  postTitle: '课程',
  sectionId: 'section-1',
  communityId: 'community-1',
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('audio store', () => {
  test('playPlaylist sets playlist, resolves URL and starts backend', async () => {
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

    expect(store.isVisible).toBe(true)
    expect(store.isPlaying).toBe(true)
    expect(store.currentTrack?.title).toBe('第一讲')
    expect(mock.calls.setSrc[0]).toEqual({ url: 'https://cdn/cloud://audio/1.mp3', title: '第一讲' })
    expect(mock.calls.play).toBe(1)
  })

  test('next and prev switch tracks', async () => {
    const mock = makeMockBackend()
    _setAudioStoreDepsForTesting({ backend: mock.backend, storage: makeStorage().storage })
    const store = useAudioStore()
    await store.playPlaylist(TRACKS, 0, META)

    await store.next()
    expect(store.currentIndex).toBe(1)
    expect(store.currentTrack?.title).toBe('第二讲')

    await store.prev()
    expect(store.currentIndex).toBe(0)
    expect(store.currentTrack?.title).toBe('第一讲')
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

  test('float position persists', () => {
    const storage = makeStorage()
    _setAudioStoreDepsForTesting({ backend: makeMockBackend().backend, storage: storage.storage })
    const store = useAudioStore()

    store.setFloatPosition(88, 166)

    expect(store.floatPosition).toEqual({ x: 88, y: 166 })
    expect(storage.data.get('audio_float_position')).toEqual({ x: 88, y: 166 })
  })
})
