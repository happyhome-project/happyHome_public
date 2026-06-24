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
    expect(code).toContain('buildCommunityOnboardingPath')
  })
})
