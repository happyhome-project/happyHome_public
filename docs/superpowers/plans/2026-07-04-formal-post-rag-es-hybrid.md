# HappyHome Formal Post RAG ES Hybrid Migration Plan

> Historical and superseded. This 2026-07-04 plan assumed an always-on Tencent ES retrieval cluster. The current formal path is CloudBase chunks plus Tencent pay-per-call atomic embedding, rerank, and LLM APIs; see [Post RAG Search](../../post-rag-search.md). Do not execute this plan or create an ES cluster.

## Diagnosis

The current production-facing RAG design still has a structural flaw: the configured main path can select `TENCENT_RAG_PROVIDER=lkeap`, which stores embeddings in CloudBase `post_rag_chunks` and recalls candidates by scanning CloudBase documents inside the cloud function. That is not the formal RAG architecture we want.

The formal design needs CloudBase to own business data, jobs, and index state, while Tencent ES AI Search owns the retrieval index. Search must start from an indexed hybrid recall stage, then rerank, then generate an answer only from qualified citations.

## Target Contract

- CloudBase remains the source of truth for `posts`, `sections`, `post_rag_jobs`, and `post_rag_index_state`.
- `post-rag-worker` writes chunk documents and embeddings into Tencent ES AI Search.
- Community-level reconcile compares `posts` with `post_rag_index_state` and queues only missing, stale, or removable jobs across all active communities.
- Health diagnostics expose source/state/job counts before live search debugging, so "no result" can be separated from index coverage, worker backlog, and retrieval quality.
- Tencent ES AI Search atomic APIs can provide Embedding, Rerank, and LLM generation directly; ES inference endpoints remain an optional compatibility path.
- Runtime search uses Tencent ES `retriever.rank_fusion` with:
  - full-text retrieval over `text`, `preview`, `title`, `fieldLabel`, and `sectionName`;
  - vector retrieval over the configured dense vector field;
  - community, section, and visibility filters at retrieval time.
- Rerank runs before final evidence filtering.
- LLM generation runs only if at least one citation passes the evidence gate.
- `mode=no_answer` means no qualified citation exists; it must not include unrelated posts as if they were evidence.
- `mode=fallback` is reserved for provider/config/service failure, not for normal no-evidence answers.

## Implementation Steps

1. Add failing tests for the formal provider contract.
   - `createTencentRagProviderFromEnv` must keep ES as the formal provider even if an old `TENCENT_RAG_PROVIDER=lkeap` value remains.
   - LKEAP CloudBase scan is allowed only through explicit `TENCENT_RAG_PROVIDER=lkeap-cloudbase` plus `HAPPYHOME_ALLOW_LEGACY_CLOUDBASE_RAG=1`.
   - `TencentRagProvider.search` must send ES `retriever.rank_fusion` instead of top-level `query + knn`.
   - Weak rerank/no-lexical candidates must be filtered before LLM generation.

2. Change runtime provider selection.
   - Default and `es` both resolve to `tencent-es-ai-search`.
   - Legacy `lkeap` no longer selects CloudBase chunk scanning.
   - `lkeap-cloudbase` remains as a deliberate debug/escape provider only when `HAPPYHOME_ALLOW_LEGACY_CLOUDBASE_RAG=1`.

3. Change ES search body.
   - Build a `rank_fusion` retriever with one `standard` full-text retriever and one `knn` retriever when the query embedding exists.
   - Apply the same authorization filters to both retrieval paths.
   - Keep chunk metadata in `_source` for citations and post jump targets.

4. Change evidence gating.
    - Compute lexical evidence from title, field label, and preview.
    - Use rerank scores to suppress unrelated high-recall noise.
    - Generate the AI answer only after the filtered citation set is non-empty.

5. Add reconcile and health guardrails.
   - `post.reconcileRagIndexCommunityBatchAdmin` queues only missing, stale, and removable RAG jobs for a community batch.
   - `post.ragIndexHealthAdmin` returns active source, indexed/removed/failed state, and pending/failed job counts.
   - `rebuild-post-rag-index -- --all-active --health` is read-only; `--reconcile` performs state-driven repair.

6. Change deployment configuration.
   - `scripts/update-rag-env.mjs` reads `~/.happyhome/tencent-rag.env`.
   - It writes `TENCENT_RAG_PROVIDER=es`, ES endpoint/credential, and either Tencent ES atomic model config or ES inference IDs into cloud functions.
   - `scripts/configure-rag-network.mjs` attaches ES-facing cloud functions to the Tencent ES VPC/subnet so private ES endpoints are reachable without opening public access.
   - `post-rag-worker` supports authorized `action: "ensureIndex"` so private ES index mapping can be initialized from cloud runtime.
   - It no longer writes LKEAP as the normal provider.

7. Update docs and verification commands.
   - Document ES as the main formal RAG path.
   - Keep LKEAP CloudBase provider documented only as debug/legacy fallback.
   - Run unit tests and script tests before commit.

## Verification

- `npm.cmd --workspace cloud run test:unit -- --runTestsByPath lib/__tests__/post-rag.test.ts`
- `npm.cmd run test:post-rag-rebuild`
- `npm.cmd run test:mp:post-rag-search-static`
- `npm.cmd run configure:rag-network -- --dry-run`
- `npm.cmd run verify:tencent-rag -- --models-only`
- `npm.cmd run rebuild:post-rag-index -- --all-active --health`
- `npm.cmd run rebuild:post-rag-index -- --all-active --reconcile`
- If ES credentials are available: `npm.cmd run verify:tencent-rag`

## Known Constraint

This branch changes code and deployment scripts. It does not by itself prove the live Tencent ES index already contains every existing post. After merge/deploy, run `npm.cmd run update:rag-env`, `npm.cmd run configure:rag-network`, initialize the private index through authorized `post-rag-worker` `action: "ensureIndex"` or `npm.cmd run ensure:tencent-rag-index` when the endpoint is locally reachable, read `npm.cmd run rebuild:post-rag-index -- --all-active --health`, repair with `npm.cmd run rebuild:post-rag-index -- --all-active --reconcile`, and then run the live RAG smoke.
