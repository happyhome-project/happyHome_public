# Archive Pinned All-Tab Ordering Implementation Plan

> **Historical / point-in-time:** This file preserves the implementation plan used for the 2026-08-25 archive pinned-order fix; do not execute it as current instructions.
> **Current authority:** Use the [documentation authority index](../../README.md), current code, tests, and repository PR rules.

## Original historical instructions (do not execute)

> **For Codex:** Execute this plan with test-driven development and verify every claimed state before handoff.

**Goal:** Make an archive post pinned in Admin Web appear first in the mini-program's “全部” tab, including posts that were pinned before this fix was released.

**Architecture:** The archive feed is cursor-paginated by the indexed `posts.sortKey`; therefore pin priority must be encoded in that persisted ordering projection. Keep existing creation-time keys for normal posts, give pinned archive posts a lexicographically higher key based on `pinnedAt`, restore the normal key on unpin, and run an idempotent release migration for existing pinned archive rows. Topic-link keys remain unchanged, so topic tabs retain their existing order.

**Tech Stack:** TypeScript cloud functions, CloudBase document database, Jest, Node.js migration tests, release change manifests.

---

### Task 1: Lock the ordering contract with failing tests

**Files:**
- Modify: `cloud/functions/admin/__tests__/admin.test.ts`
- Create: `scripts/lib/archive-pinned-sort-migration.test.mjs`

1. Add an Admin API test proving pinning an archive post writes a pin-priority `sortKey`.
2. Add an Admin API test proving unpinning restores the post's creation-time `sortKey`.
3. Prove non-archive post pinning does not change its feed projection.
4. Add migration planner cases for stale, already-correct, unpinned, deleted, and non-archive records.
5. Run the focused tests and capture the expected failures before implementation.

### Task 2: Implement the minimal indexed-order fix

**Files:**
- Modify: `cloud/lib/archive-topic-index.ts`
- Modify: `cloud/functions/admin/index.ts`
- Create: `scripts/lib/archive-pinned-sort-migration.mjs`

1. Add a deterministic pinned archive sort-key builder.
2. Add archive-only sort-key updates to `post.pinAdmin` and `post.unpinAdmin`.
3. Implement an idempotent migration planner that updates only stale active pinned archive posts.
4. Run the focused tests until green, then refactor without changing behavior.

### Task 3: Ship the existing-data repair through the release system

**Files:**
- Create: `release/migrations/20260825-archive-pinned-sort-v1.mjs`
- Create: `release/changes/20260825-archive-pinned-all-order.json`

1. Read all posts with deterministic `_id` pagination.
2. Apply only the planner's projected `sortKey` updates.
3. Re-read and require an empty residual plan so reruns are safe.
4. Bind migration dependencies and module bytes to immutable SHA-256 digests.

### Task 4: Verify and deliver

1. Run focused Admin and migration tests.
2. Run cloud unit/type/build checks and release governance/plan validation selected by impact analysis.
3. Perform a read-only dry-run of the planner against current production data and verify the known pinned post is selected without writing.
4. Self-review the exact diff for cursor correctness, migration idempotence, and topic-tab non-impact.
5. Commit as `AngryBird`, push `codex/fix-pinned-all-tab-order`, open a PR, follow exact-HEAD CI/review through Merge Queue to terminal state, then retire the feature worktree after merge.
