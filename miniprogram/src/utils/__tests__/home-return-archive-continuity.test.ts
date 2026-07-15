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

  test('invalidates the previous community feed before refreshing a new community', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../pages/index/index.vue'), 'utf8')

    expect(source).toContain('invalidateArchiveForCommunityTransition(selection.targetCommunityId)')
    expect(source).toMatch(/archiveRequestEpoch\s*\+=\s*1/)
    expect(source).toMatch(/archiveColumns\.value\s*=\s*\[\[\],\s*\[\]\]/)
    expect(source).toMatch(/archiveTabs\.value\s*=\s*\[\{\s*topicKey:\s*['"]['"],\s*displayName:\s*['"]全部['"]\s*\}\]/)
  })
})
