#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
import { invokeAdmin } from './rebuild-post-search-index.mjs'
import { resolveAdminInternalToken } from './lib/admin-internal-token.mjs'
import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import {
  createSignedPostRagSmokeIdentity,
  requirePostRagSmokeIdentitySecret,
} from './lib/post-rag-smoke-identity.mjs'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'
import { runSemanticSmokeScenario, runV2WorkerSequence } from './lib/post-semantic-smoke-orchestrator.mjs'

const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_ADMIN_INVOKE_RETRIES = 5
const SMOKE_IDENTITY_TTL_MS = 5 * 60 * 1000

function nowRunId() {
  return `rag-${Date.now().toString(36)}`
}

function getFlagValue(name, fallback = '') {
  const equalsArg = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1]
  }
  return fallback
}

export function parseArgs() {
  return {
    envId: getFlagValue('env-id', process.env.TCB_ENV || DEFAULT_ENV_ID),
    commandTimeoutMs: Math.max(30000, Math.floor(Number(getFlagValue(
      'command-timeout-ms',
      process.env.HH_POST_RAG_SMOKE_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS),
    )) || DEFAULT_TIMEOUT_MS)),
    actor: getFlagValue('actor', `rag-smoke-${nowRunId()}`),
    adminInvokeRetries: Math.max(1, Math.floor(Number(getFlagValue(
      'admin-invoke-retries',
      process.env.HH_POST_RAG_SMOKE_ADMIN_INVOKE_RETRIES || String(DEFAULT_ADMIN_INVOKE_RETRIES),
    )) || DEFAULT_ADMIN_INVOKE_RETRIES)),
    adminInternalToken: resolveAdminInternalToken(),
    smokeIdentitySecret: requirePostRagSmokeIdentitySecret(),
    workerToken: getFlagValue('worker-token', resolvePostRagWorkerToken()),
  }
}

function withWorkerToken(payload, options) {
  if (!options.workerToken) {
    throw new Error('Missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN for post-rag-worker invocation')
  }
  return { ...payload, workerToken: options.workerToken }
}

function writePayloadFile(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'happyhome-post-rag-smoke-'))
  const file = join(dir, 'payload.json')
  writeFileSync(file, JSON.stringify(payload), 'utf8')
  return { dir, file }
}

async function invokeFunction(functionName, payload, options) {
  const payloadFile = writePayloadFile(payload)
  let result
  let commandLine = ''
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
    commandLine = formatCommand(built.command, built.args)
    result = await defaultRunner(built.command, built.args, {
      timeoutMs: options.commandTimeoutMs,
    })
  } finally {
    rmSync(payloadFile.dir, { recursive: true, force: true })
  }

  const output = `${result.stdout || ''}${result.stderr || ''}`
  const parsed = parseFirstJson(output)
  const cloudInvoke = analyzeCloudInvoke(parsed)
  const functionResult = extractFunctionResult(parsed)
  const ok = Boolean(parsed) && result.status === 0 && (cloudInvoke ? cloudInvoke.ok : true)
  if (!ok) {
    const message = [
      `${functionName} invoke failed`,
      `command=${commandLine}`,
      `status=${result.status}`,
      cloudInvoke?.errMsg || result.error || result.stderr || result.stdout || 'missing JSON result',
    ].filter(Boolean).join(' | ')
    throw new Error(message)
  }
  return functionResult
}

export async function searchPost(options, communityId, query, identity) {
  const result = await invokeFunction('post', {
    action: 'search',
    communityId,
    q: query,
    limit: 5,
    __happyhomeSmokeIdentity: identity,
    happyhomeSmokeAudit: true,
  }, options)
  if (result?.error) throw new Error(`post.search failed: ${result.error}`)
  return result
}

export async function seedFixtureMember(communityId, userId) {
  const db = createProductionReleaseStore({ root: process.cwd() }).db
  const now = new Date().toISOString()
  await db.collection('community_members').add({
    communityId, userId, role: 'member', status: 'active', appliedAt: now, joinedAt: now,
  })
}

