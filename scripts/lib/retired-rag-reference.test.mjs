import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { filterRagReleaseManifest } from './release-plan.mjs'

const root = resolve(import.meta.dirname, '..', '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const retiredFiles = [
  'cloud/lib/post-rag-jobs.ts', 'cloud/lib/post-rag-job-processor.ts', 'cloud/lib/post-rag-outbox.ts',
  'cloud/lib/post-rag-outbox-materializer.ts', 'cloud/lib/post-rag-outbox-worker.ts',
  'cloud/lib/post-rag-release-probe.ts', 'cloud/lib/post-rag-v2-health.ts', 'cloud/lib/post-rag-v2-runtime.ts',
  'cloud/lib/post-rag-versioned-index-sink.ts', 'cloud/lib/post-semantic-search.ts',
  'cloud/lib/rag-worker-timer-evidence.ts', 'cloud/lib/release-rag-pagination.ts',
  'scripts/backfill-post-rag-v2.mjs', 'scripts/configure-rag-network.mjs',
  'scripts/ensure-tencent-rag-index.mjs', 'scripts/eval-post-semantic-search.mjs',
  'scripts/verify-post-rag-timer.mjs',
]

test('retired append-only ES and release-probe units are physically absent', () => {
  for (const path of retiredFiles) assert.equal(existsSync(resolve(root, path)), false, path)
})

test('business mutation and worker entrypoints reference only current-state synchronization', () => {
  const source = [
    'cloud/functions/post/index.ts', 'cloud/functions/admin/index.ts', 'cloud/functions/community/index.ts',
    'cloud/functions/post-rag-worker/index.ts', 'cloud/lib/content-audit.ts', 'cloud/lib/membership-transitions.ts',
    'scripts/verify-post-rag-smoke.mjs',
  ].map(read).join('\n')
  assert.doesNotMatch(source, /post-rag-outbox|post-rag-jobs|post-semantic-search|post_rag_index_state_v2|materializeOutbox|indexV2/)
  assert.match(source, /post-rag-sync/)
})

test('release manifests can never resurrect live RAG validation even with includeRag', () => {
  const historical = {
    changeId: 'historical-rag',
    actions: ['ensure-indexes', 'configure-rag-workers', 'update-rag-env', 'configure-rag-network', 'ensure-tencent-rag-index', 'backfill-post-rag-v2', 'verify-post-rag-timer', 'eval-post-semantic-search'],
    migrations: [],
    smokeSuites: ['post-rag', 'post-semantic-search', 'business-smoke'],
  }
  const filtered = filterRagReleaseManifest(historical, true)
  assert.deepEqual(filtered.actions, ['ensure-indexes', 'configure-rag-workers', 'update-rag-env'])
  assert.deepEqual(filtered.smokeSuites, ['business-smoke'])
})

test('active provisioning and formal environment contain no retired stores or ES requirements', () => {
  assert.doesNotMatch(read('scripts/ensure-indexes.mjs'), /post_rag_jobs|post_rag_outbox|post_rag_index_state_v2|post_rag_index_versions|post_rag_worker_timer_evidence|post_rag_release_probes/)
  assert.doesNotMatch(read('scripts/lib/rag-function-env.mjs'), /TENCENT_RAG_ES_|INFERENCE_ID/)
  assert.doesNotMatch(read('package.json'), /backfill:post-rag-v2|verify:post-rag-timer|eval:post-semantic-search|configure:rag-network|ensure:tencent-rag-index/)
})
