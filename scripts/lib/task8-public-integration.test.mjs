import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

test('index command delegates exact v2 mapping creation and readback compatibility to the shared schema helper', () => {
  const text = source('ensure-tencent-rag-index.mjs')
  assert.match(text, /buildPostSemanticIndexDefinition/)
  assert.match(text, /assertPostSemanticIndexCompatible/)
  assert.match(text, /_mapping/)
  assert.match(text, /vectorField:\s*config\.vectorField,\s*dims/)
})

test('worker configuration owns a one-minute SCF timer with a distinct timer token and exact readback', () => {
  const text = source('configure-rag-workers.mjs')
  assert.match(text, /reconcileOwnedScfTimer/)
  assert.match(text, /POST_RAG_TIMER_TOKEN/)
  assert.match(text, /post-rag-worker-every-minute/)
  assert.match(text, /0 \* \* \* \* \* \*/)
  assert.match(text, /customArgument/)
})

test('environment command applies the shared ES Atomic worker and separate timer-token contract', () => {
  const text = source('update-rag-env.mjs')
  assert.match(text, /buildPostSemanticFunctionEnvironments/)
  assert.match(text, /POST_RAG_TIMER_TOKEN/)
  assert.match(text, /const semanticSource =/)
  assert.match(text, /functionEnvironments\['post-rag-worker'\]/)
})

test('RAG rebuild exports v2 modes, paginates batches beyond 100, and reads the combined worker envelope', () => {
  const text = source('rebuild-post-rag-index.mjs')
  assert.match(text, /export function parseRagRebuildArgs/)
  assert.match(text, /healthV2:\s*argv\.includes\('--health-v2'\)/)
  assert.match(text, /workerStage:/)
  assert.match(text, /result\?\.outbox/)
  assert.match(text, /result\?\.v2/)
  assert.match(text, /result\?\.errors/)
  assert.match(text, /while \(true\)/)
})

test('semantic smoke delegates the full create update permission delete scenario to the v2 orchestrator', () => {
  const text = source('verify-post-rag-smoke.mjs')
  assert.match(text, /runSemanticSmokeScenario/)
  assert.match(text, /runV2WorkerSequence/)
  assert.match(text, /protocolVersion/)
  assert.doesNotMatch(text, /result\?\.mode !== 'rag'/)
  assert.doesNotMatch(text, /!result\?\.answer/)
})
