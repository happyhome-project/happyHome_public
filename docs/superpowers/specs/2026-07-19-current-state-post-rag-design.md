# Current-State Formal Post RAG Design

> **Approved design record:** This specification records the replacement of the historical event-replay RAG pipelines approved on 2026-07-19. While implementation is in progress, executable code and tests remain authoritative for actual behavior.
> **Current authority:** Use [`docs/post-rag-search.md`](../../post-rag-search.md) for formal post RAG operations and [`docs/release-gate.md`](../../release-gate.md) for release behavior after delivery.

## Objective

Make formal post RAG usable on the proportional-cost CloudBase plus Tencent atomic-model foundation while preventing historical business events, obsolete post versions, deleted sources, and persistent test fixtures from creating paid indexing work.

The system must index every currently valid real-business post regardless of its creation date. Age is never an eligibility rule. The source of truth is the current CloudBase business state, not a replay of historical mutations.

## Non-goals

- Do not restore Tencent ES or any always-on hourly retrieval cluster.
- Do not replace RAG with keyword-only search or one-off model analysis.
- Do not remove evidence-bearing answers, citations, or post navigation.
- Do not redesign optional video ASR/OCR analysis; retain its existing cost limits and connect its completion event to the new post sync state.
- Do not deploy, mutate production collections, change production triggers, or run live production fixtures from the feature worktree.

## Core invariant

For each post, the database stores at most one current RAG synchronization record keyed by `postId`. A new business mutation overwrites the desired revision of that record instead of appending another historical job.

The worker always rereads the current post, section or synthetic content contract, and community policy before deciding whether the post should be indexed or absent. The synchronization record does not carry a trusted historical `upsert` or `delete` action.

Twenty edits followed by deletion therefore converge to one current result: absent. If the post was never indexed, convergence to absent does not call the embedding provider.

## Authoritative data model

### Community RAG policy

Communities have an explicit `ragIndexPolicy`:

- `business`: current eligible posts may enter the formal business index.
- `validation`: short-lived, signed RAG validation fixtures may be indexed only in the validation scope.
- `excluded`: posts never enter either index scope.

Existing communities without a policy fail closed and are excluded until the post-release RAG activation operation explicitly classifies them. Normal business community creation writes `business`. Fixed H5/test fixtures write `excluded`. The signed RAG smoke fixture writes `validation` and is still required to clean itself up.

Names, creation dates, and guessed keywords such as “test” are not classification authorities.

### Current synchronization state

`post_rag_sync_state` is keyed by `postId` and contains:

- the latest monotonically increasing desired revision;
- current `communityId` and `sectionId` routing metadata;
- status `pending`, `processing`, `retry_wait`, `synced`, or `dead_letter`;
- bounded lease and retry metadata;
- applied source version and index scope after success;
- sanitized error code and timestamps, never raw post content.

Scheduling a post sync occurs in the same CloudBase transaction as the business state change whenever that change is transactional. The scheduler reads the existing record, increments its revision, resets stale retry state, and replaces the current desired record. Non-transactional callers use a small transaction dedicated to this same operation.

### Applied index state

`post_rag_index_state` remains the applied-state record keyed by `postId`. It stores whether the post is indexed or removed, the exact source version, scope, chunk count, and applied timestamp.

`post_rag_chunks` remains the proportional-cost retrieval store. Every new chunk carries the exact `sourceVersion` and `indexScope`. Formal user search reads only `business` chunks. Signed smoke search reads only its isolated `validation` community and scope.

## Eligibility

A post is eligible only when all of these current facts hold:

- its community policy matches the requested index scope;
- the community is active;
- the post is active;
- its audit state is absent or `pass`;
- its section or synthetic archive/collaboration content contract is active and belongs to the same community;
- its identifiers and searchable projection are valid.

Persistent fixtures with `fixtureKey` are excluded even if an incorrectly classified community says `business`. Deleted, missing, rejected, disabled, cross-community, malformed, or otherwise ineligible sources converge to removed.

## Worker behavior

The authenticated `post-rag-worker` processes only current sync-state candidates.

1. Claim one record with a bounded lease and remember its desired revision.
2. Reread the current community, post, and content contract.
3. Build the canonical current projection and exact source version.
4. If eligible, replace that post's chunks through the CloudBase atomic provider; if ineligible, delete chunks only when applied state says they may exist.
5. In a final transaction, mark the record `synced` only when its desired revision is unchanged. If a newer mutation arrived during external work, return it to `pending` without losing the newer revision.
6. Retry only sanitized transient failures with a bounded backoff. Validation errors and exhausted retries become `dead_letter` and surface in health output.

