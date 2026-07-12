# Public Semantic Post Search Migration Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-07-12 migration sequence. Retain it for traceability; do not treat its task state as current repository status.
> **Current authority:** Use the [formal release gate](../../release-gate.md), current `AGENTS.md`, release code, and tests.

## Original historical instructions (do not execute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the validated non-generative semantic post search onto the current public HappyHome baseline without replacing public governance, release, CI, or worktree behavior.

**Architecture:** Add the isolated schema-v2 contract, indexing, outbox, worker, and semantic retrieval modules first. Then connect public business mutations through exact transactional edits, switch the API and mini-program UI, and finally integrate the public release pipeline with index, timer, backfill, smoke, and live-evaluation gates. Public files remain the source of truth and receive only reviewed semantic-search hunks.

**Tech Stack:** TypeScript, Jest, CloudBase database transactions, Tencent ES Serverless, Tencent Atomic Embedding, Node.js 24, node:test, Vue 3/uni-app, Vitest, GitHub PR CI and Merge Queue.

---

## File Structure

New backend units:

- `cloud/shared/post-rag-search-contract.ts`: strict semantic-search request, ES response, worker and public response contracts.
- `cloud/lib/post-rag-indexing.ts`: deterministic source projections, chunking, source versions, checksums and visibility metadata.
- `cloud/lib/post-rag-outbox.ts`: transactional community-version and outbox append operations.
- `cloud/lib/post-rag-outbox-materializer.ts`: post and keyset-paginated aggregate event materialization.
- `cloud/lib/post-rag-outbox-worker.ts`: claim/retry/complete orchestration for outbox records.
- `cloud/lib/post-rag-jobs.ts`: schema-v2 job persistence, claiming and state transitions.
- `cloud/lib/post-rag-job-processor.ts`: projection, embedding and versioned sink processing.
- `cloud/lib/post-rag-versioned-index-sink.ts`: immutable ES writes, fenced activation and explicit deletion.
- `cloud/lib/post-rag-v2-runtime.ts`: strict production ES, embedding and database runtime construction.
- `cloud/lib/post-semantic-search.ts`: BM25+dense+RRF retrieval, bounded candidate caches and live authorization checks.

New release units:

- `scripts/lib/tencent-rag-index-schema.mjs`: complete versioned ES mapping and compatibility validation.
- `scripts/lib/post-semantic-function-env.mjs`: fail-closed function environment construction.
- `scripts/lib/scf-owned-timer.mjs`: signed SCF trigger creation and readback verification.
- `scripts/lib/post-rag-timer-evidence.mjs`: run-bound timer probe evidence rules.
- `scripts/lib/post-rag-v2-backfill.mjs`: complete eligible-post coverage calculation.
- `scripts/lib/post-semantic-search-eval.mjs`: exact relevance, latency and privacy metric computation.
- `scripts/lib/live-semantic-evaluator.mjs`: run-bound fixture ownership, real search collection and cleanup.
- `scripts/lib/post-semantic-smoke-orchestrator.mjs`: create/update/delete/member/guest smoke behavior.
- `scripts/lib/required-smoke-executor.mjs`: release gate sequencing and structured evidence.
- `scripts/lib/release-post-rag-backfill-executor.mjs`: formal backfill execution and ledger evidence.
- `scripts/backfill-post-rag-v2.mjs`, `scripts/verify-post-rag-timer.mjs`, `scripts/eval-post-semantic-search.mjs`: release commands.
- `scripts/fixtures/post-semantic-search-eval.json`: exactly 30 labeled Chinese semantic cases.

Existing public files are edited in place and never replaced wholesale: cloud entrypoints, database adapters, audit/membership helpers, mini-program API/search page, release scripts, package scripts and their tests.

## Task 1: Establish the Semantic Search Contract

**Files:**
- Create: `cloud/shared/post-rag-search-contract.ts`
- Create: `cloud/shared/__tests__/post-rag-search-contract.test.ts`

- [ ] **Step 1: Port the contract test before production code**

