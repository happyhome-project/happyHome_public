export type CommunityRagIndexPolicy = 'business' | 'validation' | 'excluded'

export function deriveCommunityRagIndexPolicy(name: unknown): 'business' | 'excluded' {
  return /\p{Script=Han}/u.test(String(name || '')) ? 'business' : 'excluded'
}

export function resolveCommunityRagIndexPolicy(input: {
  name: unknown
  fixtureKey?: unknown
  currentPolicy?: unknown
}): CommunityRagIndexPolicy {
  if (input.fixtureKey) return 'excluded'
  if (input.currentPolicy === 'validation') return 'validation'
  return deriveCommunityRagIndexPolicy(input.name)
}
