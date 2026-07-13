#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  DEFAULT_ENV_ID,
  analyzeCloudInvoke,
  buildTcbCommand,
  defaultRunner,
  extractFunctionResult,
  formatCommand,
  parseFirstJson,
} from './cloud-release-smoke.mjs'
import {
  invokeAdmin,
  normalizeCommunityIds,
  parseRebuildArgs,
  resolveTargetCommunityIds,
} from './rebuild-post-search-index.mjs'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'

const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_BATCH_SIZE = 5
const DEFAULT_WORKER_ROUNDS = 20

function getFlagValue(argv, name, fallback = '') {
  const equalsArg = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return fallback
}

export function parseRagRebuildArgs(argv = process.argv.slice(2), env = process.env) {
  const base = parseRebuildArgs(argv, env)
  return {
    ...base,
    envId: getFlagValue(argv, 'env-id', env.TCB_ENV || DEFAULT_ENV_ID),
    commandTimeoutMs: Math.max(30000, Math.floor(Number(getFlagValue(
      argv,
      'command-timeout-ms',
      env.HH_POST_RAG_REBUILD_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    )) || DEFAULT_TIMEOUT_MS)),
    batchSize: Math.min(20, Math.max(1, Math.floor(Number(getFlagValue(
      argv,
      'batch-size',
      env.HH_POST_RAG_REBUILD_BATCH_SIZE || String(DEFAULT_BATCH_SIZE),
    )) || DEFAULT_BATCH_SIZE))),
    processJobs: !argv.includes('--no-process'),
    reconcile: argv.includes('--reconcile'),
    health: argv.includes('--health'),
    healthV2: argv.includes('--health-v2'),
    ensureIndex: argv.includes('--ensure-index'),
    v2: argv.includes('--v2'),
    workerStage: getFlagValue(argv, 'worker-stage', 'combined'),
    workerRounds: Math.max(0, Math.floor(Number(getFlagValue(
      argv,
      'worker-rounds',
      env.HH_POST_RAG_REBUILD_WORKER_ROUNDS || String(DEFAULT_WORKER_ROUNDS),
    )) || DEFAULT_WORKER_ROUNDS)),
    adminInvokeRetries: Math.max(1, Math.floor(Number(getFlagValue(
      argv,
      'admin-invoke-retries',
      env.HH_POST_RAG_REBUILD_ADMIN_INVOKE_RETRIES || env.HH_POST_SEARCH_REBUILD_ADMIN_INVOKE_RETRIES || String(base.adminInvokeRetries || 3),
    )) || Number(base.adminInvokeRetries || 3))),
    workerToken: getFlagValue(argv, 'worker-token', resolvePostRagWorkerToken(env)),
  }
}

function withWorkerToken(payload, options) {
  if (!options.workerToken) {
    throw new Error('Missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN for post-rag-worker invocation')
  }
  return { ...payload, workerToken: options.workerToken }
}

function writePayloadFile(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-post-rag-rebuild-'))
  const file = join(dir, 'payload.json')
  writeFileSync(file, JSON.stringify(payload), 'utf8')
  return { dir, file }
}

async function invokeFunction(functionName, payload, options, runner = defaultRunner) {
  const payloadFile = writePayloadFile(payload)
  let result
  try {
    const built = buildTcbCommand([
      'fn',
      'invoke',
      functionName,
      '-d',
      `@${payloadFile.file}`,
      '--env-id',
      options.envId,
      '--json',
    ])
    result = await runner(built.command, built.args, {
      timeoutMs: options.commandTimeoutMs,
    })
  } finally {
    rmSync(payloadFile.dir, { recursive: true, force: true })
  }
  const parsed = parseFirstJson(`${result.stdout || ''}${result.stderr || ''}`)
  const cloudInvoke = analyzeCloudInvoke(parsed)
  const functionResult = extractFunctionResult(parsed)
  const ok = Boolean(parsed) && result.status === 0 && (cloudInvoke ? cloudInvoke.ok : true)
  if (!ok) {
    throw new Error(`${functionName} invoke failed: ${cloudInvoke?.errMsg || result.error || result.stderr || result.stdout || 'missing JSON result'}`)
  }
  return functionResult
}

