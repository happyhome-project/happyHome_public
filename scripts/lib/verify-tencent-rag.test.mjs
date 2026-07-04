import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'verify-tencent-rag.mjs'), 'utf8')

test('verify-tencent-rag supports Tencent atomic embedding rerank and LLM APIs', () => {
  assert.match(source, /TENCENT_RAG_ATOMIC_SECRET_ID/)
  assert.match(source, /GetTextEmbedding/)
  assert.match(source, /RunRerank/)
  assert.match(source, /ChatCompletions/)
  assert.match(source, /ModelName:\s*config\.embeddingModel/)
  assert.match(source, /Documents:/)
  assert.match(source, /Stream:\s*false/)
  assert.match(source, /TENCENT_RAG_HTTP_RETRIES/)
  assert.match(source, /ECONNRESET/)
})
