# HappyHome Formal Post RAG ES Hybrid Migration Plan

## Diagnosis

The current production-facing RAG design still has a structural flaw: the configured main path can select `TENCENT_RAG_PROVIDER=lkeap`, which stores embeddings in CloudBase `post_rag_chunks` and recalls candidates by scanning CloudBase documents inside the cloud function. That is not the formal RAG architecture we want.

The formal design needs CloudBase to own business data, jobs, and index state, while Tencent ES AI Search owns the retrieval index. Search must start from an indexed hybrid recall stage, then rerank, then generate an answer only from qualified citations.

## Target Contract

- CloudBase remains the source of truth for `posts`, `sections`, `post_rag_jobs`, and `post_rag_index_state`.
- `post-rag-worker` writes chunk documents and embeddings into Tencent ES AI Search.
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
   - LKEAP CloudBase scan is allowed only through explicit `TENCENT_RAG_PROVIDER=lkeap-cloudbase`.
   - `TencentRagProvider.search` must send ES `retriever.rank_fusion` instead of top-level `query + knn`.
   - Weak rerank/no-lexical candidates must be filtered before LLM generation.

2. Change runtime provider selection.
   - Default and `es` both resolve to `tencent-es-ai-search`.
   - Legacy `lkeap` no longer selects CloudBase chunk scanning.
   - `lkeap-cloudbase` remains as a deliberate debug/escape provider.

3. Change ES search body.
   - Build a `rank_fusion` retriever with one `standard` full-text retriever and one `knn` retriever when the query embedding exists.
   - Apply the same authorization filters to both retrieval paths.
   - Keep chunk metadata in `_source` for citations and post jump targets.

4. Change evidence gating.
   - Compute lexical evidence from title, field label, and preview.
   - Use rerank scores to suppress unrelated high-recall noise.
   - Generate the AI answer only after the filtered citation set is non-empty.

5. Change deployment configuration.
   - `scripts/update-rag-env.mjs` reads `~/.happyhome/tencent-rag.env`.
   - It writes `TENCENT_RAG_PROVIDER=es` and ES endpoint/credential/inference IDs into cloud functions.
   - It no longer writes LKEAP as the normal provider.

6. Update docs and verification commands.
   - Document ES as the main formal RAG path.
   - Keep LKEAP CloudBase provider documented only as debug/legacy fallback.
   - Run unit tests and script tests before commit.

## Verification

- `npm.cmd --workspace cloud run test:unit -- --runTestsByPath lib/__tests__/post-rag.test.ts`
- `npm.cmd run test:post-rag-rebuild`
- `npm.cmd run test:mp:post-rag-search-static`
- If ES credentials are available: `npm.cmd run verify:tencent-rag`

## Known Constraint

This branch changes code and deployment scripts. It does not by itself prove the live Tencent ES index already contains every existing post. After merge/deploy, run `npm.cmd run update:rag-env`, `npm.cmd run ensure:tencent-rag-index`, and the RAG rebuild worker path against all active communities.
