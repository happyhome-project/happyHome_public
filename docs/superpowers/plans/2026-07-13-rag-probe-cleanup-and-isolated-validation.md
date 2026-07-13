# RAG Probe Cleanup and Isolated Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make release-probe cleanup truthful and residue-free, then prove create/search/delete behavior through a temporary exact-ID cloud worker without replacing production functions.

**Architecture:** The probe moves through `active -> cleaning -> finalizing -> cleaned`. ES deletion remains asynchronous, but cleanup does not report success until the bound delete job is terminal and every probe-owned database artifact has been removed. A temporary validation function uses the real VPC, embedding provider, and ES endpoint while processing only one signed run-bound fixture.

**Tech Stack:** TypeScript, Jest, Node.js test runner, wx-server-sdk/CloudBase, Tencent SCF, Elasticsearch Serverless, esbuild.

---

### Task 1: Truthful probe cleanup state machine

**Files:**
- Modify: `cloud/lib/post-rag-release-probe.ts`
- Test: `cloud/lib/__tests__/post-rag-release-probe.integration.test.ts`

- [ ] **Step 1: Write the failing lifecycle test**

Add a test that creates a probe, materializes both create and delete outboxes/jobs in the mock store, and asserts the first cleanup call is pending:

```ts
const first = await cleanupPostRagReleaseProbe(probe)
expect(first).toMatchObject({ success: false, pending: true, status: 'cleaning' })
expect(mockStore.get(mockKey('post_rag_release_probes', probe.runId))).toMatchObject({
  status: 'cleaning',
  cleanupOutboxId: expect.any(String),
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- --runInBand cloud/lib/__tests__/post-rag-release-probe.integration.test.ts
```

Expected: FAIL because current cleanup immediately returns success and writes `status=cleaned`.

- [ ] **Step 3: Implement `active -> cleaning`**

Change the initial cleanup transaction to persist the delete outbox and return a pending result:

```ts
await tx.collection(PROBES).doc(id).set({ data: {
  ...probeData,
  status: 'cleaning',
  cleanupStartedAt: now,
  cleanupOutboxId: removed.outboxId,
} })
return { cleanupOutboxId: removed.outboxId, contentVersion: removed.contentVersion }
```

The public result is:

```ts
{ success: false, pending: true, status: 'cleaning', outboxId, contentVersion }
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command. Expected: PASS for the new first-phase assertion.

- [ ] **Step 5: Write failing finalization and binding tests**

Cover these exact behaviors:

```ts
expect(await cleanupPostRagReleaseProbe(probe)).toMatchObject({ pending: true })

// A completed delete job is the durable proof that the sink removal ran.
mockStore.set(mockKey('post_rag_jobs', deleteJobId), {
  _id: deleteJobId, schemaVersion: 2, status: 'completed', outcome: 'removed',
  postId: probe.postId, leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
})

expect(await cleanupPostRagReleaseProbe(probe)).toMatchObject({
  success: true, pending: false, status: 'cleaned',
})
const probeOwned = (key: string) => key.includes(probe.postId)
  || key.endsWith(`/${probe.outboxId}`)
  || key.endsWith(`/${cleanupOutboxId}`)
  || key.endsWith(`/${createJobId}`)
  || key.endsWith(`/${deleteJobId}`)
expect([...mockStore.keys()].filter(probeOwned)).toEqual([
  mockKey('post_rag_release_probes', probe.runId),
])
await expect(cleanupPostRagReleaseProbe({ ...probe, postId: 'business-post' }))
  .rejects.toThrow(/binding/)
```

Also test a crash after entering `finalizing`: a second call must idempotently finish missing-record removals.

- [ ] **Step 6: Run the focused test and verify RED**

Run the Step 2 command. Expected: FAIL because `cleaning/finalizing` handling and artifact removal do not exist.

- [ ] **Step 7: Implement `cleaning -> finalizing -> cleaned`**

Add private helpers with these contracts:

```ts
type ProbeArtifactIds = {
  outboxIds: string[]
  jobIds: string[]
  indexVersionIds: string[]
}

function jobHasLiveLease(job: any, now: string) {
  return job?.status === 'processing' && String(job?.leaseExpiresAt || '') > now
}

