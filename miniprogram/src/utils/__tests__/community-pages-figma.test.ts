import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const srcRoot = path.resolve(process.cwd(), 'src')
const readPage = (page: string) => fs.readFileSync(path.join(srcRoot, 'pages', page, 'index.vue'), 'utf8')
const readSource = (relativePath: string) => fs.readFileSync(path.join(srcRoot, relativePath), 'utf8')

describe('Figma community directory pages', () => {
  test('join page renders real community avatars, one-line copy, and joined/join actions', () => {
    const code = readPage('onboarding')

    expect(code).toContain(':src="communityAvatar(community)"')
    expect(code).toContain("if (community.viewerStatus === 'active') return '已加入'")
    expect(code).toContain("return '我要加入'")
    expect(code).toContain('text-overflow: ellipsis')
    expect(code).toContain('white-space: nowrap')
    expect(code).toContain('communityActionBusy')
    expect(code).toContain('.status.joined')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('switch page follows the same directory row contract instead of a separate hero layout', () => {
    const code = readPage('community-switch')

    expect(code).toContain('请选择你的社区')
    expect(code).toContain(':src="communityAvatar(community)"')
    expect(code).toContain("return '已加入'")
    expect(code).toContain("return '我要加入'")
    expect(code).not.toContain('switch-hero')
    expect(code).toContain('communityActionBusy')
    expect(code).toContain('.community-status.joined')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('switch page renders cached joined communities immediately and refreshes through one directory request', () => {
    const code = readPage('community-switch')
    const loader = code.match(/async function loadCommunities[\s\S]*?(?=\nasync function resolveCommunityCovers)/)?.[0] ?? ''

    expect(loader).toContain('communityStore.myCommunities')
    expect(loader).toContain('communityApi.listDiscoverable({')
    expect(loader).not.toContain('communityStore.loadMyCommunities')
    expect(loader).not.toContain('await resolveCommunityCovers')
    expect(loader).toContain('directoryLoadEpoch')
    expect(loader.indexOf('const epoch = ++directoryLoadEpoch')).toBeLessThan(
      loader.indexOf('if (!userStore.isLoggedIn)'),
    )
    expect(code).toContain('加载较慢')
    expect(code).toContain('communityStore.selectCommunityShell(id, shell, requestId)')
    expect(code).toContain('createPerformanceRequestId')
    expect(code).toContain("stage: 'community.directory'")
    expect(code).toContain("stage: 'community.switch'")
  })

  test('app foreground and Profile show prewarm the directory without awaiting it', () => {
    const app = readSource('App.vue')
    const appOnShow = app.slice(app.lastIndexOf('onShow(async () => {'))
    const profile = readPage('profile')
    const profileOnShowStart = profile.lastIndexOf('onShow(() => {')
    const profileOnShow = profile.slice(profileOnShowStart, profile.indexOf('onPullDownRefresh', profileOnShowStart))

    expect(app).toContain("from './utils/community-directory-cache'")
    expect(appOnShow).toContain('void primeCommunityDirectory(')
    expect(appOnShow).toContain("'community.directory.app-prefetch'")
    expect(appOnShow).toContain('.catch(')
    expect(appOnShow).not.toContain('await primeCommunityDirectory(')
    expect(appOnShow).not.toContain('showToast')

    expect(profile).toContain("from '../../utils/community-directory-cache'")
    expect(profileOnShow).toContain('void primeCommunityDirectory(')
    expect(profileOnShow).toContain("'community.directory.profile-prefetch'")
    expect(profileOnShow).toContain('.catch(')
    expect(profileOnShow).not.toContain('await primeCommunityDirectory(')
    expect(profileOnShow).not.toContain('showToast')
  })

  test('home applies cached snapshots as shell-only data and hydrates guest login in the background', () => {
    const code = readPage('index')
    const login = code.match(/async function submitGuestIntroLogin[\s\S]*?(?=\nfunction handleGuestIntroSecondary)/)?.[0] ?? ''
    const cancel = code.match(/function cancelGuestIntroLogin[\s\S]*?(?=\nfunction getGuestAvatarFileSize)/)?.[0] ?? ''

    expect(code).toContain('createHomeSnapshotShell')
    expect(code).toContain('createAdaptiveAvatarUploader')
    expect(code).toContain('adaptiveGuestAvatarUploader.upload(source)')
    expect(code).toContain('guestIntroLoginSlow')
    expect(login).toContain('guestIntroLoginEpoch.isCurrent(loginEpoch)')
    expect(login).toContain('}, 5000)')
    expect(login).toContain("stage: 'home.guest.login'")
    expect(login).toContain('shouldApply: () => guestIntroLoginEpoch.isCurrent(loginEpoch)')
    expect(cancel).toContain('guestIntroLoginEpoch.invalidate()')
    expect(cancel).not.toContain('if (guestIntroLoginBusy.value) return')
    expect(code).toMatch(/onHide\(\(\) => \{[\s\S]*guestIntroLoginEpoch\.invalidate\(\)/)
    expect(login).toContain('void refreshHomeData()')
    expect(login).not.toContain('await refreshHomeData()')
    expect(code).toContain("stage: 'post.bootstrap'")
  })

  test('home fences stale switch responses and keeps a manual retry path for network failures', () => {
    const code = readPage('index')
    const onShowIndex = code.lastIndexOf('onShow(() => {')
    const pullRefreshIndex = code.indexOf('onPullDownRefresh(', onShowIndex)
    const onShowBlock = code.slice(onShowIndex, pullRefreshIndex)

    expect(code).toContain('homeRefreshError')
    expect(code).toContain('@tap="retryHomeRefresh"')
    expect(code).toContain('requestedCommunityId !== communityStore.currentCommunityId')
    expect(code).toContain("String(result.currentCommunityId || '') !== requestedCommunityId")
    expect(code).toContain('communityStore.handleCommunityAccessLost')
    expect(code).toContain('communityStore.confirmCommunitySelection')
    expect(onShowBlock).toContain('applySelectedCommunityShellFromCache()')
    expect(onShowBlock).toContain('void refreshHomeData')
    expect(onShowBlock).toContain('!communityStore.pendingCommunitySelection')
    expect(code).toMatch(/do \{\s*activeHomeRefreshCommunityId = userStore\.isLoggedIn/)
  })

  test('create page uses three independent modules and a bottom action area', () => {
    const code = readPage('createCommunity')

    expect(code.match(/class="form-section/g)).toHaveLength(3)
    expect(code).toContain('class="bottom-action"')
    expect(code).toContain('position: fixed')
    expect(code).toContain('background: #f2f3f7')
    expect(code).toContain('font-weight: $hh-font-weight-bold')
    expect(code).toContain('if (submitting.value) return')
    expect(code).toContain('role="radiogroup"')
    expect(code).toContain(':aria-checked=')
    expect(code).toContain('env(safe-area-inset-bottom)')
  })

  test('home rejects a cached snapshot whose current community is not active', () => {
    const code = readPage('index')

    expect(code).toContain("filter((community) => community?.status === 'active')")
    expect(code).toContain('userStore.isLoggedIn && safeSnapshot.currentCommunityId && !activeCommunities.some')
    expect(code).toContain('const acceptedSnapshot = applyHomeSnapshot')
    expect(code).toContain('if (!acceptedSnapshot)')
  })

  test('home uses text-only tabs and keeps the switch visible beside long community names', () => {
    const code = readPage('index')

    expect(code).not.toContain('class="section-tab-icon"')
    expect(code).not.toContain('{{ g.icon }}')
    expect(code).toMatch(/\.community-identity\s*\{[^}]*flex:\s*1 1 0[^}]*overflow:\s*hidden/s)
    expect(code).toMatch(/\.community-title\s*\{[^}]*flex:\s*1 1 0[^}]*text-overflow:\s*ellipsis/s)
    expect(code).toMatch(/\.community-switch\s*\{[^}]*flex:\s*0 0 auto/s)
  })

  test('home keeps the community switch outside the WeChat capsule safe area', () => {
    const code = readPage('index')

    expect(code).toContain("import { resolveMenuSafeRightInset } from '../../utils/menu-safe-area'")
    expect(code).toContain(':style="homeTopbarStyle"')
    expect(code).toContain('paddingRight: `calc(var(--hh-page-x) + ${homeMenuSafeRightInset.value}px)`')
    expect(code).toContain('wx.getMenuButtonBoundingClientRect()')
    expect(code).toMatch(/onMounted\(\(\) => \{[\s\S]*?updateHomeMenuSafeArea\(\)/)
    expect(code).toMatch(/onShow\(\(\) => \{[\s\S]*?updateHomeMenuSafeArea\(\)/)
  })

  test('home shows the Figma empty state only after loading for an empty selected community section', () => {
    const code = readPage('index')
    const emptyAsset = path.join(srcRoot, 'static', 'home-empty.png')

    expect(code).toContain('const homeLoading = ref(true)')
    expect(code).toMatch(/const showHomeEmptyState = computed\(\(\) => \{\s*const group = activeArchiveGroup\.value\s*return \(\s*!homeLoading\.value\s*&&\s*Boolean\(communityStore\.currentCommunityId\)\s*&&\s*Boolean\(communityStore\.currentCommunity\)\s*&&\s*group !== null\s*&&\s*group\.items\.length === 0\s*\)\s*\}\)/s)
    expect(code).toContain('Boolean(communityStore.currentCommunity)')
    expect(code).not.toContain('.filter((g) => g.items.length > 0)')
    expect(code).toContain('v-if="showHomeEmptyState"')
    expect(code).toContain('src="/static/home-empty.png"')
    expect(code).toContain('暂无社区内容')
    expect(code).toContain('这里还没有帖子，成为第一个分享的人吧')
    expect(code).toContain('@tap="openHomeEmptyPublish"')
    expect(code).toMatch(/function openHomeEmptyPublish\(\)\s*\{[\s\S]*uni\.navigateTo\(\{\s*url: `\/pages\/create\/index\?returnTo=\$\{encodeURIComponent\(returnTo\)\}&sectionId=\$\{encodeURIComponent\(sectionId\)\}`/)
    expect(code).not.toMatch(/function openHomeEmptyPublish\(\)\s*\{[\s\S]*?setStorageSync[\s\S]*?\n\}/)
    expect(fs.existsSync(emptyAsset)).toBe(true)
  })

  test('home resets the empty-state loading gate for every refresh owner lifecycle', () => {
    const code = readPage('index')
    const refreshHomeData = code.match(/async function refreshHomeData[\s\S]*?(?=\nfunction probeHomeRender)/)?.[0] ?? ''
    const initializeHome = code.match(/async function initializeHome[\s\S]*?(?=\nonMounted)/)?.[0] ?? ''

    expect(refreshHomeData).toMatch(/const loadingOwner = homeLoadingGate\.beginRefresh\(\)\s*const refreshPromise/)
    expect(refreshHomeData).toMatch(/finally\s*\{[\s\S]*activeHomeRefreshPromise = null[\s\S]*homeLoadingGate\.endRefresh\(loadingOwner\)/)
    expect(initializeHome).not.toContain('homeLoading.value = false')
  })

  test('home releases redirected initialization through the loading gate and wraps empty copy safely', () => {
    const code = readPage('index')

    expect(code).toContain("import { createHomeLoadingGate } from '../../utils/home-loading-gate'")
    expect(code).toMatch(/const loadingOwner = homeLoadingGate\.beginRefresh\(\)[\s\S]*homeLoadingGate\.endRefresh\(loadingOwner\)/)
    expect(code).toMatch(/if \(redirectedByShare\) \{[\s\S]*homeLoadingGate\.releaseInitial\(\)[\s\S]*return/)
    expect(code).toMatch(/\.home-empty-description\s*\{[^}]*max-width:\s*100%[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*break-word/s)
    expect(code).not.toMatch(/\.home-empty-description\s*\{[^}]*white-space:\s*nowrap/s)
  })
})
