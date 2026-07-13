import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readSource(relativePath: string) {
  return readFileSync(resolve(srcRoot, relativePath), 'utf-8')
}

describe('profile page visible debug output', () => {
  test('does not render internal state labels or login-card version labels on the profile page', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).not.toContain('profile-debug-banner')
    expect(code).not.toContain('profileDebugText')
    expect(code).not.toContain('login-version')
    expect(code).not.toContain('release-build-version')
    expect(code).not.toContain('state:')
    expect(code).not.toContain('login:')
    expect(code).not.toContain('cc:')
  })

  test('keeps build metadata out of the Figma profile page surface', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain(':data-build-version="releaseVersion"')
    expect(code).not.toMatch(/<text[^>]*>\s*\{\{\s*releaseVersion\s*\}\}\s*<\/text>/)
    expect(code).not.toContain('profile-version')
    expect(code).not.toContain('<text>ver: {{ appVersion }}</text>')
    expect(code).not.toContain('BUILD_INFO')
    expect(code).not.toContain('__HH_BUILD_VERSION__')
    expect(code).not.toContain('appVersion')
    expect(code.match(/ver:/g) || []).toHaveLength(0)
  })

  test('defaults developer tools off and requires both local opt-in and a non-release environment', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).toContain("uni.getStorageSync('hh-profile-developer-tools') === '1'")
    expect(code).toMatch(/envVersion === 'develop' \|\| envVersion === 'trial'/)
    expect(code).toMatch(/const developerToolsEnabled = computed\(\(\) => \{/)
    expect(code).toMatch(/v-if="developerToolsEnabled"[^>]*class="login-alt-row"/)
    expect(code).toMatch(/v-if="developerToolsEnabled && showDevLogin"[^>]*class="dev-modal-mask"/)
  })

  test('keeps the default logged-out identity surface to the avatar and 登录 label', () => {
    const code = readSource('pages/profile/index.vue')

    expect(code).not.toContain('>微信登录</button>')
    expect(code).toMatch(/<template v-else>[\s\S]*class="avatar"[\s\S]*\{\{ profileDisplayName \}\}[\s\S]*v-if="supportsChooseAvatar"[\s\S]*class="profile-login-hit"/)
  })
})
