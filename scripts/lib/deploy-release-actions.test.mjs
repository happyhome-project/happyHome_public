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
  assert.match(release, /beforeFunctionDeploy: createPinnedCloudDeployAttemptGuard\(/)
  const cloudbaseStart = source.indexOf('async function deployCloudViaCloudBaseCli')
  const cloudbaseEnd = source.indexOf('function buildCloudArtifacts', cloudbaseStart)
  const cloudbase = source.slice(cloudbaseStart, cloudbaseEnd)
  assert.match(cloudbase, /beforeAttempt:[\s\S]*options\.beforeFunctionDeploy\(fn\)/)
})

test('formal miniprogram upload binds reuse and verification to a fresh normalized receipt identity', () => {
  const start = source.indexOf('async function runFormalRelease')
  const release = source.slice(start)
  assert.match(release, /attestMiniprogramReceipt\(/)
  assert.match(release, /expectedReceiptId: uploadEvidence\.receiptId/)
  assert.match(source, /createMiniprogramReceiptIdentity\(/)
  assert.match(source, /normalizeMiniprogramUploadReceipt\(/)
})

test('both admin backends deploy the caller-pinned artifact root instead of mutable admin-web dist', () => {
  const cloudbaseStart = source.indexOf('async function deployAdminWebToCloudBase')
  const aliyunStart = source.indexOf('async function deployAdminWebToAliyun', cloudbaseStart)
  const dispatcherStart = source.indexOf('async function deployAdminWeb(', aliyunStart)
  const cloudbase = source.slice(cloudbaseStart, aliyunStart)
  const aliyun = source.slice(aliyunStart, dispatcherStart)
  assert.match(cloudbase, /const artifactRoot = options\.artifactRoot \|\| ADMIN_WEB_DIST/)
  assert.match(cloudbase, /'deploy',\s*artifactRoot,/)
  assert.doesNotMatch(cloudbase, /'deploy',\s*ADMIN_WEB_DIST,/)
  assert.match(cloudbase, /runOptionalDirectRemoteMutation\([\s\S]*runPinnedAdminArtifactMutation\(/)
  assert.match(aliyun, /const artifactRoot = options\.artifactRoot \|\| ADMIN_WEB_DIST/)
  assert.match(aliyun, /cpSync\(artifactRoot, stagingRoot/)
  assert.match(aliyun, /-C \$\{quote\(stagingRoot\)\}/)
  assert.equal(aliyun.match(/runPinnedAdminArtifactMutation\(/g)?.length, 1)
  assert.equal(aliyun.match(/runPinnedAdminArchiveMutation\(/g)?.length, 3)
  const verifyArchive = aliyun.indexOf('actual_archive_sha=')
  const extractArchive = aliyun.indexOf('sudo tar -xzf')
  const verifyFiles = aliyun.indexOf("sha256sum -c '.happyhome-file-manifest.sha256'")
  const writeMarker = aliyun.indexOf('base64 -d | sudo tee')
  const switchCurrent = aliyun.indexOf('sudo ln -sfn')
  assert.ok(verifyArchive < extractArchive)
  assert.ok(extractArchive < verifyFiles)
  assert.ok(verifyFiles < writeMarker)
  assert.ok(writeMarker < switchCurrent)
  const verifyRemoteScript = aliyun.indexOf('actual_script_sha=$(sha256sum')
  const executeRemoteScript = aliyun.indexOf('bash ${quote(remoteScriptPath)}')
  assert.ok(verifyRemoteScript < executeRemoteScript)
  assert.equal(aliyun.match(/expectedScriptDigest/g)?.length >= 4, true)

  const formalStart = source.indexOf('async function runFormalRelease')
  const formal = source.slice(formalStart)
  assert.match(formal, /artifactRoot: resolve\(ROOT, adminArtifact\.artifactPath\)/)
  assert.ok(formal.indexOf('attestAdminWebArtifact({') < formal.indexOf('await deployAdminWeb({'))
})