export async function seedFixtureRun(identity) {
  const db = createProductionReleaseStore({ root: process.cwd() }).db
  await db.collection('post_rag_smoke_runs').doc(identity.runId).set({
    runId: identity.runId,
    communityId: identity.communityId,
    userId: identity.userId,
    action: identity.action,
    status: 'active',
    expiresAt: identity.expiresAt,
    createdAt: new Date().toISOString(),
  })
  const record = await db.collection('post_rag_smoke_runs').doc(identity.runId).get()
  const data = Array.isArray(record?.data) ? record.data[0] : record?.data
  if (
    data?.runId !== identity.runId
    || data?.communityId !== identity.communityId
    || data?.userId !== identity.userId
    || data?.status !== 'active'
  ) {
    throw new Error('post_rag_smoke_runs seed verification failed')
  }
}

export async function cleanupFixtureRun(runId) {
  if (!runId) return
  const db = createProductionReleaseStore({ root: process.cwd() }).db
  await db.collection('post_rag_smoke_runs').doc(runId).remove()
}

export async function invokePostSemanticAdmin(action, params, options) {
  return invokeAdmin(action, params, options)
}

export async function readFixtureIndexState(postId) {
  const db = createProductionReleaseStore({ root: process.cwd() }).db
  const record = await db.collection('post_rag_index_state_v2').doc(postId).get()
  return Array.isArray(record?.data) ? record.data[0] : record?.data
}

export async function advanceV2Worker(options, postId = '') {
  const payload = (action) => withWorkerToken({ ...(action ? { action } : {}), limit: 20, ...(postId ? { postId } : {}) }, options)
  return runV2WorkerSequence({
    materialize: () => invokeFunction('post-rag-worker', payload('materializeOutbox'), options),
    indexV2: () => invokeFunction('post-rag-worker', payload('indexV2'), options),
    worker: () => invokeFunction('post-rag-worker', payload(''), options),
  })
}

