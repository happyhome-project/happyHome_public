# Archive Topic Consistency Implementation Plan

**Goal:** Make archive topic tabs and admin counts agree with the current visible archive posts, including renamed topics.

**Architecture:** Keep `posts` authoritative. Resolve displayed topic names to stable configured identities, reconcile `archive_post_topics` idempotently, derive admin counts from active/pass links, and ship a release migration that repairs duplicate identities and rebuilds the projection.

## Tasks

1. Add failing unit/integration tests for renamed-topic resolution, stale-link removal, missing-link recovery, and exact admin counts.
2. Implement canonical topic resolution and idempotent per-post projection reconciliation.
3. Replace partial link updates in create, edit, audit, and delete flows with reconciliation.
4. Calculate admin counts from current active/pass links.
5. Add a pure migration planner, tests, a release migration, and a release change manifest.
6. Run focused cloud tests, type checks, documentation checks, and the repository impact suite.
7. Commit with the required Git identity, open the PR, address review/CI, and place it in Merge Queue.

