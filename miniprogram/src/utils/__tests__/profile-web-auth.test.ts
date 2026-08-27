import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')

describe('profile H5 Web auth UI', () => {
  test('keeps the logged-out Figma shell until the user activates the identity entry', () => {
    const mountedBlock = source.slice(source.indexOf('onMounted(() => {'), source.indexOf('// tabBar 切回 Profile'))
    const openLoginEntryBlock = source.slice(source.indexOf('function openLoginEntry()'), source.indexOf('function goOnboarding()'))

    expect(mountedBlock).not.toContain('showManualLoginForm.value = true')
    expect(source).toMatch(/data-testid="profile-login-entry"[\s\S]*@tap\.stop="openLoginEntry"/)
    expect(openLoginEntryBlock).toContain('showManualLoginForm.value = true')
  })

  test('has accessible persistent Web credentials without exposing DEV login on H5', () => {
    expect(source).toContain('autocomplete="username"')
    expect(source).toContain('autocomplete="current-password"')
    expect(source).toContain('password')
    expect(source).toMatch(/#ifndef H5[\s\S]*DEV 登录/)
  })

  test('offers async logout at the bottom and clears the password when closing the login form', () => {
    expect(source).toContain('退出登录')
    expect(source).toContain('await userStore.logout()')
    expect(source).toContain('closeManualLoginForm')
    expect(source).toMatch(/function closeManualLoginForm[\s\S]*webPassword\.value = ''/)
    expect(source).not.toContain('profile-web-logout')
    expect(source).toContain('data-testid="h5-logout"')
    expect(source).toMatch(/退出当前社区[\s\S]*#ifdef H5[\s\S]*class="profile-secondary-action profile-secondary-action--logout"[\s\S]*webLogoutLock\.run\(\)/)
  })

  test('shows login as the only community action while signed out', () => {
    expect(source).toMatch(/v-if="userStore\.isLoggedIn && !showManualLoginForm"[\s\S]*data-testid="profile-invite-action"/)
    expect(source).toMatch(/v-if="userStore\.isLoggedIn && !showManualLoginForm"[\s\S]*data-testid="profile-leave-community-action"/)
    expect(source).toMatch(/#ifdef H5[\s\S]*v-else-if="!showManualLoginForm"[\s\S]*data-testid="profile-logged-out-login-action"[\s\S]*@tap="openLoginEntry"[\s\S]*>登录<\/button>[\s\S]*#endif/)
    expect(source).toMatch(/#ifndef H5[\s\S]*v-else-if="!showManualLoginForm"[\s\S]*data-testid="profile-logged-out-login-action"[\s\S]*open-type="chooseAvatar"[\s\S]*@chooseavatar="onLoginChooseAvatar"[\s\S]*>登录<\/button>[\s\S]*#endif/)
  })
})
