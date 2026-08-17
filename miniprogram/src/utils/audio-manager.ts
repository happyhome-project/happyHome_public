export type AudioBackendEvent =
  | 'onPlay'
  | 'onPause'
  | 'onEnded'
  | 'onError'
  | 'onTimeUpdate'

export interface AudioBackendMeta {
  coverImgUrl?: string
  epname?: string
  singer?: string
}

export interface AudioBackend {
  setSrc(url: string, title: string, meta?: AudioBackendMeta): void
  play(): void
  pause(): void
  stop(): void
  seek(seconds: number): void
  destroy(): void
  bind(handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>>): void
}

let instance: AudioBackend | null = null

export function _resetAudioBackendForTesting() {
  if (instance) {
    try { instance.destroy() } catch (_error) {}
  }
  instance = null
}

export function _setAudioBackendForTesting(backend: AudioBackend | null) {
  instance = backend
}

export function ensureAudioBackend(): AudioBackend {
  if (instance) return instance
  instance = createBackend()
  return instance
}

function createBackend(): AudioBackend {
  if (
    typeof wx !== 'undefined' &&
    typeof (wx as any).getBackgroundAudioManager === 'function'
  ) {
    return new WxBackgroundAudioBackend()
  }
  return new HtmlAudioBackend()
}

class WxBackgroundAudioBackend implements AudioBackend {
  private bgm: any
  private listeners: Partial<Record<AudioBackendEvent | 'onStop', (...args: any[]) => void>> = {}

  constructor() {
    this.bgm = (wx as any).getBackgroundAudioManager()
  }

  setSrc(url: string, title: string, meta: AudioBackendMeta = {}) {
    this.bgm.title = title || '音频'
    this.bgm.epname = meta.epname || ''
    this.bgm.singer = meta.singer || ''
    this.bgm.coverImgUrl = meta.coverImgUrl || ''
    this.bgm.src = url
  }

  play() {
    if (typeof this.bgm.play === 'function') this.bgm.play()
  }

  pause() {
    if (typeof this.bgm.pause === 'function') this.bgm.pause()
  }

  stop() {
    if (typeof this.bgm.stop === 'function') this.bgm.stop()
  }

  seek(seconds: number) {
    if (typeof this.bgm.seek === 'function') this.bgm.seek(seconds)
    else this.bgm.currentTime = seconds
  }

  destroy() {
    this.unbind()
  }

  bind(handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>>) {
    this.unbind()
    const listeners = {
      onPlay: () => handlers.onPlay?.(),
      onPause: () => handlers.onPause?.(),
      onStop: () => handlers.onPause?.(),
      onEnded: () => handlers.onEnded?.(),
      onError: (err: any) => handlers.onError?.(err),
      onTimeUpdate: () => {
        const currentTime = Number(this.bgm.currentTime || 0)
        handlers.onTimeUpdate?.(currentTime)
      },
    }
    this.listeners = listeners
    this.bgm.onPlay?.(listeners.onPlay)
    this.bgm.onPause?.(listeners.onPause)
    this.bgm.onStop?.(listeners.onStop)
    this.bgm.onEnded?.(listeners.onEnded)
    this.bgm.onError?.(listeners.onError)
    this.bgm.onTimeUpdate?.(listeners.onTimeUpdate)
  }

  private unbind() {
    const listeners = this.listeners
    if (listeners.onPlay) this.bgm.offPlay?.(listeners.onPlay)
    if (listeners.onPause) this.bgm.offPause?.(listeners.onPause)
    if (listeners.onStop) this.bgm.offStop?.(listeners.onStop)
    if (listeners.onEnded) this.bgm.offEnded?.(listeners.onEnded)
    if (listeners.onError) this.bgm.offError?.(listeners.onError)
    if (listeners.onTimeUpdate) this.bgm.offTimeUpdate?.(listeners.onTimeUpdate)
    this.listeners = {}
  }
}

class HtmlAudioBackend implements AudioBackend {
  private audio: HTMLAudioElement | null = null
  private handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}
  private listeners: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}

  private getAudio(): HTMLAudioElement {
    if (!this.audio) {
      if (typeof Audio === 'undefined') {
        throw new Error('Audio constructor not available')
      }
      this.audio = new Audio()
      this.audio.preload = 'auto'
    }
    return this.audio
  }

  setSrc(url: string, _title: string, _meta?: AudioBackendMeta) {
    const audio = this.getAudio()
    if (audio.src !== url) audio.src = url
  }

  play() {
    const handlers = this.handlers
    try {
      const result = this.getAudio().play()
      if (result && typeof result.then === 'function') {
        result.catch((err) => handlers.onError?.(err))
      }
    } catch (err) {
      handlers.onError?.(err)
    }
  }

  pause() {
    try { this.audio?.pause() } catch (_error) {}
  }

  stop() {
    try {
      if (this.audio) {
        this.audio.pause()
        this.audio.currentTime = 0
      }
    } catch (_error) {}
  }

  seek(seconds: number) {
    try {
      this.getAudio().currentTime = seconds
    } catch (_error) {}
  }

  destroy() {
    if (this.audio) {
      this.unbind(this.audio)
      try {
        this.audio.pause()
        this.audio.src = ''
      } catch (_error) {}
    }
    this.audio = null
    this.handlers = {}
  }

  bind(handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>>) {
    const audio = this.getAudio()
    this.unbind(audio)
    this.handlers = handlers
    const listeners = {
      onPlay: () => handlers.onPlay?.(),
      onPause: () => handlers.onPause?.(),
      onEnded: () => handlers.onEnded?.(),
      onError: () => handlers.onError?.(audio.error),
      onTimeUpdate: () => handlers.onTimeUpdate?.(audio.currentTime || 0),
    }
    this.listeners = listeners
    audio.addEventListener('play', listeners.onPlay)
    audio.addEventListener('pause', listeners.onPause)
    audio.addEventListener('ended', listeners.onEnded)
    audio.addEventListener('error', listeners.onError)
    audio.addEventListener('timeupdate', listeners.onTimeUpdate)
  }

  private unbind(audio: HTMLAudioElement) {
    const listeners = this.listeners
    if (listeners.onPlay) audio.removeEventListener('play', listeners.onPlay)
    if (listeners.onPause) audio.removeEventListener('pause', listeners.onPause)
    if (listeners.onEnded) audio.removeEventListener('ended', listeners.onEnded)
    if (listeners.onError) audio.removeEventListener('error', listeners.onError)
    if (listeners.onTimeUpdate) audio.removeEventListener('timeupdate', listeners.onTimeUpdate)
    this.listeners = {}
  }
}
