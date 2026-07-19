import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseRagRebuildArgs, runPostRagRebuild } from '../rebuild-post-rag-index.mjs'

function payload(args) {
  const value = args[args.indexOf('-d') + 1]
  return JSON.parse(readFileSync(value.slice(1), 'utf8'))
}

function runner() {
  const calls = []
  const run = async (_command, args) => {
    const body = payload(args)
    calls.push(body)
    if (body.action === 'post.ragCommunityPageAdmin') return { status: 0, stdout: JSON.stringify({ items: [{ communityId: 'business-1', ragIndexPolicy: 'business' }, { communityId: 'old-1', ragIndexPolicy: 'unclassified' }], hasMore: false }), stderr: '' }
    if (body.action === 'post.ragCurrentHealthAdmin') return { status: 0, stdout: JSON.stringify({ communityId: body.communityId, synced: 3, pending: 0 }), stderr: '' }
    if (body.action === 'post.ragReconcileCurrentAdmin') return { status: 0, stdout: JSON.stringify({ communityId: body.communityId, scheduledCount: 3 }), stderr: '' }
    if (body.action === 'post.ragClassifyCommunityAdmin') return { status: 0, stdout: JSON.stringify({ success: true, communityId: body.communityId, policy: body.policy }), stderr: '' }
    if (body.workerToken) return { status: 0, stdout: JSON.stringify({ scannedCount: 0, results: [] }), stderr: '' }
    return { status: 1, stdout: '', stderr: 'unexpected' }
  }
  run.calls = calls
  return run
}

test('default mode is read-only health and excludes unclassified communities', async () => {
  const run = runner()
  const result = await runPostRagRebuild({ ...parseRagRebuildArgs([], {}), adminInternalToken: 'admin' }, run)
  assert.equal(result.mode, 'health')
  assert.deepEqual(result.communityIds, ['business-1'])
  assert.equal(run.calls.some((item) => item.action === 'post.ragReconcileCurrentAdmin' || item.workerToken), false)
})

test('classification requires an explicit closed policy', () => {
  assert.throws(() => parseRagRebuildArgs(['--classify-community', 'c1'], {}), /policy/)
  assert.equal(parseRagRebuildArgs(['--classify-community', 'c1', '--policy', 'excluded'], {}).mode, 'classify')
})

test('classification reconciliation and processing cannot be combined', () => {
  assert.throws(() => parseRagRebuildArgs(['--reconcile', '--process'], {}), /separate/)
})

test('reconcile schedules one current state per post through the current admin action', async () => {
  const run = runner()
  const result = await runPostRagRebuild({ ...parseRagRebuildArgs(['--reconcile', '--community-id', 'business-1'], {}), adminInternalToken: 'admin' }, run)
  assert.equal(result.results[0].scheduledCount, 3)
  assert.equal(run.calls.some((item) => item.action === 'post.ragReconcileCurrentAdmin'), true)
})

test('processing invokes only the current-state worker payload', async () => {
  const run = runner()
  await runPostRagRebuild({ ...parseRagRebuildArgs(['--process'], {}), workerToken: 'worker-secret' }, run)
  assert.deepEqual(run.calls[0], { limit: 20, workerToken: 'worker-secret' })
})
