import { describe, expect, test } from 'vitest'

import {
  buildHomeImageKey,
  clearFailedHomeImageProbeEntries,
  summarizeHomeImageProbe,
  upsertHomeImageProbeEntry,
} from '../home-image-probe'

describe('home image probe', () => {
  test('clears only failed entries when a current image retries', () => {
    const bannerKey = buildHomeImageKey('banner', 'cloud://banner')
    const guideKey = buildHomeImageKey('guide', 'cloud://guide')
    const seeded = upsertHomeImageProbeEntry(
      upsertHomeImageProbeEntry({}, {
        key: bannerKey,
        kind: 'banner',
        src: 'https://tmp/banner',
        label: 'Banner',
        status: 'loaded',
        updatedAt: '2026-07-06T00:00:00.000Z',
      }),
      {
        key: guideKey,
        kind: 'guide',
        src: 'https://tmp/guide',
        label: 'Guide',
        status: 'failed',
        updatedAt: '2026-07-06T00:00:00.000Z',
      },
    )

    const next = clearFailedHomeImageProbeEntries(seeded, [bannerKey, guideKey])

    expect(next[bannerKey]?.status).toBe('loaded')
    expect(next[guideKey]).toBeUndefined()
  })

  test('summarizes current home images and treats empty image sets as satisfied', () => {
    const summary = summarizeHomeImageProbe([], {})

    expect(summary).toMatchObject({
      currentImageCount: 0,
      loadedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      hasRendered: false,
      satisfied: true,
    })
  })

  test('dedupes keys and accepts graceful fallback once all current images are resolved', () => {
    const bannerKey = buildHomeImageKey('banner', 'cloud://banner')
    const entries = {
      [bannerKey]: {
        key: bannerKey,
        kind: 'banner' as const,
        src: 'https://tmp/banner',
        label: 'Banner',
        status: 'failed' as const,
        updatedAt: '2026-07-06T00:00:00.000Z',
      },
    }

    const summary = summarizeHomeImageProbe([bannerKey, bannerKey], entries)

    expect(summary).toMatchObject({
      currentImageCount: 1,
      loadedCount: 0,
      failedCount: 1,
      pendingCount: 0,
      hasRendered: false,
      satisfied: true,
    })
  })

  test('does not satisfy release evidence while current images are still pending', () => {
    const bannerKey = buildHomeImageKey('banner', 'cloud://banner')

    const summary = summarizeHomeImageProbe([bannerKey], {})

    expect(summary).toMatchObject({
      currentImageCount: 1,
      loadedCount: 0,
      failedCount: 0,
      pendingCount: 1,
      hasRendered: false,
      satisfied: false,
    })
  })
})
