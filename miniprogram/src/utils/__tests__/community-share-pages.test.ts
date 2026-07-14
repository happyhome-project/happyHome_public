import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readSource(relativePath: string) {
  return readFileSync(resolve(srcRoot, relativePath), 'utf-8')
}

describe('community share page integration contract', () => {
  test('home page registers native community sharing and resolves cloud cover images', () => {
    const code = readSource('pages/index/index.vue')

    expect(code).toContain('onShareAppMessage')
    expect(code).toContain('buildCommunitySharePath')
    expect(code).toContain('resolveCloudFileUrl')
    expect(code).toContain('handleInitialShareLanding')
    expect(code).toContain('CommunityShareImageCanvas')
    expect(code).toContain('communityInitial')
    expect(code).not.toContain('imageUrl: shareImageUrl.value || DEFAULT_COMMUNITY_SHARE_IMAGE')
  })

  test('share canvas prepares a probed cover or an offscreen initial png', () => {
    const code = readSource('components/CommunityShareImageCanvas.vue')

    expect(code).toContain('uni.getImageInfo')
    expect(code).toContain('uni.createCanvasContext')
    expect(code).toContain('uni.canvasToTempFilePath')
    expect(code).toContain('width="500"')
    expect(code).toContain('height="400"')
    expect(code).toContain('position: fixed')
    expect(code).not.toContain('display: none')
  })

  test('profile shares the current community with the prepared image', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain('CommunityShareImageCanvas')
    expect(code).toContain(':cover-image="currentCommunityCoverImage"')
    expect(code).not.toContain('imageUrl: DEFAULT_COMMUNITY_SHARE_IMAGE')
  })

  test.each([
    'pages/index/index.vue',
    'pages/community-switch/index.vue',
    'pages/onboarding/index.vue',
  ])('%s uses the shared grapheme-safe community initial', (page) => {
    expect(readSource(page)).toContain('communityInitial')
  })

  test('onboarding page keeps shared target community visible and highlighted', () => {
    const code = readSource('pages/onboarding/index.vue')

    expect(code).toContain('prioritizeShareTargetCommunities')
    expect(code).toContain('share-target')
    expect(code).toContain('targetCommunityId')
  })

  test('profile login restores pending shared community intent', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain('consumePendingShareCommunity')
    expect(code).toContain('restorePendingShareCommunity')
    expect(code).toContain('openOnboardingPreservingStack({ mode: \'discover\', communityId })')
  })
})
