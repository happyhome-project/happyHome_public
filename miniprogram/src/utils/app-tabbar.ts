export type AppTabKey = 'home' | 'create' | 'profile'

export interface AppTabItem {
  key: AppTabKey
  path: string
}

export const APP_TABS: AppTabItem[] = [
  { key: 'home', path: '/pages/index/index' },
  { key: 'create', path: '/pages/create/index' },
  { key: 'profile', path: '/pages/profile/index' },
]

export const CREATE_SECTION_INTENT_KEY = 'create_section_intent_v1'
export const CREATE_SECTION_INTENT_TTL_MS = 10 * 60 * 1000

export function getTabByKey(key: AppTabKey): AppTabItem | undefined {
  return APP_TABS.find((tab) => tab.key === key)
}

export function hideNativeTabBar() {
  try {
    uni.hideTabBar({ animation: false })
  } catch (_error) {
    // Some non-mini-program runtimes do not expose the native tabBar bridge.
  }
}
