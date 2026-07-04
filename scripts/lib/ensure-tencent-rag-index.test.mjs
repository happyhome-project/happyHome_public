import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'ensure-tencent-rag-index.mjs'), 'utf8')

test('ensure-tencent-rag-index creates an indexed cosine dense_vector mapping', () => {
  assert.match(source, /type:\s*'dense_vector'/)
  assert.match(source, /index:\s*true/)
  assert.match(source, /similarity:\s*'cosine'/)
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
