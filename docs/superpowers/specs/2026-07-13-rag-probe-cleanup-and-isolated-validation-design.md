# RAG Probe Cleanup and Isolated Cloud Validation Design

## Objective

Make the release RAG probe truthful and self-cleaning, then prove the RAG path in Tencent Cloud without replacing production functions or performing a formal release.

Success means one run-bound fixture completes this lifecycle:

`create post -> timer/outbox -> V2 job complete -> ES document searchable -> delete post -> ES document absent -> probe artifacts removed -> cleaned`

The final state must contain no probe-owned pending, retrying, processing, dead-letter, outbox, job, index-state, or index-version residue.

## Confirmed Defect

`cleanupPostRagReleaseProbe` currently deletes the fixture post and section, appends a `post.deleted` outbox event, and immediately writes `status=cleaned`. It does not wait for the ES delete job or remove the create/delete RAG artifacts. Five historical probes therefore report `cleaned` while their jobs remain expired `processing/attempts=5`, starving later work.

## Scope

The fix is restricted to records bound to one `post_rag_release_probes` document and its deterministic `rag_timer_post_*`/`rag_timer_section_*` identities. It must never bulk-delete normal business posts or generic failed RAG jobs.

Included:

- truthful probe cleanup lifecycle;
- removal of probe-owned outbox, V2 jobs, index state, and index versions after ES deletion is proven;
- bounded cleanup polling in the release probe runner;
- safe claim failure diagnostics without raw secrets;
- exact, isolated cloud validation using a temporary function and run-bound IDs.

Excluded:

- formal release, mini-program upload, or replacement of production functions;
- generic queue repair or deletion of business jobs;
- ES architecture, embedding model, search-ranking, or release framework redesign.

## Chosen Approach

Use a two-phase cleanup state machine.

1. The first cleanup call validates the run binding, removes the fixture post and section, appends the higher-version `post.deleted` event, persists `cleanupOutboxId`, and changes the probe to `cleaning`.
2. Later cleanup calls inspect only the bound delete outbox/job and index state. While deletion is incomplete they return a bounded pending result; they do not claim success.
3. After the delete job is complete and the index state proves removal, cleanup removes only the probe-owned create/delete outboxes, their materialized V2 jobs, the fixture index state, and fixture index versions.
4. Only after those removals succeed does the probe become `cleaned`.
5. Repeated cleanup calls remain idempotent.

The release probe runner polls cleanup within a separate bounded deadline and treats timeout or partial cleanup as a cleanup failure.

### Rejected alternatives

- Immediate database deletion is rejected because it can leave a searchable ES document.
- Ignoring `rag_timer_post_*` rows in release health is rejected because it hides residue and allows unbounded accumulation.
- Generic deletion of exhausted jobs is rejected because it could destroy real business failure evidence.

## Claim Diagnostics

Claim catches must retain the existing public `INTERNAL_ERROR/claim` envelope but emit a safe diagnostic containing only an allowlisted SDK error code/name and a deterministic fingerprint. Raw messages, payloads, endpoints, credentials, and stack traces are not returned to callers.

## Isolated Cloud Validation

The test deployment uses a temporary function name and timer trigger. It shares the real Tencent Cloud network, embedding provider, and ES endpoint, but every mutation is fenced by the exact probe run binding. The temporary handler processes only the supplied probe outbox/job IDs and must not scan the global queue.

Validation steps:

1. Record baseline counts for all probe-owned collections and verify the temporary function name is unused.
2. Deploy the temporary function with copied RAG network/environment configuration and independent temporary credentials.
3. Create a uniquely named release probe fixture.
4. Let the temporary timer process only that fixture's create outbox and V2 job.
5. Verify job completion, ES document identity/vector mapping, and semantic retrieval returning the exact post with citation fields.
6. Start cleanup, process only the cleanup outbox/job, and verify the ES document is absent.
7. Poll cleanup to `cleaned`; assert all probe-owned artifacts are absent and global non-probe records were unchanged.
8. Repeat the lifecycle enough times to catch ordering/idempotency errors and record latency.
9. Delete the temporary trigger/function and temporary secrets; verify cleanup from the control plane.

No production function is overwritten and no formal release command is run.

## Test Strategy

TDD regression coverage must first fail against current behavior:

- first cleanup returns `cleaning`, not `cleaned`;
- cleanup cannot finalize before the bound ES delete job/state proves removal;
- finalization removes both create and delete outboxes/jobs plus state/version residue;
- cleanup is idempotent after partial and complete execution;
- cross-run or non-probe identities fail closed;
- cleanup polling times out as a cleanup failure;
- claim diagnostics expose only safe metadata;
- exact-ID temporary handler cannot process unrelated queue candidates.

After targeted tests pass, run affected cloud unit/integration suites, all cloud function builds, and the isolated cloud lifecycle. Formal release remains a separate main-session action after merge.

## Acceptance Boundary

This work may claim `RAG cloud validation passed` only when the isolated real-cloud create/search/delete lifecycle and cleanup assertions pass. It may claim `release-ready` only after PR CI and Merge Queue merge. It may not claim `released` or `production verified`; those require the formal release session on the merged main SHA.
