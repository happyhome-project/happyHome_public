#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { DEFAULT_ENV_ID, analyzeCloudInvoke, buildTcbCommand, defaultRunner, extractFunctionResult, parseFirstJson } from './cloud-release-smoke.mjs'
import { invokeAdmin } from './rebuild-post-search-index.mjs'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'

function value(argv, name, fallback = '') {
  const exact = argv.find((item) => item.startsWith(`--${name}=`))
  if (exact) return exact.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

export function parseRagRebuildArgs(argv = process.argv.slice(2), env = process.env) {
  const classifyCommunityId = value(argv, 'classify-community')
  const reconcile = argv.includes('--reconcile')
  const process = argv.includes('--process')
  const mutationModes = Number(Boolean(classifyCommunityId)) + Number(reconcile) + Number(process)
  if (mutationModes > 1) throw new Error('classification, reconciliation, and processing must be separate invocations')
  const policy = value(argv, 'policy')
  if (classifyCommunityId && !['business', 'validation', 'excluded'].includes(policy)) throw new Error('--policy must be business, validation, or excluded')
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    dryRun: argv.includes('--dry-run'),
    mode: classifyCommunityId ? 'classify' : reconcile ? 'reconcile' : process ? 'process' : 'health',
    classifyCommunityId,
    policy,
    communityId: value(argv, 'community-id'),
    allClassified: argv.includes('--all-classified'),
    envId: value(argv, 'env-id', env.TCB_ENV || DEFAULT_ENV_ID),
    timeoutMs: Math.max(30_000, Number(value(argv, 'timeout-ms', env.HH_POST_RAG_REBUILD_TIMEOUT_MS || '180000')) || 180_000),
    workerToken: value(argv, 'worker-token', resolvePostRagWorkerToken(env)),
    adminInternalToken: value(argv, 'admin-internal-token', env.ADMIN_INTERNAL_CALL_TOKEN || ''),
  }
}

function payloadFile(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-rag-current-'))
  const file = join(dir, 'payload.json')
  writeFileSync(file, JSON.stringify(payload), 'utf8')
  return { dir, file }
}

async function invokeWorker(payload, options, runner) {
  if (!options.workerToken) throw new Error('POST_RAG_WORKER_TOKEN is required')
  const temp = payloadFile({ ...payload, workerToken: options.workerToken })
  try {
    const built = buildTcbCommand(['fn', 'invoke', 'post-rag-worker', '-d', `@${temp.file}`, '--env-id', options.envId, '--json'])
    const result = await runner(built.command, built.args, { timeoutMs: options.timeoutMs })
    const parsed = parseFirstJson(`${result.stdout || ''}${result.stderr || ''}`)
    const analyzed = analyzeCloudInvoke(parsed)
    if (!parsed || result.status !== 0 || (analyzed && !analyzed.ok)) throw new Error('post-rag-worker invoke failed')
    return extractFunctionResult(parsed)
  } finally {
    rmSync(temp.dir, { recursive: true, force: true })
  }
}

async function admin(action, params, options, runner) {
  const record = await invokeAdmin(action, params, {
    envId: options.envId,
    commandTimeoutMs: options.timeoutMs,
    adminInternalToken: options.adminInternalToken,
    adminInvokeRetries: 3,
  }, runner)
  return record.functionResult || {}
}

async function listClassifiedCommunities(options, runner) {
  const ids = []
  let afterId = ''
  while (true) {
    const page = await admin('post.ragCommunityPageAdmin', { afterId, limit: 100 }, options, runner)
    for (const item of page.items || []) if (item.ragIndexPolicy !== 'unclassified') ids.push(item.communityId)
    if (!page.hasMore) break
    if (!page.nextAfterId || page.nextAfterId === afterId) throw new Error('community pagination did not advance')
    afterId = page.nextAfterId
  }
  return [...new Set(ids)].sort()
}

async function targetCommunityIds(options, runner) {
  if (options.communityId) return [options.communityId]
  if (options.allClassified || options.mode === 'health') return listClassifiedCommunities(options, runner)
  throw new Error('--community-id or --all-classified is required')
}

export async function runPostRagRebuild(options = parseRagRebuildArgs(), runner = defaultRunner) {
  if (options.help) return { help: true }
  if (options.mode === 'classify') {
    if (options.dryRun) return { mode: 'classify', dryRun: true, communityId: options.classifyCommunityId, policy: options.policy }
    return admin('post.ragClassifyCommunityAdmin', { communityId: options.classifyCommunityId, policy: options.policy }, options, runner)
  }
  if (options.mode === 'process') {
    if (options.dryRun) return { mode: 'process', dryRun: true }
    return { mode: 'process', result: await invokeWorker({ limit: 20 }, options, runner) }
  }
  const communityIds = await targetCommunityIds(options, runner)
  if (options.dryRun) return { mode: options.mode, dryRun: true, communityIds }
  const action = options.mode === 'reconcile' ? 'post.ragReconcileCurrentAdmin' : 'post.ragCurrentHealthAdmin'
  const results = []
  for (const communityId of communityIds) results.push(await admin(action, { communityId }, options, runner))
  return { mode: options.mode, communityIds, results }
}

function usage() {
  console.log('Usage: rebuild:post-rag-index [--health] [--community-id ID | --all-classified]\n'
    + '       rebuild:post-rag-index --classify-community ID --policy business|validation|excluded\n'
    + '       rebuild:post-rag-index --reconcile --community-id ID\n'
    + '       rebuild:post-rag-index --process')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const options = parseRagRebuildArgs()
  if (options.help) usage()
  else runPostRagRebuild(options).then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(`[post-rag-current] ${String(error?.message || error)}`)
    process.exitCode = 1
  })
}
