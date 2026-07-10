export const CANONICAL_MAIN_WORKSPACE = 'C:\\Project\\Claude\\happyHome'

function normalizeWorkspacePath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^\\\\\?\\/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')

  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function assertWorktreePolicy({
  agentsExists,
  agentsIsSymbolicLink = false,
  branch,
  cwd,
  canonicalMainPath = CANONICAL_MAIN_WORKSPACE,
}) {
  if (!agentsExists) throw new Error(`Required repository policy file is missing: ${cwd}/AGENTS.md`)
  if (agentsIsSymbolicLink) throw new Error(`Required repository policy file must not be a symbolic link: ${cwd}/AGENTS.md`)

  if (branch === 'main' && normalizeWorkspacePath(cwd) !== normalizeWorkspacePath(canonicalMainPath)) {
    throw new Error(`Branch main is allowed only in the canonical workspace ${canonicalMainPath}; got ${cwd}`)
  }
}

export function parseDivergence(output) {
  const match = String(output || '').trim().match(/^(\d+)\s+(\d+)$/)
  if (!match) throw new Error(`Unable to parse origin/main divergence: ${String(output || '').trim() || '(empty)'}`)
  return { behind: Number(match[1]), ahead: Number(match[2]) }
}

export function formatWorktreeReport({ cwd, branch, head, behind, ahead }) {
  return `[worktree-preflight] cwd=${cwd} branch=${branch || '(detached)'} HEAD=${head} divergence=behind=${behind} ahead=${ahead}`
}

export function parsePrePushUpdates(input) {
  const lines = String(input || '').split(/\r?\n/).filter((line) => line.trim())
  return lines.map((line) => {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4) throw new Error(`Malformed pre-push update: ${line}`)
    const [localRef, localSha, remoteRef, remoteSha] = fields
    return { localRef, localSha, remoteRef, remoteSha }
  })
}

export function assertPrePushAllowed(input) {
  const blocked = parsePrePushUpdates(input).find(({ remoteRef }) => remoteRef === 'refs/heads/main')
  if (blocked) throw new Error('Direct pushes targeting refs/heads/main are prohibited; use the PR integration workflow')
}

export function assertHooksPathConfigured(value) {
  const configured = String(value || '').trim().replace(/\\/g, '/')
  if (configured !== '.githooks') {
    throw new Error(`Expected core.hooksPath=.githooks; got ${configured || '(unset)'}`)
  }
}