Copy the behavioral assertions from the private reference test, then update imports to the public tree. The test must assert Unicode query normalization, 1..80 character validation, limit bounds, protocol-v2 item parsing, repeated `body.2` fields, strict ES envelopes, safe public response mapping and rejection of malformed IDs or pagination.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runTestsByPath shared/__tests__/post-rag-search-contract.test.ts --runInBand`

Expected: FAIL because `post-rag-search-contract.ts` does not exist.

- [ ] **Step 3: Add the minimal strict contract implementation**

Port only the contract module. Keep response compatibility fields as `answer: ''` and `citations: []`; define `mode` as `rag | no_answer` for the migrated API and do not add fallback or generated-answer behavior.

- [ ] **Step 4: Run the contract test and cloud type/build checks**

Run the focused test again, followed by `npm.cmd --workspace cloud run build`.

Expected: focused suite PASS and cloud build exit 0.

- [ ] **Step 5: Commit**

Commit: `feat: add public semantic search contract`

## Task 2: Add Database Contracts and Isolated V2 Indexing Units

**Files:**
- Modify: `cloud/lib/db.ts`
- Modify: `cloud/lib/db.local.ts`
- Modify: `cloud/lib/__tests__/db.test.ts`
- Modify: `cloud/lib/__tests__/db.contract.test.ts`
- Create: `cloud/lib/post-rag-indexing.ts`
- Create: `cloud/lib/post-rag-outbox.ts`
- Create: `cloud/lib/post-rag-jobs.ts`
- Create: `cloud/lib/post-rag-versioned-index-sink.ts`
- Create corresponding tests under `cloud/lib/__tests__/`

- [ ] **Step 1: Add failing database contract tests**

Specify `getByIds`, stable `queryAfterId`, and transactional `setById` behavior for both CloudBase and local adapters. Assert keyset ordering, bounded page size, empty ID handling and identical production/local interfaces.

- [ ] **Step 2: Run database tests and verify RED**

Run: `npm.cmd --workspace cloud run test:unit -- --runTestsByPath lib/__tests__/db.test.ts lib/__tests__/db.contract.test.ts --runInBand`

Expected: FAIL on missing adapter methods.

- [ ] **Step 3: Implement the minimal adapter methods**

Edit the public adapter implementations in place. Do not replace public retry, transaction or error-normalization behavior.

- [ ] **Step 4: Add failing pure indexing/outbox/job/sink tests**

Port tests for deterministic chunks and checksums, monotonic community versions, idempotent event IDs, schema-v2 job isolation, stale claim fencing, immutable bulk writes, compare-and-set activation, delete envelope validation and explicit-ID cleanup.

- [ ] **Step 5: Run the new tests and verify RED**

Expected: FAIL because the four v2 modules do not exist.

- [ ] **Step 6: Port the four isolated modules and verify GREEN**

Run all Task 2 focused tests. Expected: PASS with no changes to legacy entrypoints.

- [ ] **Step 7: Commit**

Commit: `feat: add public v2 semantic indexing core`

## Task 3: Add Materialization, Processing and Production Runtime

**Files:**
- Create: `cloud/lib/post-rag-outbox-materializer.ts`
- Create: `cloud/lib/post-rag-outbox-worker.ts`
- Create: `cloud/lib/post-rag-job-processor.ts`
- Create: `cloud/lib/post-rag-v2-runtime.ts`
- Create corresponding unit and integration tests.
- Modify: `cloud/lib/post-rag.ts`
- Modify: `cloud/lib/__tests__/post-rag.test.ts`

- [ ] **Step 1: Add failing orchestration and integration tests**

Cover post materialization, section/community `_id` keyset fanout across multiple pages with intervening delete/insert, ACL invalidation producing zero embedding jobs, claim retries, projection and embedding, active/removed state, and a real local ES-compatible HTTP create/update/delete flow.

- [ ] **Step 2: Add a failing legacy isolation test**

Assert the public legacy processor never claims `schemaVersion: 2` jobs even across pagination.

- [ ] **Step 3: Run focused tests and verify RED**

Expected: missing modules and legacy schema-v2 isolation failure.

- [ ] **Step 4: Port the isolated runtime modules**

Require HTTPS ES endpoints, exact `embedding` vector field, bounded timeout/response sizes, sanitized errors, Basic auth and Tencent Atomic embedding configuration. Do not port LLM, rerank or video behavior into v2.

- [ ] **Step 5: Add the minimal schema-v2 filter/export hunks to public `post-rag.ts`**

Preserve all public legacy behavior except the ability to steal v2 jobs.

- [ ] **Step 6: Run focused tests, cloud unit tests and build**

Expected: focused suites PASS; public cloud unit suite and build remain green.

- [ ] **Step 7: Commit**

Commit: `feat: add public v2 semantic worker runtime`

## Task 4: Connect the Public Worker and Secure Timer Evidence

**Files:**
- Modify: `cloud/functions/post-rag-worker/index.ts`
- Modify: `cloud/functions/post-rag-worker/__tests__/index.test.ts`
- Modify: `cloud/lib/rag-worker-auth.ts`
- Modify: `cloud/lib/__tests__/rag-worker-auth.test.ts`
- Create timer-evidence database tests.

- [ ] **Step 1: Add failing worker-stage tests**

Assert default execution order `outbox -> v2 -> legacy`, explicit `indexV2`, auth-before-dependency construction, Timer `Message` token parsing, rejection of a forged tokenless Timer shape, and timer evidence written only for authenticated Timer invocations.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: current public worker exposes only the legacy stage.

- [ ] **Step 3: Merge the minimal worker and auth hunks**

Keep public probe wrappers, build metadata and error policies. Timer evidence records only IDs, counts, hashes, versions and timestamps.

- [ ] **Step 4: Run worker/auth tests and integration tests**

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `feat: connect public semantic worker stages`

## Task 5: Atomically Connect Business Mutations

**Files:**
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`
- Modify: `cloud/functions/admin/index.ts`
- Modify admin tests under `cloud/functions/admin/__tests__/`
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/lib/membership-transitions.ts`
- Create: `cloud/lib/__tests__/post-rag-business-flow.integration.test.ts`
- Create: `cloud/lib/__tests__/membership-rag-acl.integration.test.ts`

- [ ] **Step 1: Add failing transactional rollback tests**

For post create/delete, admin create/update/delete, audit pass/reject, section metadata/status/widgets, community metadata/status and membership approve/kick/leave, assert business data and version/outbox commit together. Force outbox append failure and assert the business mutation rolls back.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: public mutations update business data but do not create v2 outbox/version state atomically.

- [ ] **Step 3: Add one transactional helper and migrate direct post boundaries**

Use the public database transaction interface. Preserve legacy enqueue after successful commit for compatibility; never treat a transaction-external v2 enqueue as success.

- [ ] **Step 4: Migrate audit/admin boundaries and rerun focused tests**

Preserve public admin authorization, audit and video behavior. Hard community deletion must remove each post and append `post.deleted` in the same transaction or through the tested recoverable batch path.

- [ ] **Step 5: Migrate section/community/ACL boundaries**

Section/community projection changes emit fanout events. Membership-only ACL changes increment/invalidate versions and complete with zero embedding jobs.

- [ ] **Step 6: Add and run the full business integration flow**

Prove `mutation -> outbox -> materialize -> v2 job -> sink active state -> semantic candidate` and deletion to removed state.

- [ ] **Step 7: Run all affected public cloud tests and commit**

Commit: `feat: connect public mutations to semantic indexing`

## Task 6: Add Semantic Retrieval and Cut Over `post.search`

**Files:**
- Create: `cloud/lib/post-semantic-search.ts`
- Create unit/integration tests.
- Modify: `cloud/lib/post-search.ts`
- Modify: `cloud/lib/__tests__/post-search.test.ts`
- Modify: `cloud/functions/post/index.ts`
- Modify: `cloud/functions/post/__tests__/post.test.ts`

- [ ] **Step 1: Add failing retrieval tests**

Cover BM25+dense RRF request shape with Tencent `rank_window_size`, query `勤俭持家` returning a post containing `一粥一饭`, timeout handling, repeated fields, pagination, bounded candidate caches, stale/deleted/pending/cross-community filtering, public/member visibility and no fallback.

- [ ] **Step 2: Add the member-title privacy regression test**

Create a projection with member-only title and public body; assert the guest cannot search or receive member-only title text.

- [ ] **Step 3: Run tests and verify RED**

Expected: public search still uses generated legacy RAG/fallback.

- [ ] **Step 4: Port semantic retrieval and public-title selection**

Use CloudBase as final authorization truth. Cache candidates only, never final authorization.

- [ ] **Step 5: Cut `post.search` to a lazy semantic singleton**

Authorize community and membership before constructing providers. Return safe errors and compatibility empty answer/citations without invoking legacy generation or lexical fallback.

- [ ] **Step 6: Run focused, cloud unit, integration and build checks**

Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat: launch public semantic post retrieval`

