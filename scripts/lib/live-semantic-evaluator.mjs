import { evaluateSemanticSearch, validateEvaluationDataset } from './post-semantic-search-eval.mjs'
import { createSignedPostRagSmokeIdentity, MAX_POST_RAG_SMOKE_IDENTITY_TTL_MS } from './post-rag-smoke-identity.mjs'

export function createEvaluationIdentities(input) {
  const expiresAt=input.now+MAX_POST_RAG_SMOKE_IDENTITY_TTL_MS
  const create=(kind,userId)=>createSignedPostRagSmokeIdentity({version:1,action:'search',communityId:input.communityId,runId:`${input.runId}-${kind}-run`,userId,expiresAt},input.secret)
  return {memberIdentity:create('member',input.memberUserId),guestIdentity:create('guest',input.guestUserId)}
}

export async function runLiveSemanticEvaluation(input, deps) {
  validateEvaluationDataset(input.cases)
  let fixtures
  try {
    fixtures = await deps.createFixtures({ environment: input.environment, runId: input.runId })
    if (!(fixtures?.mapping instanceof Map)) throw new Error('live evaluator fixture mapping is missing')
    const freshness=await deps.verifyFreshness(fixtures)
    const permission=await deps.verifyPermissions(fixtures)
    if (!freshness?.initialSourceVersion || freshness.initialSourceVersion===freshness.updatedSourceVersion || freshness.deleteState!=='removed') throw new Error('live freshness verification failed')
    if (permission?.memberHit!==true || permission?.guestLeak!==false) throw new Error('live permission verification failed')
    const resultsByCase = new Map(); const durationsMs=[]; let errors=0
    for (let index=0; index<input.latencyRuns; index+=1) {
      const item=input.cases[index % input.cases.length]
      const sample={ index, cacheClass:index<input.cases.length?'cold':'warm' }
      try {
        const result=await deps.search(item,sample)
        durationsMs.push(Number(result.durationMs||0))
        const aliases=(result.items||[]).map((entry)=>{
          if (entry.postId===fixtures.crossPostId) throw new Error('cross-community fixture leaked into semantic results')
          const alias=fixtures.mapping.get(entry.postId)
          if (!alias) throw new Error('search returned an id outside the current evaluation run')
          return alias
        })
        if (!resultsByCase.has(item.id)) resultsByCase.set(item.id,aliases)
      } catch(error) { errors+=1; durationsMs.push(Number(error?.durationMs||0)); if (/outside the current evaluation run|cross-community/.test(error.message)) throw error }
    }
    const metrics=evaluateSemanticSearch(input.cases,resultsByCase,{durationsMs,errors,enforceProductionRunCount:input.latencyRuns===100})
    const evidence={ schemaVersion:1,environment:input.environment,runId:input.runId,caseCount:input.cases.length,latencyRuns:input.latencyRuns,cacheSamples:{cold:Math.min(input.latencyRuns,input.cases.length),warm:Math.max(0,input.latencyRuns-input.cases.length)},...metrics,freshness,permission }
    const evidencePath=await deps.writeEvidence(evidence)
    return {...evidence,evidencePath}
  } finally { await deps.cleanup?.(fixtures) }
}
