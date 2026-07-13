#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runReleasePreflight } from './lib/release-preflight.mjs'
import { RELEASE_CONTROL_PLANE_COLLECTIONS } from './lib/release-control-plane.mjs'
import { createReleasePlan } from './lib/release-plan.mjs'
import { createReleasePlanAfterResumeIdentityCheck } from './lib/release-run-ledger.mjs'
import { invokeAdmin, parseRebuildArgs } from './rebuild-post-search-index.mjs'
import { defaultRunner } from './cloud-release-smoke.mjs'
import { createTimerProbeDeadline } from './lib/post-rag-timer-probe-policy.mjs'

const REQUIRED_RAG_COLLECTIONS = ['post_rag_outbox', 'post_rag_jobs', 'post_rag_index_state_v2', 'post_rag_index_versions', 'post_rag_worker_timer_evidence']
function readEnv(file) {
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => {
    const index = line.indexOf('='); return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')] : []
  }).filter(([key]) => key))
}
const home = os.homedir()
const env = { ...readEnv(path.join(home, '.happyhome', 'cam.env')), ...readEnv(path.join(home, '.happyhome', 'tencent-rag.env')), ...process.env }
const secretId = env.TENCENTCLOUD_SECRETID
const secretKey = env.TENCENTCLOUD_SECRETKEY
const envId = env.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
const app = secretId && secretKey ? CloudBase.init({ secretId, secretKey, envId }) : null
const headSha = String(env.HH_RELEASE_HEAD_SHA || '').trim()
const runId = `preflight-${Date.now()}-${crypto.randomUUID()}`
const adminOptions = { ...parseRebuildArgs([], env), envId, commandTimeoutMs: 180000, adminInvokeRetries: 3 }

const checks = [
  { name: 'rag-collections', run: async () => {
    if (!app) throw new Error('credentials unavailable')
    const missing = []
    for (const name of [...RELEASE_CONTROL_PLANE_COLLECTIONS, ...REQUIRED_RAG_COLLECTIONS]) {
      if ((await app.database.checkCollectionExists(name))?.Exists !== true) missing.push(name)
    }
    return missing.length ? { status: 'failed', detail: `${missing.length} required collections missing` } : { status: 'passed' }
  } },
  { name: 'rag-index', run: async () => {
    const endpoint = String(env.TENCENT_RAG_ES_ENDPOINT || '').replace(/\/+$/, '')
    const index = String(env.TENCENT_RAG_ES_INDEX || 'happyhome-post-rag-v2')
    if (!endpoint || !env.TENCENT_RAG_ES_USERNAME || !env.TENCENT_RAG_ES_PASSWORD) throw new Error('index credentials unavailable')
    const auth = Buffer.from(`${env.TENCENT_RAG_ES_USERNAME}:${env.TENCENT_RAG_ES_PASSWORD}`).toString('base64')
    const response = await fetch(`${endpoint}/${encodeURIComponent(index)}`, { method: 'HEAD', headers: { Authorization: `Basic ${auth}` } })
    return response.ok ? { status: 'passed' } : { status: 'failed', detail: 'required RAG index is unavailable' }
  } },
  { name: 'worker-timers', run: async () => {
    if (!app) throw new Error('credentials unavailable')
    for (const [functionName, triggerName] of [['post-rag-worker', 'post-rag-worker-every-minute'], ['post-video-rag-worker', 'post-video-rag-worker-every-10-min']]) {
      const detail = await app.functions.getFunctionDetail(functionName)
      const response = await app.functions.scfService.request('ListTriggers', { FunctionName: functionName, Namespace: detail?.Namespace || app.functions.getFunctionConfig?.().namespace })
      if (!(response?.Triggers || []).some(item => item.TriggerName === triggerName)) return { status: 'failed', detail: 'required worker timer is missing' }
    }
    return { status: 'passed' }
  } },
  { name: 'full-current-plan-resume', run: async () => {
    if (!/^[0-9a-f]{7,64}$/i.test(headSha)) return { status: 'failed', detail: 'HH_RELEASE_HEAD_SHA is required' }
    const resumeRunState = env.HH_RELEASE_RESUME_CONTEXT_JSON ? JSON.parse(env.HH_RELEASE_RESUME_CONTEXT_JSON) : null
    createReleasePlanAfterResumeIdentityCheck({ resumeRunState, gitSha: headSha, releaseStrategy: 'full-current', createPlan: (gitSha, mode) => createReleasePlan({ headSha: gitSha, mode }) })
    return { status: 'passed' }
  } },
  { name: 'timer-probe-document',
    createFixture: async () => {
      if (!adminOptions.adminInternalToken) throw new Error('admin credential unavailable')
      return (await invokeAdmin('post.ragTimerProbeCreateAdmin', { runId }, adminOptions, defaultRunner)).functionResult
    },
    run: async probe => {
      const deadline = createTimerProbeDeadline(Date.now(), env)
      let status
      while (Date.now() < deadline) {
        status = (await invokeAdmin('post.ragTimerProbeStatusAdmin', probe, adminOptions, defaultRunner)).functionResult
        if (!status) return { status: 'failed', detail: 'probe document is missing' }
        if (status.complete) return { status: 'passed' }
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(0, deadline - Date.now()))))
      }
      return { status: 'failed', detail: 'probe document remained pending' }
    },
    cleanupFixture: async probe => invokeAdmin('post.ragTimerProbeCleanupAdmin', probe, adminOptions, defaultRunner),
  },
]
const result = await runReleasePreflight({ checks })
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1
