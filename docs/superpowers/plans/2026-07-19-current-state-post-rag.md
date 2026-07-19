# Current-State Formal Post RAG Implementation Plan

> **Historical / point-in-time:** This plan records the approved 2026-07-19 implementation sequence. Its checkboxes are delivery notes, not current repository status after the work is complete.
> **Current authority:** Use the maintained [formal post RAG operations](../../post-rag-search.md), [release gate](../../release-gate.md), executable code, and tests after delivery.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both append-only post RAG pipelines with one current-state record per post, restore the CloudBase proportional-cost RAG search path, exclude non-business data explicitly, and remove old RAG release gates before opening a PR.

**Architecture:** `post_rag_sync_state/<postId>` stores the latest desired revision and is the only indexing work source. The worker rereads current CloudBase business data, writes versioned `post_rag_chunks`, and commits applied state only when the desired revision is unchanged. `post.search` uses the CloudBase plus Tencent atomic provider and filters candidates against live sync, applied, post, section, community-policy, membership, source-version, and scope state.

**Tech Stack:** TypeScript, CloudBase document database and transactions, Jest unit/integration tests, Node.js release tooling tests, Tencent atomic Embedding/Rerank/LLM APIs, GitHub PR CI and Merge Queue.

---

## File structure

New focused units:

- `cloud/lib/post-rag-sync.ts`: current sync document contract, transaction-safe overwrite scheduling, leasing, completion, retry, health, and bounded reconciliation.
- `cloud/lib/post-rag-sync-worker.ts`: current-source resolution, eligibility, provider calls, revision fencing, and batch processing.
- `cloud/lib/__tests__/post-rag-sync.test.ts`: unit contract for one-record coalescing and leases.
- `cloud/lib/__tests__/post-rag-sync-worker.test.ts`: worker decision and fencing tests.
- `cloud/lib/__tests__/post-rag-current-state.integration.test.ts`: real handler-to-sync-to-chunk convergence with the local database.
- `scripts/lib/retired-rag-reference.test.mjs`: fail-closed guard that prevents retired ES/outbox/release symbols from returning to active code.
- `release/changes/20260719-current-state-post-rag.json`: deploy/configure/index declaration only; no live RAG verification actions.

Retained and modified:

- `cloud/lib/post-rag.ts`: proportional-cost provider, answer/citation contract, chunk helpers, optional video analysis; remove append-only job processing.
- `cloud/lib/post-rag-indexing.ts`: canonical source version and explicit policy/scope-aware eligibility inputs.
- `cloud/functions/post-rag-worker/index.ts`: authenticated current-state batch only.
- `cloud/functions/post/index.ts`, `cloud/functions/admin/index.ts`, `cloud/functions/community/index.ts`, `cloud/lib/content-audit.ts`: schedule the current post state, not history.
- `cloud/shared/types.ts`: explicit `ragIndexPolicy` and fixture marker fields.
- `scripts/rebuild-post-rag-index.mjs`: read-only classification/health plus explicit current-state reconcile; no old jobs or V2 stages.
- `scripts/verify-post-rag-smoke.mjs`: validation-scoped current-state worker invocation.
- `scripts/configure-rag-workers.mjs`, `scripts/update-rag-env.mjs`, `scripts/ensure-indexes.mjs`: new collections and pay-per-call environment only.
- `scripts/deploy.mjs`, `scripts/lib/release-plan.mjs`, `scripts/lib/release-component-registry.mjs`, `scripts/lib/release-dag-v2.mjs`: deploy RAG artifacts only when included; permanently remove timer/backfill/smoke/evaluation release execution.
- `docs/post-rag-search.md`, `docs/release-gate.md`, `docs/TESTING.md`: current-state operations and post-release ownership.

Retired units to delete after their replacement tests pass:

- `cloud/lib/post-rag-jobs.ts`
- `cloud/lib/post-rag-job-processor.ts`
- `cloud/lib/post-rag-outbox.ts`
- `cloud/lib/post-rag-outbox-materializer.ts`
- `cloud/lib/post-rag-outbox-worker.ts`
- `cloud/lib/post-rag-release-probe.ts`
- `cloud/lib/post-rag-v2-health.ts`
- `cloud/lib/post-rag-v2-runtime.ts`
- `cloud/lib/post-rag-versioned-index-sink.ts`
- `cloud/lib/post-semantic-search.ts`
- `cloud/lib/rag-worker-timer-evidence.ts`
- `cloud/lib/release-rag-pagination.ts`
- their focused unit/integration tests
- `scripts/backfill-post-rag-v2.mjs`
- `scripts/configure-rag-network.mjs`
- `scripts/ensure-tencent-rag-index.mjs`
- `scripts/eval-post-semantic-search.mjs`
- `scripts/verify-post-rag-timer.mjs`
- their V2/ES/timer/evaluation helpers and tests under `scripts/lib/`
- the committed semantic evaluation dataset after no active command references it

### Task 1: Add explicit community policy and one-record synchronization state

**Files:**
- Modify: `cloud/shared/types.ts`
- Modify: `cloud/functions/community/index.ts`
- Modify: `scripts/lib/h5-test-tenant.mjs`
- Create: `cloud/lib/post-rag-sync.ts`
- Create: `cloud/lib/__tests__/post-rag-sync.test.ts`
- Modify: `scripts/ensure-indexes.mjs`

- [ ] **Step 1: Write failing policy and coalescing tests**

Add tests that require normal community creation to persist `ragIndexPolicy: 'business'`, the fixed H5 community to declare `excluded`, and two schedules for one post to leave one record with revision 2:

```ts
test('a newer schedule replaces the same post state instead of appending history', async () => {
  await db.runTransaction(tx => schedulePostRagSyncInTransaction(tx, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.created', now: NOW,
  }))
  await db.runTransaction(tx => schedulePostRagSyncInTransaction(tx, {
    postId: 'post-1', communityId: 'community-1', sectionId: 'section-1', reason: 'post.updated', now: LATER,
  }))

  expect(await db.query(POST_RAG_SYNC_STATE, {}, { limit: 10 })).toEqual([
    expect.objectContaining({ _id: 'post-1', desiredRevision: 2, status: 'pending', attempts: 0, reason: 'post.updated' }),
  ])
})
```

Also cover invalid identifiers, revision overflow, retry reset, immutable `_id=postId`, no raw content fields, and a processing record rescheduled back to `pending` without retaining the old lease.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm.cmd --prefix cloud run test:unit -- --runInBand lib/__tests__/post-rag-sync.test.ts functions/community/__tests__/community.test.ts
node --test scripts/lib/h5-test-tenant.test.mjs
```

Expected: failures because `post-rag-sync.ts` and `ragIndexPolicy` do not exist.

- [ ] **Step 3: Implement the minimal policy and scheduling contract**

Add these public contracts:

```ts
export const POST_RAG_SYNC_STATE = 'post_rag_sync_state'
export type RagIndexPolicy = 'business' | 'validation' | 'excluded'
export type PostRagSyncStatus = 'pending' | 'processing' | 'retry_wait' | 'synced' | 'dead_letter'

