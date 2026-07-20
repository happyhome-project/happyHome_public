import assert from 'node:assert/strict'
import test from 'node:test'

import { runCurrentPostRagSmokeScenario } from './post-rag-current-smoke-orchestrator.mjs'

const REQUIRED_QUERIES = [
  '有没有讲节俭家风的帖子？',
  '勤俭持家',
  '一粥一饭当思来处不易',
]

function ragResult(postId, visibility = 'public') {
  return {
    mode: 'rag',
    answer: '有，临时帖子讲述了勤俭持家的家风。',
    citations: [{ postId, visibility, preview: visibility === 'member' ? '会员专属内容' : '勤俭持家' }],
    items: [{ postId }],
  }
}

test('current-state smoke verifies semantic retrieval, permission filtering, update and deletion', async () => {
  const postId = 'post-1'
  let phase = 'initial'
  let clock = 0
  const searches = []

  const evidence = await runCurrentPostRagSmokeScenario({ postId, memberIdentity: 'member', guestIdentity: 'guest' }, {
    now: () => clock,
    wait: async (ms) => { clock += ms },
    advanceCurrent: async () => ({ scannedCount: 1, results: [{ postId, outcome: phase === 'deleted' ? 'removed' : 'indexed' }] }),
    readState: async () => phase === 'deleted'
      ? {
          sync: { status: 'synced', appliedSourceVersion: 'removed-v3', indexScope: null },
          index: { status: 'removed', sourceVersion: 'removed-v3', indexScope: null },
        }
      : {
          sync: { status: 'synced', appliedSourceVersion: phase === 'initial' ? 'source-v1' : 'source-v2', indexScope: 'validation' },
          index: { status: 'indexed', sourceVersion: phase === 'initial' ? 'source-v1' : 'source-v2', indexScope: 'validation' },
        },
    search: async (query, identity) => {
      searches.push({ query, identity, phase })
      if (phase === 'deleted') return { mode: 'no_answer', answer: '', citations: [], items: [] }
      if (query === '会员专属内容') return identity === 'member' ? ragResult(postId, 'member') : { mode: 'no_answer', answer: '', citations: [], items: [] }
      return ragResult(postId)
    },
    updatePost: async () => { phase = 'updated' },
    deletePost: async () => { phase = 'deleted' },
  })

  assert.deepEqual(evidence, {
    initialSourceVersion: 'source-v1',
    updatedSourceVersion: 'source-v2',
    deleteState: 'removed',
    permissionLeaks: 0,
    semanticQueryCount: 3,
  })
  assert.deepEqual(searches.filter((entry) => REQUIRED_QUERIES.includes(entry.query)).map((entry) => entry.query), REQUIRED_QUERIES)
  assert.equal(searches.some((entry) => entry.query === '会员专属内容' && entry.identity === 'guest'), true)
  assert.equal(searches.some((entry) => entry.phase === 'updated' && entry.query === '循环利用旧物'), true)
  assert.equal(searches.some((entry) => entry.phase === 'deleted'), true)
})
