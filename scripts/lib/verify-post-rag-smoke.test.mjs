import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../verify-post-rag-smoke.mjs', import.meta.url), 'utf8')

test('verify-post-rag-smoke exposes admin invoke retry controls for fixture cleanup', () => {
  assert.match(source, /admin-invoke-retries/)
  assert.match(source, /HH_POST_RAG_SMOKE_ADMIN_INVOKE_RETRIES/)
  assert.match(source, /adminInvokeRetries/)
})

test('verify-post-rag-smoke forwards the admin internal token to fixture actions', () => {
  assert.match(source, /resolveAdminInternalToken/)
  assert.match(source, /adminInternalToken:\s*resolveAdminInternalToken\(\)/)
})

test('verify-post-rag-smoke queries the post cloud function instead of the disabled HTTP gateway', () => {
  assert.match(source, /invokeFunction\('post', \{[\s\S]*action: 'search'/)
  assert.match(source, /_testOpenid: openid/)
  assert.doesNotMatch(source, /http-gateway/)
})

test('verify-post-rag-smoke joins the temporary community before searching as its fixture user', () => {
  assert.match(source, /invokeFunction\('member', \{[\s\S]*action: 'apply'/)
  assert.match(source, /member\?\.status !== 'active'/)
})
