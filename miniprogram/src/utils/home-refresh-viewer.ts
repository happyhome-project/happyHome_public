export interface HomeRefreshViewer {
  loggedIn: boolean
  openId: string
}

export function captureHomeRefreshViewer(isLoggedIn: boolean, openId: unknown): HomeRefreshViewer {
  const normalizedOpenId = String(openId || '').trim()
  const authenticated = Boolean(isLoggedIn && normalizedOpenId)
  return {
    loggedIn: authenticated,
    openId: authenticated ? normalizedOpenId : '',
  }
}

export function isSameHomeRefreshViewer(
  requested: HomeRefreshViewer,
  current: HomeRefreshViewer,
): boolean {
  return requested.loggedIn === current.loggedIn && requested.openId === current.openId
}
