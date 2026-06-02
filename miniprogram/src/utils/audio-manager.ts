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
  private bound = false
  private handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}

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
    this.handlers = {}
    this.bound = false
  }

  bind(handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>>) {
    this.handlers = handlers
    if (this.bound) return
    this.bound = true
    this.bgm.onPlay?.(() => this.handlers.onPlay?.())
    this.bgm.onPause?.(() => this.handlers.onPause?.())
    this.bgm.onStop?.(() => this.handlers.onPause?.())
    this.bgm.onEnded?.(() => this.handlers.onEnded?.())
    this.bgm.onError?.((err: any) => this.handlers.onError?.(err))
    this.bgm.onTimeUpdate?.(() => {
      const currentTime = Number(this.bgm.currentTime || 0)
      this.handlers.onTimeUpdate?.(currentTime)
    })
  }
}

class HtmlAudioBackend implements AudioBackend {
  private audio: HTMLAudioElement | null = null
  private handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>> = {}
  private bound = false

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
    try {
      const result = this.getAudio().play()
      if (result && typeof result.then === 'function') {
        result.catch((err) => this.handlers.onError?.(err))
      }
    } catch (err) {
      this.handlers.onError?.(err)
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
      try {
        this.audio.pause()
        this.audio.src = ''
      } catch (_error) {}
    }
    this.audio = null
    this.handlers = {}
    this.bound = false
  }

  bind(handlers: Partial<Record<AudioBackendEvent, (...args: any[]) => void>>) {
    this.handlers = handlers
    if (this.bound) return
    this.bound = true
    const audio = this.getAudio()
    audio.addEventListener('play', () => this.handlers.onPlay?.())
    audio.addEventListener('pause', () => this.handlers.onPause?.())
    audio.addEventListener('ended', () => this.handlers.onEnded?.())
    audio.addEventListener('error', () => this.handlers.onError?.(audio.error))
    audio.addEventListener('timeupdate', () => {
      this.handlers.onTimeUpdate?.(audio.currentTime || 0)
    })
  }
}