export async function schedulePostRagSyncInTransaction(
  transaction: db.DbTransaction,
  input: { postId: string; communityId: string; sectionId?: string; reason: string; now: string },
): Promise<{ postId: string; desiredRevision: number }> {
  const current = await db.transactionGetByIdOrNull<PostRagSyncDocument>(transaction, POST_RAG_SYNC_STATE, input.postId)
  const desiredRevision = (current?.desiredRevision || 0) + 1
  const next = {
    _id: input.postId,
    postId: input.postId,
    communityId: input.communityId,
    sectionId: input.sectionId || '',
    desiredRevision,
    status: 'pending' as const,
    attempts: 0,
    reason: input.reason,
    requestedAt: input.now,
    updatedAt: input.now,
    nextAttemptAt: input.now,
    lastErrorCode: '',
  }
  await transaction.collection(POST_RAG_SYNC_STATE).doc(input.postId).set({ data: withoutId(next) })
  return { postId: input.postId, desiredRevision }
}
```

Extend `Community` and `Post` with explicit optional policy/fixture fields, set new business communities to `business`, and set deterministic H5 fixture communities/posts to `excluded`/fixture-owned data. Add `post_rag_sync_state` indexes for `(status,nextAttemptAt)` and `(communityId,status)` while removing append-only-job indexes only in Task 5.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2. Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add cloud/shared/types.ts cloud/functions/community/index.ts scripts/lib/h5-test-tenant.mjs cloud/lib/post-rag-sync.ts cloud/lib/__tests__/post-rag-sync.test.ts scripts/ensure-indexes.mjs
git commit -m "feat: add current post RAG sync state"
```

### Task 2: Build revision-fenced current-source worker

**Files:**
- Modify: `cloud/lib/post-rag-indexing.ts`
- Modify: `cloud/lib/post-rag.ts`
- Create: `cloud/lib/post-rag-sync-worker.ts`
- Create: `cloud/lib/__tests__/post-rag-sync-worker.test.ts`
- Modify: `cloud/functions/post-rag-worker/index.ts`
- Modify: `cloud/functions/post-rag-worker/__tests__/index.test.ts`

- [ ] **Step 1: Write failing worker tests**

Cover these behaviors with injected real in-memory state and a recording provider:

```ts
test('a deleted never-indexed post converges without a provider call', async () => {
  const result = await processClaimedPostRagSync(claim, deps({ post: null, appliedState: null }))
  expect(result).toMatchObject({ outcome: 'removed', providerCalled: false })
  expect(provider.upsertChunks).not.toHaveBeenCalled()
  expect(provider.deletePostChunks).not.toHaveBeenCalled()
})

test('a newer desired revision wins while external indexing is running', async () => {
  provider.upsertChunks.mockImplementation(async () => {
    await schedule('post-1', 'post.updated')
  })
  await processClaimedPostRagSync(claimForRevision(1), deps())
  expect(await readSync('post-1')).toMatchObject({ desiredRevision: 2, status: 'pending' })
})
```