async function listCommunitySections(communityId, options, runner) {
  const sections=[]; let afterId=''
  while(true) {
    const record=await invokeAdmin('section.listPageAdmin',{communityId,afterId,limit:100},options,runner)
    const result=record.functionResult||{}; sections.push(...(Array.isArray(result.items)?result.items:[]))
    if(!result.hasMore) break
    if(!result.nextAfterId||result.nextAfterId===afterId) throw new Error('section pagination did not advance')
    afterId=String(result.nextAfterId)
  }
  return sections
    .map((section) => String(section?._id || section?.id || '').trim())
    .filter(Boolean)
}

async function enqueueCommunityRagJobs(communityId, options, runner) {
  const sectionIds = await listCommunitySections(communityId, options, runner)
  const totals = {
    communityId,
    sectionCount: sectionIds.length,
    scannedCount: 0,
    upsertQueuedCount: 0,
    deleteQueuedCount: 0,
    failedCount: 0,
  }
  for (const sectionId of sectionIds) {
    let skip = 0
    while (true) {
      const record = await invokeAdmin(
        'post.rebuildRagIndexSectionBatchAdmin',
        { sectionId, skip, limit: options.batchSize, ...(options.v2 ? { schemaVersion: 2 } : {}) },
        options,
        runner,
      )
      const result = record.functionResult || {}
      totals.scannedCount += Number(result.scannedCount || 0)
      totals.upsertQueuedCount += Number(result.upsertQueuedCount || 0)
      totals.deleteQueuedCount += Number(result.deleteQueuedCount || 0)
      totals.failedCount += Number(result.failedCount || 0)
      if (!result.hasMore || !result.nextSkip) break
      skip = Number(result.nextSkip)
    }
  }
  return totals
}

async function loadCommunityRagHealth(communityId, options, runner) {
  const record = await invokeAdmin(
    options.healthV2 ? 'post.ragV2HealthAdmin' : 'post.ragIndexHealthAdmin',
    { communityId },
    options,
    runner,
  )
  return {
    communityId,
    ...(record.functionResult || {}),
  }
}

async function reconcileCommunityRagJobs(communityId, options, runner) {
  const totals = {
    communityId,
    sectionCount: 0,
    scannedCount: 0,
    upsertQueuedCount: 0,
    deleteQueuedCount: 0,
    skippedCount: 0,
    missingStateCount: 0,
    staleStateCount: 0,
    removableStateCount: 0,
    failedCount: 0,
  }
  let skip = 0
  while (true) {
    const record = await invokeAdmin(
      'post.reconcileRagIndexCommunityBatchAdmin',
      { communityId, skip, limit: options.batchSize },
      options,
      runner,
    )
    const result = record.functionResult || {}
    totals.scannedCount += Number(result.scannedCount || 0)
    totals.upsertQueuedCount += Number(result.upsertQueuedCount || 0)
    totals.deleteQueuedCount += Number(result.deleteQueuedCount || 0)
    totals.skippedCount += Number(result.skippedCount || 0)
    totals.missingStateCount += Number(result.missingStateCount || 0)
    totals.staleStateCount += Number(result.staleStateCount || 0)
    totals.removableStateCount += Number(result.removableStateCount || 0)
    totals.failedCount += Number(result.failedCount || 0)
    if (!result.hasMore || !result.nextSkip) break
    skip = Number(result.nextSkip)
  }
  return totals
}

async function processQueuedJobs(options, runner) {
  if (!options.workerToken) {
    throw new Error('POST_RAG_WORKER_TOKEN is required to invoke post-rag-worker; use --no-process to only enqueue jobs')
  }
  const rounds = []
  for (let round = 0; round < options.workerRounds; round += 1) {
    const workerPayload = { limit: 20, ...(options.workerStage === 'materialize' ? { action: 'materializeOutbox' } : options.workerStage === 'v2' ? { action: 'indexV2' } : {}) }
    const result = await invokeFunction('post-rag-worker', withWorkerToken(workerPayload, options), options, runner)
    const stages = [result?.outbox, result?.v2, result?.legacy].filter(Boolean)
    const scannedCount = stages.length
      ? stages.reduce((total, stage) => total + Number(stage?.scannedCount || 0), 0)
      : Number(result?.scannedCount || 0)
    const stageResults = stages.flatMap(stage => Array.isArray(stage?.results) ? stage.results : [])
    const errors = Array.isArray(result?.errors) ? result.errors : []
    rounds.push({
      round: round + 1,
      scannedCount,
      okCount: stageResults.filter((item) => item.ok !== false).length,
      failedCount: errors.length + stageResults.filter((item) => item.ok === false).length,
      stageErrors: errors,
    })
    if (scannedCount === 0) break
  }
  return rounds
}