async function readProbeArtifacts(probe: any): Promise<ProbeArtifactIds> {
  const outboxIds = [probe.outboxId, probe.cleanupOutboxId].filter(Boolean)
  const outboxes = await db.getByIds('post_rag_outbox', outboxIds)
  if (outboxes.some((row: any) => row.aggregateId !== probe.postId || row.communityId !== probe.communityId)) {
    throw new Error('release probe artifact binding mismatch')
  }
  const jobIds = outboxes.map((row: any) => String(row.materializedJobId || '')).filter(Boolean)
  const jobs = await db.getByIds('post_rag_jobs', jobIds)
  if (jobs.some((row: any) => row.postId !== probe.postId)) throw new Error('release probe artifact binding mismatch')
  const versions = await db.query('post_rag_index_versions', { postId: probe.postId }, { limit: 100 }) as any[]
  return { outboxIds, jobIds, indexVersionIds: versions.map(row => String(row._id)) }
}

async function removeProbeArtifacts(probe: any, ids: ProbeArtifactIds): Promise<void> {
  for (const jobId of ids.jobIds) await db.removeById('post_rag_jobs', jobId)
  for (const outboxId of ids.outboxIds) await db.removeById('post_rag_outbox', outboxId)
  for (const versionId of ids.indexVersionIds) await db.removeById('post_rag_index_versions', versionId)
  await db.removeById('post_rag_index_state_v2', probe.postId)
}
```

Rules:

- Only `probe.outboxId`, `probe.cleanupOutboxId`, their `materializedJobId` values, `postId` index state, and index versions queried by the same `postId` are eligible.
- The cleanup delete job must be `completed` with `outcome` equal to `removed` or `superseded`.
- A create job with a live lease keeps cleanup pending. An absent, terminal, or expired-lease create job may be removed after the higher-version delete job completes.
- Persist `status=finalizing` and the exact artifact ID arrays before removing anything.
- Remove IDs idempotently, then persist `status=cleaned`, `cleanedAt`, and bounded cleanup counts.

- [ ] **Step 8: Run focused and related probe tests**

Run:

```powershell
npm.cmd test -- --runInBand cloud/lib/__tests__/post-rag-release-probe.integration.test.ts cloud/functions/admin/__tests__/admin.test.ts
```

Expected: PASS.

### Task 2: Bounded cleanup polling in the release runner

**Files:**
- Modify: `scripts/lib/post-rag-timer-probe-runner.mjs`
- Test: `scripts/lib/post-rag-timer-probe-runner.test.mjs`

- [ ] **Step 1: Write failing polling tests**

Add one test returning pending twice and success once:

```js
const cleanupResults = [
  { functionResult: { success: false, pending: true, status: 'cleaning' } },
  { functionResult: { success: false, pending: true, status: 'finalizing' } },
  { functionResult: { success: true, pending: false, status: 'cleaned' } },
]
```

Assert cleanup invokes the bound action three times and returns only after `cleaned`. Add a timeout test asserting a pending cleanup becomes a `phase=cleanup`, `code=TIMEOUT`, `cleanup=true` failure.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test scripts/lib/post-rag-timer-probe-runner.test.mjs
```

Expected: FAIL because cleanup currently invokes the admin action once.

- [ ] **Step 3: Implement bounded polling**

Use a fixed five-minute cleanup budget independent from the probe wait deadline:

```js
const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000
const CLEANUP_POLL_MS = 5000

while (runtime.now() < cleanupDeadlineMs) {
  const response = await invokeSafe('post.ragTimerProbeCleanupAdmin', boundCleanup, {
    phase: 'cleanup', cleanup: true,
  })
  if (response.functionResult?.success === true && response.functionResult?.status === 'cleaned') return response
  if (response.functionResult?.pending !== true) throw safeTimerError({ phase: 'cleanup', code: 'INVALID_RESPONSE', classification: 'invalid-response', cleanup: true })
  await runtime.sleep(Math.min(CLEANUP_POLL_MS, cleanupDeadlineMs - runtime.now()), signal)
}
throw safeTimerError({ phase: 'cleanup', code: 'TIMEOUT', classification: 'timeout', cleanup: true })
```

- [ ] **Step 4: Run the focused runner tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 3: Safe claim diagnostics

**Files:**
- Create: `cloud/lib/safe-error-diagnostic.ts`
- Create: `cloud/lib/__tests__/safe-error-diagnostic.test.ts`
- Modify: `cloud/lib/post-rag-job-processor.ts`
- Modify: `cloud/lib/__tests__/post-rag-job-processor.test.ts`

- [ ] **Step 1: Write failing redaction tests**

Define the desired result without exposing raw messages:

