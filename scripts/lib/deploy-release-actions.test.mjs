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

test('formal release contains no retired ES, backfill, timer-probe, or semantic-evaluation actions', () => {
  for (const retired of ['ensure-tencent-rag-index', 'configure-rag-network', 'backfill-post-rag-v2', 'verify-post-rag-timer', 'eval-post-semantic-search']) {
    assert.doesNotMatch(source, new RegExp(retired))
  }
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
  assert.match(release, /attestCloudWithCurrentOrPrior\(/)
  assert.match(release, /loadPriorCloudAttestationProbe\(/)
  assert.match(release, /registerSecrets: \(secrets\) => releaseLedger\.registerSecrets\(secrets\)/)
  assert.equal((release.match(/forceRedeployCurrent,/g) || []).length >= 2, true)
  assert.match(release, /runCloudSmoke\(cloudDeploy\.fns/)
  assert.match(release, /beforeFunctionDeploy: createPinnedCloudDeployAttemptGuard\(/)
  const cloudbaseStart = source.indexOf('async function deployCloudViaCloudBaseCli')
  const cloudbaseEnd = source.indexOf('function buildCloudArtifacts', cloudbaseStart)
  const cloudbase = source.slice(cloudbaseStart, cloudbaseEnd)
  assert.match(cloudbase, /beforeAttempt:[\s\S]*options\.beforeFunctionDeploy\(fn\)/)
})

test('declared migration rechecks the pinned module bytes after the mutation fence and before import', () => {
  const start = source.indexOf('async function runDeclaredReleaseMigration')
  const end = source.indexOf('async function runFormalRelease', start)
  const runner = source.slice(start, end)
  assert.match(runner, /verifyMigrationInputFile\(\{ root: ROOT, migration \}\)/)
  assert.match(runner, /pathToFileURL\(modulePath\)\.href/)
  assert.ok(runner.indexOf('verifyMigrationInputFile') < runner.indexOf('await import('))
})

test('formal component digests are pinned while miniprogram remains upload-attested only within one run', () => {
  const start = source.indexOf('async function runFormalRelease')
  const release = source.slice(start)
  assert.match(release, /createFrontendComponentDigests\(formalPlan, toolchainIdentity\)/)
  assert.match(release, /componentDigests,/)
  assert.match(release, /artifactManifest\.artifacts\.miniprogram\.componentDigest/)
  assert.match(release, /attestMiniprogramReceipt\(/)
  assert.doesNotMatch(release, /inspectRemoteMiniprogram|attestRemoteMiniprogram/)
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
  const createFileManifest = aliyun.indexOf('writeFileSync(fileManifestPath')
  const bindFileManifest = aliyun.indexOf('fileManifestDigest: await computeFileSha256(fileManifestPath)')
  const writeMarker = aliyun.indexOf('base64 -d | sudo tee')
  const switchCurrent = aliyun.indexOf('sudo ln -sfn')
  assert.ok(verifyArchive < extractArchive)
  assert.ok(extractArchive < verifyFiles)
  assert.ok(createFileManifest < bindFileManifest)
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

test('admin cross-run attestation rehashes the live remote files before trusting the marker', () => {
  const inspectStart = source.indexOf('async function inspectAdminWebPublication')
  const inspectEnd = source.indexOf('async function deployAdminWebToCloudBase', inspectStart)
  const inspect = source.slice(inspectStart, inspectEnd)
  assert.match(inspect, /diff -u \"\$expected_files\" \"\$actual_files\"/)
  assert.match(inspect, /sha256sum -c '\.happyhome-file-manifest\.sha256'/)
  assert.ok(inspect.indexOf("sha256sum -c '.happyhome-file-manifest.sha256'") < inspect.indexOf('cat "$marker"'))
  assert.match(inspect, /actual_manifest_sha="\$\(sha256sum "\$manifest"/)
  assert.match(inspect, /actual_manifest_sha" = "\$expected_manifest_sha/)
  assert.match(inspect, /runtimeVerified: true/)
  assert.match(inspect, /fileManifestDigestVerified: true/)
})

test('admin stable identity binds the effective Vite configuration and Node/npm builder identity without plaintext config', () => {
  const toolchainStart = source.indexOf('function releaseToolchainIdentity')
  const toolchainEnd = source.indexOf('async function createFrontendComponentDigests', toolchainStart)
  const toolchain = source.slice(toolchainStart, toolchainEnd)
  assert.match(source, /function resolveAdminBuildEnvironment\(defaultRouterMode = 'history'\)/)
  for (const name of ['VITE_CLOUD_API_URL', 'VITE_ROUTER_MODE', 'VITE_AMAP_JS_KEY', 'VITE_AMAP_SECURITY_CODE']) assert.match(source, new RegExp(name))
  assert.match(toolchain, /createReleaseBuildConfigurationDigest\(resolveAdminBuildEnvironment\('history'\)\)/)
  assert.match(toolchain, /adminBuilder: `vite@\$\{[^}]+\}\+node@\$\{process\.version\}\+npm@\$\{npmVersion\}\+config@\$\{adminConfigurationDigest\}`/)
  assert.match(source, /const env = \{ \.\.\.process\.env, \.\.\.resolveAdminBuildEnvironment\(defaultRouterMode\) \}/)
})
