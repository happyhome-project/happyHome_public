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
  assert.match(source, /createSignedPostRagSmokeIdentity/)
  assert.match(source, /__happyhomeSmokeIdentity: identity/)
  assert.doesNotMatch(source, /_testOpenid: openid/)
  assert.doesNotMatch(source, /http-gateway/)
})

test('verify-post-rag-smoke binds the signed identity to a server-side temporary run and cleans it up', () => {
  assert.match(source, /createProductionReleaseStore/)
  assert.match(source, /async function seedFixtureMember/)
  assert.match(source, /collection\('community_members'\)\.add/)
  assert.match(source, /async function seedFixtureRun/)
  assert.match(source, /collection\('post_rag_smoke_runs'\)\.doc\(identity\.runId\)\.set/)
  assert.match(source, /async function cleanupFixtureRun/)
  assert.match(source, /cleanupFixtureRun\(runId\)/)
  assert.doesNotMatch(source, /invokeFunction\('member', \{[\s\S]*action: 'apply'/)
})
