export const HOME_TAB_URL = '/pages/index/index'
export const CREATE_TAB_URL = '/pages/create/index'
export const PROFILE_TAB_URL = '/pages/profile/index'

const TAB_URLS = new Set([HOME_TAB_URL, CREATE_TAB_URL, PROFILE_TAB_URL])

export interface HierarchyReturnTarget {
  returnTo?: string
}

export function currentStackDepth(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore getCurrentPages is injected by the mini-program runtime.
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    return Array.isArray(pages) ? pages.length : 0
  } catch {
    return 0
  }
}

export function normalizeRouteUrl(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function routePath(url: string): string {
  return normalizeRouteUrl(url).split('?')[0]
}

function runSwitchTab(url: string, fail?: (error: any) => void, success?: () => void) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore uni is injected by uni-app.
  const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
  uniGlobal?.switchTab?.({ url, fail, success })
}

function runNavigateTo(url: string, fail?: (error: any) => void) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore uni is injected by uni-app.
  const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
  uniGlobal?.navigateTo?.({ url, fail })
}

export function switchHome() {
  runSwitchTab(HOME_TAB_URL, () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore uni is injected by uni-app.
    const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
    uniGlobal?.reLaunch?.({ url: HOME_TAB_URL })
  })
}

export function navigateBackOrHome() {
  if (currentStackDepth() > 1) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore uni is injected by uni-app.
    const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
    uniGlobal?.navigateBack?.({ fail: () => switchHome() })
    return
  }
  switchHome()
}

export function openHierarchyParent(returnTo: unknown) {
  const url = normalizeRouteUrl(returnTo)
  if (!url) {
    switchHome()
    return
  }

  const path = routePath(url)
  if (TAB_URLS.has(path)) {
    runSwitchTab(path, () => switchHome())
    return
  }

  runSwitchTab(HOME_TAB_URL, () => switchHome(), () => {
    runNavigateTo(url, () => switchHome())
  })
}