```ts
expect(safeErrorDiagnostic(Object.assign(new Error('request https://secret:9200 token=abc'), {
  code: 'DATABASE_TRANSACTION_CONFLICT',
}))).toEqual({
  name: 'Error',
  code: 'DATABASE_TRANSACTION_CONFLICT',
  fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
})
expect(JSON.stringify(result)).not.toContain('secret')
expect(JSON.stringify(result)).not.toContain('token=abc')
```

- [ ] **Step 2: Run diagnostics tests and verify RED**

Run:

```powershell
npm.cmd test -- --runInBand cloud/lib/__tests__/safe-error-diagnostic.test.ts cloud/lib/__tests__/post-rag-job-processor.test.ts
```

Expected: FAIL because the helper and structured claim warning do not exist.

- [ ] **Step 3: Implement safe metadata and structured warning**

The helper returns only sanitized name/code and a truncated SHA-256 fingerprint:

```ts
export function safeErrorDiagnostic(error: unknown) {
  const value = error as { name?: unknown; code?: unknown; message?: unknown }
  const safeToken = (input: unknown, fallback: string) => {
    const token = String(input || '')
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(token) ? token : fallback
  }
  const name = safeToken(value?.name, 'Error')
  const code = safeToken(value?.code, 'UNKNOWN')
  const fingerprint = createHash('sha256')
    .update(`${name}\n${code}\n${String(value?.message || '')}`)
    .digest('hex').slice(0, 16)
  return { name, code, fingerprint }
}
```

Change the claim catch to `catch (error)` and emit:

```ts
console.warn('[post-rag-job-processor] claim failed', {
  jobId,
  ...safeErrorDiagnostic(error),
})
```

Keep the caller result envelope as `INTERNAL_ERROR/claim`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: PASS with no raw error data in output assertions.

### Task 4: Exact-ID isolated cloud validator

**Files:**
- Create: `scripts/fixtures/post-rag-isolated-worker/index.ts`
- Create: `scripts/lib/post-rag-isolated-validation.mjs`
- Create: `scripts/lib/post-rag-isolated-validation.test.mjs`
- Create: `scripts/validate-post-rag-isolated.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing isolation-policy tests**

Test deterministic names and exact-ID fencing:

```js
const identity = createValidationIdentity('f16b88f', '20260713T210000')
assert.match(identity.functionName, /^post-rag-validate-[a-f0-9]{8}$/)
assert.equal(assertProbeOwnedId('rag_timer_post_abcd', 'rag_timer_post_abcd'), true)
assert.throws(() => assertProbeOwnedId('business-post', 'rag_timer_post_abcd'), /binding/)
assert.deepEqual(selectExactCandidates(['job-a'], ['job-a', 'job-b']), ['job-a'])
```

The tested helpers are defined as:

```js
export function createValidationIdentity(head, runId) {
  const digest = createHash('sha256').update(`${head}:${runId}`).digest('hex').slice(0, 8)
  return { functionName: `post-rag-validate-${digest}`, runId }
}

export function assertProbeOwnedId(actual, expected) {
  if (!expected.startsWith('rag_timer_') || actual !== expected) throw new Error('validation binding mismatch')
  return true
}

