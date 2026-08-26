# Collaboration Publish Timeout Fix Implementation Plan

> **Historical / point-in-time:** This delivery plan records the approved 2026-08-26 implementation sequence. Retain it for traceability; do not treat its task text as current repository status.
> **Current authority:** Use the [documentation authority map](../../README.md), current checked-in code, tests, and release gates.

## Original historical instructions (do not execute)

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan.

**Goal:** Stop successful collaboration posts from being reported as failed when synchronous derived-search indexing exhausts the 15-second `post` cloud-function budget.

**Architecture:** Keep the post row, audit transition, and `post_rag_sync_state` scheduling as the publish-path source of truth. Remove legacy lexical search-index refresh from the synchronous audit transition and execute it inside the existing leased, retryable `post-rag-worker` before the worker marks the desired revision complete. The worker runs every minute with a 120-second timeout, so derived data becomes eventually consistent without making serverless fire-and-forget work unreliable.

**Tech Stack:** TypeScript, Jest, CloudBase transactions and timer-triggered cloud functions.

**Spec:** The user's 2026-08-26 collaboration publish failure and the production evidence recorded in this task: the request timed out at 15 seconds after the post was already persisted and approved, while legacy indexing created 1 document, 7 chunks, 168 term rows, 112 vector-term rows, and 1 state row.

## Global Constraints

- Do not increase the `post` function timeout or suppress the client error.
- Do not use detached/fire-and-forget promises in a serverless invocation.
- A committed audit transition must schedule durable current-state sync in the same transaction.
- The worker must refresh or remove the lexical index for every claimed post, including communities excluded from semantic RAG.
- The worker may call `completePostRagSync` only after lexical indexing succeeds; lexical failures must enter the existing retry path with a bounded error code.
- Preserve current semantic RAG eligibility, deletion, and provider behavior.
- Add regression tests before production changes and keep user/private production content out of code, tests, commits, and PR text.

### Task 1: Move lexical indexing behind the durable worker boundary

**Files:**
- Modify: `cloud/lib/__tests__/content-audit.test.ts`
- Modify: `cloud/lib/__tests__/post-rag-sync-worker.test.ts`
- Modify: `cloud/lib/content-audit.ts`
- Modify: `cloud/lib/post-rag-sync-worker.ts`

**Step 1: Write failing publish-path tests**

Update the audit tests so a successful audit transition is expected to schedule `post.audit_changed` sync without directly calling `refreshPostSearchIndexById`. Add a regression where the legacy refresh mock rejects and prove the audit transition still succeeds because it is no longer on the request path.

**Step 2: Write failing worker tests**

Mock `refreshPostSearchIndexById`. Prove the worker calls it for both an approved semantic-RAG post and an excluded/unclassified post. Prove a lexical refresh failure prevents completion and calls `failPostRagSync` with a bounded retryable error code.

**Step 3: Verify RED**

Run:

`npm.cmd --prefix cloud run test:unit -- --runInBand lib/__tests__/content-audit.test.ts lib/__tests__/post-rag-sync-worker.test.ts`

Expected: the new boundary tests fail against the current synchronous implementation.

**Step 4: Implement the smallest boundary change**

Remove the `post-search` import and awaited refresh from `applyAuditSummary`. Import `refreshPostSearchIndexById` in `post-rag-sync-worker.ts`; call it once for every claim after current source resolution and before each successful `completePostRagSync` path. Keep it inside the existing `try/catch` so failure enters `failPostRagSync` and is retried.

**Step 5: Verify GREEN and regressions**

Run the focused unit tests above, then relevant post/search tests and the full repository validation required by `AGENTS.md`/`docs/TESTING.md`. Build cloud functions and inspect the branch diff for accidental scope expansion.

**Step 6: Review and integrate**

Request an independent code review, fix any load-bearing findings, commit as `AngryBird <48046333+angrybirddd@users.noreply.github.com>`, push the feature branch, open a PR against `main`, and follow the exact PR head through required checks and Merge Queue to a terminal state. Do not deploy production from the feature worktree.
