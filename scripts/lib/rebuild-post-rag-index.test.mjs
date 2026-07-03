import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runPostRagRebuild } from '../rebuild-post-rag-index.mjs'

function payloadFromArgs(args) {
  const index = args.indexOf('-d')
  assert.notEqual(index, -1)
  const payloadArg = args[index + 1]
  if (String(payloadArg).startsWith('@')) {
    return JSON.parse(readFileSync(String(payloadArg).slice(1), 'utf8'))
  }
  return JSON.parse(payloadArg)
}

function createMockRunner() {
  const calls = []
  const runner = async (command, args, runnerOptions = {}) => {
    const payload = payloadFromArgs(args)
    calls.push({ command, args, options: runnerOptions, payload })
    if (payload.action === 'community.list') {
      return {
        status: 0,
        stdout: JSON.stringify({
          communities: [
            { _id: 'c-active-1', status: 'active' },
            { _id: 'c-disabled', status: 'disabled' },
            { id: 'c-active-2', status: 'active' },
          ],
        }),
        stderr: '',
      }
    }
    if (payload.action === 'section.list') {
      return {
        status: 0,
        stdout: JSON.stringify({ sections: [{ _id: `${payload.communityId}-section-1` }] }),
        stderr: '',
      }
    }
    if (payload.action === 'post.rebuildRagIndexSectionBatchAdmin') {
      return {
        status: 0,
        stdout: JSON.stringify({
          sectionId: payload.sectionId,
          scannedCount: 1,
          upsertQueuedCount: 1,
          deleteQueuedCount: 0,
          failedCount: 0,
          hasMore: false,
          nextSkip: null,
        }),
        stderr: '',
      }
    }
    if (payload.workerToken) {
      return {
        status: 0,
        stdout: JSON.stringify({ scannedCount: 0, results: [] }),
        stderr: '',
      }
    }
    return { status: 1, stdout: '', stderr: 'worker token missing' }
  }
  runner.calls = calls
  return runner
}

test('runPostRagRebuild sends the explicit worker token when processing queued jobs', async () => {
  const runner = createMockRunner()

  const summary = await runPostRagRebuild({
    envId: 'env-x',
    communityIds: ['community-1'],
    allActive: false,
    dryRun: false,
    help: false,
    commandTimeoutMs: 999,
    batchSize: 5,
    processJobs: true,
    workerRounds: 1,
    workerToken: 'worker-secret',
  }, runner)

  assert.equal(summary.totals.failedCommunityCount, 0)
  const workerCall = runner.calls.find((call) => !call.payload.action)
  assert.equal(workerCall.payload.workerToken, 'worker-secret')
})

test('runPostRagRebuild with --all-active enqueues every active community', async () => {
  const runner = createMockRunner()

  const summary = await runPostRagRebuild({
    envId: 'env-x',
    communityIds: [],
    allActive: true,
    dryRun: false,
    help: false,
    commandTimeoutMs: 999,
    batchSize: 5,
    processJobs: false,
    workerRounds: 0,
    workerToken: '',
    includeDisabled: false,
  }, runner)

  assert.deepEqual(summary.communityIds, ['c-active-1', 'c-active-2'])
  assert.equal(summary.totals.communityCount, 2)
  assert.equal(summary.totals.scannedCount, 2)
  assert.equal(summary.totals.upsertQueuedCount, 2)
  assert.equal(summary.totals.deleteQueuedCount, 0)
  assert.equal(summary.totals.failedCommunityCount, 0)
  const sectionListCalls = runner.calls.filter((call) => call.payload.action === 'section.list')
  assert.deepEqual(sectionListCalls.map((call) => call.payload.communityId), ['c-active-1', 'c-active-2'])
  const backfillCalls = runner.calls.filter((call) => call.payload.action === 'post.rebuildRagIndexSectionBatchAdmin')
  assert.deepEqual(backfillCalls.map((call) => call.payload.sectionId), [
    'c-active-1-section-1',
    'c-active-2-section-1',
  ])
})
