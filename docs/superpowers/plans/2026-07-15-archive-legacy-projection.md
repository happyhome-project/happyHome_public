# Historical Archive Display Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every migrated legacy archive post render through the current waterfall without losing its original section content or detail behavior.

**Architecture:** A pure projector resolves canonical archive fields from a legacy section schema. A CloudBase repair planner scans deterministic candidates, applies transactional compare-and-set updates, and is exposed both as a guarded operator CLI and an immutable release migration.

**Tech Stack:** Node.js ESM, `node:test`, `@cloudbase/node-sdk`, HappyHome release manifests and migrations.

---

### Task 1: Pure legacy projection

**Files:**
- Create: `scripts/lib/archive-legacy-projection.mjs`
- Create: `scripts/lib/archive-legacy-projection.test.mjs`

- [ ] Write a failing test where `guide_title`, `guide_images`, `guide_body`, and `guide_location` are resolved through section widget `fieldKey` values into canonical content aliases and `format: image_text`.
- [ ] Run `node --test scripts/lib/archive-legacy-projection.test.mjs` and verify the missing module/API failure.
- [ ] Implement `projectLegacyArchivePost(post, section)` so canonical non-empty values take precedence, original fields remain present, image-less posts become `text`, and an unchanged projection returns no mutation.
- [ ] Re-run the test and verify all projector cases pass.

### Task 2: Deterministic repair planner and executor

**Files:**
- Create: `scripts/lib/archive-legacy-projection-node-sdk.mjs`
- Create: `scripts/lib/archive-legacy-projection-node-sdk.test.mjs`

- [ ] Write failing tests for full pagination, deterministic plan digest, transactional compare-and-set, idempotent retry, and concurrent-change rejection.
- [ ] Run `node --test scripts/lib/archive-legacy-projection-node-sdk.test.mjs` and verify the expected missing implementation failure.
- [ ] Implement `planArchiveLegacyProjectionRepair(database)` and `applyArchiveLegacyProjectionRepair(database, plan)` using exact before/after snapshots and per-document transactions.
- [ ] Re-run both projection test files and verify they pass.

### Task 3: Guarded CLI and immutable release migration

**Files:**
- Create: `scripts/repair-archive-legacy-projection.mjs`
- Create: `release/migrations/20260715-archive-posts-v3-display-projection.mjs`
- Create: `release/changes/20260715-archive-legacy-display-projection.json`
- Modify: `scripts/lib/archive-migration.test.mjs`
- Modify: `scripts/lib/release-component-registry.test.mjs`

- [ ] Add failing governance tests requiring a new migration, pinned helper digests, exclusive backup writes, reviewed plan digest/count flags, and residual verification.
- [ ] Run the targeted governance tests and confirm they fail for the absent entrypoints.
- [ ] Implement the dry-run/apply CLI, immutable migration, and change manifest without altering v1 or v2 migration identities.
- [ ] Refresh only the new migration/helper digests and run targeted tests until green.

### Task 4: Verification and production repair

**Files:**
- Runtime evidence only: `.codex-local/archive-repair/<run>/before.json` and `after.json`

- [ ] Run targeted tests, `npm.cmd run test:governance`, and `git diff --check`.
- [ ] Run the production dry-run through the `read` environment profile and record exact counts/digest.
- [ ] Acquire the machine validation lease, re-run the exact plan, and apply with expected digest/counts plus an exclusive backup directory.
- [ ] Verify zero residual changes, compare preserved fields, execute the production indexed topic queries, and invoke the deployed public-community archive APIs.
- [ ] Commit as AngryBird, push the feature branch, open a ready PR, and follow exact-head PR CI plus Merge Queue to `MERGED` or `CLOSED`.

