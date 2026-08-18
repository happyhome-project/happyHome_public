import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  _resetAudioBackendForTesting,
  ensureAudioBackend,
} from '../audio-manager'
import { _setAudioStoreDepsForTesting, useAudioStore } from '../../store/audio'

type Listener = (...args: any[]) => void

const htmlPlayResults: Array<Promise<void>> = []
let htmlAudio: FakeHtmlAudio | null = null

class FakeHtmlAudio {
  preload = ''
  src = ''
  error: Error | null = null
  seekAssignments: number[] = []
  private time = 0
  private listeners = new Map<string, Set<Listener>>()

  constructor() {
    htmlAudio = this
  }

  get currentTime() {
    return this.time
  }

  set currentTime(value: number) {
    this.time = value
    this.seekAssignments.push(value)
  }

  play() {
    return htmlPlayResults.shift() || Promise.resolve()
  }

  pause() {}

  addEventListener(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) || new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  removeEventListener(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
  }

  snapshot(event: string): Listener[] {
    return Array.from(this.listeners.get(event) || [])
  }

  emit(event: string) {
    for (const listener of this.snapshot(event)) listener()
  }

}

class FakeWxBackgroundAudio {
  title = ''
  epname = ''
  singer = ''
  coverImgUrl = ''
  src = ''
  currentTime = 0
  seeks: number[] = []
  private listeners = new Map<string, Set<Listener>>()

  play() {}
  pause() {}
  stop() {}
  seek(seconds: number) { this.seeks.push(seconds) }

  onPlay(listener: Listener) { this.add('play', listener) }
  offPlay(listener: Listener) { this.remove('play', listener) }
  onPause(listener: Listener) { this.add('pause', listener) }
  offPause(listener: Listener) { this.remove('pause', listener) }
  onStop(listener: Listener) { this.add('stop', listener) }
  offStop(listener: Listener) { this.remove('stop', listener) }
  onEnded(listener: Listener) { this.add('ended', listener) }
  offEnded(listener: Listener) { this.remove('ended', listener) }
  onError(listener: Listener) { this.add('error', listener) }
  offError(listener: Listener) { this.remove('error', listener) }
  onTimeUpdate(listener: Listener) { this.add('timeupdate', listener) }
  offTimeUpdate(listener: Listener) { this.remove('timeupdate', listener) }

  snapshot(event: string): Listener[] {
    return Array.from(this.listeners.get(event) || [])
  }

  emit(event: string) {
    for (const listener of this.snapshot(event)) listener()
  }

  has(event: string, listener: Listener) {
    return this.listeners.get(event)?.has(listener) || false
  }

  private add(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) || new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  private remove(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
  }
}

