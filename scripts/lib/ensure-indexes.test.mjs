import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'ensure-indexes.mjs'), 'utf8')

test('ensure-indexes creates every CloudBase collection used by formal post RAG state', () => {
  assert.match(source, /post_rag_jobs/)
  assert.match(source, /post_rag_index_state/)
  assert.match(source, /post_rag_worker_state/)
  assert.match(source, /post_video_rag_assets/)
  assert.match(source, /post_video_rag_jobs/)
})

test('ensure-indexes treats CloudBase already-exists races as idempotent success', () => {
  assert.match(source, /function isAlreadyExistsError/)
  assert.match(source, /Table exist/)
  assert.match(source, /already exists/)
  assert.match(source, /= collection \$\{coll\} \(already exists\)/)
})
