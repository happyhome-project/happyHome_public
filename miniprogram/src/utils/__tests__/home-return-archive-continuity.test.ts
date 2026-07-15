import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('home archive continuity after returning from a detail page', () => {
  test('keeps same-community cards visible while onShow refreshes in the background', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')

    expect(source).toContain('preserveArchive: true')
    expect(source).toMatch(/archiveCommunityId\.value\s*===\s*communityId/)
    expect(source).toMatch(/if\s*\(!preserveVisibleArchive\)\s*\{\s*archiveColumns\.value\s*=\s*\[\[\],\s*\[\]\]/s)
    expect(source).toMatch(/archiveLoading\.value\s*=\s*!preserveVisibleArchive/)
    expect(source).toMatch(/archiveCommunityId\.value\s*=\s*communityId/)
  })
})
