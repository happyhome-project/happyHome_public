import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildPostSemanticIndexDefinition } from './tencent-rag-index-schema.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'ensure-tencent-rag-index.mjs'), 'utf8')

test('ensure-tencent-rag-index creates an indexed cosine dense_vector mapping', () => {
  const definition = buildPostSemanticIndexDefinition({ vectorField: 'embedding', dims: 768 })
  assert.deepEqual(definition.mappings.properties.embedding, { type: 'dense_vector', dims: 768, index: true, similarity: 'cosine' })
  assert.match(source, /buildPostSemanticIndexDefinition/)
  assert.match(source, /assertPostSemanticIndexCompatible/)
})

test('ensure-tencent-rag-index can probe dimensions through Tencent atomic embedding API', () => {
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_ID/)
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_KEY/)
  assert.match(source, /GetTextEmbedding/)
  assert.match(source, /ModelName:\s*config\.embeddingModel/)
  assert.match(source, /Texts:/)
  assert.match(source, /TENCENT_RAG_HTTP_RETRIES/)
  assert.match(source, /ECONNRESET/)
})

test('ensure-tencent-rag-index retries when Node reports ECONNRESET as socket hang up', () => {
  assert.match(source, /error\?\.code/)
})
