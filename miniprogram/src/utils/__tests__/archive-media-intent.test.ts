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
})
