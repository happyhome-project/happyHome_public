import assert from 'node:assert/strict'
import test from 'node:test'

import {
  makeAdminPayload,
  normalizeCommunityIds,
  parseRebuildArgs,
  runPostSearchRebuild,
} from '../rebuild-post-search-index.mjs'

function payloadFromArgs(args) {
  const index = args.indexOf('-d')
  assert.notEqual(index, -1)
  return JSON.parse(args[index + 1])
}

function createMockRunner(options = {}) {
  const calls = []
  const runner = async (command, args, runnerOptions = {}) => {
    calls.push({ command, args, options: runnerOptions })
    const payload = payloadFromArgs(args)
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
    if (payload.action === 'post.rebuildSearchIndexAdmin') {
      if (options.failCommunityId === payload.communityId) {
        return { status: 1, stdout: '', stderr: 'invoke failed' }
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          communityId: payload.communityId,
          scannedCount: 3,
          indexedCount: 2,
          removedCount: 1,
          failedCount: options.failedPostCount || 0,
        }),
        stderr: '',
      }
    }
    return { status: 2, stdout: '', stderr: `unexpected action ${payload.action}` }
  }
  runner.calls = calls
  return runner
}

test('normalizeCommunityIds trims, splits, and deduplicates values', () => {
  assert.deepEqual(
    normalizeCommunityIds([' c1,c2 ', 'c1', '', ' c3 ']),
    ['c1', 'c2', 'c3'],
  )
})

test('parseRebuildArgs requires explicit target intent and supports repeated ids', () => {
  const options = parseRebuildArgs([
    '--env-id', 'env-x',
    '--community-id', 'c1',
    '--community-id=c2',
    '--community-ids=c2,c3',
    '--command-timeout-ms=4567',
    '--dry-run',
  ], {})

  assert.equal(options.envId, 'env-x')
  assert.equal(options.commandTimeoutMs, 4567)
  assert.equal(options.dryRun, true)
  assert.deepEqual(options.communityIds, ['c1', 'c2', 'c3'])
})

test('makeAdminPayload uses internal superAdmin actor context', () => {
  const payload = makeAdminPayload('post.rebuildSearchIndexAdmin', { communityId: 'c1' }, 'actor-x')

  assert.equal(payload.action, 'post.rebuildSearchIndexAdmin')
  assert.equal(payload.communityId, 'c1')
  assert.equal(payload._actAs.role, 'superAdmin')
  assert.equal(payload._actAs.accountId, 'actor-x')
})

test('runPostSearchRebuild lists active communities and rebuilds each one', async () => {
  const runner = createMockRunner()
  const summary = await runPostSearchRebuild({
    ...parseRebuildArgs(['--all-active', '--env-id', 'env-x'], {}),
    commandTimeoutMs: 999,
  }, runner)

  assert.equal(summary.envId, 'env-x')
  assert.deepEqual(summary.communityIds, ['c-active-1', 'c-active-2'])
  assert.equal(summary.totals.communityCount, 2)
  assert.equal(summary.totals.scannedCount, 6)
  assert.equal(summary.totals.indexedCount, 4)
  assert.equal(summary.totals.removedCount, 2)
  assert.equal(summary.totals.failedPostCount, 0)
  assert.equal(summary.totals.failedCommunityCount, 0)
  assert.equal(runner.calls.length, 3)
  assert(runner.calls.every((call) => call.options.timeoutMs === 999))
})

test('runPostSearchRebuild dry run resolves targets without rebuilding', async () => {
  const runner = createMockRunner()
  const summary = await runPostSearchRebuild(
    parseRebuildArgs(['--all-active', '--dry-run'], {}),
    runner,
  )

  assert.equal(summary.dryRun, true)
  assert.deepEqual(summary.communityIds, ['c-active-1', 'c-active-2'])
  assert.equal(summary.totals.communityCount, 2)
  assert.equal(runner.calls.length, 1)
})

test('runPostSearchRebuild records failed community invocations', async () => {
  const runner = createMockRunner({ failCommunityId: 'c2' })
  const summary = await runPostSearchRebuild(
    parseRebuildArgs(['--community-ids=c1,c2'], {}),
    runner,
  )

  assert.equal(summary.totals.communityCount, 2)
  assert.equal(summary.totals.failedCommunityCount, 1)
  assert.equal(summary.results[1].ok, false)
  assert.match(summary.results[1].error, /post\.rebuildSearchIndexAdmin failed/)
})

test('runPostSearchRebuild treats empty CLI output as failed invocation', async () => {
  const runner = async (_command, args) => {
    const payload = payloadFromArgs(args)
    if (payload.action === 'post.rebuildSearchIndexAdmin') {
      return { status: 0, stdout: '', stderr: '' }
    }
    return { status: 2, stdout: '', stderr: 'unexpected action' }
  }

  const summary = await runPostSearchRebuild(
    parseRebuildArgs(['--community-id=c1'], {}),
    runner,
  )

  assert.equal(summary.totals.failedCommunityCount, 1)
  assert.match(summary.results[0].error, /missing JSON result/)
})
