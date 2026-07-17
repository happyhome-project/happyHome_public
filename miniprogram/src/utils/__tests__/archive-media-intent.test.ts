import { describe, expect, test, vi } from 'vitest'

describe('archive media intent', () => {
  test('provides a versioned local handoff API', async () => {
    const module = await import('../archive-media-intent').catch(() => ({} as any))
    expect(typeof (module as any).storeArchiveMediaIntent).toBe('function')
    expect(typeof (module as any).consumeArchiveMediaIntent).toBe('function')
    expect((module as any).ARCHIVE_MEDIA_INTENT_VERSION).toBe(1)
  })

  test('stores media locally and consumes it once without URL serialization', async () => {
    vi.resetModules()
    const storage = new Map<string, any>()
    vi.stubGlobal('uni', {
      setStorageSync: (key: string, value: any) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
    })
    const module = await import('../archive-media-intent').catch(() => ({} as any))
    expect(typeof (module as any).storeArchiveMediaIntent).toBe('function')
    if (typeof (module as any).storeArchiveMediaIntent !== 'function') return

    const file = { name: 'family.mp4', type: 'video/mp4', size: 42 }
    const token = (module as any).storeArchiveMediaIntent('video', [file])
    expect(token).toMatch(/^media-/)
    expect(JSON.stringify(storage)).not.toContain('blob:')
    expect((module as any).peekArchiveMediaIntent(token)).toMatchObject({ mediaType: 'video' })
    expect((module as any).peekArchiveMediaIntent(token)).toMatchObject({ mediaType: 'video' })
    expect((module as any).consumeArchiveMediaIntent(token)).toMatchObject({
      version: 1, mediaType: 'video', files: [file],
    })
    expect((module as any).consumeArchiveMediaIntent(token)).toBeNull()
  })

  test('expires volatile files and revokes owned preview URLs', async () => {
    vi.resetModules()
    const revokeObjectURL = vi.fn()
    const NativeURL = globalThis.URL
    class URLWithObjectUrl extends NativeURL {
      static revokeObjectURL = revokeObjectURL
    }
    vi.stubGlobal('URL', URLWithObjectUrl)
    vi.stubGlobal('uni', { setStorageSync: vi.fn(), getStorageSync: vi.fn(), removeStorageSync: vi.fn() })
    const module = await import('../archive-media-intent')
    const token = module.storeArchiveMediaIntent('image', [{ source: {} as Blob, objectUrl: 'blob:owned', name: 'a.jpg', type: 'image/jpeg', size: 1 } as any], 100)
    expect(module.sweepArchiveMediaIntents(100 + module.ARCHIVE_MEDIA_INTENT_TTL_MS + 1)).toBe(1)
    expect(module.peekArchiveMediaIntent(token, 100 + module.ARCHIVE_MEDIA_INTENT_TTL_MS + 1)).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned')
    vi.unstubAllGlobals()
  })

  test('sweeps persisted intents after a simulated process restart', async () => {
    vi.resetModules()
    const storage = new Map<string, any>()
    vi.stubGlobal('uni', {
      setStorageSync: (key: string, value: any) => storage.set(key, value),
      getStorageSync: (key: string) => storage.get(key),
      removeStorageSync: (key: string) => storage.delete(key),
    })
    let module = await import('../archive-media-intent')
    const token = module.storeArchiveMediaIntent('image', [{ source: 'wxfile://a.jpg', name: 'a.jpg', type: 'image/jpeg', size: 1 }], 100)
    expect(storage.has(module.ARCHIVE_MEDIA_INTENT_INDEX_KEY)).toBe(true)
    expect(storage.has(`${module.ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX}${token}`)).toBe(true)

    vi.resetModules()
    module = await import('../archive-media-intent')
    expect(module.sweepArchiveMediaIntents(100 + module.ARCHIVE_MEDIA_INTENT_TTL_MS + 1)).toBe(1)
    expect(storage.has(`${module.ARCHIVE_MEDIA_INTENT_STORAGE_PREFIX}${token}`)).toBe(false)
    expect(storage.get(module.ARCHIVE_MEDIA_INTENT_INDEX_KEY)).toEqual([])

    storage.set(module.ARCHIVE_MEDIA_INTENT_INDEX_KEY, { malformed: true })
    expect(() => module.sweepArchiveMediaIntents()).not.toThrow()
  })
})
