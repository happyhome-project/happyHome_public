import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readSource(relativePath: string) {
  return readFileSync(resolve(srcRoot, relativePath), 'utf-8')
}

describe('profile page visible debug output', () => {
  test('does not render internal state labels or debug version prefixes on the profile page', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).not.toContain('profile-debug-banner')
    expect(code).not.toContain('profileDebugText')
    expect(code).not.toContain('login-version')
    expect(code).not.toContain('profile-version')
    expect(code).not.toContain('ver:')
    expect(code).not.toContain('state:')
    expect(code).not.toContain('login:')
    expect(code).not.toContain('cc:')
  })

  test('keeps official build version text for the release UI gate', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain('release-build-version')
    expect(code).toContain('BUILD_INFO')
    expect(code).toContain('appVersion')
  })
})
