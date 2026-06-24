#!/usr/bin/env node
import process from 'node:process'
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

const DEFAULT_TIMEOUT_MS = 120000
const DEFAULT_ACTOR = 'post-search-rebuild'

function getFlagValue(argv, name, fallback = '') {
  const equalsArg = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return fallback
}

function getRepeatedFlagValues(argv, name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith(`--${name}=`)) {
      values.push(arg.slice(name.length + 3))
      continue
    }
    if (arg === `--${name}` && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      values.push(argv[index + 1])
      index += 1
    }
  }
  return values
}

export function normalizeCommunityIds(values) {
  const seen = new Set()
  const ids = []
  for (const value of values) {
    for (const part of String(value || '').split(',')) {
      const id = part.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

function normalizeTimeoutMs(value) {
  const n = Math.floor(Number(value || DEFAULT_TIMEOUT_MS))
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

export function parseRebuildArgs(argv = process.argv.slice(2), env = process.env) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    envId: getFlagValue(argv, 'env-id', env.TCB_ENV || DEFAULT_ENV_ID),
    commandTimeoutMs: normalizeTimeoutMs(getFlagValue(
      argv,
      'command-timeout-ms',
      env.HH_POST_SEARCH_REBUILD_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    )),
    actor: getFlagValue(argv, 'actor', DEFAULT_ACTOR),
    allActive: argv.includes('--all-active'),
    includeDisabled: argv.includes('--include-disabled'),
    dryRun: argv.includes('--dry-run'),
    communityIds: normalizeCommunityIds([
      ...getRepeatedFlagValues(argv, 'community-id'),
      ...getRepeatedFlagValues(argv, 'community-ids'),
    ]),
  }
}

export function makeAdminPayload(action, params = {}, actor = DEFAULT_ACTOR) {
  return {
    action,
    _actAs: {
      accountId: actor,
      role: 'superAdmin',
      userId: `${actor}-user`,
      username: actor,
    },
    ...params,
  }
}

function extractErrorMessage(value) {
  if (!value || typeof value !== 'object') return ''
  if (value.errorMessage) return String(value.errorMessage)
  if (value.error) return String(value.error)
  if (Number(value.errorCode || 0) !== 0) return `errorCode=${value.errorCode}`
  if (Number(value.statusCode || 0) >= 400) {
    if (typeof value.body === 'string') return `HTTP ${value.statusCode}: ${value.body}`
    return `HTTP ${value.statusCode}`
  }
  return ''
}

export async function invokeAdmin(action, params, options, runner = defaultRunner) {
  const payload = makeAdminPayload(action, params, options.actor)
  const built = buildTcbCommand([
    'fn',
    'invoke',
    'admin',
    '-d',
    JSON.stringify(payload),
    '--env-id',
    options.envId,
    '--json',
  ])

  const commandLine = formatCommand(built.command, built.args)
  const result = await runner(built.command, built.args, {
    timeoutMs: options.commandTimeoutMs,
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const parsed = parseFirstJson(output)
  const cloudInvoke = analyzeCloudInvoke(parsed)
  const functionResult = extractFunctionResult(parsed)
  const functionError = extractErrorMessage(functionResult)
  const ok = Boolean(parsed) && result.status === 0 && (cloudInvoke ? cloudInvoke.ok : true) && !functionError

  if (!ok) {
    const cloudError = cloudInvoke?.errMsg || extractErrorMessage(cloudInvoke?.retMsg)
    throw new Error([
      `admin ${action} failed`,
      `command=${commandLine}`,
      `status=${result.status}`,
      functionError || cloudError || result.error || result.stderr || result.stdout || 'missing JSON result',
    ].filter(Boolean).join(' | '))
  }

  return { payload, parsed, functionResult }
}

async function listActiveCommunityIds(options, runner) {
  const record = await invokeAdmin('community.list', {}, options, runner)
  const communities = Array.isArray(record.functionResult?.communities)
    ? record.functionResult.communities
    : []
  const filtered = options.includeDisabled
    ? communities
    : communities.filter((community) => String(community?.status || 'active') === 'active')
  return normalizeCommunityIds(filtered.map((community) => community?._id || community?.id))
}

export async function resolveTargetCommunityIds(options, runner = defaultRunner) {
  const ids = [...options.communityIds]
  if (options.allActive) ids.push(...await listActiveCommunityIds(options, runner))
  const normalized = normalizeCommunityIds(ids)
  if (normalized.length === 0) {
    throw new Error('No target communities. Pass --all-active or --community-id <id>.')
  }
  return normalized
}

function normalizeBackfillResult(communityId, value) {
  return {
    communityId,
    scannedCount: Number(value?.scannedCount || 0),
    indexedCount: Number(value?.indexedCount || 0),
    removedCount: Number(value?.removedCount || 0),
    failedCount: Number(value?.failedCount || 0),
  }
}

export async function runPostSearchRebuild(options = parseRebuildArgs(), runner = defaultRunner) {
  if (options.help) {
    return { help: true, communityIds: [], results: [], totals: {} }
  }

  const communityIds = await resolveTargetCommunityIds(options, runner)
  if (options.dryRun) {
    return {
      envId: options.envId,
      dryRun: true,
      communityIds,
      results: [],
      totals: {
        communityCount: communityIds.length,
        scannedCount: 0,
        indexedCount: 0,
        removedCount: 0,
        failedPostCount: 0,
        failedCommunityCount: 0,
      },
    }
  }

  const results = []
  for (const communityId of communityIds) {
    try {
      const record = await invokeAdmin('post.rebuildSearchIndexAdmin', { communityId }, options, runner)
      results.push({
        ok: true,
        ...normalizeBackfillResult(communityId, record.functionResult),
      })
    } catch (error) {
      results.push({
        ok: false,
        communityId,
        error: String(error?.message || error),
        scannedCount: 0,
        indexedCount: 0,
        removedCount: 0,
        failedCount: 0,
      })
    }
  }

  const totals = results.reduce((acc, item) => {
    acc.communityCount += 1
    acc.scannedCount += item.scannedCount || 0
    acc.indexedCount += item.indexedCount || 0
    acc.removedCount += item.removedCount || 0
    acc.failedPostCount += item.failedCount || 0
    if (!item.ok) acc.failedCommunityCount += 1
    return acc
  }, {
    communityCount: 0,
    scannedCount: 0,
    indexedCount: 0,
    removedCount: 0,
    failedPostCount: 0,
    failedCommunityCount: 0,
  })

  return {
    envId: options.envId,
    dryRun: false,
    communityIds,
    results,
    totals,
  }
}

function printUsage() {
  console.log(`Usage:
  npm run rebuild:post-search-index -- --all-active
  npm run rebuild:post-search-index -- --community-id <communityId>

Options:
  --all-active                  Rebuild all active communities returned by admin.community.list.
  --community-id <id>           Rebuild one community. Can be repeated.
  --community-ids <id1,id2>     Rebuild multiple communities.
  --include-disabled            With --all-active, include non-active communities too.
  --dry-run                     Print target community ids without rebuilding.
  --env-id <envId>              CloudBase env id. Defaults to TCB_ENV or ${DEFAULT_ENV_ID}.
  --command-timeout-ms <ms>     Per-invocation timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
`)
}

function printSummary(summary) {
  if (summary.dryRun) {
    console.log(`[post-search-rebuild] dryRun env=${summary.envId} communities=${summary.communityIds.join(',')}`)
    return
  }
  for (const item of summary.results) {
    if (item.ok) {
      console.log([
        `[post-search-rebuild] ok community=${item.communityId}`,
        `scanned=${item.scannedCount}`,
        `indexed=${item.indexedCount}`,
        `removed=${item.removedCount}`,
        `failed=${item.failedCount}`,
      ].join(' '))
    } else {
      console.error(`[post-search-rebuild] failed community=${item.communityId} ${item.error}`)
    }
  }
  console.log(`[post-search-rebuild] totals ${JSON.stringify(summary.totals)}`)
}

async function main() {
  const options = parseRebuildArgs()
  if (options.help) {
    printUsage()
    return
  }
  const summary = await runPostSearchRebuild(options)
  printSummary(summary)
  if (summary.totals.failedCommunityCount || summary.totals.failedPostCount) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[post-search-rebuild] FAILED: ${error?.stack || error?.message || error}`)
    process.exit(1)
  })
}
