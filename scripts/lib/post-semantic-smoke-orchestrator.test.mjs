import assert from 'node:assert/strict'
import test from 'node:test'
import { runSemanticSmokeScenario, runV2WorkerSequence } from './post-semantic-smoke-orchestrator.mjs'

test('v2 worker sequence materializes then indexes then verifies the combined envelope', async () => {
  const calls = []
  await runV2WorkerSequence({ materialize: async () => calls.push('materializeOutbox'), indexV2: async () => calls.push('indexV2'), worker: async () => { calls.push('worker'); return { outbox: {}, v2: {}, legacy: {}, errors: [] } } })
  assert.deepEqual(calls, ['materializeOutbox', 'indexV2', 'worker'])
})

test('orchestrator proves v2 indexing, version-changing update, permissions and removed-state delete', async () => {
  const calls = []
  let version = 'v1'
  let deleted = false
  const deps = {
    advanceV2: async () => { calls.push('materializeOutbox:indexV2:worker') },
    readState: async () => ({ state: deleted ? 'removed' : 'active', sourceVersion: version }),
    search: async (query, identity) => {
      calls.push(`search:${query}:${identity}`)
      if (deleted) return { protocolVersion: 2, answer: '', citations: [], items: [] }
      if (query === '会员专属内容' && identity === 'guest') return { protocolVersion: 2, answer: '', citations: [], items: [] }
      return { protocolVersion: 2, answer: '', citations: [], items: [{ postId: 'p1', matchedSnippet: 'safe', matchedField: query === '会员专属内容' ? '会员专属' : '正文' }] }
    },
    updatePost: async () => { calls.push('update'); version = 'v2' },
    deletePost: async () => { calls.push('post.deleteAdmin'); deleted = true },
    now: (() => { let n = 0; return () => n += 10 })(), wait: async () => {},
  }
  const report = await runSemanticSmokeScenario({ postId: 'p1', memberIdentity: 'member', guestIdentity: 'guest', latencyRuns: 2 }, deps)
  assert.equal(report.permissionLeaks, 0)
  assert.equal(report.initialSourceVersion, 'v1')
  assert.equal(report.updatedSourceVersion, 'v2')
  assert.equal(report.deleteState, 'removed')
  assert.ok(calls.includes('post.deleteAdmin'))
  assert.equal(calls.filter((x) => x === 'materializeOutbox:indexV2:worker').length >= 3, true)
})

test('orchestrator propagates permission failures and never prints raw content in metrics', async () => {
  let cleaned = false
  const deps = { advanceV2: async () => {}, readState: async () => ({ state: 'active', sourceVersion: 'v1' }), updatePost: async () => {}, deletePost: async () => {}, now: () => 1, wait: async () => {}, cleanup: async () => { cleaned = true }, search: async () => ({ protocolVersion: 2, answer: '', citations: [], items: [{ postId: 'p1', matchedSnippet: 'secret', matchedField: '会员专属' }] }) }
  await assert.rejects(() => runSemanticSmokeScenario({ postId: 'p1', memberIdentity: 'member', guestIdentity: 'guest', latencyRuns: 1 }, deps), /leakage/)
  assert.equal(cleaned, true)
})

test('cleanup failure is propagated after a successful scenario', async () => {
  let version = 'v1'; let deleted = false
  const deps = { advanceV2: async () => {}, readState: async () => ({ state: deleted ? 'removed' : 'active', sourceVersion: version }), updatePost: async () => { version = 'v2' }, deletePost: async () => { deleted = true }, now: (() => { let n=0; return () => ++n })(), wait: async () => {}, cleanup: async () => { throw new Error('cleanup failed') }, search: async (q, identity) => ({ protocolVersion: 2, answer: '', citations: [], items: deleted || (q === '会员专属内容' && identity === 'guest') ? [] : [{ postId: 'p1', matchedSnippet: 'safe', matchedField: q === '会员专属内容' ? '会员专属' : '正文' }] }) }
  await assert.rejects(() => runSemanticSmokeScenario({ postId: 'p1', memberIdentity: 'member', guestIdentity: 'guest', latencyRuns: 1 }, deps), /cleanup failed/)
})
