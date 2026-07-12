import assert from 'node:assert/strict'
import test from 'node:test'
import { executeRequiredSmokeSuite } from './required-smoke-executor.mjs'

test('required post-rag smoke runs command then records ledger and guard', async () => {
  const calls = []
  const result = await executeRequiredSmokeSuite(['post-rag'], { run: async () => calls.push('run'), recordLedger: async () => calls.push('ledger'), recordGuard: async () => calls.push('guard'), skipLedger: async () => calls.push('skip') })
  assert.deepEqual(calls, ['run', 'ledger', 'guard'])
  assert.equal(result.status, 'passed')
})

test('required post-rag gate runs smoke and 30-case live evaluator before recording evidence', async () => {
  const calls=[]
  await executeRequiredSmokeSuite(['post-rag'], { run:async()=>calls.push('smoke'), runEvaluation:async()=>{calls.push('eval');return {evidencePath:'/e.json',recallAt5:.9,top3Precision:.8,p95Ms:100,errorRate:0,forbiddenCount:0}}, recordLedger:async(e)=>calls.push(`ledger:${e.evidencePath}`),recordGuard:async()=>calls.push('guard') })
  assert.deepEqual(calls,['smoke','eval','ledger:/e.json','guard'])
})

test('required smoke propagates command failure without false records and skips absent suite', async () => {
  const calls = []
  await assert.rejects(() => executeRequiredSmokeSuite(['post-rag'], { run: async () => { throw new Error('boom') }, recordLedger: async () => calls.push('ledger'), recordGuard: async () => calls.push('guard') }), /boom/)
  assert.deepEqual(calls, [])
  await executeRequiredSmokeSuite([], { skipLedger: async () => calls.push('skip') })
  assert.deepEqual(calls, ['skip'])
})
