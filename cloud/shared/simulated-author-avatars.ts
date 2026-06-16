export const SIMULATED_AUTHOR_AVATAR_COUNT = 50

export function simulatedAuthorAvatarUrl(seed: unknown): string {
  const value = String(seed || 'anonymous')
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const avatarIndex = (hash >>> 0) % SIMULATED_AUTHOR_AVATAR_COUNT
  return `/static/ai-avatars/avatar-${String(avatarIndex + 1).padStart(2, '0')}.svg`
}

export function resolveAuthorAvatarUrl(realAvatarUrl: unknown, seed: unknown): string {
  const realUrl = String(realAvatarUrl || '').trim()
  return realUrl || simulatedAuthorAvatarUrl(seed)
}
