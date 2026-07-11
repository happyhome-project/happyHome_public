function validGitSha(value) {
  return /^[0-9a-f]{7,64}$/i.test(String(value || ''))
}

export async function resolveMainReleasePlanBase({ explicitBase = '', readProductionState } = {}) {
  if (explicitBase) return { baseSha: String(explicitBase), source: 'explicit' }
  if (typeof readProductionState !== 'function') throw new Error('main release planning requires a production state reader')
  const state = await readProductionState()
  if (state == null) return { baseSha: '', source: 'bootstrap' }
  if (!state.lastSuccessfulRunId && !state.gitSha) return { baseSha: '', source: 'bootstrap' }
  if (!validGitSha(state.gitSha)) throw new Error('production release state has an invalid gitSha')
  return { baseSha: state.gitSha, source: 'production-state' }
}