export function selectExactCandidates(boundIds, availableIds) {
  const allowed = new Set(boundIds)
  return availableIds.filter(id => allowed.has(id))
}
```

Also test that the orchestrator always schedules trigger deletion and function deletion in `finally`, including a failed semantic assertion.

- [ ] **Step 2: Run the policy tests and verify RED**

Run:

```powershell
node --test scripts/lib/post-rag-isolated-validation.test.mjs
```

Expected: FAIL because the isolated validation module does not exist.

- [ ] **Step 3: Implement the temporary exact-ID handler**

The handler must:

- require `RAG_VALIDATION_TOKEN` using constant-time comparison;
- require a valid release-probe `runId`;
- call `createPostRagReleaseProbe`, `readPostRagReleaseProbeStatus`, and `cleanupPostRagReleaseProbe` only for that binding;
- on timer invocation, read the bound probe and process only `probe.outboxId` or `probe.cleanupOutboxId`;
- materialize one exact outbox using `claimPostRagOutboxEvent` and `materializeClaimedPostRagOutboxEvent`;
- process one exact V2 job by invoking `processPostRagJobV2Batch` with dependencies whose `listCandidates` returns only the bound job ID;
- reject any outbox/job whose stored `postId` or `aggregateId` differs from the probe post ID;
- never call the global candidate scanners.

Return bounded counts and IDs only; never return tokens, embeddings, endpoints, or raw provider errors.

- [ ] **Step 4: Implement the orchestrator**

`scripts/validate-post-rag-isolated.mjs` must:

1. Build the temporary handler with esbuild into `.codex-local/rag-validation/<runId>/function`.
2. Deploy a unique function with `tcb fn deploy`.
3. Copy the production worker's VPC and required RAG environment values, adding independent validation/timer tokens.
4. Create a timer trigger named `post-rag-worker-every-minute` bound only to the temporary function.
5. Invoke `create`, wait for exact create completion, call the real semantic-search cloud action with query `probe-<runId>`, and require the exact fixture post/citation.
6. Invoke cleanup, wait for the exact delete job, verify an exact semantic lookup no longer returns the fixture, and poll cleanup to `cleaned`.
7. Compare pre/post non-probe counts and assert zero probe-owned residue.
8. In `finally`, delete the timer trigger, temporary function, artifact directory, and temporary secrets; re-read control-plane state to prove absence.

The command writes sanitized evidence to `.codex-local/rag-validation/<runId>/evidence.json`.

The orchestration boundary is explicit:

```js
export async function runIsolatedValidation(options, deps) {
  const identity = createValidationIdentity(options.head, options.runId)
  let deployed = false
  let triggerCreated = false
  try {
    const artifact = await deps.build(identity)
    await deps.deploy({ ...identity, artifact }); deployed = true
    await deps.copyRuntimeConfig(identity)
    await deps.createTrigger(identity); triggerCreated = true
    const probe = await deps.invoke(identity, { action: 'create', runId: identity.runId })
    const indexed = await deps.waitIndexed(identity, probe)
    await deps.assertSemanticHit(probe, indexed)
    await deps.invoke(identity, { action: 'cleanup', ...probe })
    const removed = await deps.waitRemoved(identity, probe)
    await deps.assertSemanticAbsent(probe, removed)
    const cleaned = await deps.waitCleaned(identity, probe)
    await deps.assertNoResidue(probe, cleaned)
    return await deps.writeEvidence({ identity, probe, indexed, removed, cleaned })
  } finally {
    if (triggerCreated) await deps.deleteTrigger(identity)
    if (deployed) await deps.deleteFunction(identity)
    await deps.removeArtifact(identity)
    await deps.assertControlPlaneAbsent(identity)
  }
}
```

- [ ] **Step 5: Add the package command**

```json
"validate:rag:isolated": "node scripts/validate-post-rag-isolated.mjs"
```

- [ ] **Step 6: Run policy tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 5: Local verification, isolated cloud run, and PR update

**Files:**
- Modify as required by Tasks 1-4 only.

- [ ] **Step 1: Run affected cloud tests**

```powershell
npm.cmd test -- --runInBand cloud/lib/__tests__/post-rag-release-probe.integration.test.ts cloud/lib/__tests__/safe-error-diagnostic.test.ts cloud/lib/__tests__/post-rag-job-processor.test.ts cloud/functions/admin/__tests__/admin.test.ts
node --test scripts/lib/post-rag-timer-probe-runner.test.mjs scripts/lib/post-rag-isolated-validation.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run full cloud unit/integration and builds**

```powershell
npm.cmd run test:cloud
npm.cmd run test:integration
npm.cmd run build:cloud
git diff --check
```

Expected: all pass; all ten release cloud functions build; no whitespace errors.

- [ ] **Step 3: Run the authorized isolated cloud lifecycle**

```powershell
npm.cmd run validate:rag:isolated
```

Expected evidence:

- create outbox consumed;
- V2 job completed with `outcome=indexed`;
- exact semantic result includes the fixture post and citation fields;
- delete job completed with `outcome=removed` or `superseded`;
- exact semantic result no longer includes the fixture;
- probe status is `cleaned`;
- probe-owned artifact counts are zero;
- non-probe baseline counts are unchanged;
- temporary trigger/function/control-plane secrets are absent.

- [ ] **Step 4: Commit and ordinary-push through PR control**

Before each Git/package mutation, run the subscription guard. Commit as:

```powershell
git add cloud scripts package.json docs/superpowers
git commit -m "fix: complete RAG probe cleanup lifecycle"
git push origin codex/rag-v2-claim-starvation
```

Record the push through subscription `0lwX4vVTlHNsYPS-o-Qitw35`, then report the exact SHA and test/evidence paths. Do not merge, deploy production functions, upload the mini-program, or resolve reviewer threads.
