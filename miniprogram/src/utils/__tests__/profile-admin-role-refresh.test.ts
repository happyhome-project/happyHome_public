import { describe, expect, test } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, '../../', relativePath), 'utf8')
}

describe('profile admin role refresh contract', () => {
  test('profile refresh revalidates cached user role before loading approval state', () => {
    const code = readSource('pages/profile/index.vue')
    const roleRefreshIndex = code.indexOf('await userStore.refreshLoginRole()')
    const pendingCommunityIndex = code.indexOf('await loadPendingCommunities()')
    const pendingMemberIndex = code.indexOf('await loadPendingMembers()')

    expect(roleRefreshIndex).toBeGreaterThan(-1)
    expect(pendingCommunityIndex).toBeGreaterThan(roleRefreshIndex)
    expect(pendingMemberIndex).toBeGreaterThan(roleRefreshIndex)
  })

  test('user store can refresh role through user.login without requiring a visible login flow', () => {
    const code = readSource('store/user.ts')

    expect(code).toContain('async refreshLoginRole()')
    expect(code).toContain("if (!this.isLoggedIn) return")
    expect(code).toContain('const result = await userApi.login')
    expect(code).toContain('this.role = result.user.role')
    expect(code).toContain('this.saveToStorage()')
  })
})
