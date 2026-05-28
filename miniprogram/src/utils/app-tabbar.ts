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

export function getTabByKey(key: AppTabKey): AppTabItem | undefined {
  return APP_TABS.find((tab) => tab.key === key)
}

export function hideNativeTabBar() {
  try {
    uni.hideTabBar({ animation: false })
  } catch {
    // Some non-mini-program runtimes do not expose the native tabBar bridge.
  }
}
