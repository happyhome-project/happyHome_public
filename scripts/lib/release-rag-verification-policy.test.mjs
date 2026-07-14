import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  applyReleaseRagVerificationPolicy,
  selectNonRagReleaseSmokeFunctions,
} from './release-rag-verification-policy.mjs'

test('release smoke keeps business functions and excludes RAG specialist workers', () => {
  assert.deepEqual(
    selectNonRagReleaseSmokeFunctions([
      'admin', 'community', 'post', 'post-rag-worker', 'post-video-rag-worker', 'user',
    ]),
    ['admin', 'community', 'post', 'user'],
  )
})

test('release delegates only RAG specialist verification and preserves unrelated gates', () => {
  const policy = applyReleaseRagVerificationPolicy({
    actions: ['verify-post-rag-timer', 'backfill-post-rag-v2', 'eval-post-semantic-search', 'unrelated-check'],
    smokeSuites: ['post-rag', 'post-semantic-search', 'business-smoke'],
  })

  assert.deepEqual(policy.actions, ['unrelated-check'])
  assert.deepEqual(policy.smokeSuites, ['business-smoke'])
  assert.deepEqual(policy.delegatedActions, [
    'verify-post-rag-timer', 'backfill-post-rag-v2', 'eval-post-semantic-search',
  ])
  assert.deepEqual(policy.delegatedSmokeSuites, ['post-rag', 'post-semantic-search'])
  assert.match(policy.reason, /RAG development session after deployment/)
})

test('formal release consumes the delegated policy for DAG and legacy smoke paths', () => {
  const source = readFileSync(new URL('../deploy.mjs', import.meta.url), 'utf8')
  const formalRelease = source.slice(source.indexOf('async function runFormalRelease'), source.indexOf("const target = process.argv[2]"))
  assert.match(formalRelease, /applyReleaseRagVerificationPolicy\(/)
  assert.match(formalRelease, /HH_RELEASE_DELEGATE_RAG_VERIFICATION: '1'/)
  assert.match(formalRelease, /selectNonRagReleaseSmokeFunctions\(formalPlan\.targets\.cloud\.functions/)
  assert.match(formalRelease, /runCloudSmoke\(releaseCloudSmokeFunctions,/)
  assert.doesNotMatch(formalRelease, /runCloudSmoke\(plannedCloudFunctions,|runCloudSmoke\(cloudDeploy\.fns,/)
})
