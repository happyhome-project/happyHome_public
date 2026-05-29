import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  _clearCloudFileUrlCacheForTesting,
  resolveCloudFileUrl,
  resolveCloudFileUrls,
} from '../cloud-file-url'

describe('cloud file url resolver', () => {
  beforeEach(() => {
    _clearCloudFileUrlCacheForTesting()
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
})
