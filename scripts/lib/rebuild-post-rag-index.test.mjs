import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runPostRagRebuild } from '../rebuild-post-rag-index.mjs'

const source = readFileSync(new URL('../rebuild-post-rag-index.mjs', import.meta.url), 'utf8')

function payloadFromArgs(args) {
  const index = args.indexOf('-d')
  assert.notEqual(index, -1)
  const payloadArg = args[index + 1]
  if (String(payloadArg).startsWith('@')) {
    return JSON.parse(readFileSync(String(payloadArg).slice(1), 'utf8'))
  }
  return JSON.parse(payloadArg)
}

test('rebuild-post-rag-index exposes a RAG-specific admin invoke retry env knob', () => {
  assert.match(source, /HH_POST_RAG_REBUILD_ADMIN_INVOKE_RETRIES/)
  assert.match(source, /admin-invoke-retries/)
})

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
    if (payload.action === 'post.reconcileRagIndexCommunityBatchAdmin') {
      return {
        status: 0,
        stdout: JSON.stringify({
          communityId: payload.communityId,
          scannedCount: 2,
          upsertQueuedCount: 1,
          deleteQueuedCount: 1,
          skippedCount: 0,
          missingStateCount: 1,
          staleStateCount: 0,
          removableStateCount: 1,
          failedCount: 0,
          hasMore: false,
          nextSkip: null,
        }),
        stderr: '',
      }
    }
    if (payload.action === 'post.ragIndexHealthAdmin') {
      return {
        status: 0,
        stdout: JSON.stringify({
          communityId: payload.communityId,
          activePostCount: 3,
          indexedStateCount: 2,
          removedStateCount: 1,
          failedStateCount: 0,
          pendingJobCount: 1,
          failedJobCount: 0,
          potentialMissingActiveCount: 1,
          coverageRatio: 2 / 3,
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

test('runPostRagRebuild with reconcile scans communities directly against index state', async () => {
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
    reconcile: true,
  }, runner)

  assert.deepEqual(summary.communityIds, ['c-active-1', 'c-active-2'])
  assert.equal(summary.totals.communityCount, 2)
  assert.equal(summary.totals.scannedCount, 4)
  assert.equal(summary.totals.upsertQueuedCount, 2)
  assert.equal(summary.totals.deleteQueuedCount, 2)
  assert.equal(summary.totals.failedCommunityCount, 0)
  const sectionListCalls = runner.calls.filter((call) => call.payload.action === 'section.list')
  assert.equal(sectionListCalls.length, 0)
  const reconcileCalls = runner.calls.filter((call) => call.payload.action === 'post.reconcileRagIndexCommunityBatchAdmin')
  assert.deepEqual(reconcileCalls.map((call) => call.payload.communityId), ['c-active-1', 'c-active-2'])
})

test('runPostRagRebuild with health reads RAG health without queueing jobs', async () => {
  const runner = createMockRunner()

  const summary = await runPostRagRebuild({
    envId: 'env-x',
    communityIds: [],
    allActive: true,
    dryRun: false,
    help: false,
    commandTimeoutMs: 999,
    batchSize: 5,
    processJobs: true,
    workerRounds: 1,
    workerToken: 'worker-secret',
    includeDisabled: false,
    reconcile: false,
    health: true,
  }, runner)

  assert.equal(summary.health, true)
  assert.deepEqual(summary.communityIds, ['c-active-1', 'c-active-2'])
  assert.equal(summary.totals.communityCount, 2)
  assert.equal(summary.totals.activePostCount, 6)
  assert.equal(summary.totals.indexedStateCount, 4)
  assert.equal(summary.totals.pendingJobCount, 2)
  const healthCalls = runner.calls.filter((call) => call.payload.action === 'post.ragIndexHealthAdmin')
  assert.deepEqual(healthCalls.map((call) => call.payload.communityId), ['c-active-1', 'c-active-2'])
  const writeCalls = runner.calls.filter((call) =>
    call.payload.action === 'post.rebuildRagIndexSectionBatchAdmin'
    || call.payload.action === 'post.reconcileRagIndexCommunityBatchAdmin'
    || call.payload.workerToken
  )
  assert.equal(writeCalls.length, 0)
})

test('runPostRagRebuild retries transient admin invoke failures before giving up', async () => {
  let communityListAttempts = 0
  const runner = async (_command, args, runnerOptions = {}) => {
    const payload = payloadFromArgs(args)
    if (payload.action === 'community.list') {
      communityListAttempts += 1
      if (communityListAttempts === 1) {
        return { status: 1, stdout: '', stderr: '[object Object]', options: runnerOptions }
      }
      return {
        status: 0,
        stdout: JSON.stringify({ communities: [{ _id: 'c-active-1', status: 'active' }] }),
        stderr: '',
      }
    }
    if (payload.action === 'post.ragIndexHealthAdmin') {
      return {
        status: 0,
        stdout: JSON.stringify({
          communityId: payload.communityId,
          activePostCount: 1,
          indexedStateCount: 1,
          removedStateCount: 0,
          failedStateCount: 0,
          pendingJobCount: 0,
          failedJobCount: 0,
          potentialMissingActiveCount: 0,
          coverageRatio: 1,
        }),
        stderr: '',
      }
    }
    throw new Error(`unexpected action ${payload.action}`)
  }

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
    reconcile: false,
    health: true,
    adminInvokeRetries: 2,
  }, runner)

  assert.equal(communityListAttempts, 2)
  assert.equal(summary.totals.failedCommunityCount, 0)
  assert.deepEqual(summary.communityIds, ['c-active-1'])
})
