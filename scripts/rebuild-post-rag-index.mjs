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

function parseRagRebuildArgs(argv = process.argv.slice(2), env = process.env) {
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
    workerRounds: Math.max(0, Math.floor(Number(getFlagValue(
      argv,
      'worker-rounds',
      env.HH_POST_RAG_REBUILD_WORKER_ROUNDS || String(DEFAULT_WORKER_ROUNDS),
    )) || DEFAULT_WORKER_ROUNDS)),
    workerToken: String(getFlagValue(argv, 'worker-token', env.POST_RAG_WORKER_TOKEN || '')).trim(),
  }
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
  const record = await invokeAdmin('section.list', { communityId }, options, runner)
  const sections = Array.isArray(record.functionResult?.sections) ? record.functionResult.sections : []
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
        { sectionId, skip, limit: options.batchSize },
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

async function processQueuedJobs(options, runner) {
  if (!options.workerToken) {
    throw new Error('POST_RAG_WORKER_TOKEN is required to invoke post-rag-worker; use --no-process to only enqueue jobs')
  }
  const rounds = []
  for (let round = 0; round < options.workerRounds; round += 1) {
    const result = await invokeFunction('post-rag-worker', { limit: 20, workerToken: options.workerToken }, options, runner)
    const scannedCount = Number(result?.scannedCount || 0)
    rounds.push({
      round: round + 1,
      scannedCount,
      okCount: Array.isArray(result?.results) ? result.results.filter((item) => item.ok).length : 0,
      failedCount: Array.isArray(result?.results) ? result.results.filter((item) => !item.ok).length : 0,
    })
    if (scannedCount === 0) break
  }
  return rounds
}

export async function runPostRagRebuild(options = parseRagRebuildArgs(), runner = defaultRunner) {
  if (options.help) return { help: true }
  const communityIds = await resolveTargetCommunityIds(options, runner)
  if (options.dryRun) {
    return {
      envId: options.envId,
      dryRun: true,
      communityIds: normalizeCommunityIds(communityIds),
      results: [],
      workerRounds: [],
    }
  }
  const results = []
  for (const communityId of communityIds) {
    try {
      results.push({ ok: true, ...await enqueueCommunityRagJobs(communityId, options, runner) })
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
    acc.failedPostCount += item.failedCount || 0
    if (!item.ok) acc.failedCommunityCount += 1
    return acc
  }, {
    communityCount: 0,
    sectionCount: 0,
    scannedCount: 0,
    upsertQueuedCount: 0,
    deleteQueuedCount: 0,
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
  --dry-run                     Print target community ids without enqueueing.
  --batch-size <n>              Posts per admin invocation. Defaults to ${DEFAULT_BATCH_SIZE}.
  --no-process                  Only enqueue jobs; do not invoke post-rag-worker.
  --worker-token <token>        Required when processing jobs; defaults to POST_RAG_WORKER_TOKEN.
  --worker-rounds <n>           Max worker invocations when processing. Defaults to ${DEFAULT_WORKER_ROUNDS}.
`)
}

function printSummary(summary) {
  if (summary.help) return
  if (summary.dryRun) {
    console.log(`[post-rag-rebuild] dryRun env=${summary.envId} communities=${summary.communityIds.join(',')}`)
    return
  }
  for (const item of summary.results) {
    if (item.ok) {
      console.log(`[post-rag-rebuild] ok community=${item.communityId} sections=${item.sectionCount} scanned=${item.scannedCount} upsertJobs=${item.upsertQueuedCount} deleteJobs=${item.deleteQueuedCount} failed=${item.failedCount}`)
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