function rejectable() {
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

function makeStorage() {
  const data = new Map<string, unknown>()
  return {
    get: (key: string) => data.get(key) ?? null,
    set: (key: string, value: unknown) => { data.set(key, value) },
  }
}

const META = {
  postId: 'post-a',
  postTitle: 'Post A',
  sectionId: 'section-1',
  communityId: 'community-1',
}

function installHtmlBackend() {
  vi.stubGlobal('wx', undefined)
  vi.stubGlobal('Audio', FakeHtmlAudio)
  const backend = ensureAudioBackend()
  _setAudioStoreDepsForTesting({
    backend,
    storage: makeStorage(),
    getTempFileURL: async (fileIDs: string[]) => (
      fileIDs.map(fileID => ({ fileID, tempFileURL: fileID }))
    ),
  })
  return backend
}

beforeEach(() => {
  _resetAudioBackendForTesting()
  htmlPlayResults.length = 0
  htmlAudio = null
  setActivePinia(createPinia())
})

afterEach(() => {
  _resetAudioBackendForTesting()
  vi.unstubAllGlobals()
})

describe('audio backend attempt ownership', () => {
  test('a detached HTML play callback keeps the handlers from its bind', () => {
    const backend = installHtmlBackend()
    const oldPlay = vi.fn()
    const newPlay = vi.fn()
    backend.bind({ onPlay: oldPlay })
    const detachedOldPlay = htmlAudio?.snapshot('play')[0]
    expect(detachedOldPlay).toBeTypeOf('function')

    backend.bind({ onPlay: newPlay })
    detachedOldPlay?.()

    expect(oldPlay).toHaveBeenCalledTimes(1)
    expect(newPlay).not.toHaveBeenCalled()

    htmlAudio?.emit('play')
    expect(newPlay).toHaveBeenCalledTimes(1)
  })

  test('a detached WeChat play callback keeps the handlers from its bind', () => {
    const bgm = new FakeWxBackgroundAudio()
    vi.stubGlobal('wx', { getBackgroundAudioManager: () => bgm })
    const backend = ensureAudioBackend()
    const oldPlay = vi.fn()
    const newPlay = vi.fn()
    backend.bind({ onPlay: oldPlay })
    const detachedOldPlay = bgm.snapshot('play')[0]
    expect(detachedOldPlay).toBeTypeOf('function')

    backend.bind({ onPlay: newPlay })
    detachedOldPlay?.()

    expect(oldPlay).toHaveBeenCalledTimes(1)
    expect(newPlay).not.toHaveBeenCalled()
    expect(bgm.has('play', detachedOldPlay as Listener)).toBe(false)
    expect(bgm.snapshot('play')).toHaveLength(1)

    bgm.emit('play')
    expect(newPlay).toHaveBeenCalledTimes(1)

    backend.destroy()
    expect(bgm.snapshot('play')).toEqual([])
  })

  test('a detached old HTML callback cannot activate the replacement store request', async () => {
    htmlPlayResults.push(Promise.resolve(), Promise.resolve())
    installHtmlBackend()
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/source-a.mp3',
      title: 'Source A',
      duration: 60,
    }], 0, META)
    const detachedSourceAPlay = htmlAudio?.snapshot('play')[0]
    htmlAudio?.emit('play')

    await store.playPlaylist([{
      fileID: 'https://cdn/source-b.mp3',
      title: 'Source B',
      duration: 80,
    }], 0, { ...META, postId: 'post-b', postTitle: 'Post B' })
    store.seek(22)
    detachedSourceAPlay?.()

    expect(store.playbackPending).toBe(true)
    expect(store.isPlaying).toBe(false)
    expect(htmlAudio?.seekAssignments).toEqual([])

    htmlAudio?.emit('play')
    expect(store.isPlaying).toBe(true)
    expect(htmlAudio?.seekAssignments).toEqual([22])
  })

  test('a stale HTML play rejection cannot clear the replacement pending seek', async () => {
    const sourceAPlay = rejectable()
    htmlPlayResults.push(sourceAPlay.promise, Promise.resolve())
    installHtmlBackend()
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/reject-a.mp3',
      title: 'Reject A',
      duration: 60,
    }], 0, META)
    htmlAudio?.emit('play')

    await store.playPlaylist([{
      fileID: 'https://cdn/pending-b.mp3',
      title: 'Pending B',
      duration: 80,
    }], 0, { ...META, postId: 'pending-b', postTitle: 'Pending B' })
    store.seek(22)
    sourceAPlay.reject(new Error('source A was aborted'))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.playbackPending).toBe(true)
    expect(store.currentTime).toBe(22)
    expect(htmlAudio?.seekAssignments).toEqual([])

    htmlAudio?.emit('play')
    expect(store.isPlaying).toBe(true)
    expect(htmlAudio?.seekAssignments).toEqual([22])
  })

  test('the current HTML play rejection fails that request and ignores its late onPlay', async () => {
    const currentPlay = rejectable()
    htmlPlayResults.push(currentPlay.promise)
    installHtmlBackend()
    const store = useAudioStore()
    await store.playPlaylist([{
      fileID: 'https://cdn/reject-current.mp3',
      title: 'Reject current',
      duration: 60,
    }], 0, META)
    store.seek(19)

    currentPlay.reject(new Error('current source failed'))
    await Promise.resolve()
    await Promise.resolve()

    expect(store.playbackPending).toBe(false)
    expect(store.currentTime).toBe(0)
    expect(store.isPlaying).toBe(false)

    htmlAudio?.emit('play')
    expect(store.isPlaying).toBe(false)
    expect(htmlAudio?.seekAssignments).toEqual([])
  })
})