## Task 7: Migrate the Mini-program Search Experience

**Files:**
- Modify: `miniprogram/src/api/cloud.ts`
- Modify: `miniprogram/src/pages/search/index.vue`
- Create: `miniprogram/src/utils/__tests__/search-semantic-static.test.ts`
- Modify: `scripts/test-mp-post-rag-search-static.mjs`

- [ ] **Step 1: Update static and component tests first**

Assert that semantic item types expose `matchedSnippet` and `matchedField`; AI answer, citation, fallback, fake history and recommendation UI are absent; loading/error/empty/clear/pagination/navigation and stale-request protection remain present.

- [ ] **Step 2: Run mini-program tests and verify RED**

Run: `npm.cmd run test:mp:post-rag-search-static` and `npm.cmd --workspace miniprogram run test:unit`.

Expected: legacy AI UI assertions or new semantic assertions fail.

- [ ] **Step 3: Merge API types and the focused search-page behavior**

Do not replace unrelated public API or UI changes. Keep detail navigation through the existing authorization path.

- [ ] **Step 4: Run unit, static, type and WeChat build checks**

Run mini-program unit, `type-check`, static search test and `build:mp-weixin`.

Expected: all PASS.

- [ ] **Step 5: Commit**

Commit: `feat: show semantic post results in public mini-program`

