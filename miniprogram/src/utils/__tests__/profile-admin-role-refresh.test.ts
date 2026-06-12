import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

describe('profile admin role refresh contract', () => {
  test('profile refresh revalidates cached user role before loading approval state', () => {
    const code = readSource('pages/profile/index.vue')
    const refreshFunctionIndex = code.indexOf('async function refreshProfileData')
    const roleRefreshIndex = code.indexOf('await userStore.refreshLoginRole()', refreshFunctionIndex)
    const loadProfileDataIndex = code.indexOf('await loadProfileDataAfterRoleResolved(reason)', roleRefreshIndex)

    expect(refreshFunctionIndex).toBeGreaterThan(-1)
    expect(roleRefreshIndex).toBeGreaterThan(-1)
    expect(loadProfileDataIndex).toBeGreaterThan(roleRefreshIndex)
  })

  test('user store can refresh role through user.login without requiring a visible login flow', () => {
    const code = readSource('store/user.ts')

    expect(code).toContain('async refreshLoginRole()')
    expect(code).toContain("if (!this.isLoggedIn) return")
    expect(code).toContain('const result = await userApi.login')
    expect(code).toContain('this.role = result.user.role')
    expect(code).toContain('this.saveToStorage()')
  })

  test('successful login immediately loads approval state without waiting for pull-down refresh', () => {
    const code = readSource('pages/profile/index.vue')
    const loginIndex = code.indexOf('await userStore.login')
    const immediateRefreshIndex = code.indexOf("await loadProfileDataAfterRoleResolved('loginSaved')", loginIndex)

    expect(loginIndex).toBeGreaterThan(-1)
    expect(immediateRefreshIndex).toBeGreaterThan(loginIndex)
  })
})
