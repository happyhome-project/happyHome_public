import { defineStore } from 'pinia'
import {
  ensureAudioBackend,
  type AudioBackend,
  type AudioBackendEvent,
} from '../utils/audio-manager'
import { getCloudTempFileURL } from '../api/storage'

export interface AudioTrackLite {
  fileID: string
  title: string
  duration: number
  cover?: string
}

export interface PlaylistMeta {
  postId: string
  postTitle: string
  sectionId: string
  communityId: string
}

export interface FloatPosition {
  x: number
  y: number
}

interface UrlCacheEntry {
  url: string
  expiresAt: number
}

interface PlaybackRequestSnapshot {
  playlist: AudioTrackLite[]
  index: number
  track: AudioTrackLite
  meta: PlaylistMeta
}

export interface AudioStoreDeps {
  storage: {
    get(key: string): unknown
    set(key: string, value: unknown): void
  }
  getTempFileURL?: (fileIDs: string[]) => Promise<Array<{ fileID: string; tempFileURL: string }>>
  backend?: AudioBackend
}

const STORAGE_KEY_POSITION = 'audio_float_position'
const URL_REFRESH_BUFFER_MS = 5 * 60 * 1000
const TEMP_URL_TTL_MS = 2 * 60 * 60 * 1000

let deps: AudioStoreDeps = {
  storage: {
    get: (key) => {
      try { return uni.getStorageSync(key) } catch (_error) { return null }
    },
    set: (key, value) => {
      try { uni.setStorageSync(key, value) } catch (_error) {}
    },
  },
  getTempFileURL: getCloudTempFileURL,
}

function isResolvedMediaUrl(value: string): boolean {
  return /^(?:https?:\/\/|blob:|data:|file:|wxfile:|\/)/i.test(value)
}

function createPlaybackRequestSnapshot(
  list: AudioTrackLite[],
  index: number,
  meta: PlaylistMeta | null,
): PlaybackRequestSnapshot | null {
  if (!Array.isArray(list) || list.length === 0 || !meta) return null
  const safeIndex = index >= 0 && index < list.length ? index : 0
  const playlist = list.map(track => ({ ...track }))
  return {
    playlist,
    index: safeIndex,
    track: { ...playlist[safeIndex] },
    meta: { ...meta },
  }
}

export function _setAudioStoreDepsForTesting(overrides: Partial<AudioStoreDeps>) {
  deps = Object.assign({}, deps, overrides)
}

