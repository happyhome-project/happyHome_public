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
    const loadProfileDataIndex = code.indexOf('await hydrateProfileInBackground(reason)', roleRefreshIndex)

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

  test('successful login commits the visible form before starting background hydration', () => {
    const code = readSource('pages/profile/index.vue')
    const loginIndex = code.indexOf('await userStore.login')
    const closeFormIndex = code.indexOf('showNickConfirm.value = false', loginIndex)
    const backgroundHydrationIndex = code.indexOf("void hydrateProfileInBackground('loginSaved')", loginIndex)

    expect(loginIndex).toBeGreaterThan(-1)
    expect(closeFormIndex).toBeGreaterThan(loginIndex)
    expect(backgroundHydrationIndex).toBeGreaterThan(closeFormIndex)
    expect(code.slice(loginIndex, backgroundHydrationIndex)).not.toContain("await loadProfileDataAfterRoleResolved('loginSaved')")
  })

  test('pending members are requested in parallel only for communities marked viewerRole admin', () => {
    const code = readSource('pages/profile/index.vue')
    const functionIndex = code.indexOf('async function loadPendingMembers')
    const nextFunctionIndex = code.indexOf('async function loadPendingCommunities', functionIndex)
    const functionBody = code.slice(functionIndex, nextFunctionIndex)

    expect(functionBody).toContain("community?.viewerRole === 'admin'")
    expect(functionBody).toContain('await Promise.all(')
    expect(functionBody).not.toContain('pendingList only succeeds')
  })

  test('background hydration exposes a five second slow state and ignores stale completion', () => {
    const code = readSource('pages/profile/index.vue')
    const functionIndex = code.indexOf('async function hydrateProfileInBackground')
    const nextFunctionIndex = code.indexOf('function retryProfileHydration', functionIndex)
    const functionBody = code.slice(functionIndex, nextFunctionIndex)

    expect(functionBody).toContain('PROFILE_SLOW_THRESHOLD_MS')
    expect(functionBody).toContain('profileHydrationEpoch.isCurrent(epoch)')
    expect(functionBody).toContain("profileError.value = '加载较慢，可点击重试'")
    expect(functionBody.match(/hydrateProfileInBackground\(/g)).toHaveLength(1)
  })

  test('profile observes late restored login state without requiring pull-down refresh', () => {
    const code = readSource('pages/profile/index.vue')
    const watchImportIndex = code.indexOf("import { ref, computed, onMounted, nextTick, watch } from 'vue'")
    const watcherIndex = code.indexOf('watch(')
    const loginStateReadyIndex = code.indexOf("refreshProfileData('loginStateReady')", watcherIndex)

    expect(watchImportIndex).toBeGreaterThan(-1)
    expect(watcherIndex).toBeGreaterThan(-1)
    expect(loginStateReadyIndex).toBeGreaterThan(watcherIndex)
  })

  test('logout invalidates pending hydration so late responses cannot restore profile data', () => {
    const code = readSource('pages/profile/index.vue')
    const watcherIndex = code.indexOf('watch(')
    const loggedOutIndex = code.indexOf('if (!key)', watcherIndex)
    const invalidateIndex = code.indexOf('profileHydrationEpoch.invalidate()', loggedOutIndex)

    expect(loggedOutIndex).toBeGreaterThan(watcherIndex)
    expect(invalidateIndex).toBeGreaterThan(loggedOutIndex)
  })

  test('profile login shows an independent five second slow state without automatic retry', () => {
    const code = readSource('pages/profile/index.vue')
    const submitIndex = code.indexOf('const submitFormLock = useBusyLock')
    const nextFunctionIndex = code.indexOf('function saveProfile', submitIndex)
    const submitBody = code.slice(submitIndex, nextFunctionIndex)

    expect(code).toContain("v-if=\"profileLoginSlow\"")
    expect(code).toContain('登录较慢，请稍候')
    expect(code).toContain('const PROFILE_LOGIN_SLOW_THRESHOLD_MS = 5000')
    expect(submitBody).toContain('profileLoginSlow.value = true')
    expect(submitBody).toContain('clearTimeout(loginSlowTimer)')
    expect(submitBody).toContain('if (profileLoginEpoch.isCurrent(loginEpoch)) profileLoginSlow.value = false')
    expect(submitBody.match(/userStore\.(?:webLogin|login)\(/g)).toHaveLength(2)
  })

  test('closing a login form invalidates the request and stale completion cannot mutate visible state', () => {
    const code = readSource('pages/profile/index.vue')
    const submitIndex = code.indexOf('const submitFormLock = useBusyLock')
    const nextFunctionIndex = code.indexOf('function saveProfile', submitIndex)
    const submitBody = code.slice(submitIndex, nextFunctionIndex)
    const cancelIndex = code.indexOf('function cancelNickConfirm')
    const cancelBody = code.slice(cancelIndex, code.indexOf('function onNickInput', cancelIndex))
    const closeIndex = code.indexOf('function closeManualLoginForm')
    const closeBody = code.slice(closeIndex, code.indexOf('const webLogoutLock', closeIndex))

    expect(submitBody).toContain('const loginEpoch = profileLoginEpoch.begin()')
    expect(submitBody.match(/if \(!isLoginRequestCurrent\(\)\) return/g)?.length).toBeGreaterThanOrEqual(2)
    expect(submitBody).toContain('shouldApply: isLoginRequestCurrent')
    expect(cancelBody).toContain('invalidateProfileLoginRequest()')
    expect(closeBody).toContain('invalidateProfileLoginRequest()')
  })
})