## Task 8: Integrate Public ES, Backfill, Timer and Evaluation Gates

**Files:**
- Create the new release units listed in File Structure with tests.
- Modify public `scripts/configure-rag-workers.mjs`, `scripts/ensure-tencent-rag-index.mjs`, `scripts/update-rag-env.mjs`, `scripts/rebuild-post-rag-index.mjs`, `scripts/rebuild-post-search-index.mjs`, `scripts/verify-post-rag-smoke.mjs`, `scripts/ensure-indexes.mjs`, `scripts/deploy.mjs` and focused tests.
- Modify public release-plan/run-ledger/identity helpers minimally.
- Modify: `package.json`
- Create: `release/changes/20260712-public-semantic-search.json`

- [ ] **Step 1: Add failing schema/env/timer tests**

Require the complete v2 mapping, probed embedding dimensions, strict `embedding` field, only `post` and `post-rag-worker` semantic env targets, missing-config failure, signed SCF Create/Delete/List calls, CustomArgument readback and one convergent owned one-minute trigger.

- [ ] **Step 2: Add failing complete-backfill tests**

Test more than 100 communities and sections, stable pagination, eligible source-version coverage, pending/failed job rejection and structured ledger evidence.

- [ ] **Step 3: Add failing timer-probe tests**

Require a unique run-bound post/outbox/job/state. Lock outbox and v2-job evidence across the same or later authenticated timer runs; reject empty, manual, old, reordered or unrelated evidence; always clean up.

- [ ] **Step 4: Add failing live evaluation tests**

Require exactly 30 cases, fixture-owned result IDs, public/member/deleted/cross-community hard gates, 30 cold plus 70 warm multi-query samples, Recall@5, Top-3 precision, nearest-rank P95 and error-rate computation.

- [ ] **Step 5: Port isolated helpers and merge public scripts minimally**

Keep public direct-deploy policy, production guard, release control plane, validation lease, full-current behavior and ledger semantics. Add new stages; do not replace public scripts.

- [ ] **Step 6: Add the public change manifest and package commands**

Use a new public change ID. Declare exact cloud targets, index/env/timer/backfill actions, required semantic gates, no video RAG and no implicit production mutation from a feature worktree.

- [ ] **Step 7: Run all release, rebuild, governance and docs tests**

Expected: PASS without connecting to real cloud or ES.

- [ ] **Step 8: Commit**

Commit: `test: gate public semantic search release`

## Task 9: Full Verification, Review and Public PR

**Files:**
- All files changed by Tasks 1-8.
- PR body only after push.

- [ ] **Step 1: Run fresh full verification**

Run cloud unit/integration/build; mini-program unit/type/WeChat build; `node --test scripts/lib/*.test.mjs`; governance, deploy-output, post-RAG rebuild, post-search rebuild, static semantic UI and docs checks; then run the exact commands in public `.github/workflows/pr-ci.yml`.

Expected: every command exit 0. Existing explicit todo items may remain; no failed suite is acceptable.

- [ ] **Step 2: Perform independent specification and quality reviews**

Review `origin/main..HEAD` for scope, privacy, transactionality, public-governance preservation and release executability. Fix every Critical or Important finding using a failing regression test.

- [ ] **Step 3: Synchronize current public main**

Fetch `origin/main`. If behind, use the public `worktree:sync-main --prepare` and exact apply flow or the repository-authorized merge flow. Resolve semantically, never stash/rebase/force-push, then rerun affected and full tests.

- [ ] **Step 4: Verify delivery identity**

Report exact cwd, branch, HEAD, upstream, clean status and AngryBird author identity. Confirm the branch has unique commits and no workflow/governance replacement.

- [ ] **Step 5: Push and create a ready public PR**

The PR body records behavior, tests, cloud/index/env/timer/backfill actions, live release acceptance, known boundaries and that production was not mutated.

- [ ] **Step 6: Monitor to terminal state**

Poll exact-head PR CI, review and comments. Address feedback in the original public worktree with ordinary pushes. The feature agent does not enqueue; the public coordinator handles Merge Queue. Continue until GitHub reports `MERGED` or `CLOSED`.