export const useAudioStore = defineStore('audio', {
  state: () => ({
    currentPlaylist: [] as AudioTrackLite[],
    currentMeta: null as PlaylistMeta | null,
    currentIndex: 0,
    isPlaying: false,
    isVisible: false,
    floatPosition: { x: 20, y: 480 } as FloatPosition,
    httpsUrlCache: {} as Record<string, UrlCacheEntry>,
    currentTime: 0,
    playbackGeneration: 0,
    playbackPending: false,
  }),
  getters: {
    currentTrack: (state) => state.currentPlaylist[state.currentIndex] || null,
    canPrev: (state) => state.currentIndex > 0,
    canNext: (state) => state.currentIndex < state.currentPlaylist.length - 1,
  },
  actions: {
    loadPositionFromStorage() {
      const saved = deps.storage.get(STORAGE_KEY_POSITION) as FloatPosition | null
      if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
        this.floatPosition = saved
      }
    },
    setFloatPosition(x: number, y: number) {
      this.floatPosition = { x, y }
      deps.storage.set(STORAGE_KEY_POSITION, { x, y })
    },
    async playPlaylist(list: AudioTrackLite[], startIdx: number, meta: PlaylistMeta) {
      const snapshot = createPlaybackRequestSnapshot(list, startIdx, meta)
      if (!snapshot) return
      const shouldPause = this.currentPlaylist.length > 0 || this.playbackPending || this.isPlaying
      const generation = this._beginPlaybackRequest(shouldPause)
      this.currentPlaylist = snapshot.playlist.map(track => ({ ...track }))
      this.currentMeta = { ...snapshot.meta }
      this.currentIndex = snapshot.index
      this.currentTime = 0
      this.isVisible = false
      await this._playSnapshot(snapshot, generation)
    },
    async togglePlay() {
      if (this.currentPlaylist.length === 0) return
      const backend = this._backend()
      if (this.playbackPending) {
        this._invalidatePlaybackRequest()
        try { backend.pause() } catch (_error) {}
        return
      }
      if (this.isPlaying) {
        this._invalidatePlaybackRequest()
        try { backend.pause() } catch (_error) {}
        return
      }
      const snapshot = createPlaybackRequestSnapshot(this.currentPlaylist, this.currentIndex, this.currentMeta)
      if (!snapshot) return
      const generation = this._beginPlaybackRequest(false)
      await this._playSnapshot(snapshot, generation)
    },
    async next() {
      if (!this.canNext) return
      const snapshot = createPlaybackRequestSnapshot(this.currentPlaylist, this.currentIndex + 1, this.currentMeta)
      if (!snapshot) return
      const generation = this._beginPlaybackRequest(true)
      this.currentIndex = snapshot.index
      this.currentTime = 0
      await this._playSnapshot(snapshot, generation)
    },
    async prev() {
      if (!this.canPrev) return
      const snapshot = createPlaybackRequestSnapshot(this.currentPlaylist, this.currentIndex - 1, this.currentMeta)
      if (!snapshot) return
      const generation = this._beginPlaybackRequest(true)
      this.currentIndex = snapshot.index
      this.currentTime = 0
      await this._playSnapshot(snapshot, generation)
    },
    seek(seconds: number) {
      if (this.currentPlaylist.length === 0) return
      this.currentTime = seconds
      this._backend().seek(seconds)
    },
    close() {
      this._invalidatePlaybackRequest()
      try { this._backend().stop() } catch (_error) {}
      this.isVisible = false
      this.currentPlaylist = []
      this.currentMeta = null
      this.currentIndex = 0
      this.currentTime = 0
    },
    _backend(): AudioBackend {
      return deps.backend || ensureAudioBackend()
    },
    _beginPlaybackRequest(shouldPause: boolean): number {
      const backend = this._backend()
      this.playbackGeneration += 1
      this.playbackPending = true
      this.isPlaying = false
      if (shouldPause) {
        try { backend.pause() } catch (_error) {}
      }
      return this.playbackGeneration
    },
    _invalidatePlaybackRequest() {
      this.playbackGeneration += 1
      this.playbackPending = false
      this.isPlaying = false
    },
    _isCurrentPlaybackRequest(generation: number): boolean {
      return generation === this.playbackGeneration
    },
    _bindPlaybackEvents(backend: AudioBackend, generation: number) {
      let activated = false
      backend.bind({
        onPlay: () => {
          if (!this._isCurrentPlaybackRequest(generation)) return
          activated = true
          this.playbackPending = false
          this.isPlaying = true
        },
        onPause: () => {
          if (!this._isCurrentPlaybackRequest(generation) || !activated) return
          this.playbackPending = false
          this.isPlaying = false
        },
        onEnded: () => {
          if (!this._isCurrentPlaybackRequest(generation) || !activated) return
          this.playbackPending = false
          this.isPlaying = false
          if (this.canNext) void this.next()
        },
        onTimeUpdate: (seconds: number) => {
          if (!this._isCurrentPlaybackRequest(generation) || !activated) return
          this.currentTime = seconds
        },
        onError: () => {
          if (!this._isCurrentPlaybackRequest(generation)) return
          this.playbackPending = false
          this.isPlaying = false
        },
      } as Record<AudioBackendEvent, (...args: any[]) => void>)
    },
    async _playSnapshot(snapshot: PlaybackRequestSnapshot, generation: number) {
      await this._preloadUrls(
        snapshot.playlist.flatMap(item => [item.fileID, item.cover || '']).filter(Boolean),
      )
      if (!this._isCurrentPlaybackRequest(generation)) return
      const url = await this._urlFor(snapshot.track.fileID)
      if (!this._isCurrentPlaybackRequest(generation)) return
      if (!url) {
        this.playbackPending = false
        return
      }
      const coverImgUrl = snapshot.track.cover ? await this._urlFor(snapshot.track.cover) : ''
      if (!this._isCurrentPlaybackRequest(generation)) return
      const backend = this._backend()
      this._bindPlaybackEvents(backend, generation)
      backend.setSrc(url, snapshot.track.title, {
        coverImgUrl,
        epname: snapshot.meta.postTitle,
        singer: '',
      })
      if (!this._isCurrentPlaybackRequest(generation)) return
      backend.play()
    },
    async _preloadUrls(fileIDs: string[]) {
      const fetchFn = deps.getTempFileURL
      if (!fetchFn) return
      const now = Date.now()
      const stale = fileIDs.filter((fileID) => !isResolvedMediaUrl(fileID)).filter((fileID) => {
        const cached = this.httpsUrlCache[fileID]
        return !cached || cached.expiresAt - now < URL_REFRESH_BUFFER_MS
      })
      if (stale.length === 0) return
      try {
        const results = await fetchFn(stale)
        const expiresAt = now + TEMP_URL_TTL_MS
        const next = Object.assign({}, this.httpsUrlCache)
        for (const result of results) {
          next[result.fileID] = { url: result.tempFileURL, expiresAt }
        }
        this.httpsUrlCache = next
      } catch (error) {
        console.warn('[audio] preload failed', error)
      }
    },
    async _urlFor(fileID: string): Promise<string> {
      if (!fileID) return ''
      if (isResolvedMediaUrl(fileID)) return fileID
      const now = Date.now()
      const cached = this.httpsUrlCache[fileID]
      if (cached && cached.expiresAt - now > URL_REFRESH_BUFFER_MS) return cached.url
      const fetchFn = deps.getTempFileURL
      if (!fetchFn) return cached ? cached.url : ''
      try {
        const results = await fetchFn([fileID])
        const expiresAt = now + TEMP_URL_TTL_MS
        const next = Object.assign({}, this.httpsUrlCache)
        for (const result of results) {
          next[result.fileID] = { url: result.tempFileURL, expiresAt }
        }
        this.httpsUrlCache = next
        return next[fileID] ? next[fileID].url : ''
      } catch (error) {
        console.warn('[audio] url failed', error)
        return cached ? cached.url : ''
      }
    },
  },
})
