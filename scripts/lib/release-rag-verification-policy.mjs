const RAG_VERIFICATION_ACTIONS = new Set([
  'verify-post-rag-timer',
  'backfill-post-rag-v2',
  'eval-post-semantic-search',
])

const RAG_VERIFICATION_SMOKE_SUITES = new Set([
  'post-rag',
  'post-semantic-search',
])

const RAG_SPECIALIST_FUNCTIONS = new Set([
  'post-rag-worker',
  'post-video-rag-worker',
])

export const RAG_VERIFICATION_DELEGATION_REASON = 'RAG specialist verification is delegated to the RAG development session after deployment'

export function shouldRunRagSpecialistVerification(env = {}) {
  return env.HH_RELEASE_DELEGATE_RAG_VERIFICATION !== '1'
}

export function selectNonRagReleaseSmokeFunctions(functions = []) {
  return [...functions].filter((name) => !RAG_SPECIALIST_FUNCTIONS.has(name))
}

export function applyReleaseRagVerificationPolicy({ actions = [], smokeSuites = [] } = {}) {
  return {
    actions: actions.filter((action) => !RAG_VERIFICATION_ACTIONS.has(action)),
    smokeSuites: smokeSuites.filter((suite) => !RAG_VERIFICATION_SMOKE_SUITES.has(suite)),
    delegatedActions: actions.filter((action) => RAG_VERIFICATION_ACTIONS.has(action)),
    delegatedSmokeSuites: smokeSuites.filter((suite) => RAG_VERIFICATION_SMOKE_SUITES.has(suite)),
    reason: RAG_VERIFICATION_DELEGATION_REASON,
  }
}
