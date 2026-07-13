#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_ENV_ID, defaultRunner } from './cloud-release-smoke.mjs'
import { invokeAdmin, parseRebuildArgs } from './rebuild-post-search-index.mjs'
import { advanceProbeTimerEvidence } from './lib/post-rag-timer-evidence.mjs'
import { createTimerProbeDeadline } from './lib/post-rag-timer-probe-policy.mjs'

const startedAt = new Date().toISOString()
const base = parseRebuildArgs([], process.env)
const options = { ...base, envId: process.env.TCB_ENV || DEFAULT_ENV_ID, commandTimeoutMs: 180000, adminInvokeRetries: 3 }
const runId = String(process.env.HH_RELEASE_RUN_ID || Date.now())
const deadline = createTimerProbeDeadline(Date.now(), process.env)
if (!options.adminInternalToken) throw new Error('ADMIN_INTERNAL_CALL_TOKEN is required')

let evidence = null
let probe = null
let probeEvidence = { probeOutboxSeen: false, probeV2JobSeen: false }
try {
  probe = (await invokeAdmin('post.ragTimerProbeCreateAdmin', { runId }, options, defaultRunner)).functionResult
  while (Date.now() < deadline) {
    const bound = { runId: probe.runId, communityId: probe.communityId, sectionId: probe.sectionId, postId: probe.postId, outboxId: probe.outboxId }
    const [evidenceRecord, statusRecord] = await Promise.all([
      invokeAdmin('post.ragTimerEvidenceAdmin', { runId: probe.runId }, options, defaultRunner),
      invokeAdmin('post.ragTimerProbeStatusAdmin', bound, options, defaultRunner),
    ])
    evidence = evidenceRecord.functionResult?.evidence
    const status = statusRecord.functionResult
    probeEvidence = advanceProbeTimerEvidence(probeEvidence, evidence, { startedAt, outboxId: probe.outboxId, jobId: status?.job?._id })
    if (probeEvidence.probeOutboxSeen && probeEvidence.probeV2JobSeen && status?.complete) break
    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(5000, remainingMs)))
  }
  const status = (await invokeAdmin('post.ragTimerProbeStatusAdmin', {
    runId: probe.runId, communityId: probe.communityId, sectionId: probe.sectionId, outboxId: probe.outboxId, postId: probe.postId,
  }, options, defaultRunner)).functionResult
  if (!probeEvidence.probeOutboxSeen || !probeEvidence.probeV2JobSeen || !status?.complete) {
    throw new Error('fresh authenticated timer did not complete the unique V2 probe before the bounded deadline')
  }
  const output = { schemaVersion: 1, runId, triggerName: evidence.triggerName, postId: probe.postId, probeOutboxSeen: true, probeV2JobSeen: true, complete: true }
  const evidencePath = path.resolve('.codex-local', 'release-evidence', runId, 'post-rag-timer.json')
  await fs.mkdir(path.dirname(evidencePath), { recursive: true })
  await fs.writeFile(evidencePath, JSON.stringify(output, null, 2))
  console.log(`[post-rag-timer] verified runId=${runId} trigger=${evidence.triggerName} postId=${probe.postId}`)
} finally {
  if (probe) await invokeAdmin('post.ragTimerProbeCleanupAdmin', {
    runId: probe.runId, communityId: probe.communityId, sectionId: probe.sectionId, postId: probe.postId,
  }, options, defaultRunner)
}