async function main() {
  const options = parseArgs()
  if (!options.workerToken) {
    throw new Error('POST_RAG_WORKER_TOKEN is required to invoke post-rag-worker')
  }
  let runId = ''
  let ownerOpenid = ''
  let communityId = ''
  let sectionId = ''
  let postId = ''
  let guestRunId = ''

  console.log(`[post-rag-smoke] env=${options.envId} actor=${options.actor}`)
  try {
    const community = await invokeAdmin('community.createAdmin', {
      name: `HH_RAG_SMOKE_${options.actor}`,
      description: 'temporary RAG smoke fixture',
      coverImage: '',
      location: { province: 'P', city: 'C', district: 'D', address: 'rag-smoke' },
      joinType: 'open',
    }, options)
    communityId = community.functionResult?.communityId || ''
    if (!communityId) throw new Error('community.createAdmin did not return communityId')

    runId = `${options.actor}-${nowRunId()}`
    ownerOpenid = `${runId}-user`
    const identity = createSignedPostRagSmokeIdentity({
      version: 1,
      action: 'search',
      communityId,
      runId,
      userId: ownerOpenid,
      expiresAt: Date.now() + SMOKE_IDENTITY_TTL_MS,
    }, options.smokeIdentitySecret)
    await seedFixtureMember(communityId, ownerOpenid)
    await seedFixtureRun(identity)
    guestRunId = `${runId}-guest-run`
    const guestIdentity = createSignedPostRagSmokeIdentity({ version: 1, action: 'search', communityId, runId: guestRunId, userId: `${runId}-guest`, expiresAt: Date.now() + SMOKE_IDENTITY_TTL_MS }, options.smokeIdentitySecret)
    await seedFixtureRun(guestIdentity)

    const section = await invokeAdmin('section.create', {
      communityId,
      name: `RAG Smoke ${options.actor}`,
      icon: 'test',
      order: 0,
      type: 'evergreen',
    }, options)
    sectionId = section.functionResult?.sectionId || ''
    if (!sectionId) throw new Error('section.create did not return sectionId')

    const widgetsResult = await invokeAdmin('section.updateWidgets', {
      communityId,
      sectionId,
      widgets: [
        { type: 'short_text', label: '标题', fieldKey: 'title', required: true, showInList: true, order: 0, widgetId: '' },
        { type: 'rich_text', label: '正文', fieldKey: 'body', required: true, showInList: false, order: 1, widgetId: '' },
        { type: 'short_text', label: '会员专属', fieldKey: 'memberNote', required: false, showInList: false, visibility: 'member', order: 2, widgetId: '' },
      ],
    }, options)
    const widgets = widgetsResult.functionResult?.widgets || []
    const titleWidget = widgets.find((widget) => widget.fieldKey === 'title')
    const bodyWidget = widgets.find((widget) => widget.fieldKey === 'body')
    const memberWidget = widgets.find((widget) => widget.fieldKey === 'memberNote')
    if (!titleWidget?.widgetId || !bodyWidget?.widgetId || !memberWidget?.widgetId) {
      throw new Error('section.updateWidgets did not return required widget ids')
    }

    const post = await invokeAdmin('post.createAdmin', {
      communityId,
      sectionId,
      content: {
        [titleWidget.widgetId]: `朱子治家格言 ${options.actor}`,
        [bodyWidget.widgetId]: '《朱子治家格言》里说：一粥一饭，当思来处不易；半丝半缕，恒念物力维艰。这是在讲勤俭持家和节俭家风。',
        [memberWidget.widgetId]: '会员专属内容',
      },
    }, options)
    postId = post.functionResult?.postId || ''
    if (!postId) throw new Error('post.createAdmin did not return postId')

    if (post.functionResult?.auditStatus !== 'pass') {
      await invokeAdmin('audit.approveAdmin', { postId }, options)
    }

    const evidence = await runSemanticSmokeScenario({ postId, memberIdentity: identity, guestIdentity, latencyRuns: 30 }, {
      now: () => Date.now(), wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
      advanceV2: () => advanceV2Worker(options, postId), readState: () => readFixtureIndexState(postId),
      search: (query, searchIdentity) => searchPost(options, communityId, query, searchIdentity),
      updatePost: async () => { const updated = await invokePostSemanticAdmin('post.updateAdmin', { postId, content: { [titleWidget.widgetId]: `朱子治家格言 ${options.actor}`, [bodyWidget.widgetId]: '循环利用旧物，勤俭持家。', [memberWidget.widgetId]: '会员专属内容' } }, options); if (updated.functionResult?.auditStatus !== 'pass') await invokePostSemanticAdmin('audit.approveAdmin', { postId }, options) },
      deletePost: () => invokePostSemanticAdmin('post.deleteAdmin', { postId }, options),
    })
    const evidencePath=join(process.cwd(),'.codex-local','release-evidence',String(process.env.HH_RELEASE_RUN_ID||runId),'post-rag-smoke.json')
    mkdirSync(dirname(evidencePath),{recursive:true});writeFileSync(evidencePath,JSON.stringify({schemaVersion:1,protocolVersion:2,permissionLeaks:evidence.permissionLeaks,deleteState:evidence.deleteState,p95Ms:evidence.p95Ms,errorRate:evidence.errorRate},null,2))

    console.log(`[post-rag-smoke] PASS post=${postId} community=${communityId}`)
    console.log(`[post-rag-smoke] protocolVersion=2 p95Ms=${evidence.p95Ms} errorRate=${evidence.errorRate}`)
  } finally {
    let cleanupError
    try {
      await cleanupFixtureRun(runId)
      await cleanupFixtureRun(guestRunId)
    } catch (error) {
      console.warn(`[post-rag-smoke] cleanup run warning: ${error?.message || error}`)
      cleanupError = error
    }
    if (communityId) {
      try {
        await invokeAdmin('community.disable', { communityId }, options)
      } catch (error) {
        console.warn(`[post-rag-smoke] cleanup disable warning: ${error?.message || error}`)
      }
      try {
        await invokeAdmin('community.hardDelete', { communityId }, options)
      } catch (error) {
        console.warn(`[post-rag-smoke] cleanup hardDelete warning: ${error?.message || error}`)
        cleanupError ||= error
      }
      if (postId) {
        try {
          await invokeFunction('post-rag-worker', withWorkerToken({ limit: 20, postId }, options), options)
        } catch (error) {
          console.warn(`[post-rag-smoke] cleanup worker warning: ${error?.message || error}`)
          cleanupError ||= error
        }
      }
      if (!cleanupError) console.log(`[post-rag-smoke] cleanup ok community=${communityId}`)
    }
    if (cleanupError) throw cleanupError
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(`[post-rag-smoke] FAILED: ${error?.stack || error?.message || error}`)
  process.exit(1)
})
