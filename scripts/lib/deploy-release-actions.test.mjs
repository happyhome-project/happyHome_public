import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'deploy.mjs'), 'utf8')

test('declared release actions use a non-blocking child process so the production heartbeat can renew', () => {
  const start = source.indexOf('function runDeclaredReleaseAction')
  const end = source.indexOf('async function runDeclaredReleaseMigration', start)
  const actionRunner = source.slice(start, end)
  assert.match(actionRunner, /await runReleaseNpmScript\(script\)/)
  assert.doesNotMatch(actionRunner, /execSync\(/)
})

test('formal Tencent RAG index gate uses the VPC worker instead of local private ES access', () => {
  assert.match(source, /'ensure-tencent-rag-index': 'ensure:tencent-rag-index:release'/)
})

test('formal release prepares immutable artifacts and fresh-attests cloud functions before selective deployment', () => {
  const start = source.indexOf('async function runFormalRelease')
  const release = source.slice(start)
  assert.doesNotMatch(release, /const formalPlan = prepareOnly \? null/)
  assert.match(release, /pinReleaseArtifacts\(\{ formalPlan, artifactManifest \}\)/)
  assert.match(release, /createImmutableArtifactSnapshots\(/)
  assert.match(release, /orchestrateCloudArtifactRelease\(/)
  assert.match(release, /functions: \[functionName\]/)
  assert.match(release, /artifactRoot: dirname\(artifactRoot\)/)
  assert.match(release, /skipBuild: true/)
  assert.match(release, /recordRemoteAttestations\('cloud'/)
})

test('formal miniprogram upload binds reuse and verification to a fresh normalized receipt identity', () => {
  const start = source.indexOf('async function runFormalRelease')
  const release = source.slice(start)
  assert.match(release, /attestMiniprogramReceipt\(/)
  assert.match(release, /expectedReceiptId: uploadEvidence\.receiptId/)
  assert.match(source, /createMiniprogramReceiptIdentity\(/)
  assert.match(source, /normalizeMiniprogramUploadReceipt\(/)
})
