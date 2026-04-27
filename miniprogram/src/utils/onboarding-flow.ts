export type OnboardingEntryMode = 'auto' | 'discover'

export const DISCOVER_ENTRY_STORAGE_KEY = 'onboarding_entry_mode'

export function resolveOnboardingEntryMode(params: {
  queryMode?: unknown
  currentPageMode?: unknown
  storedMode?: unknown
  currentMode?: OnboardingEntryMode
} = {}): OnboardingEntryMode {
  if (params.queryMode === 'discover') return 'discover'
  if (params.currentPageMode === 'discover') return 'discover'
  if (params.currentMode === 'discover') return 'discover'
  if (params.storedMode === 'discover') return 'discover'
  return 'auto'
}

export function shouldRedirectJoinedUserFromOnboarding(
  entryMode: OnboardingEntryMode,
  joinedCommunityCount: number,
) {
  return entryMode !== 'discover' && joinedCommunityCount > 0
}
