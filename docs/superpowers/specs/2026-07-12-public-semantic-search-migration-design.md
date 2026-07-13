# Public Semantic Post Search Migration Design

> **Historical / point-in-time:** This specification records the semantic-search migration design accepted on 2026-07-12. It does not override later implementation or operational policy.
> **Current authority:** Use the [formal release gate](../../release-gate.md), current repository rules, code, and tests.

## Objective

Migrate the already validated semantic post-search outcome from the private HappyHome feature branch onto the current public repository baseline. The public mini-program must return accurate posts and matched snippets for semantic Chinese queries without generating an AI summary, silently falling back to lexical search, or weakening live authorization checks.

Success means the implementation enters `happyhome-project/happyHome_public` through a public PR, passes the public repository's exact PR CI and review gates, and leaves production deployment to the guarded public canonical `main` workflow.

## Scope Boundary

The migration includes:

- Tencent ES Serverless BM25 plus dense-vector retrieval combined by RRF.
- Precomputed, versioned post chunks and query embeddings.
- The schema-v2 outbox, job processor, immutable index activation, deletion, and stale-job fencing.
- Atomic coupling between business mutations, community versions, and v2 outbox events.
- Live community, section, widget, post-state, and membership authorization rechecks.
- The mini-program search experience that displays posts and matched snippets only.
- Controlled existing-post backfill, authenticated timer processing, live smoke fixtures, and the 30-case semantic release evaluation.

The migration explicitly excludes:

- Generated answers, LLM summaries, SSE, reranking, video analysis, OCR, or ASR.
- A new search architecture or a broad rewrite of legacy RAG.
- Dependency upgrades or remediation of the existing npm audit inventory.
- Cleanup of old private branches, PRs, worktrees, or historical documents.
- Replacement of public worktree, Ruleset, Merge Queue, CI, release-control, validation-lease, or production-guard behavior.

## Source-of-Truth Strategy

The public `main` branch is authoritative for every shared file and operational rule. The private feature branch is a behavioral reference and a source for isolated v2 modules and tests, not a branch to merge or a tree to copy wholesale.

Migration uses three rules:

1. New, isolated v2 modules and their tests may be ported after their imports and assumptions are verified against public `main`.
2. Existing public files are edited from the public version and receive only the minimum semantic-search hunks.
3. Generated `cloud/dist`, old governance files, old workflow files, old release manifests, and old design documents are never copied.

## Architecture

### Retrieval contract

`post.search` validates a normalized Unicode query, confirms community readability and server-side membership, embeds the query, and executes one ES request containing BM25 and dense candidates combined by RRF. ES results are candidate identifiers only. Before returning a result, CloudBase remains the final source of truth for post, section, widget, state-version, community, and membership visibility.

The response contains post items with title, matched snippet, matched field, section metadata, and pagination information. Compatibility fields `answer` and `citations` may remain empty during the transition, but no production path generates an answer or reports a lexical fallback as semantic success.

### Indexing and consistency

Business writes increment the relevant community content or ACL version and append a v2 outbox event in the same CloudBase transaction. The worker runs three explicit stages: materialize outbox events, process schema-v2 jobs, then preserve the existing legacy worker stage while migration compatibility is required.

Post events become one v2 job. Section and community projection changes fan out with stable `_id` keyset pagination. ACL invalidation updates version state without re-embedding unchanged content. Index activation is immutable and source-version fenced; removal deletes explicit ES document IDs and records a removed state.

Legacy processors must ignore schema-v2 jobs so the two pipelines cannot steal each other's work.

### Timer and backfill

The one-minute timer carries the worker token in SCF `CustomArgument`. Configuration bypasses the installed manager helper that drops this field, uses the signed SCF request service, and reads the trigger back to verify cron and the redacted token hash.

The formal release creates a unique probe post and outbox event. It accepts only fresh authenticated timer evidence that observes that exact outbox and, in the same or a later timer run, completes the corresponding v2 job and matching active state. Existing posts are then backfilled through the v2 outbox pipeline. Release continues only when every eligible active post has the exact current source version and pending/failed counts are zero.

### Mini-program experience

The search page presents a truthful semantic-search introduction, query input, loading/error/empty states, and a paged list of posts. Each result shows the post title, section, matched snippet, and matched field when safe. It removes AI-answer language, citations UI, fake history, recommendations, and fallback-mode messaging. Requests use stale-response protection and navigate through the existing post-detail authorization path.

