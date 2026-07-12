type SessionRefreshDependencies = {
  sessionReady: Promise<unknown>
  isLoggedIn: () => boolean
  identity: () => string
  load: () => Promise<unknown>
  clear: () => void
}

export async function refreshCommunitiesForCurrentSession(deps: SessionRefreshDependencies) {
  await deps.sessionReady
  if (!deps.isLoggedIn()) return false
  const identityAtStart = deps.identity()
  await deps.load()
  if (!deps.isLoggedIn() || !identityAtStart || deps.identity() !== identityAtStart) {
    deps.clear()
    return false
  }
  return true
}
