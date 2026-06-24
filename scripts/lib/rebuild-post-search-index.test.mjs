import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  const payloadArg = args[index + 1]
  if (String(payloadArg).startsWith('@')) {
    return JSON.parse(readFileSync(String(payloadArg).slice(1), 'utf8'))
  }
  return JSON.parse(payloadArg)
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
    if (payload.action === 'section.list') {
      return {
        status: 0,
        stdout: JSON.stringify({
          sections: [
            { _id: `${payload.communityId}-section-1`, status: 'active' },
          ],
        }),
        stderr: '',
      }
    }
    if (payload.action === 'post.rebuildSearchIndexSectionBatchAdmin') {
      const communityId = String(payload.sectionId || '').replace(/-section-\d+$/, '')
      if (options.failCommunityId === communityId) {
        return { status: 1, stdout: '', stderr: 'invoke failed' }
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          sectionId: payload.sectionId,
          scannedCount: 3,
          indexedCount: 2,
          removedCount: 1,
          failedCount: options.failedPostCount || 0,
          hasMore: false,
          nextSkip: null,
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
    '--batch-size=7',
    '--dry-run',
  ], {})

  assert.equal(options.envId, 'env-x')
  assert.equal(options.commandTimeoutMs, 4567)
  assert.equal(options.batchSize, 7)
  assert.equal(options.dryRun, true)
  assert.deepEqual(options.communityIds, ['c1', 'c2', 'c3'])
})

test('makeAdminPayload uses internal superAdmin actor context', () => {
  const payload = makeAdminPayload('post.rebuildSearchIndexSectionBatchAdmin', { sectionId: 'section-1' }, 'actor-x')

  assert.equal(payload.action, 'post.rebuildSearchIndexSectionBatchAdmin')
  assert.equal(payload.sectionId, 'section-1')
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
  assert.equal(runner.calls.length, 5)
  assert(runner.calls.every((call) => call.options.timeoutMs === 999))
  assert(runner.calls.every((call) => String(call.args[call.args.indexOf('-d') + 1]).startsWith('@')))
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
  assert.match(summary.results[1].error, /post\.rebuildSearchIndexSectionBatchAdmin failed/)
})

test('runPostSearchRebuild treats empty CLI output as failed invocation', async () => {
  const runner = async (_command, args) => {
    const payload = payloadFromArgs(args)
    if (payload.action === 'section.list') {
      return {
        status: 0,
        stdout: JSON.stringify({ sections: [{ _id: `${payload.communityId}-section-1` }] }),
        stderr: '',
      }
    }
    if (payload.action === 'post.rebuildSearchIndexSectionBatchAdmin') {
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
