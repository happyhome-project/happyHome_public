export const HOME_TAB_URL = '/pages/index/index'
export const CREATE_TAB_URL = '/pages/create/index'
export const PROFILE_TAB_URL = '/pages/profile/index'

const TAB_URLS = new Set([HOME_TAB_URL, PROFILE_TAB_URL])
const HIERARCHY_STACK_MARK = '__hhStack'

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

function runNavigateTo(url: string, fail?: (error: any) => void, success?: () => void) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore uni is injected by uni-app.
  const uniGlobal: any = typeof uni !== 'undefined' ? uni : null
  uniGlobal?.navigateTo?.({ url, fail, success })
}

function routeQuery(options: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): string {
  const merged: Record<string, unknown> = Object.assign({}, options, extra)
  const parts: string[] = []
  Object.keys(merged).forEach((key) => {
    if (key === HIERARCHY_STACK_MARK && !extra[key]) return
    const value = merged[key]
    if (value === undefined || value === null || value === '') return
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  })
  return parts.length ? `?${parts.join('&')}` : ''
}

export function buildRouteUrl(path: string, options: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return `${normalizeRouteUrl(path)}${routeQuery(options, extra)}`
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
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

export function ensureHierarchyStack(
  currentPath: string,
  options: Record<string, unknown> = {},
  parent: unknown = '',
): boolean {
  if (isBrowserRuntime()) return false
  if (currentStackDepth() > 1) return false
  if (String(options?.[HIERARCHY_STACK_MARK] || '')) return false

  const currentUrl = buildRouteUrl(currentPath, options, { [HIERARCHY_STACK_MARK]: '1' })
  const parentUrl = normalizeRouteUrl(parent || options?.returnTo || HOME_TAB_URL)
  const parentPath = routePath(parentUrl)
  const openCurrent = () => runNavigateTo(currentUrl, () => switchHome())

  if (TAB_URLS.has(parentPath)) {
    runSwitchTab(parentPath, () => switchHome(), openCurrent)
    return true
  }

  runSwitchTab(HOME_TAB_URL, () => switchHome(), () => {
    runNavigateTo(parentUrl, () => switchHome(), openCurrent)
  })
  return true
}
