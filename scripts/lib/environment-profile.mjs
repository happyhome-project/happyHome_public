function normalize(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function assertEnvironmentProfile(profile, {
  canonicalPath = 'C:\\Project\\Claude\\happyHome',
  cwd,
  branch,
  dirty,
  head,
  originMain,
} = {}) {
  if (profile === 'read' || profile === 'fixture-write') return
  if (profile !== 'release') throw new Error(`Unknown environment profile: ${profile}`)
  if (normalize(cwd) !== normalize(canonicalPath) || branch !== 'main') {
    throw new Error(`release profile requires canonical main workspace ${canonicalPath}`)
  }
  if (dirty) throw new Error('release profile requires a clean worktree')
  if (!head || head !== originMain) throw new Error('release profile requires HEAD to equal origin/main')
}
