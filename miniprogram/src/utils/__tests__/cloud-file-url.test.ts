import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  _clearCloudFileUrlCacheForTesting,
  refreshCloudFileUrl,
  resolveCloudFileUrl,
  resolveCloudFileUrls,
} from '../cloud-file-url'

describe('cloud file url resolver', () => {
  beforeEach(() => {
    _clearCloudFileUrlCacheForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('converts cloud fileID to temporary url', async () => {
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://tmp.example/${encodeURIComponent(fileID)}` })),
    )

    await expect(resolveCloudFileUrl('cloud://env/avatars/a.jpg', { getTempFileURL })).resolves.toBe(
      'https://tmp.example/cloud%3A%2F%2Fenv%2Favatars%2Fa.jpg',
    )
    expect(getTempFileURL).toHaveBeenCalledWith(['cloud://env/avatars/a.jpg'])
  })

  test('reuses cached temporary url for repeated cloud fileID', async () => {
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://tmp.example/${fileID}` })),
    )

    await resolveCloudFileUrl('cloud://env/avatars/a.jpg', { getTempFileURL })
    await resolveCloudFileUrl('cloud://env/avatars/a.jpg', { getTempFileURL })

    expect(getTempFileURL).toHaveBeenCalledTimes(1)
  })

  test('batch converts cloud fileIDs while leaving non-cloud urls unchanged', async () => {
    const getTempFileURL = vi.fn(async (fileIDs: string[]) =>
      fileIDs.map((fileID) => ({ fileID, tempFileURL: `https://tmp.example/${fileID}` })),
    )

    const result = await resolveCloudFileUrls([
      'cloud://env/avatars/a.jpg',
      'https://cdn.example/b.jpg',
      '',
      'cloud://env/avatars/a.jpg',
    ], { getTempFileURL })

    expect(result).toEqual({
      'cloud://env/avatars/a.jpg': 'https://tmp.example/cloud://env/avatars/a.jpg',
      'https://cdn.example/b.jpg': 'https://cdn.example/b.jpg',
      '': '',
    })
    expect(getTempFileURL).toHaveBeenCalledTimes(1)
  })

  test('retries only the missing entries when a batch returns partial success', async () => {
    const first = 'cloud://env/posts/first.jpg'
    const second = 'cloud://env/posts/second.jpg'
    const getTempFileURL = vi.fn(async (fileIDs: string[]) => {
      if (fileIDs.length > 1) {
        return [
          { fileID: first, status: 0, tempFileURL: 'https://tmp.example/first.jpg' },
          { fileID: second, status: -1, errMsg: 'temporary failure', tempFileURL: '' },
        ]
      }
      return [{ fileID: second, status: 0, tempFileURL: 'https://tmp.example/second.jpg' }]
    })

    await expect(resolveCloudFileUrls([first, second], { getTempFileURL })).resolves.toEqual({
      [first]: 'https://tmp.example/first.jpg',
      [second]: 'https://tmp.example/second.jpg',
    })
    expect(getTempFileURL).toHaveBeenNthCalledWith(1, [first, second])
    expect(getTempFileURL).toHaveBeenNthCalledWith(2, [second])
  })

  test('refreshes a failed temporary URL through its canonical cloud fileID', async () => {
    const fileID = 'cloud://env/posts/cover.jpg'
    let version = 0
    const getTempFileURL = vi.fn(async () => [{
      fileID,
      status: 0,
      tempFileURL: `https://tmp.example/cover-v${++version}.jpg`,
    }])

    const first = await resolveCloudFileUrl(fileID, { getTempFileURL })
    await expect(refreshCloudFileUrl(first, { getTempFileURL })).resolves.toBe(
      'https://tmp.example/cover-v2.jpg',
    )
    expect(getTempFileURL).toHaveBeenNthCalledWith(2, [fileID])
  })

  test('splits URL requests at the documented 50-file batch boundary', async () => {
    const fileIDs = Array.from({ length: 51 }, (_, index) => `cloud://env/posts/${index}.jpg`)
    const getTempFileURL = vi.fn(async (batch: string[]) =>
      batch.map((fileID) => ({ fileID, status: 0, tempFileURL: `https://tmp.example/${fileID}` })),
    )

    const resolved = await resolveCloudFileUrls(fileIDs, { getTempFileURL })

    expect(Object.keys(resolved)).toHaveLength(51)
    expect(getTempFileURL).toHaveBeenNthCalledWith(1, fileIDs.slice(0, 50))
    expect(getTempFileURL).toHaveBeenNthCalledWith(2, fileIDs.slice(50))
  })

  test('never falls back to a cached URL after the provider-reported maxAge expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-23T00:00:00.000Z'))
    const fileID = 'cloud://env/posts/expiring.jpg'
    let available = true
    const getTempFileURL = vi.fn(async () => available
      ? [{ fileID, status: 0, maxAge: 120_000, tempFileURL: 'https://tmp.example/expiring.jpg' }]
      : [])

    await expect(resolveCloudFileUrls([fileID], { getTempFileURL })).resolves.toEqual({
      [fileID]: 'https://tmp.example/expiring.jpg',
    })
    available = false
    vi.advanceTimersByTime(60_001)

    await expect(resolveCloudFileUrls([fileID], { getTempFileURL })).resolves.toEqual({
      [fileID]: fileID,
    })
  })
})