export async function runPostRagRebuild(options = parseRagRebuildArgs(), runner = defaultRunner) {
  if (options.help) return { help: true }
  if (options.ensureIndex) {
    const result = await invokeFunction(
      'post-rag-worker',
      withWorkerToken({ action: 'ensureIndex' }, options),
      options,
      runner,
    )
    return { ensureIndex: true, envId: options.envId, result }
  }
  const communityIds = await resolveTargetCommunityIds(options, runner)
  if (options.dryRun) {
    return {
      envId: options.envId,
      dryRun: true,
      health: Boolean(options.health || options.healthV2),
      communityIds: normalizeCommunityIds(communityIds),
      results: [],
      workerRounds: [],
    }
  }
  if (options.health || options.healthV2) {
    const results = []
    for (const communityId of communityIds) {
      try {
        results.push({ ok: true, ...await loadCommunityRagHealth(communityId, options, runner) })
      } catch (error) {
        results.push({
          ok: false,
          communityId,
          error: String(error?.message || error),
          activePostCount: 0,
          indexedStateCount: 0,
          removedStateCount: 0,
          failedStateCount: 0,
          pendingJobCount: 0,
          failedJobCount: 0,
          potentialMissingActiveCount: 0,
        })
      }
    }
    const totals = results.reduce((acc, item) => {
      acc.communityCount += 1
      acc.activePostCount += Number(item.activePostCount || 0)
      acc.indexedStateCount += Number(item.indexedStateCount || 0)
      acc.removedStateCount += Number(item.removedStateCount || 0)
      acc.failedStateCount += Number(item.failedStateCount || 0)
      acc.pendingJobCount += Number(item.pendingJobCount || 0)
      acc.failedJobCount += Number(item.failedJobCount || 0)
      acc.retryJobCount += Number(item.retryJobCount || 0)
      acc.processingJobCount += Number(item.processingJobCount || 0)
      acc.unknownJobStatusCount += Number(item.unknownJobStatusCount || 0)
      acc.eligibleActivePostCount += Number(item.eligibleActivePostCount || 0)
      acc.exactSourceVersionCount += Number(item.exactSourceVersionCount || 0)
      acc.missingExactSourceVersionCount += Number(item.missingExactSourceVersionCount || 0)
      acc.potentialMissingActiveCount += Number(item.potentialMissingActiveCount || 0)
      if (!item.ok) acc.failedCommunityCount += 1
      return acc
    }, {
      communityCount: 0,
      activePostCount: 0,
      indexedStateCount: 0,
      removedStateCount: 0,
      failedStateCount: 0,
      pendingJobCount: 0,
      failedJobCount: 0,
      retryJobCount: 0,
      processingJobCount: 0,
      unknownJobStatusCount: 0,
      eligibleActivePostCount: 0,
      exactSourceVersionCount: 0,
      missingExactSourceVersionCount: 0,
      potentialMissingActiveCount: 0,
      failedCommunityCount: 0,
    })
    totals.coverageRatio = options.healthV2
      ? (totals.eligibleActivePostCount > 0 ? totals.exactSourceVersionCount / totals.eligibleActivePostCount : 1)
      : totals.activePostCount > 0
      ? totals.indexedStateCount / totals.activePostCount
      : 1
    return {
      envId: options.envId,
      dryRun: false,
      health: true,
      healthV2: Boolean(options.healthV2),
      communityIds,
      results,
      totals,
      workerRounds: [],
    }
  }
  const results = []
  for (const communityId of communityIds) {
    try {
      const communityResult = options.reconcile
        ? await reconcileCommunityRagJobs(communityId, options, runner)
        : await enqueueCommunityRagJobs(communityId, options, runner)
      results.push({ ok: true, ...communityResult })
    } catch (error) {
      results.push({
        ok: false,
        communityId,
        error: String(error?.message || error),
        sectionCount: 0,
        scannedCount: 0,
        upsertQueuedCount: 0,
        deleteQueuedCount: 0,
        failedCount: 0,
      })
    }
  }
  const workerRounds = options.processJobs ? await processQueuedJobs(options, runner) : []
  const totals = results.reduce((acc, item) => {
    acc.communityCount += 1
    acc.sectionCount += item.sectionCount || 0
    acc.scannedCount += item.scannedCount || 0
    acc.upsertQueuedCount += item.upsertQueuedCount || 0
    acc.deleteQueuedCount += item.deleteQueuedCount || 0
    acc.skippedCount += item.skippedCount || 0
    acc.missingStateCount += item.missingStateCount || 0
    acc.staleStateCount += item.staleStateCount || 0
    acc.removableStateCount += item.removableStateCount || 0
    acc.failedPostCount += item.failedCount || 0
    if (!item.ok) acc.failedCommunityCount += 1
    return acc
  }, {
    communityCount: 0,
    sectionCount: 0,
    scannedCount: 0,
    upsertQueuedCount: 0,
    deleteQueuedCount: 0,
    skippedCount: 0,
    missingStateCount: 0,
    staleStateCount: 0,
    removableStateCount: 0,
    failedPostCount: 0,
    failedCommunityCount: 0,
  })
  return {
    envId: options.envId,
    dryRun: false,
    communityIds,
    results,
    totals,
    workerRounds,
  }
}

