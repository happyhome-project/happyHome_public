import type { GuestIntroConfig } from '../../../cloud/shared/guest-intro-config'

export const GUEST_INTRO_SEEN_VERSION_KEY = 'happyhome.guestIntro.seenVersion.v1'

interface GuestIntroVisibilityOptions {
  isLoggedIn: boolean
  hasPublicCommunity: boolean
}

interface GuestIntroFirstPaintOptions {
  isLoggedIn: boolean
}

function readStorage(key: string): string {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getStorageSync === 'function') {
      return String(uni.getStorageSync(key) || '')
    }
  } catch {}
  return ''
}

function writeStorage(key: string, value: string) {
  try {
    if (typeof uni !== 'undefined' && typeof uni.setStorageSync === 'function') {
      uni.setStorageSync(key, value)
    }
  } catch {}
}

export function shouldShowGuestIntro(
  config: GuestIntroConfig | null | undefined,
  options: GuestIntroVisibilityOptions,
): boolean {
  if (options.isLoggedIn) return false
  if (!options.hasPublicCommunity) return false
  if (!config?.enabled) return false
  const version = String(config.version || '').trim()
  if (!version) return false
  return readStorage(GUEST_INTRO_SEEN_VERSION_KEY) !== version
}

export function shouldShowGuestIntroOnFirstPaint(
  config: GuestIntroConfig | null | undefined,
  options: GuestIntroFirstPaintOptions,
): boolean {
  if (options.isLoggedIn) return false
  if (!config?.enabled) return false
  if (!String(config.version || '').trim()) return false
  return !readStorage(GUEST_INTRO_SEEN_VERSION_KEY)
}

export function markGuestIntroSeen(version: string) {
  const normalized = String(version || '').trim()
  if (!normalized) return
  writeStorage(GUEST_INTRO_SEEN_VERSION_KEY, normalized)
}
