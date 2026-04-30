import { defineStore } from 'pinia'
import {
  ensureAudioBackend,
  type AudioBackend,
  type AudioBackendEvent,
} from '../utils/audio-manager'

export interface AudioTrackLite {
  fileID: string
  title: string
  duration: number
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
      try { return uni.getStorageSync(key) } catch { return null }
    },
    set: (key, value) => {
      try { uni.setStorageSync(key, value) } catch {}
    },
  },
  getTempFileURL: async (fileIDs) => {
    if (typeof wx === 'undefined' || !wx?.cloud?.getTempFileURL) {
      return fileIDs.map((fileID) => ({ fileID, tempFileURL: fileID }))
    }
    const res = await wx.cloud.getTempFileURL({ fileList: fileIDs })
    return (res.fileList || []).map((item: any) => ({
      fileID: String(item.fileID),
      tempFileURL: String(item.tempFileURL),
    }))
  },
}

export function _setAudioStoreDepsForTesting(overrides: Partial<AudioStoreDeps>) {
  deps = { ...deps, ...overrides }
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
      if (!Array.isArray(list) || list.length === 0) return
      const safeIdx = startIdx >= 0 && startIdx < list.length ? startIdx : 0
      this.currentPlaylist = list.slice()
      this.currentMeta = meta
      this.currentIndex = safeIdx
      this.currentTime = 0
      this.isVisible = true
      await this._preloadUrls(list.map((item) => item.fileID))
      await this._playCurrent()
    },
    async togglePlay() {
      if (this.currentPlaylist.length === 0) return
      const backend = this._backend()
      if (this.isPlaying) {
        backend.pause()
        return
      }
      if (!this.currentTrack) return
      const url = await this._urlFor(this.currentTrack.fileID)
      if (!url) return
      backend.setSrc(url, this.currentTrack.title)
      backend.play()
    },
    async next() {
      if (!this.canNext) return
      this.currentIndex += 1
      this.currentTime = 0
      await this._playCurrent()
    },
    async prev() {
      if (!this.canPrev) return
      this.currentIndex -= 1
      this.currentTime = 0
      await this._playCurrent()
    },
    seek(seconds: number) {
      if (this.currentPlaylist.length === 0) return
      this.currentTime = seconds
      this._backend().seek(seconds)
    },
    close() {
      try { this._backend().stop() } catch {}
      this.isPlaying = false
      this.isVisible = false
      this.currentPlaylist = []
      this.currentMeta = null
      this.currentIndex = 0
      this.currentTime = 0
    },
    _backend(): AudioBackend {
      const backend = deps.backend ?? ensureAudioBackend()
      backend.bind({
        onPlay: () => { this.isPlaying = true },
        onPause: () => { this.isPlaying = false },
        onEnded: () => {
          this.isPlaying = false
          if (this.canNext) void this.next()
        },
        onTimeUpdate: (seconds: number) => { this.currentTime = seconds },
        onError: () => { this.isPlaying = false },
      } as Record<AudioBackendEvent, (...args: any[]) => void>)
      return backend
    },
    async _playCurrent() {
      if (!this.currentTrack) return
      const url = await this._urlFor(this.currentTrack.fileID)
      if (!url) return
      const backend = this._backend()
      backend.setSrc(url, this.currentTrack.title)
      backend.play()
    },
    async _preloadUrls(fileIDs: string[]) {
      const fetchFn = deps.getTempFileURL
      if (!fetchFn) return
      const now = Date.now()
      const stale = fileIDs.filter((fileID) => {
        const cached = this.httpsUrlCache[fileID]
        return !cached || cached.expiresAt - now < URL_REFRESH_BUFFER_MS
      })
      if (stale.length === 0) return
      try {
        const results = await fetchFn(stale)
        const expiresAt = now + TEMP_URL_TTL_MS
        const next = { ...this.httpsUrlCache }
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
      const now = Date.now()
      const cached = this.httpsUrlCache[fileID]
      if (cached && cached.expiresAt - now > URL_REFRESH_BUFFER_MS) return cached.url
      const fetchFn = deps.getTempFileURL
      if (!fetchFn) return cached?.url || ''
      try {
        const results = await fetchFn([fileID])
        const expiresAt = now + TEMP_URL_TTL_MS
        const next = { ...this.httpsUrlCache }
        for (const result of results) {
          next[result.fileID] = { url: result.tempFileURL, expiresAt }
        }
        this.httpsUrlCache = next
        return next[fileID]?.url || ''
      } catch (error) {
        console.warn('[audio] url failed', error)
        return cached?.url || ''
      }
    },
  },
})
