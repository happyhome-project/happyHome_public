import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/pages/profile/index.vue'), 'utf8')

describe('profile H5 Web auth UI', () => {
  test('has accessible persistent Web credentials without exposing DEV login on H5', () => {
    expect(source).toContain('autocomplete="username"')
    expect(source).toContain('autocomplete="current-password"')
    expect(source).toContain('password')
    expect(source).toMatch(/#ifndef H5[\s\S]*DEV 登录/)
  })

  test('offers async logout and clears the password when closing the login form', () => {
    expect(source).toContain('退出登录')
    expect(source).toContain('await userStore.logout()')
    expect(source).toContain('closeManualLoginForm')
    expect(source).toMatch(/function closeManualLoginForm[\s\S]*webPassword\.value = ''/)
  })
})