## Public Repository Integration

The following are added as focused units:

- `cloud/shared/post-rag-search-contract.ts`
- `cloud/lib/post-rag-indexing.ts`
- `cloud/lib/post-rag-job-processor.ts`
- `cloud/lib/post-rag-jobs.ts`
- `cloud/lib/post-rag-outbox.ts`
- `cloud/lib/post-rag-outbox-materializer.ts`
- `cloud/lib/post-rag-outbox-worker.ts`
- `cloud/lib/post-rag-v2-runtime.ts`
- `cloud/lib/post-rag-versioned-index-sink.ts`
- `cloud/lib/post-semantic-search.ts`
- Focused semantic evaluation, backfill, timer, schema, and smoke helpers under `scripts/lib/`.

The following public files are merged manually and minimally:

- `cloud/functions/post/index.ts`
- `cloud/functions/admin/index.ts`
- `cloud/functions/post-rag-worker/index.ts`
- `cloud/lib/post-rag.ts`
- `cloud/lib/post-search.ts`
- `cloud/lib/content-audit.ts`
- `cloud/lib/membership-transitions.ts`
- `cloud/lib/rag-worker-auth.ts`
- `cloud/lib/db.ts` and `cloud/lib/db.local.ts`
- `miniprogram/src/api/cloud.ts`
- `miniprogram/src/pages/search/index.vue`
- Existing public release, rebuild, environment, index, smoke, ledger, and package scripts.

Public worktree lifecycle, environment profiles, direct-deploy policy, production guard, release control plane, validation lease, trusted workflow, and GitHub workflow files remain authoritative and must not be replaced by private versions.

## Migration Sequence

1. Add the response/search contract and pure tests.
2. Add database adapter contracts and isolated v2 indexing modules with unit and local integration tests.
3. Add the worker stages and prove legacy/schema-v2 job isolation.
4. Connect post, audit, admin, section, community, and membership mutations transactionally, one business boundary at a time.
5. Switch `post.search` to semantic retrieval and remove runtime fallback/generation behavior.
6. Migrate the mini-program API types and search page.
7. Integrate ES schema, environment, timer, backfill, smoke, live evaluation, and release-ledger gates into the public release system.
8. Run the public full verification matrix, perform independent specification and quality reviews, synchronize current public `main`, and create a public PR.

Each step follows red-green-refactor. A batch cannot advance while a Critical or Important review finding remains.

## Failure and Privacy Boundaries

- ES or embedding unavailability returns a safe unavailable/error state; it never falls back to a different result set while claiming semantic retrieval.
- Candidate caches never cache final authorization. Every returned item is rechecked against live CloudBase state.
- Member-only title or field content never appears in public chunk metadata or guest results.
- Cross-community, deleted, disabled, stale-version, pending, and unauthorized results are hard failures in release evidence.
- Timer configuration without verified `CustomArgument`, incomplete backfill, pending/failed jobs, missing fixture cleanup, or metric failure blocks release.
- Logs and evidence store identifiers, counts, hashes, versions, and timings only; they do not print raw fixture or user post content.

## Verification and Acceptance

The migration must preserve the previously approved acceptance thresholds:

- Exactly 30 committed, diverse Chinese semantic cases.
- Recall@5 at least 0.90.
- Top-3 precision at least 0.80.
- Nearest-rank latency P95 at most 2000 ms across at least 100 multi-query samples.
- Error rate at most 1 percent.
- Zero member-only, deleted, unknown-run, or cross-community leakage.
- Version-changing update becomes searchable and hard deletion becomes absent within 60 seconds.
- A real authenticated timer, not a manual worker call, processes the unique release probe.
- Every temporary fixture is cleaned even when validation fails.

Local verification covers cloud unit/integration/build, mini-program unit/type/build, all affected release-script tests, governance, deploy-output, rebuild, documentation checks, and the exact public PR CI command. Production ES, CloudBase mutation, and mini-program upload remain prohibited from the feature worktree.

## Delivery State Model

The task reports only evidence-backed states in order: migrated, locally tested, committed, pushed, public PR CI passed, merge-queue passed, merged, deployed, and production verified. Creating a public PR is not deployment, and the old private PR is not an acceptable release input.
