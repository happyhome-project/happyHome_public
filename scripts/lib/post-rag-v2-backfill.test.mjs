import assert from 'node:assert/strict'; import test from 'node:test'
import { executePostRagV2Backfill } from './post-rag-v2-backfill.mjs'

test('formal v2 backfill requires combined processing and records complete coverage evidence', async()=>{
  const calls=[]; const evidence=await executePostRagV2Backfill({
    rebuild:async o=>{calls.push(['rebuild',o]);return{totals:{failedCommunityCount:0,failedPostCount:0},workerRounds:[{failedCount:0}]}},
    health:async o=>{calls.push(['health',o]);return{totals:{failedCommunityCount:0,failedStateCount:0,pendingJobCount:0,retryJobCount:0,processingJobCount:0,failedJobCount:0,unknownJobStatusCount:0,eligibleActivePostCount:4,exactSourceVersionCount:4,missingExactSourceVersionCount:0,coverageRatio:1}}},
    recordEvidence:async e=>calls.push(['evidence',e]),
  })
  assert.equal(evidence.coveredPostCount,4); assert.equal(calls[0][1].workerStage,'combined'); assert.equal(calls[1][1].healthV2,true); assert.equal(calls[2][0],'evidence')
})

test('formal v2 backfill fails closed when health does not prove exact source-version coverage', async()=>{
  const rebuild=async()=>({totals:{failedCommunityCount:0,failedPostCount:0},workerRounds:[]})
  await assert.rejects(()=>executePostRagV2Backfill({rebuild,health:async()=>({totals:{failedCommunityCount:0,failedStateCount:0,pendingJobCount:0,failedJobCount:0,activePostCount:4,indexedStateCount:4,potentialMissingActiveCount:0,coverageRatio:1}})},{maxAttempts:1}),/exact source-version health contract/)
})

test('formal v2 backfill fails closed on incomplete coverage or failed jobs', async()=>{
  const rebuild=async()=>({totals:{failedCommunityCount:0,failedPostCount:0},workerRounds:[]})
  await assert.rejects(()=>executePostRagV2Backfill({rebuild,health:async()=>({totals:{failedCommunityCount:0,failedStateCount:0,pendingJobCount:0,retryJobCount:0,processingJobCount:0,failedJobCount:0,unknownJobStatusCount:0,eligibleActivePostCount:2,exactSourceVersionCount:1,missingExactSourceVersionCount:1,coverageRatio:.5}})},{maxAttempts:1}),/incomplete/)
  await assert.rejects(()=>executePostRagV2Backfill({rebuild,health:async()=>({totals:{failedCommunityCount:0,failedStateCount:0,pendingJobCount:0,retryJobCount:0,processingJobCount:0,failedJobCount:1,unknownJobStatusCount:0,eligibleActivePostCount:1,exactSourceVersionCount:1,missingExactSourceVersionCount:0,coverageRatio:1}})},{maxAttempts:1}),/failed or pending/)
})

test('formal v2 backfill rejects unknown schema-v2 job statuses',async()=>{const rebuild=async()=>({totals:{failedCommunityCount:0,failedPostCount:0},workerRounds:[]});await assert.rejects(()=>executePostRagV2Backfill({rebuild,health:async()=>({totals:{failedCommunityCount:0,failedStateCount:0,pendingJobCount:0,retryJobCount:0,processingJobCount:0,failedJobCount:0,unknownJobStatusCount:1,eligibleActivePostCount:1,exactSourceVersionCount:1,missingExactSourceVersionCount:0,coverageRatio:1}})},{maxAttempts:1}),/unknown job status/)})
