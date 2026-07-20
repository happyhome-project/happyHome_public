export const REQUIRED_POST_RAG_SMOKE_QUERIES = [
  '有没有讲节俭家风的帖子？',
  '勤俭持家',
  '一粥一饭当思来处不易',
]

function referencesPost(result, postId) {
  return [...(result?.citations || []), ...(result?.items || [])]
    .some((item) => String(item?.postId || item?._id || item?.id || '') === postId)
}

function requireRagHit(result, postId, label) {
  if (result?.mode !== 'rag' || !String(result?.answer || '').trim() || !referencesPost(result, postId)) {
    throw new Error(`${label} did not return an evidence-bearing RAG answer`)
  }
  return result
}

function currentIndexedState(state, sourceVersion = '') {
  const syncVersion = String(state?.sync?.appliedSourceVersion || '')
  const indexVersion = String(state?.index?.sourceVersion || '')
  return state?.sync?.status === 'synced'
    && state?.index?.status === 'indexed'
    && state?.sync?.indexScope === 'validation'
    && state?.index?.indexScope === 'validation'
    && syncVersion
    && syncVersion === indexVersion
    && (!sourceVersion || syncVersion !== sourceVersion)
    ? syncVersion
    : ''
}

function currentRemovedState(state) {
  const syncVersion = String(state?.sync?.appliedSourceVersion || '')
  return state?.sync?.status === 'synced'
    && state?.index?.status === 'removed'
    && syncVersion
    && syncVersion === String(state?.index?.sourceVersion || '')
    && state?.sync?.indexScope == null
    && state?.index?.indexScope == null
}

async function poll(dependencies, label, probe, timeoutMs = 180_000) {
  const deadline = dependencies.now() + timeoutMs
  while (dependencies.now() <= deadline) {
    await dependencies.advanceCurrent()
    const value = await probe()
    if (value) return value
    await dependencies.wait(1_000)
  }
  throw new Error(`${label} timed out`)
}

export async function runCurrentPostRagSmokeScenario(input, dependencies) {
  const initial = await poll(dependencies, 'initial current-state index', async () => {
    const version = currentIndexedState(await dependencies.readState())
    if (!version) return null
    const result = await dependencies.search(REQUIRED_POST_RAG_SMOKE_QUERIES[0], input.memberIdentity)
    return referencesPost(result, input.postId) ? { version, result } : null
  })
  const initialSourceVersion = initial.version

  requireRagHit(initial.result, input.postId, REQUIRED_POST_RAG_SMOKE_QUERIES[0])
  for (const query of REQUIRED_POST_RAG_SMOKE_QUERIES.slice(1)) {
    requireRagHit(await dependencies.search(query, input.memberIdentity), input.postId, query)
  }

  const memberResult = requireRagHit(
    await dependencies.search('会员专属内容', input.memberIdentity),
    input.postId,
    'member-only evidence',
  )
  if (!(memberResult.citations || []).some((citation) => citation.postId === input.postId && citation.visibility === 'member')) {
    throw new Error('member-only evidence was not returned to the member')
  }
  const guestResult = await dependencies.search('会员专属内容', input.guestIdentity)
  if ((guestResult?.citations || []).some((citation) => citation.visibility === 'member')) {
    throw new Error('guest received member-only evidence')
  }

  await dependencies.updatePost()
  const updatedSourceVersion = await poll(dependencies, 'updated current-state index', async () => {
    const version = currentIndexedState(await dependencies.readState(), initialSourceVersion)
    if (!version) return ''
    const result = await dependencies.search('循环利用旧物', input.memberIdentity)
    return referencesPost(result, input.postId) ? version : ''
  })
  requireRagHit(await dependencies.search('循环利用旧物', input.memberIdentity), input.postId, 'updated evidence')

  await dependencies.deletePost()
  await poll(dependencies, 'removed current-state index', async () => {
    if (!currentRemovedState(await dependencies.readState())) return false
    return !referencesPost(await dependencies.search('循环利用旧物', input.memberIdentity), input.postId)
  })

  return {
    initialSourceVersion,
    updatedSourceVersion,
    deleteState: 'removed',
    permissionLeaks: 0,
    semanticQueryCount: REQUIRED_POST_RAG_SMOKE_QUERIES.length,
  }
}
