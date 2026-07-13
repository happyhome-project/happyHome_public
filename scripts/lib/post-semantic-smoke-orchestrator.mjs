import { nearestRankPercentile } from './post-semantic-search-eval.mjs'

const QUERIES = ['勤俭持家', '节俭家风', '一粥一饭当思来处不易']

export async function runV2WorkerSequence(deps) {
  await deps.materialize()
  await deps.indexV2()
  const worker = await deps.worker()
  if (!worker?.outbox || !worker?.v2 || !worker?.legacy || !Array.isArray(worker.errors)) throw new Error('post-rag-worker returned an invalid v2 stage envelope')
  if (worker.errors.length) throw new Error(`post-rag-worker stage errors=${worker.errors.length}`)
  return worker
}

function hit(result, postId, field) {
  if (result?.protocolVersion !== 2 || result?.answer !== '' || (result?.citations || []).length) throw new Error('semantic protocol compatibility failed')
  return (result.items || []).slice(0, 5).find((item) => item.postId === postId && item.matchedSnippet && item.matchedField && (!field || item.matchedField === field))
}

async function poll(deps, label, probe, timeoutMs = 60_000) {
  const deadline = deps.now() + timeoutMs
  while (deps.now() <= deadline) {
    await deps.advanceV2()
    if (await probe()) return
    await deps.wait(1_000)
  }
  throw new Error(`${label} timed out`)
}

async function executeSemanticSmokeScenario(input, deps) {
  await poll(deps, 'initial active index', async () => (await deps.readState())?.state === 'active' && hit(await deps.search(QUERIES[0], input.memberIdentity), input.postId))
  const initialState = await deps.readState()
  for (const query of QUERIES) if (!hit(await deps.search(query, input.memberIdentity), input.postId)) throw new Error('required semantic query missed target')
  const durations = []; let errors = 0
  for (let i = 0; i < input.latencyRuns; i += 1) {
    const start = deps.now()
    try { if (!hit(await deps.search(QUERIES[0], input.memberIdentity), input.postId)) errors += 1 } catch { errors += 1 }
    durations.push(deps.now() - start)
  }
  if (!hit(await deps.search('会员专属内容', input.memberIdentity), input.postId, '会员专属')) throw new Error('member permission fixture failed')
  if (hit(await deps.search('会员专属内容', input.guestIdentity), input.postId, '会员专属')) throw new Error('guest member-only leakage')
  await deps.updatePost()
  let updatedState
  await poll(deps, 'updated source version', async () => {
    const state = await deps.readState()
    if (state?.state !== 'active' || !state.sourceVersion || state.sourceVersion === initialState.sourceVersion) return false
    if (!hit(await deps.search('循环利用旧物', input.memberIdentity), input.postId)) return false
    updatedState = state; return true
  })
  await deps.deletePost()
  await poll(deps, 'removed state and absent search result', async () => {
    const state = await deps.readState()
    return state?.state === 'removed' && !hit(await deps.search('循环利用旧物', input.memberIdentity), input.postId)
  })
  return { initialSourceVersion: initialState.sourceVersion, updatedSourceVersion: updatedState.sourceVersion, deleteState: 'removed', p95Ms: nearestRankPercentile(durations, .95), errorRate: errors / input.latencyRuns, permissionLeaks: 0 }
}

export async function runSemanticSmokeScenario(input, deps) {
  try { return await executeSemanticSmokeScenario(input, deps) }
  finally { await deps.cleanup?.() }
}
