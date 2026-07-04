import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'update-rag-env.mjs'), 'utf8')

test('update-rag-env configures Tencent ES AI Search as the formal post RAG provider', () => {
  assert.match(source, /tencent-rag\.env/)
  assert.match(source, /TENCENT_RAG_PROVIDER:\s*'es'/)
  assert.match(source, /TENCENT_RAG_ES_ENDPOINT/)
  assert.match(source, /TENCENT_RAG_ES_USERNAME/)
  assert.match(source, /TENCENT_RAG_ES_PASSWORD/)
  assert.match(source, /TENCENT_RAG_EMBEDDING_INFERENCE_ID/)
  assert.match(source, /TENCENT_RAG_RERANK_INFERENCE_ID/)
  assert.match(source, /TENCENT_RAG_LLM_INFERENCE_ID/)
  assert.doesNotMatch(source, /TENCENT_RAG_PROVIDER:\s*'lkeap'/)
})
