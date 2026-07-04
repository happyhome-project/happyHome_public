import { COMMUNITY_SHARE_FROM, normalizeCommunityShareId } from './community-share'

type OnboardingMode = 'auto' | 'discover'

type OpenOnboardingOptions = {
  mode?: OnboardingMode
  replaceCurrent?: boolean
  communityId?: string
}

function buildOnboardingUrl(mode?: OnboardingMode, communityId?: string) {
  const params: string[] = []
  if (mode && mode !== 'auto') params.push(`mode=${encodeURIComponent(mode)}`)
  const targetCommunityId = normalizeCommunityShareId(communityId)
  if (targetCommunityId) {
    params.push(`communityId=${encodeURIComponent(targetCommunityId)}`)
    params.push(`fromShare=${COMMUNITY_SHARE_FROM}`)
  }
  return params.length ? `/pages/onboarding/index?${params.join('&')}` : '/pages/onboarding/index'
}

function currentStackDepth() {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore getCurrentPages is injected by the mini-program runtime.
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    return Array.isArray(pages) ? pages.length : 0
  } catch {
    return 0
  }
}

function runRoute(
  name: 'navigateTo' | 'redirectTo' | 'reLaunch',
  url: string,
  fail?: (error: any) => void,
) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore uni is injected by uni-app.
  const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
  if (!uniGlobal || typeof uniGlobal[name] !== 'function') return
  uniGlobal[name]({ url, fail })
}

function fallbackToRelaunch(url: string) {
  runRoute('reLaunch', url)
}

function redirectOrRelaunch(url: string) {
  runRoute('redirectTo', url, () => fallbackToRelaunch(url))
}

/**
 * Open the community-join page without needlessly clearing the native page stack.
 * A preserved stack lets the WeChat side-swipe gesture return to the previous page
 * instead of dropping the user out of the mini-program.
 */
export function openOnboardingPreservingStack(options: OpenOnboardingOptions = {}) {
  const url = buildOnboardingUrl(options.mode, options.communityId)
  if (options.mode) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore uni is injected by uni-app.
      uni.setStorageSync('onboarding_entry_mode', options.mode)
    } catch {}
  }

  if (options.replaceCurrent) {
    redirectOrRelaunch(url)
    return
  }

  if (currentStackDepth() >= 9) {
    redirectOrRelaunch(url)
    return
  }

  runRoute('navigateTo', url, () => redirectOrRelaunch(url))
}