Search fails closed for a post whose sync record is not `synced`, whose applied source version differs from its chunks, or whose current business state is no longer eligible. This prevents stale content from leaking while a new revision waits for indexing.

The timer becomes a low-cost wake-up and safety mechanism for the new current-state worker. An idle run performs a bounded state query and no embedding, rerank, or generation call. The historical outbox/materializer/job stages and their timer evidence are not retained.

## Search path

`post.search` uses the proportional-cost `tencent-cloudbase-atomic` provider:

- CloudBase stores chunks and embeddings.
- Tencent atomic APIs are called for document/query embeddings, reranking, and evidence-bound answer generation.
- No ES endpoint, username, password, VPC network attachment, ES index, or ES versioned activation record is required.
- The response preserves `mode`, `answer`, `citations`, and navigable `items`.
- No evidence returns `no_answer`; provider failure returns `fallback` without presenting ordinary keyword results as RAG evidence.

## Section, community, audit, and video changes

- Post create/update/audit/delete schedules only that post's current sync record.
- Section projection changes scan only current posts in that section and replace one sync record per post.
- Community policy or status changes scan only current posts in that community and replace one sync record per post.
- Membership changes do not re-embed content; authorization is checked from current membership at query time.
- Video analysis completion schedules the parent post's current sync record. Existing video cost budgets and asset reuse remain unchanged.

## Old pipeline retirement

The implementation removes active references, code, tests, commands, indexes, and release actions for:

- `rag_community_versions` content/ACL event cursors;
- immutable `post_rag_outbox` history and its materializer;
- schema-v2 `post_rag_jobs` event-version jobs and the older append-only jobs that share that collection;
- `post_rag_index_state_v2` and `post_rag_index_versions` ES activation state;
- timer probe/evidence and release-probe collections;
- ES semantic-search runtime, ES network configuration, ES index creation, V2 backfill, timer verification, and 30-case release evaluation;
- formal-release execution paths that can run RAG timer probes, backfills, live fixtures, retrieval tests, or evaluations.

Historical specifications, plans, and already-consumed release change manifests remain as clearly historical records. Runtime selection and release planning must permanently ignore their retired actions.

The implementation retains:

- CloudBase `post_rag_chunks` and `post_rag_index_state`;
- Tencent atomic model configuration and proportional-cost provider;
- evidence-bound RAG search contract and mini-program UI;
- signed, separately scoped post-release smoke validation;
- optional video RAG assets/jobs and their cost controls;
- authenticated manual/operational worker invocation.

## Release and activation boundary

The formal release process may deploy or attest the RAG cloud functions only when RAG is explicitly included. It must never run RAG backfill, timer validation, live smoke, semantic retrieval, or evaluation as a release gate.

After deployment, the RAG owner performs a separate activation operation:

1. Read and report community classification candidates without changing data.
2. Explicitly classify real communities as `business`, signed smoke communities as `validation`, and fixtures as `excluded`.
3. Reconcile current posts into one sync record each.
4. Drain only the new current-state records.
5. Verify eligible-business coverage, exact source versions, zero business-scope fixtures, update/delete convergence, citations, and idle zero-model-call behavior.
6. After evidence is preserved, remove the retired production trigger and collections through the guarded canonical-main operational path.

The feature PR supplies code and operational commands but does not perform these production mutations.

## Safety limits and observability

Health output reports sanitized counts:

- classified business, validation, excluded, and unclassified communities;
- eligible posts by scope;
- pending, processing, retry, synced, and dead-letter sync states;
- exact indexed, removed, stale, missing-state, and duplicate-state counts;
- oldest pending age and daily model-call counters when available.

Hard invariants:

- one sync-state document per `postId`;
- business pending-state count cannot exceed the current posts in business communities;
- zero fixture-marked chunks in business scope;
- no model call for a no-op removed source;
- no model call during an idle worker run;
- abnormal candidate counts, fixture leakage, or configured daily budget exhaustion fail closed instead of blindly draining work.

## Verification

Local verification must include:

- red-green unit tests for overwrite/coalescing, lease fencing, retry reset, missing-source no-op removal, fixture exclusion, policy fail-closed behavior, and stale-search filtering;
- integration tests for create/update/delete convergence, section/community fanout, concurrent reschedule during processing, and video completion reschedule;
- post search tests for answer/citations, business/validation scope isolation, live membership filtering, deleted/stale suppression, and provider failure behavior;
- static/reference tests proving retired modules, collections, scripts, environment keys, release actions, and package commands have no active references;
- cloud unit and integration suites, builds, documentation checks, governance/release tests affected by the deletion, and the exact PR CI command.

Production smoke, deployment, trigger changes, collection deletion, and activation are explicitly deferred to the post-merge RAG owner workflow.
