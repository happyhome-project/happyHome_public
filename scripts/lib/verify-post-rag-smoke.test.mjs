import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../verify-post-rag-smoke.mjs', import.meta.url), 'utf8')

test('verify-post-rag-smoke exposes admin invoke retry controls for fixture cleanup', () => {
  assert.match(source, /admin-invoke-retries/)
  assert.match(source, /HH_POST_RAG_SMOKE_ADMIN_INVOKE_RETRIES/)
  assert.match(source, /adminInvokeRetries/)
})