Also cover unclassified/excluded/fixture communities, validation scope, inactive community/section, audit failure, source-version exactness, lease ownership, bounded retry/backoff, dead letter, idle batch zero provider calls, and candidate limit validation.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd --prefix cloud run test:unit -- --runInBand lib/__tests__/post-rag-sync-worker.test.ts functions/post-rag-worker/__tests__/index.test.ts
```

Expected: failures because the new processor does not exist and the worker still calls outbox/V2/legacy stages.

- [ ] **Step 3: Implement claim, processing, and revision fencing**

Expose from `post-rag-sync.ts`:

```ts
claimPostRagSync(postId, { workerId, now, leaseMs })
completePostRagSync(postId, { workerId, leaseToken, desiredRevision, sourceVersion, indexScope, outcome, chunkCount, now })
failPostRagSync(postId, { workerId, leaseToken, desiredRevision, errorCode, retryable, now })
listPostRagSyncCandidates({ now, limit, postId })
```

Implement `processPostRagSyncBatch()` so it rereads `communities`, `posts`, and the actual section/content contract, resolves `business` or `validation` scope, checks `fixtureKey`, creates exact-version chunks, skips delete calls when applied state proves absence, and commits only against the claimed desired revision.

Add `sourceVersion` and `indexScope` to `RagChunkDocument`. Export the existing current chunk builder from `post-rag.ts` and pass the canonical source version into all text/video chunks. Preserve video metadata and cached analysis chunks.

Replace the worker entry with one authenticated action:

```ts
export async function main(event: any = {}, context: any = {}) {
  assertPostRagWorkerAuthorized(event, context)
  return processPostRagSyncBatch({
    limit: normalizeLimit(event.limit),
    postId: normalizeOptionalPostId(event.postId),
    workerId: `post-rag-worker:${randomUUID()}`,
  })
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all selected tests pass and the worker test has no outbox/V2/legacy envelope expectations.

- [ ] **Step 5: Commit**

```powershell
git add cloud/lib/post-rag-indexing.ts cloud/lib/post-rag.ts cloud/lib/post-rag-sync.ts cloud/lib/post-rag-sync-worker.ts cloud/lib/__tests__/post-rag-sync-worker.test.ts cloud/functions/post-rag-worker
git commit -m "feat: process only current post RAG state"
```

### Task 3: Wire every business mutation to the current state

**Files:**
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/admin/index.ts`
- Modify: `cloud/functions/community/index.ts`
- Modify: `cloud/lib/membership-transitions.ts`
- Modify: `cloud/lib/post-rag.ts`
- Modify tests under `cloud/functions/post/__tests__/`, `cloud/functions/admin/__tests__/`, `cloud/functions/community/__tests__/`, and `cloud/lib/__tests__/content-audit.test.ts`
- Create: `cloud/lib/__tests__/post-rag-current-state.integration.test.ts`

- [ ] **Step 1: Write failing handler and integration tests**

Require create/update/audit/delete to leave one sync record, section/community changes to schedule each current affected post once, membership changes to schedule nothing, and video completion to reschedule its parent post.

```ts
test('create update and delete converge through one post sync record', async () => {
  const created = await handleCreate(input, 'member-1')
  await approveAudit(created.postId)
  await handleUpdate({ postId: created.postId, content: changed }, 'member-1')
  await handleDelete({ postId: created.postId }, 'member-1')

  expect(await db.query(POST_RAG_SYNC_STATE, {}, { limit: 10 })).toEqual([
    expect.objectContaining({ _id: created.postId, status: 'pending', desiredRevision: 4 }),
  ])
})
```

- [ ] **Step 2: Run affected tests and verify RED**

```powershell
npm.cmd --prefix cloud run test:unit -- --runInBand functions/post/__tests__/post.test.ts functions/admin/__tests__/admin.test.ts functions/community/__tests__/community.test.ts lib/__tests__/content-audit.test.ts
npm.cmd --prefix cloud run test:integration -- --runInBand lib/__tests__/post-rag-current-state.integration.test.ts
```

Expected: assertions fail because handlers still write both append-only pipelines.

- [ ] **Step 3: Replace mutation calls**

Replace `appendPostRagOutboxEvent`, `enqueuePostRagJob`, and `enqueuePostRagDeleteJobInTransaction` with `schedulePostRagSyncInTransaction` or `schedulePostRagSync`.

For bulk section/community projection changes, query current affected post IDs in bounded `_id` pages and call `schedulePostRagSync` once per ID. Membership transitions remove RAG outbox invalidation because final authorization is checked live and no embedding changes.

Keep ordinary post writes and scheduling in the same transaction. The video worker schedules through a dedicated transaction after it commits a ready asset.

- [ ] **Step 4: Run affected tests and verify GREEN**

Run the commands from Step 2. Expected: all selected tests pass and no test mocks the retired outbox/job modules.

- [ ] **Step 5: Commit**

```powershell
git add cloud/lib/content-audit.ts cloud/functions/post cloud/functions/admin cloud/functions/community cloud/lib/membership-transitions.ts cloud/lib/post-rag.ts cloud/lib/__tests__/post-rag-current-state.integration.test.ts
git commit -m "refactor: coalesce post RAG mutation work"
```

### Task 4: Restore evidence-bearing proportional-cost search with live state filtering

**Files:**
- Modify: `cloud/lib/post-rag.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/lib/__tests__/post-rag.test.ts`
- Modify: `miniprogram/src/api/cloud.ts` only if current response types reject populated answers/citations
- Modify: `scripts/test-mp-post-rag-search-static.mjs`

- [ ] **Step 1: Write failing search tests**

Require `handleSearch` to return the provider's answer/citations/items, business search to reject validation chunks, signed validation smoke to select validation scope, and stale/pending/deleted/excluded candidates to disappear.

```ts
test('search returns only exact synced business evidence', async () => {
  provider.search.mockResolvedValue(ragResult({ sourceVersion: 'v2', indexScope: 'business' }))
  seedSync({ postId: 'post-1', status: 'synced', appliedSourceVersion: 'v2', indexScope: 'business' })
  seedIndex({ postId: 'post-1', status: 'indexed', sourceVersion: 'v2', indexScope: 'business' })

  await expect(handleSearch({ communityId: 'community-1', q: '勤俭持家' }, 'member-1')).resolves.toMatchObject({
    mode: 'rag', answer: expect.any(String), citations: [expect.objectContaining({ postId: 'post-1' })],
  })
})
```

Add negative cases for mismatched chunk/source versions, pending sync, removed state, fixture-marked post, inactive community/section, cross-community candidate, member-only field as guest, and provider failure.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd --prefix cloud run test:unit -- --runInBand lib/__tests__/post-rag.test.ts functions/post/__tests__/post.test.ts
npm.cmd run test:mp:post-rag-search-static
```

Expected: failures because `handleSearch` still calls the ES semantic service and empties answer/citations.

- [ ] **Step 3: Switch search and add exact-state filtering**

Call `searchPostsWithRag` from `handleSearch`. Pass `indexScope: 'business'` for ordinary requests and `validation` only after the existing signed smoke identity and run binding are accepted.

Before returning citations, load current community, posts, sections, `post_rag_sync_state`, and `post_rag_index_state` for bounded candidate IDs. Keep only candidates whose chunk, sync state, applied state, current source, policy, and requested scope agree. Apply final member-only checks after the current membership query.

The returned contract remains:

```ts
{ mode: 'rag' | 'no_answer' | 'fallback', answer, citations, items, query, communityId, sectionId, total, skip, limit }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run Step 2 commands. Expected: all selected tests pass and no active post-search import references `post-semantic-search`.

- [ ] **Step 5: Commit**

```powershell
git add cloud/lib/post-rag.ts cloud/functions/post/index.ts cloud/functions/post/__tests__/post.test.ts cloud/lib/__tests__/post-rag.test.ts miniprogram/src/api/cloud.ts scripts/test-mp-post-rag-search-static.mjs
git commit -m "fix: restore proportional cost post RAG search"
```

### Task 5: Delete retired runtime and release pipelines

**Files:**
- Delete the retired cloud and script units listed in the file-structure section
- Create: `scripts/lib/retired-rag-reference.test.mjs`
- Modify: `scripts/deploy.mjs`
- Modify: `scripts/lib/release-plan.mjs`
- Modify: `scripts/lib/release-component-registry.mjs`
- Modify: `scripts/lib/release-dag-v2.mjs`
- Modify: `scripts/lib/release-preflight-checks.mjs`
- Modify corresponding release tests
- Modify: `package.json`

- [ ] **Step 1: Write the failing retirement guard**

The test scans active code, package scripts, release registry, and current operational docs while excluding historical specifications/plans/manifests. It rejects these retired active symbols:

```js
const retired = [
  'post_rag_outbox', 'rag_community_versions', 'post_rag_index_state_v2', 'post_rag_index_versions',
  'post_rag_worker_timer_evidence', 'post_rag_release_probes', 'materializeOutbox', 'indexV2',
  'backfill-post-rag-v2', 'verify-post-rag-timer', 'eval-post-semantic-search',
  'configure-rag-network', 'ensure-tencent-rag-index', 'TENCENT_RAG_ES_ENDPOINT',
  'TENCENT_RAG_ES_USERNAME', 'TENCENT_RAG_ES_PASSWORD',
]
```

It also asserts that `release/changes` may retain historical strings but `filterRagReleaseManifest()` removes them even when `includeRag=true`.

- [ ] **Step 2: Run the guard and verify RED**

```powershell
node --test scripts/lib/retired-rag-reference.test.mjs
```

Expected: failure with the current active files and commands listed.

- [ ] **Step 3: Delete runtime modules and simplify release execution**

Delete the retired modules/tests/scripts. Remove their imports and package scripts.

Keep `--include-rag` only as permission to deploy/attest `post-rag-worker` and `post-video-rag-worker`, run `ensure:indexes`, configure worker timers, and reconcile pay-per-call environment variables. Permanently strip retired RAG actions and smoke suites from all manifests regardless of include mode.

Replace the RAG-specific release DAG with the ordinary release sequence:

```js
await deps.preflight()
const cloud = await deps.deployCloud()
const smoke = await deps.runCloudSmoke({ cloud })
const admin = await deps.publishAdmin({ cloud, smoke })
const miniprogram = await deps.publishMiniprogram({ cloud, smoke, admin })
return { cloud, smoke, admin, miniprogram }
```

Remove timer fixture, timer wait/cleanup, backfill, semantic-gate, ES-index, and RAG collection checks from preflight/deploy. Preserve Git fences, immutable artifact attestation, ordinary cloud smoke, admin publication, mini-program publication, cleanup, and ledger behavior.

- [ ] **Step 4: Run retirement and release tests and verify GREEN**

```powershell
node --test scripts/lib/retired-rag-reference.test.mjs scripts/lib/release-plan.test.mjs scripts/lib/release-component-registry.test.mjs scripts/lib/release-dag-v2.test.mjs scripts/lib/release-preflight-checks.test.mjs scripts/lib/deploy-release-actions.test.mjs
npm.cmd run test:governance
npm.cmd run test:deploy-output
```

Expected: zero failures and no retired active reference.

- [ ] **Step 5: Commit**

```powershell
git add -A cloud scripts package.json
git commit -m "refactor: retire historical post RAG pipelines"
```

### Task 6: Replace operations, smoke scope, indexes, and current documentation

**Files:**
- Modify: `scripts/rebuild-post-rag-index.mjs`
- Modify: `scripts/lib/rebuild-post-rag-index.test.mjs`
- Modify: `scripts/verify-post-rag-smoke.mjs`
- Modify: `scripts/lib/verify-post-rag-smoke.test.mjs`
- Modify: `scripts/configure-rag-workers.mjs`
- Modify: `scripts/lib/configure-rag-workers.test.mjs`
- Modify: `scripts/update-rag-env.mjs`
- Modify: `scripts/lib/update-rag-env.test.mjs`
- Modify: `scripts/ensure-indexes.mjs`
- Modify: `scripts/lib/ensure-indexes.test.mjs`
- Modify: `docs/post-rag-search.md`
- Modify: `docs/release-gate.md`
- Modify: `docs/TESTING.md`
- Modify: `docs/README.md` only if the operational link changes
- Create: `release/changes/20260719-current-state-post-rag.json`

- [ ] **Step 1: Write failing command/policy tests**

Require the rebuild command to default to read-only classification/health, require explicit classification values for mutations, schedule only current states, and never invoke a retired stage. Require smoke fixtures to declare `validation`, H5 fixtures to remain excluded, and environment reconciliation to contain no ES credentials.

- [ ] **Step 2: Run focused script tests and verify RED**

```powershell
node --test scripts/lib/rebuild-post-rag-index.test.mjs scripts/lib/verify-post-rag-smoke.test.mjs scripts/lib/configure-rag-workers.test.mjs scripts/lib/update-rag-env.test.mjs scripts/lib/ensure-indexes.test.mjs
```

Expected: failures because the commands still describe jobs, V2, timer evidence, and ES.

- [ ] **Step 3: Implement the new operational contract**

Supported rebuild modes:

```text
--health
--classify-community <communityId> --policy business|validation|excluded
--reconcile --community-id <communityId>
--reconcile --all-classified
--process
```

Classification mutation, reconcile scheduling, and processing remain separate explicit stages. Default invocation is read-only health. Output contains sanitized counts and identifiers only.

Configure the new current-state timer name, retain worker authentication, and remove ES network/index configuration. Update docs so formal release deployment and post-release RAG activation/validation are unambiguously separate.

The release manifest may declare `ensure-indexes`, `configure-rag-workers`, and `update-rag-env`; it declares no RAG smoke, timer proof, backfill, retrieval, or evaluation suite.

- [ ] **Step 4: Run focused tests and docs check and verify GREEN**

```powershell
node --test scripts/lib/rebuild-post-rag-index.test.mjs scripts/lib/verify-post-rag-smoke.test.mjs scripts/lib/configure-rag-workers.test.mjs scripts/lib/update-rag-env.test.mjs scripts/lib/ensure-indexes.test.mjs
npm.cmd run docs:check
```

Expected: zero failures and no broken documentation links.

- [ ] **Step 5: Commit**

```powershell
git add scripts docs release/changes package.json
git commit -m "docs: define current post RAG operations"
```

### Task 7: First-principles and adversarial review, full verification, and PR

**Files:**
- Modify only files with findings from the two reviews
- Add regression tests before every production-code correction

- [ ] **Step 1: Review from first principles**

Check each invariant against code and tests:

- CloudBase current business data is the only source of truth.
- One post creates at most one sync document.
- Age never controls eligibility.
- Unclassified/test/fixture data fails closed.
- Idle or never-indexed removal performs no paid model call.
- Search cannot return pending, stale, deleted, unauthorized, cross-community, or wrong-scope evidence.
- Release cannot run RAG live validation or migration.

For every finding, add a failing test, run it to verify RED, make the smallest fix, and rerun to GREEN.

- [ ] **Step 2: Review adversarially**

Attempt revision races, lease theft, retry storms, forged scope, fixture policy mismatch, source-version mismatch, missing community/section/post, partial provider write, provider success followed by DB failure, oversized fanout, malformed records, raw-content error leakage, and resurrection of retired release actions through historical full-current manifests.

For every confirmed defect, follow the same red-green correction cycle.

- [ ] **Step 3: Run fresh full verification**

```powershell
npm.cmd --prefix cloud test -- --runInBand
npm.cmd --prefix cloud run build
npm.cmd run test:mp:post-rag-search-static
npm.cmd run test:post-rag-rebuild
npm.cmd run test:governance
npm.cmd run test:deploy-output
npm.cmd run docs:check
npm.cmd run ci:impact -- --base=origin/main
git diff --check
git status --short --branch
```

Read every exit code and failure count. Do not treat a timed-out command as a pass even if partial output is green; rerun the exact incomplete layer with sufficient time.

- [ ] **Step 4: Verify commit identity and create the PR**

```powershell
git log origin/main..HEAD --format='%H %an <%ae> %s'
git push -u origin codex/rag-current-state-indexing
gh pr create --base main --head codex/rag-current-state-indexing --title "Replace historical post RAG pipelines with current-state sync" --body-file .codex-local/pr-body.md
```

The PR body records scope, deletion list, local evidence, deployment targets, post-merge classification/reconcile requirements, no feature-worktree production mutation, and risks.

- [ ] **Step 5: Own the PR to terminal state**

Verify GitHub exact HEAD equals the pushed SHA. Monitor required CI, reviews, comments, conflicts, and Merge Queue for that exact HEAD. Fix deterministic failures only in this worktree with new tests, ordinary commits, and ordinary pushes. When merge-ready, run:

```powershell
gh pr merge <PR_NUMBER> --auto --merge
```

Continue until GitHub reports `MERGED` or `CLOSED`. After `MERGED`, verify this worktree is clean and retire only this exact worktree from `C:\Project\Claude\happyHome_public` with the guarded `worktree:retire` command.
