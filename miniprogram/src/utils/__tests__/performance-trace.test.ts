import { describe, expect, test, vi } from 'vitest'
import {
  createAdaptiveAvatarUploader,
  createLatestEpoch,
  sanitizePerformanceTrace,
} from '../performance-trace'

describe('performance trace', () => {
  test('keeps only non-sensitive, bounded fields', () => {
    expect(sanitizePerformanceTrace({
      requestId: ' login/123 ',
      stage: 'profile.login',
      sample: 'warm',
      counts: { communityCount: 3, bad: Number.NaN, negative: -1 },
      nickName: 'secret',
      avatarUrl: 'cloud://secret',
      location: 'secret',
    } as any)).toEqual({
      requestId: 'login/123',
      stage: 'profile.login',
      sample: 'warm',
      counts: { communityCount: 3 },
    })
  })

  test('epoch rejects late work after a newer request starts', () => {
    const epoch = createLatestEpoch()
    const first = epoch.begin()
    const second = epoch.begin()
    expect(epoch.isCurrent(first)).toBe(false)
    expect(epoch.isCurrent(second)).toBe(true)
  })
})

describe('adaptive avatar uploader', () => {
  test('does not upload a successful slow large source twice and prefers compression next time', async () => {
    let now = 0
    const upload = vi.fn(async (source: string) => {
      now += 900
      return { fileID: `cloud://${source}` }
    })
    const compress = vi.fn(async (source: string) => `${source}.compressed`)
    const uploader = createAdaptiveAvatarUploader({
      getSize: vi.fn(async () => 600 * 1024),
      compress,
      upload,
      now: () => now,
    })

    await expect(uploader.upload('original-a')).resolves.toEqual({ fileID: 'cloud://original-a' })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(compress).not.toHaveBeenCalled()

    await uploader.upload('original-b')
    expect(compress).toHaveBeenCalledWith('original-b', 80)
    expect(upload).toHaveBeenLastCalledWith('original-b.compressed')
  })

  test('retries a slow failed large upload with quality 80 compression', async () => {
    let now = 0
    const upload = vi.fn(async (source: string) => {
      now += 900
      if (source === 'original') throw new Error('network')
      return { fileID: 'cloud://compressed' }
    })
    const compress = vi.fn(async () => 'compressed')
    const uploader = createAdaptiveAvatarUploader({
      getSize: vi.fn(async () => 700 * 1024),
      compress,
      upload,
      now: () => now,
    })

    await expect(uploader.upload('original')).resolves.toEqual({ fileID: 'cloud://compressed' })
    expect(compress).toHaveBeenCalledWith('original', 80)
    expect(upload.mock.calls.map(([source]) => source)).toEqual(['original', 'compressed'])
  })

  test('falls back to the original source when preferred compression fails', async () => {
    let now = 0
    const upload = vi.fn(async (source: string) => {
      now += 900
      return { fileID: `cloud://${source}` }
    })
    const compress = vi.fn().mockRejectedValueOnce(new Error('compress failed'))
    const uploader = createAdaptiveAvatarUploader({
      getSize: vi.fn(async () => 700 * 1024),
      compress,
      upload,
      now: () => now,
    })

    await uploader.upload('original-a')
    await expect(uploader.upload('original-b')).resolves.toEqual({ fileID: 'cloud://original-b' })
    expect(upload.mock.calls.map(([source]) => source)).toEqual(['original-a', 'original-b'])
  })
})