function printUsage() {
  console.log(`Usage:
  npm run rebuild:post-rag-index -- --all-active
  npm run rebuild:post-rag-index -- --community-id <communityId>

Options:
  --all-active                  Enqueue RAG jobs for all active communities.
  --community-id <id>           Enqueue one community. Can be repeated.
  --community-ids <id1,id2>     Enqueue multiple communities.
  --reconcile                   Queue only missing/stale/removable RAG jobs from post_rag_index_state.
  --health                      Read RAG source/state/job counts without queueing or processing jobs.
  --health-v2                   Read v2 semantic source/state/job coverage.
  --ensure-index                Validate or initialize the ES index through the VPC worker.
  --v2                          Request v2 outbox backfill facts from admin batch actions.
  --worker-stage <stage>        combined (default), materialize, or v2.
  --dry-run                     Print target community ids without enqueueing.
  --batch-size <n>              Posts per admin invocation. Defaults to ${DEFAULT_BATCH_SIZE}.
  --no-process                  Only enqueue jobs; do not invoke post-rag-worker.
  --worker-token <token>        Token used to invoke post-rag-worker.
  --worker-rounds <n>           Max worker invocations when processing. Defaults to ${DEFAULT_WORKER_ROUNDS}.
  --admin-invoke-retries <n>    Retries for transient admin invocation failures.
`)
}

function printSummary(summary) {
  if (summary.help) return
  if (summary.ensureIndex) {
    console.log(`[post-rag-index] ${JSON.stringify(summary.result)}`)
    return
  }
  if (summary.dryRun) {
    console.log(`[post-rag-rebuild] dryRun env=${summary.envId} communities=${summary.communityIds.join(',')}`)
    return
  }
  for (const item of summary.results) {
    if (summary.health) {
      if (item.ok) {
        console.log(`[post-rag-health] ok community=${item.communityId} active=${item.activePostCount} indexed=${item.indexedStateCount} removed=${item.removedStateCount} failedState=${item.failedStateCount} pendingJobs=${item.pendingJobCount} failedJobs=${item.failedJobCount} potentialMissing=${item.potentialMissingActiveCount} coverage=${Number(item.coverageRatio || 0).toFixed(3)}`)
      } else {
        console.error(`[post-rag-health] failed community=${item.communityId} ${item.error}`)
      }
      continue
    }
    if (item.ok) {
      const reconcileBits = item.missingStateCount || item.staleStateCount || item.removableStateCount || item.skippedCount
        ? ` skipped=${item.skippedCount || 0} missing=${item.missingStateCount || 0} stale=${item.staleStateCount || 0} removable=${item.removableStateCount || 0}`
        : ''
      console.log(`[post-rag-rebuild] ok community=${item.communityId} sections=${item.sectionCount} scanned=${item.scannedCount} upsertJobs=${item.upsertQueuedCount} deleteJobs=${item.deleteQueuedCount}${reconcileBits} failed=${item.failedCount}`)
    } else {
      console.error(`[post-rag-rebuild] failed community=${item.communityId} ${item.error}`)
    }
  }
  for (const round of summary.workerRounds || []) {
    console.log(`[post-rag-rebuild] worker round=${round.round} scanned=${round.scannedCount} ok=${round.okCount} failed=${round.failedCount}`)
  }
  console.log(`[post-rag-rebuild] totals ${JSON.stringify(summary.totals)}`)
}

async function main() {
  const options = parseRagRebuildArgs()
  if (options.help) {
    printUsage()
    return
  }
  const summary = await runPostRagRebuild(options)
  printSummary(summary)
  if (summary.totals?.failedCommunityCount || summary.totals?.failedPostCount) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[post-rag-rebuild] FAILED: ${error?.stack || error?.message || error}`)
    process.exit(1)
  })
}
