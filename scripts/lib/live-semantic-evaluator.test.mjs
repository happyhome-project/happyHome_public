import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createEvaluationIdentities, runLiveSemanticEvaluation } from './live-semantic-evaluator.mjs'
const require=createRequire(import.meta.url)
const { verifyPostRagSmokeIdentity }=require('../../cloud/shared/post-rag-smoke-identity.cjs')

const cases = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, query: `查询${i}`, topic: ['family-thrift','parent-route','lost-found','gardening-service'][i%4], relevantFixtureAliases: [`fixture-p${i}`], forbiddenFixtureAliases: ['fixture-member-only','fixture-deleted-post','fixture-cross-community'] }))

test('live evaluator owns fixtures, maps only current-run ids, spans queries and always cleans up', async () => {
  const calls=[]; const mapping=new Map(cases.map((c,i)=>[`id${i}`, c.relevantFixtureAliases[0]])); mapping.set('member','fixture-member-only'); mapping.set('deleted','fixture-deleted-post'); mapping.set('cross','fixture-cross-community')
  const report=await runLiveSemanticEvaluation({ cases, environment:'env-x', runId:'run-x', latencyRuns:100 }, {
    createFixtures: async()=>{ calls.push('create'); return { mapping, memberOnlyId:'member', deletedId:'deleted', crossCommunityId:'cross', freshness:{initialSourceVersion:'v1',updatedSourceVersion:'v2',deleteState:'removed'}, permission:{memberHit:true,guestLeak:false} } },
    verifyFreshness:async(f)=>f.freshness,verifyPermissions:async(f)=>f.permission,
    search: async(item, sample)=>{ calls.push(`search:${item.id}:${sample.cacheClass}`); return { durationMs:10, items:[{postId:`id${Number(item.id.slice(1))}`}] } },
    writeEvidence: async(e)=>{ calls.push('evidence'); return `/evidence/${e.runId}.json` }, cleanup:async()=>calls.push('cleanup'),
  })
  assert.equal(report.recallAt5,1); assert.equal(report.top3Precision,1); assert.equal(report.forbiddenCount,0); assert.equal(report.evidencePath,'/evidence/run-x.json')
  assert.ok(calls.some(x=>x.endsWith(':cold'))); assert.ok(calls.some(x=>x.endsWith(':warm'))); assert.equal(calls.at(-1),'cleanup')
})

test('live evaluator rejects ids outside this run and cleans up on failure', async () => {
  let cleaned=false
  await assert.rejects(()=>runLiveSemanticEvaluation({cases,environment:'env',runId:'run',latencyRuns:100},{ createFixtures:async()=>({mapping:new Map()}),verifyFreshness:async()=>({initialSourceVersion:'a',updatedSourceVersion:'b',deleteState:'removed'}),verifyPermissions:async()=>({memberHit:true,guestLeak:false}), search:async()=>({durationMs:1,items:[{postId:'production-id'}]}),writeEvidence:async()=>'',cleanup:async()=>{cleaned=true} }),/current evaluation run/)
  assert.equal(cleaned,true)
})

test('member and guest evaluation identities are accepted by the real shared verifier', () => {
  const now=1_000_000,secret='x'.repeat(32)
  const identities=createEvaluationIdentities({communityId:'c1',runId:'r1',memberUserId:'m1',guestUserId:'g1',now,secret})
  for(const identity of [identities.memberIdentity,identities.guestIdentity]) assert.ok(verifyPostRagSmokeIdentity(identity,{secret,action:'search',communityId:'c1',now}))
})

test('cross-community fixture id is a global hard failure even when case labels omit it', async () => {
  const safeCases=cases.map(item=>({...item,forbiddenFixtureAliases:[]}));let cleaned=false
  await assert.rejects(()=>runLiveSemanticEvaluation({cases:safeCases,environment:'env',runId:'run',latencyRuns:100},{createFixtures:async()=>({mapping:new Map([['cross-id','fixture-cross-community']]),crossPostId:'cross-id'}),verifyFreshness:async()=>({initialSourceVersion:'a',updatedSourceVersion:'b',deleteState:'removed'}),verifyPermissions:async()=>({memberHit:true,guestLeak:false}),search:async()=>({durationMs:1,items:[{postId:'cross-id'}]}),writeEvidence:async()=>'',cleanup:async()=>{cleaned=true}}),/cross-community/i)
  assert.equal(cleaned,true)
})
