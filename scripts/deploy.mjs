/**
 * One-click deployment script.
 *
 * Usage:
 *   node scripts/deploy.mjs cloud                # upload all cloud functions
 *   node scripts/deploy.mjs cloud --only=post    # upload only post (comma-separated ok)
 *   node scripts/deploy.mjs miniprogram          # upload mini program (preview QR)
 *   node scripts/deploy.mjs miniprogram-upload   # upload mini program as a dev build for trial selection, no QR
 *   node scripts/deploy.mjs admin-web            # upload admin-web dist to Aliyun Nginx production host
 *   node scripts/deploy.mjs all                  # cloud + miniprogram
 *   node scripts/deploy.mjs release --use-tcb    # CloudBase CLI/COS cloud + cloud smoke + admin-web + miniprogram-upload
 *   node scripts/deploy.mjs release-prepare      # write fixed build-info + build/gate/DevTools evidence, no cloud/upload
 *   node scripts/deploy.mjs release-publish --use-tcb --resume --release-run-id=<id>
 *                                                # resume prepared evidence, then cloud + smoke + admin-web + upload
 *
 * Flags:
 *   --only=a,b,c   filter cloud functions by name (not allowed for formal release)
 *   --version=x    version for miniprogram-upload (default: 1.0.YYMMDDHHmm)
 *   --desc=x       description for miniprogram-upload
 *   --use-tcb      force CloudBase CLI deploy path for cloud functions
 *   --smoke        after cloud deploy, run release cloud invoke smoke and log capture
 *   --env-id=x     CloudBase env id for deploy and smoke (default: cloudbase-3gh862acb1505ff3)
 *   --use-ci       skip DevTools/CloudBase CLI paths, go straight to miniprogram-ci
 *                  (useful when DevTools is not installed on the machine)
 *   --resume       resume the latest release ledger conservatively
 *   --release-run-id=x  use or resume a specific release ledger run id
 *   --cloud-deploy-concurrency=x  bounded CloudBase CLI/COS deploy concurrency (default: 2)
 *   --cloud-smoke-concurrency=x   bounded cloud invoke/log concurrency (default: 3)
 *
 * Deploy path resolution:
 *   Primary   = WeChat DevTools CLI `cloud functions deploy`
 *     - Uses the IDE's own network stack, sidesteps transparent proxy/IPv6 whitelist issues
 *     - Requires WeChat DevTools installed and IDE login/signing state to be valid
 *     - Parses output because DevTools can exit 0 while cloud deploy rows fail
 *   Formal release / fallback = CloudBase CLI `fn deploy`
 *     - Official CloudBase path; deploys by COS from each built function package directory
 *     - Formal release requires this path plus cloud smoke/log evidence before upload
 *   Last resort = miniprogram-ci `cloud.uploadFunction`
 *     - Applies dns.setDefaultResultOrder('ipv4first') + dns.lookup monkey-patch
 *       to force IPv4, still subject to WeChat CI IP 白名单
 *
 * 该请求路径要求显式 IPv4，避免双栈环境中的连接不确定性。
 */

// ── IPv4 forcing for miniprogram-ci fallback path ──
// Node 17+ defaults to dual-stack; on IPv6-enabled networks this triggers
// `-10008 invalid ip` because CloudBase/WeChat CI whitelists only accept IPv4.
import dns from 'node:dns'
dns.setDefaultResultOrder('ipv4first')
const _origDnsLookup = dns.lookup
dns.lookup = function forcedIPv4Lookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options
    options = {}
  }
  const opts = typeof options === 'number' ? { family: options } : { ...(options || {}) }
  opts.family = 4
  return _origDnsLookup.call(this, hostname, opts, callback)
}

import ci from 'miniprogram-ci'
import { resolve, dirname, isAbsolute, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { execSync, spawn, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { parseArgs as parseCloudSmokeArgs, runCloudReleaseSmoke } from './cloud-release-smoke.mjs'
import { deployFunctionsWithConcurrency } from './lib/cloudbase-function-deploy.mjs'
import {
  WECHAT_AUDIT_CALLBACK,
  WECHAT_AUDIT_CALLBACK_PATH,
  assertWechatAuditHttpAccess,
  cloudBaseCreateServiceArgs,
  cloudBaseDeployArgs,
  ensureWechatAuditHttpAccess,
} from './lib/cloudbase-http-function.mjs'
import { abortableDelay, runAbortableShellCapture } from './lib/abortable-process.mjs'
import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import {
  analyzeDevtoolsCloudDeployOutput,
  analyzeDevtoolsUploadInfo,
  analyzeDevtoolsUploadOutput,
} from './lib/deploy-output.mjs'
import { runDirectRemoteMutation } from './lib/direct-deploy-policy.mjs'
import { parsePositiveIntOption } from './lib/release-concurrency.mjs'
import { renderReleaseBuildInfo, restoreReleaseOwnedBuildInfo } from './lib/release-build-info-cleanup.mjs'
import {
  assertFormalReleaseGitState,
  createFormalReleaseMutationFences,
  mustRevalidateRemoteReleaseStage,
  shouldFallbackAfterDevtoolsFailure,
} from './lib/release-policy.mjs'
import {
  assertReleaseCapabilitySeparation,
  assertReleaseFunctionSecurityConfig,
} from './lib/release-security-policy.mjs'
import {
  createReleaseRunLedger,
  createReleasePlanAfterResumeIdentityCheck,
  computeDirectoryDigest,
  findLatestReleaseUiEvidence,
  inspectReleaseStageReuse,
  loadReleaseRun,
  loadLatestReleaseRun,
  makeReleaseRunId,
  runLedgerStage,
} from './lib/release-run-ledger.mjs'
import {
  completeProductionReleaseWithRemoteConfirmation,
  ProductionReleaseGuard,
} from './lib/production-release-guard.mjs'
import { hasCloudReleaseComponentAttestationResponse, hasCloudReleaseProbeResponse } from './lib/cloud-release-probe.mjs'
import { collectComponentSourcePaths, createReleaseBuildConfigurationDigest, createReleaseComponentDigest } from './lib/release-component-digest.mjs'
import { selectCloudProductionBindings, selectStableProductionBinding } from './lib/release-component-state.mjs'
import { attestCloudWithCurrentOrPrior, loadPriorCloudAttestationProbe } from './lib/release-prior-cloud-attestation.mjs'
import { executeReleaseOperations } from './lib/release-operations.mjs'
import { CLOUD_RELEASE_COMPONENTS, verifyMigrationInputFile } from './lib/release-component-registry.mjs'
import {
  executeReleaseDagV2,
  partitionReleaseCloudFunctions,
  releaseDagMode,
} from './lib/release-dag-v2.mjs'
import { inspectReleaseUiQualification, writeReleaseUiQualification } from './lib/release-ui-qualification.mjs'
import { persistFormalReleaseFailure } from './lib/release-terminal-failure.mjs'
import { ReleaseGovernance } from './lib/release-governance.mjs'
import {
  attestAdminWebArtifact,
  attestMiniprogramReceipt,
  computeFileSha256,
  createDeterministicFileManifest,
  createPinnedCloudDeployAttemptGuard,
  createImmutableArtifactSnapshots,
  createReleaseArtifactManifest,
  orchestrateCloudArtifactRelease,
  runPinnedAdminArtifactMutation,
  runPinnedAdminArchiveMutation,
} from './lib/release-artifact-attestation.mjs'
import {
  createMiniprogramReceiptIdentity,
  normalizeMiniprogramUploadReceipt,
} from './lib/miniprogram-receipt-identity.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPID = 'wx673b17363cd6b4a6'
const KEY_PATH = process.env.MP_PRIVATE_KEY_PATH || resolve(ROOT, `private.${APPID}.key`)
const MP_DIST = resolve(ROOT, 'miniprogram/dist/build/mp-weixin')
const CLOUD_DIST = resolve(ROOT, 'cloud/dist')
const ADMIN_WEB_DIR = resolve(ROOT, 'admin-web')
const ADMIN_WEB_DIST = resolve(ROOT, 'admin-web/dist')

function resolveAdminBuildEnvironment(defaultRouterMode = 'history') {
  return {
    VITE_CLOUD_API_URL: process.env.VITE_CLOUD_API_URL || ADMIN_WEB_DEFAULT_API_URL,
    VITE_ROUTER_MODE: process.env.VITE_ROUTER_MODE || defaultRouterMode,
    VITE_AMAP_JS_KEY: process.env.VITE_AMAP_JS_KEY || process.env.AMAP_JS_KEY || process.env.GAODE_JS_KEY || '',
    VITE_AMAP_SECURITY_CODE: process.env.VITE_AMAP_SECURITY_CODE || process.env.AMAP_SECURITY_CODE || process.env.GAODE_SECURITY_CODE || '',
  }
}

function releaseToolchainIdentity() {
  const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'))
  const rootPackage = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'))
  const version = (path) => lock.packages?.[path]?.version || 'unknown'
  const npmVersion = String(rootPackage.packageManager || '').match(/^npm@(.+)$/)?.[1] || 'unknown'
  const adminConfigurationDigest = createReleaseBuildConfigurationDigest(resolveAdminBuildEnvironment('history'))
  return {
    node: process.version,
    npm: `npm@${npmVersion}`,
    cloudBuilder: `cloud/build.mjs+esbuild@${version('node_modules/esbuild')}`,
    adminBuilder: `vite@${version('admin-web/node_modules/vite')}+node@${process.version}+npm@${npmVersion}+config@${adminConfigurationDigest}`,
    miniprogramBuilder: `@dcloudio/uni-app@${version('miniprogram/node_modules/@dcloudio/uni-app')}+node@${process.version}+npm@${npmVersion}+WeChat-DevTools-release-gate`,
  }
}

async function createFrontendComponentDigests(plan, toolchain) {
  const digests = {}
  if (plan.targets.adminWeb) {
    digests.adminWeb = await createReleaseComponentDigest({
      root: ROOT,
      component: 'admin-web',
      sourcePaths: await collectComponentSourcePaths(ADMIN_WEB_DIR, { excludeDirectories: ['dist', 'node_modules'] }),
      configPaths: ['package.json', 'project.config.json'],
      lockfilePath: 'package-lock.json',
      builderVersion: toolchain.adminBuilder,
    })
  }
  if (plan.targets.miniprogram) {
    digests.miniprogram = await createReleaseComponentDigest({
      root: ROOT,
      component: 'miniprogram',
      // This marker is written by the release run itself. The compiled package digest,
      // UI qualification and upload receipt bind its value; treating it as source input
      // would make a successful upload impossible to resume after final verification.
      sourcePaths: await collectComponentSourcePaths(resolve(ROOT, 'miniprogram'), {
        excludeDirectories: ['dist', 'node_modules'],
        excludeFiles: ['src/generated/build-info.ts'],
      }),
      configPaths: ['package.json', 'project.config.json'],
      lockfilePath: 'package-lock.json',
      builderVersion: toolchain.miniprogramBuilder,
    })
  }
  return digests
}

async function runOptionalDirectRemoteMutation(options, mutate) {
  if (typeof options?.beforeRemoteMutation !== 'function') return await mutate()
  return await runDirectRemoteMutation({ revalidate: options.beforeRemoteMutation, mutate })
}

const DEFAULT_CLOUD_ENV = 'cloudbase-3gh862acb1505ff3'
const CLOUD_ENV = process.env.TCB_ENV || DEFAULT_CLOUD_ENV
const ADMIN_WEB_DEFAULT_API_URL = 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com'
const ADMIN_WEB_ALIYUN_HOST = process.env.ADMIN_WEB_SSH_HOST || 'aliyun'
const ADMIN_WEB_ALIYUN_ROOT = process.env.ADMIN_WEB_REMOTE_ROOT || '/var/www/happyhome-admin'
const CLOUD_FUNCTIONS = [...CLOUD_RELEASE_COMPONENTS]

// Common DevTools install locations on Windows
const DEVTOOLS_CLI_CANDIDATES = [
  'X:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'D:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'E:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
]

function findDevtoolsCli() {
  const envOverride = process.env.WX_DEVTOOLS_CLI
  if (envOverride && existsSync(envOverride)) return envOverride
  return DEVTOOLS_CLI_CANDIDATES.find((p) => existsSync(p)) || null
}

const quote = (s) => (/[ \t&|<>()]/.test(String(s)) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s))

function getFlagValue(name) {
  const equalsArg = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1]
  }
  return ''
}

function getRequiredFlagValue(name, purpose) {
  const value = getFlagValue(name).trim()
  if (!value) throw new Error(`${purpose} requires explicit --${name}=<value>`)
  return value
}

function getPositiveIntFlag(name, fallback, options = {}) {
  return parsePositiveIntOption(getFlagValue(name) || process.env[`HH_${name.toUpperCase().replace(/-/g, '_')}`], fallback, options)
}

function getCloudDeployConcurrency() {
  return getPositiveIntFlag('cloud-deploy-concurrency', 2, { min: 1, max: 4 })
}

function getCloudSmokeConcurrency() {
  return getPositiveIntFlag('cloud-smoke-concurrency', 3, { min: 1, max: 5 })
}

function getCloudEnvId() {
  return getFlagValue('env-id') || CLOUD_ENV
}

function getShortGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

function readWechatDevToolsVersion() {
  const cli = findDevtoolsCli()
  if (!cli) throw new Error('WeChat DevTools CLI was not found; cannot bind UI qualification to a DevTools version')
  const packagePath = resolve(dirname(cli), 'code', 'package.nw', 'package.json')
  if (!existsSync(packagePath)) throw new Error(`WeChat DevTools package metadata was not found: ${packagePath}`)
  const version = String(JSON.parse(readFileSync(packagePath, 'utf8')).version || '').trim()
  if (!version) throw new Error('WeChat DevTools version is missing from package metadata')
  return version
}

function getGitOutput(command) {
  return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function getFormalReleaseGitState({ publishOnly, version, desc, releaseStrategy, fullCurrentExplicit = false, allowReleaseBuildInfo = false }) {
  const changedPaths = new Set()
  for (const command of [
    'git diff --name-only --no-ext-diff',
    'git diff --cached --name-only --no-ext-diff',
    'git ls-files --others --exclude-standard',
  ]) {
    for (const path of getGitOutput(command).split(/\r?\n/).filter(Boolean)) changedPaths.add(path)
  }
  const buildInfoPath = resolve(ROOT, 'miniprogram/src/generated/build-info.ts')
  const buildInfo = existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
  return {
    cwd: ROOT,
    originUrl: getGitOutput('git remote get-url origin'),
    releaseStrategy,
    fullCurrentExplicit,
    branch: getGitOutput('git branch --show-current'),
    headSha: getGitOutput('git rev-parse HEAD'),
    originMainSha: getGitOutput('git rev-parse origin/main'),
    changedPaths: [...changedPaths],
    publishOnly,
    allowReleaseBuildInfo,
    generatedBuildInfoMatches: buildInfo.includes(version) && buildInfo.includes(desc),
  }
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function getExplicitReleaseRunId() {
  return getFlagValue('release-run-id') || getFlagValue('run-id') || process.env.HH_RELEASE_RUN_ID || ''
}

function assertNoFormalReleaseOnlyFilter() {
  const hasOnlyFilter = process.argv.some((arg) => arg === '--only' || arg.startsWith('--only='))
  if (hasOnlyFilter) {
    throw new Error('Formal release does not support --only; deploy and smoke all release functions.')
  }
}

function assertFormalReleaseCloudBasePath({ prepareOnly }) {
  if (prepareOnly) return
  if (!hasFlag('use-tcb')) {
    throw new Error('Formal release publish requires --use-tcb so cloud deploy uses CloudBase CLI/COS before upload.')
  }
}

async function getResumeRunState(forceResume = false) {
  if (!forceResume && !hasFlag('resume')) return null
  const explicitRunId = getExplicitReleaseRunId()
  if (explicitRunId) return await loadReleaseRun(ROOT, explicitRunId)
  try {
    return await loadLatestReleaseRun(ROOT)
  } catch {
    throw new Error('No previous release ledger found. Start without --resume or pass --release-run-id=<id>.')
  }
}

async function resolveReleaseRunId(forceResume = false) {
  const explicitRunId = getExplicitReleaseRunId()
  if (explicitRunId) return explicitRunId
  if (forceResume || hasFlag('resume')) {
    const latest = await loadLatestReleaseRun(ROOT)
    return latest.runId
  }
  return makeReleaseRunId()
}

function getLocalTimestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return {
    yy: String(now.getFullYear()).slice(-2),
    yyyy: String(now.getFullYear()),
    MM: pad(now.getMonth() + 1),
    dd: pad(now.getDate()),
    hh: pad(now.getHours()),
    mm: pad(now.getMinutes()),
  }
}

function writeMiniprogramBuildInfo(version, desc) {
  const buildInfoPath = resolve(ROOT, 'miniprogram/src/generated/build-info.ts')
  const content = renderReleaseBuildInfo({ version, desc })

  mkdirSync(dirname(buildInfoPath), { recursive: true })
  if (existsSync(buildInfoPath) && readFileSync(buildInfoPath, 'utf8') === content) {
    console.log(`[build-info] unchanged ${version}`)
    return
  }
  writeFileSync(buildInfoPath, content)
  console.log(`[build-info] wrote ${buildInfoPath}`)
}

function runShell(commandLine, options = {}) {
  console.log(commandLine)
  return new Promise((res) => {
    const proc = spawn(commandLine, {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      stdio: 'inherit',
      shell: true,
    })
    proc.on('exit', (code) => res({ ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}` }))
    proc.on('error', (err) => res({ ok: false, reason: String(err?.message || err) }))
  })
}

function runShellCapture(commandLine, options = {}) {
  console.log(options.displayCommandLine || commandLine)
  return runAbortableShellCapture(commandLine, {
    ...options,
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  })
}

function parseCliJson(output) {
  const text = String(output || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function logCloudFunctionDetailSummary(functionName, output) {
  const parsed = parseCliJson(output)
  const data = parsed?.data || {}
  const envKeys = (data.Environment?.Variables || []).map((item) => item.Key).filter(Boolean)
  console.log(`[tcb fn detail] ${functionName}: status=${data.Status || 'unknown'} available=${data.AvailableStatus || 'unknown'} runtime=${data.Runtime || 'unknown'} envKeys=${envKeys.length ? envKeys.join(',') : 'none'}`)
  return data
}

function isTransientCloudBaseCliFailure(result) {
  const text = `${result?.reason || ''}\n${result?.output || ''}`
  return /ECONNRESET|ETIMEDOUT|TLS connection|socket disconnected|network timeout|ENOTFOUND|EAI_AGAIN|_a\.includes is not a function|e\.message\.includes is not a function/i.test(text)
}

async function runCloudBaseCliCaptureWithRetry(commandLine, options = {}, attempts = 3) {
  const { beforeAttempt, ...shellOptions } = options
  let lastResult = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (shellOptions.signal?.aborted) throw new Error('operation aborted before CloudBase CLI attempt')
    if (typeof beforeAttempt === 'function') await beforeAttempt({ attempt, attempts })
    if (shellOptions.signal?.aborted) throw new Error('operation aborted before CloudBase CLI process start')
    const result = await runShellCapture(commandLine, {
      ...shellOptions,
      displayCommandLine: attempt === 1
        ? shellOptions.displayCommandLine
        : `${shellOptions.displayCommandLine || commandLine} (retry ${attempt}/${attempts})`,
    })
    if (result.ok) return result
    if (shellOptions.signal?.aborted || result.aborted) return result
    lastResult = result
    if (!isTransientCloudBaseCliFailure(result) || attempt >= attempts) break
    console.warn(`[CloudBase CLI] transient failure; retrying in ${attempt * 3000}ms`)
    await abortableDelay(attempt * 3000, shellOptions.signal)
  }
  return lastResult
}

// Lazy: miniprogram-ci 的 Project 构造会 eager 读 private key；DevTools CLI
// 主路径完全不需要 key。key 只在主仓（不进 worktree/CI 环境），所以延迟到真
// 正要走 miniprogram-ci fallback 时再构造——避免 worktree 里 import 期即崩。
let _project
function getCiProject() {
  if (_project) return _project
  _project = new ci.Project({
    appid: APPID,
    type: 'miniProgram',
    projectPath: MP_DIST,
    privateKeyPath: KEY_PATH,
    ignores: ['node_modules/**/*'],
  })
  return _project
}

// ── Primary deploy path: WeChat DevTools CLI ──
// Uses the IDE's own network stack, which bypasses local transparent proxies
// / IPv6 tunnels that corrupt node-layer DNS. IDE must be logged in (once).
async function deployCloudViaDevtoolsCli(fns) {
  const cli = findDevtoolsCli()
  if (!cli) return { ok: false, reason: 'DevTools CLI not found at known paths (set WX_DEVTOOLS_CLI env to override)' }
  const envId = getCloudEnvId()

  const paths = fns.map((fn) => resolve(CLOUD_DIST, fn))
  const args = [
    'cloud', 'functions', 'deploy',
    '--env', envId,
    '--paths', ...paths,
    // ⚠️ --project 必须指向 MP_DIST 而不是仓库根！
    // 2026-04-24 实测：`cli.bat auto --project <ROOT>` 会让 DevTools 把根目录
    // 当成独立小程序项目，**把 project.config.json 覆写成只剩 {"appid":...}**
    // 的单行版（丢掉 miniprogramRoot/cloudfunctionRoot/packOptions.include 等）。
    // DevTools automator 需要先完成 CLI 登录并保持端口可用。
    '--project', MP_DIST,
    '--remote-npm-install',
  ]

  // Windows + Node spawn + .bat + shell:true 组合下，带空格的路径必须手动加引号，
  // 否则 cmd.exe 会把 "X:/Program Files (x86)/..." 劈成两段。
  // 做法：把整条命令字符串自己拼好、并对每个含空格的段加双引号，然后当作一条命令传给 shell。
  const commandLine = [cli, ...args].map(quote).join(' ')
  console.log(`[DevTools CLI] ${commandLine}`)

  const result = await runShellCapture(commandLine)
  if (!result.ok) return result

  const semantic = analyzeDevtoolsCloudDeployOutput(result.output)
  if (!semantic.ok) {
    const loginHint = semantic.reason.includes('signed-header')
      ? '; open WeChat DevTools, log in again, then retry deploy'
      : ''
    return { ok: false, reason: `${semantic.reason}${loginHint}` }
  }

  return { ok: true, reason: 'ok' }
}

async function deployCloudViaCloudBaseCli(fns, options = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const tcb = (...args) => [npx, '--yes', '--package', '@cloudbase/cli', 'tcb', ...args].map(quote).join(' ')
  const confirmDefault = (commandLine) => process.platform === 'win32'
    ? `echo. | ${commandLine}`
    : `printf '\\n' | ${commandLine}`
  const envId = getCloudEnvId()
  const concurrency = getCloudDeployConcurrency()
  const securityConfigByFunction = {}

  const authProbe = await runShellCapture(
    tcb('fn', 'list', '--env-id', envId, '--json'),
    { displayCommandLine: `tcb fn list --env-id ${envId} --json` }
  )
  if (!authProbe.ok) {
    return {
      ok: false,
      reason: `CloudBase CLI auth/env probe failed: ${authProbe.reason}. Run "cloudbase login" or "cloudbase login --apiKeyId <id> --apiKey <key>" and retry.`,
    }
  }

  console.log(`[CloudBase CLI] deploying ${fns.length} function(s) with concurrency=${concurrency}`)
  try {
    const functionResults = await deployFunctionsWithConcurrency({
      functions: fns,
      concurrency,
      deployOne: async (fn) => {
        const fnDir = resolve(options.artifactRoot || CLOUD_DIST, fn)
        const deployResult = await runCloudBaseCliCaptureWithRetry(
          confirmDefault(tcb(...cloudBaseDeployArgs(fn, envId))),
          {
            cwd: fnDir,
            displayCommandLine: `cd ${fnDir} && <confirm default> | tcb fn deploy ${fn} --force --env-id ${envId} --deployMode cos --json`,
            // CloudBase CLI 3.5.8 prompts to accept the merged existing function
            // config; its --yes path throws "_a.includes is not a function".
            beforeAttempt: typeof options.beforeFunctionDeploy === 'function'
              ? async () => await options.beforeFunctionDeploy(fn)
              : undefined,
          }
        )
        if (!deployResult.ok || fn !== WECHAT_AUDIT_CALLBACK) return deployResult

        const readAccess = async () => {
          const result = await runCloudBaseCliCaptureWithRetry(
            tcb('service', 'list', '--service-path', WECHAT_AUDIT_CALLBACK_PATH, '--json', '--env-id', envId),
            { displayCommandLine: `tcb service list --service-path ${WECHAT_AUDIT_CALLBACK_PATH} --json`, silentOutput: true }
          )
          if (!result.ok) throw new Error(`HTTP access readback failed: ${result.reason}`)
          return result.output
        }
        await ensureWechatAuditHttpAccess({
          readAccess,
          beforeCreate: async () => {
            if (typeof options.beforeFunctionDeploy === 'function') await options.beforeFunctionDeploy(fn)
          },
          createAccess: async () => {
            const result = await runCloudBaseCliCaptureWithRetry(
              tcb(...cloudBaseCreateServiceArgs(envId)),
              { displayCommandLine: `tcb service create --service-path ${WECHAT_AUDIT_CALLBACK_PATH} --function ${WECHAT_AUDIT_CALLBACK} --json` }
            )
            if (!result.ok) throw new Error(`HTTP access create failed: ${result.reason}`)
          },
        })
        return deployResult
      },
      detailOne: async (fn) => {
        const detail = await runCloudBaseCliCaptureWithRetry(
          tcb('fn', 'detail', fn, '--env-id', envId, '--json'),
          { displayCommandLine: `tcb fn detail ${fn} --env-id ${envId} --json`, silentOutput: true }
        )
        if (detail.ok) {
          const data = logCloudFunctionDetailSummary(fn, detail.output)
          const environmentVariables = data.Environment?.Variables || []
          assertReleaseFunctionSecurityConfig(fn, environmentVariables)
          securityConfigByFunction[fn] = environmentVariables
        }
        if (detail.ok && fn === WECHAT_AUDIT_CALLBACK) {
          const access = await runCloudBaseCliCaptureWithRetry(
            tcb('service', 'list', '--service-path', WECHAT_AUDIT_CALLBACK_PATH, '--json', '--env-id', envId),
            { displayCommandLine: `tcb service list --service-path ${WECHAT_AUDIT_CALLBACK_PATH} --json`, silentOutput: true }
          )
          if (!access.ok) return access
          try {
            assertWechatAuditHttpAccess(access.output)
          } catch (error) {
            return { ok: false, reason: error.message }
          }
        }
        return detail
      },
      afterDeploy: options.afterFunctionDeploy,
    })
    assertReleaseCapabilitySeparation(securityConfigByFunction)
    return { ok: true, reason: 'ok', concurrency, functionResults }
  } catch (error) {
    return {
      ok: false,
      reason: `CloudBase CLI deploy failed: ${error?.message || error}`,
      concurrency,
      functionResults: error?.functionResults || [],
    }
  }
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function getMiniprogramUploadEvidencePath(releaseRunId) {
  return resolve(ROOT, '.codex-local', 'release-evidence', releaseRunId, 'miniprogram-upload', 'upload-evidence.json')
}

function writeMiniprogramUploadEvidence({ releaseRunId, version, desc, packageDigest, uploadResult }) {
  const evidencePath = getMiniprogramUploadEvidencePath(releaseRunId)
  const uploadInfoPath = uploadResult.uploadInfoPath || ''
  const normalizedReceipt = normalizeMiniprogramUploadReceipt({
    method: uploadResult.method,
    uploadInfoText: uploadInfoPath && existsSync(uploadInfoPath) ? readFileSync(uploadInfoPath, 'utf8') : '',
    receipt: uploadResult.receipt,
  })
  const receiptId = normalizedReceipt ? createMiniprogramReceiptIdentity({
    receipt: normalizedReceipt,
    runId: releaseRunId,
    packageDigest,
    version,
    desc,
  }) : ''
  const evidence = {
    success: true,
    releaseRunId,
    receiptId,
    normalizedReceipt,
    appid: APPID,
    version,
    desc,
    packageDigest,
    method: uploadResult.method,
    uploadInfoPath,
    uploadInfoSize: uploadInfoPath && existsSync(uploadInfoPath) ? statSync(uploadInfoPath).size : 0,
    uploadInfoMtimeMs: uploadResult.uploadInfoMtimeMs || 0,
    uploadStartedAtMs: uploadResult.uploadStartedAtMs || 0,
    uploadedAt: new Date().toISOString(),
  }
  writeJsonFile(evidencePath, evidence)
  return { evidencePath, evidence }
}

function readMiniprogramUploadEvidence(releaseRunId) {
  const evidencePath = getMiniprogramUploadEvidencePath(releaseRunId)
  if (!existsSync(evidencePath)) throw new Error(`upload evidence file not found: ${evidencePath}`)
  return { evidencePath, evidence: JSON.parse(readFileSync(evidencePath, 'utf8')) }
}

// ── Fallback deploy path: miniprogram-ci ──
// Subject to WeChat CI IP 白名单 (mp.weixin.qq.com → 开发管理 → 代码上传)
// Prone to IPv6/transparent-proxy issues despite DNS patching.
async function deployCloudViaMiniprogramCi(fns, options = {}) {
  const envId = getCloudEnvId()
  for (const fn of fns) {
    console.log(`[miniprogram-ci] Uploading: ${fn}`)
    await runOptionalDirectRemoteMutation(options, async () => await ci.cloud.uploadFunction({
      project: getCiProject(),
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: envId,
      remoteNpmInstall: true,
    }))
    console.log(`  OK: ${fn}`)
  }
}

async function deployCloud(options = {}) {
  const requireCloudBaseCli = options.requireCloudBaseCli === true
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const onlyList = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null
  const plannedFunctions = Array.isArray(options.functions) ? options.functions : null
  const fns = plannedFunctions
    ? CLOUD_FUNCTIONS.filter((f) => plannedFunctions.includes(f))
    : onlyList && onlyList.length
    ? CLOUD_FUNCTIONS.filter((f) => onlyList.includes(f))
    : CLOUD_FUNCTIONS
  if (!fns.length) throw new Error('No cloud functions selected for deployment')
  if (plannedFunctions) console.log(`Release plan selected: ${fns.join(', ')}`)
  if (onlyList) console.log(`Filtering to: ${fns.join(', ')}`)

  if (!options.skipBuild) buildCloudArtifacts(fns, options.sourceSha || process.env.HH_RELEASE_SOURCE_SHA || 'unknown')

  const forceCi = process.argv.includes('--use-ci')
  const forceTcb = process.argv.includes('--use-tcb')

  if (forceTcb) {
    console.log('\n[--use-tcb] Attempting deploy via CloudBase CLI...')
    const tcbResult = await deployCloudViaCloudBaseCli(fns, options)
    if (tcbResult.ok) {
      console.log('[OK] Cloud functions deployed via CloudBase CLI')
      return { fns, path: 'cloudbase-cli', concurrency: tcbResult.concurrency, functionResults: tcbResult.functionResults || [] }
    }
    if (requireCloudBaseCli) {
      const error = new Error(`Formal release CloudBase CLI/COS deploy failed: ${tcbResult.reason}`)
      error.result = {
        path: 'cloudbase-cli',
        status: 'failed',
        fns,
        concurrency: tcbResult.concurrency,
        functionResults: tcbResult.functionResults || [],
      }
      throw error
    }
    const nextPath = forceCi ? 'falling back to miniprogram-ci' : 'trying WeChat DevTools CLI'
    console.log(`[!] CloudBase CLI failed (${tcbResult.reason}) - ${nextPath}`)
  }

  if (!forceCi) {
    console.log('\n[primary] Attempting deploy via WeChat DevTools CLI...')
    const result = await runOptionalDirectRemoteMutation(options, async () => await deployCloudViaDevtoolsCli(fns))
    if (result.ok) {
      console.log('[OK] Cloud functions deployed via DevTools CLI')
      return { fns, path: 'devtools-cli' }
    }
    if (!shouldFallbackAfterDevtoolsFailure({ target: 'cloud', reason: result.reason, forceCi })) {
      throw new Error(`DevTools CLI cloud deploy failed (${result.reason}). Open WeChat DevTools, log in again, then retry deploy.`)
    }
    if (!forceTcb) {
      console.log(`[!] DevTools CLI failed (${result.reason}) - trying CloudBase CLI`)

      console.log('\n[fallback] Attempting deploy via CloudBase CLI...')
      const tcbResult = await deployCloudViaCloudBaseCli(fns, options)
      if (tcbResult.ok) {
        console.log('[OK] Cloud functions deployed via CloudBase CLI')
        return { fns, path: 'cloudbase-cli', concurrency: tcbResult.concurrency, functionResults: tcbResult.functionResults || [] }
      }
      console.log(`[!] CloudBase CLI failed (${tcbResult.reason}) - falling back to miniprogram-ci`)
    } else {
      console.log(`[!] DevTools CLI failed (${result.reason}) - falling back to miniprogram-ci`)
    }
  } else {
    console.log('\n[--use-ci] Skipping DevTools CLI and CloudBase CLI, using miniprogram-ci directly')
  }

  console.log('\n[fallback] Deploying via miniprogram-ci...')
  await deployCloudViaMiniprogramCi(fns, options)
  console.log('[OK] Cloud functions deployed via miniprogram-ci')
  return { fns, path: 'miniprogram-ci' }
}

function buildCloudArtifacts(functions, sourceSha) {
  console.log('\nBuilding cloud functions...')
  execSync('node build.mjs', {
    cwd: resolve(ROOT, 'cloud'),
    stdio: 'inherit',
    env: {
      ...process.env,
      HH_CLOUD_BUILD_ONLY: functions.length < CLOUD_FUNCTIONS.length ? functions.join(',') : '',
      HH_RELEASE_SOURCE_SHA: sourceSha,
    },
  })
}

async function runCloudSmoke(fns, releaseRunId = '', options = {}) {
  const parsedSmokeArgs = parseCloudSmokeArgs(process.argv.slice(3))
  const smokeOptions = {
    ...parsedSmokeArgs,
    envId: getCloudEnvId(),
    only: fns,
    runId: releaseRunId || parsedSmokeArgs.runId,
    evidenceDir: releaseRunId
      ? resolve(ROOT, '.codex-local', 'release-evidence', releaseRunId, 'cloud-smoke')
      : parsedSmokeArgs.evidenceDir,
    concurrency: getCloudSmokeConcurrency(),
    beforeCommand: options.beforeSmokeCommand,
    beforeCleanupCommand: options.beforeFixtureCleanup,
  }
  if (options.ensureIndexes !== false) {
    console.log('\nEnsuring release database collections and indexes...')
    if (typeof options.beforeEnsureIndexes === 'function') await options.beforeEnsureIndexes()
    execSync('npm.cmd run ensure:indexes', {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, TCB_ENV: smokeOptions.envId },
    })
  }
  console.log('\nRunning cloud release smoke and log capture...')
  const summary = await runCloudReleaseSmoke(smokeOptions)
  if (summary.status !== 'passed') {
    throw new Error(`Cloud release smoke failed. See ${summary.evidenceDir}`)
  }
  console.log(`[OK] Cloud release smoke passed: ${summary.evidenceDir}`)
  return summary
}

// ── Primary preview path: WeChat DevTools CLI `preview` ──
// 跟 deployCloudViaDevtoolsCli 同源：走 IDE 内部网络栈，绕开 miniprogram-ci 撞
// IPv6 / 透明代理 / WeChat CI 白名单的一切老坑（2026-04-24 血泪教训：那天
// `ci.preview()` 在本机再次被 `-10008 invalid ip: 2409:...` 拦下）。
// 云端请求保持显式 IPv4 策略。
async function deployMiniprogramViaDevtoolsCli() {
  const cli = findDevtoolsCli()
  if (!cli) return { ok: false, reason: 'DevTools CLI not found at known paths (set WX_DEVTOOLS_CLI env to override)' }

  const qrPath = resolve(ROOT, 'preview-qr.png')
  const infoPath = resolve(ROOT, 'preview-info.json')
  const args = [
    'preview',
    '--project', MP_DIST,
    '--qr-format', 'terminal',
    '--qr-output', qrPath,
    '--info-output', infoPath,
  ]

  const commandLine = [cli, ...args].map(quote).join(' ')
  console.log(`[DevTools CLI] ${commandLine}`)

  return await new Promise((res) => {
    const proc = spawn(commandLine, { stdio: 'inherit', shell: true })
    proc.on('exit', (code) => res({ ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}` }))
    proc.on('error', (err) => res({ ok: false, reason: String(err?.message || err) }))
  })
}

async function uploadMiniprogramViaDevtoolsCli(version, desc) {
  const cli = findDevtoolsCli()
  if (!cli) return { ok: false, reason: 'DevTools CLI not found at known paths (set WX_DEVTOOLS_CLI env to override)' }

  const infoPath = resolve(ROOT, 'mp-upload-info.json')
  rmSync(infoPath, { force: true })
  const args = [
    'upload',
    '--project', MP_DIST,
    '--version', version,
    '--desc', desc,
    '--info-output', infoPath,
  ]

  const commandLine = [cli, ...args].map(quote).join(' ')
  console.log(`[DevTools CLI] ${commandLine}`)
  const uploadStartedAtMs = Date.now()
  const result = await runShellCapture(commandLine)
  if (!result.ok) return result

  const output = result.output || ''
  const semantic = analyzeDevtoolsUploadOutput(output)
  if (!semantic.ok) {
    const loginHint = semantic.reason.includes('IDE login/signing problem')
      ? '; open WeChat DevTools, log in again, then retry upload'
      : ''
    return {
      ok: false,
      reason: `DevTools CLI upload failed: ${semantic.reason}${loginHint}`,
    }
  }
  if (!existsSync(infoPath)) return { ok: false, reason: 'DevTools CLI upload info file was not created' }
  const receiptStat = statSync(infoPath)
  const receipt = analyzeDevtoolsUploadInfo({
    isFile: receiptStat.isFile(),
    size: receiptStat.size,
    mtimeMs: receiptStat.mtimeMs,
  }, uploadStartedAtMs)
  if (!receipt.ok) return { ok: false, reason: `DevTools CLI upload receipt failed: ${receipt.reason}` }
  return {
    ok: true,
    reason: `ok; info-output=${infoPath}`,
    uploadInfoSize: receiptStat.size,
    uploadInfoMtimeMs: receiptStat.mtimeMs,
    uploadStartedAtMs,
  }
}

async function uploadMiniprogramViaMiniprogramCi(version, desc) {
  console.log('Uploading miniprogram via miniprogram-ci...')
  const receipt = await ci.upload({
    project: getCiProject(),
    version,
    desc,
    setting: { es6: true, minified: false },
  })
  console.log('Miniprogram upload finished via miniprogram-ci')
  return receipt
}

function resolveMiniprogramUploadMetadata(defaults = {}) {
  const stamp = getLocalTimestamp()
  const shortSha = getShortGitSha()
  return {
    version: getFlagValue('version') || defaults.version || `1.0.${stamp.yy}${stamp.MM}${stamp.dd}${stamp.hh}${stamp.mm}`,
    desc: getFlagValue('desc') || defaults.desc || `trial ${stamp.yyyy}-${stamp.MM}-${stamp.dd} ${stamp.hh}:${stamp.mm} ${shortSha}`,
    forceCi: process.argv.includes('--use-ci'),
  }
}

async function buildAndGateMiniprogramUpload({ version, desc, releaseRunId, gitSha = '', devToolsVersion = '' }) {
  writeMiniprogramBuildInfo(version, desc)

  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  const packageDigest = await computeDirectoryDigest(MP_DIST)
  const releaseUiEvidenceDir = resolve(ROOT, '.codex-local', 'release-evidence', releaseRunId, 'release-ui')

  console.log('\nRunning miniprogram release gate...')
  execSync('npm run test:mp:release-gate -- --skip-mp-build', {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      HH_RELEASE_RUN_ID: releaseRunId,
      HH_RELEASE_PACKAGE_DIGEST: packageDigest,
      HH_RELEASE_UI_EVIDENCE_DIR: releaseUiEvidenceDir,
      HH_RELEASE_GIT_SHA: gitSha,
      HH_RELEASE_DEVTOOLS_VERSION: devToolsVersion,
      HH_RELEASE_VERSION: version,
      WECHAT_DEVTOOLS_PROJECT_PATH: MP_DIST,
    },
  })
  return {
    packageRoot: MP_DIST,
    packageDigest,
    releaseUiEvidencePath: resolve(releaseUiEvidenceDir, 'release-ui-evidence.json'),
  }
}

async function runReleaseUiQualification() {
  const purpose = 'release-ui-qualify'
  const version = getRequiredFlagValue('version', purpose)
  const desc = getRequiredFlagValue('desc', purpose)
  const qualificationPath = getRequiredFlagValue('ui-qualification', purpose)
  if (!isAbsolute(qualificationPath)) throw new Error('release-ui-qualify requires an absolute --ui-qualification path')
  const gitSha = getGitSha()
  if (!/^[0-9a-f]{40}$/i.test(gitSha)) throw new Error('release-ui-qualify could not resolve the exact Git SHA')
  const devToolsVersion = readWechatDevToolsVersion()
  const prepared = await buildAndGateMiniprogramUpload({
    version,
    desc,
    releaseRunId: `ui-qualification-${makeReleaseRunId()}`,
    gitSha,
    devToolsVersion,
  })
  const qualification = await writeReleaseUiQualification({
    root: ROOT,
    outputPath: qualificationPath,
    gitSha,
    version,
    desc,
    packageRoot: prepared.packageRoot,
    devToolsVersion,
    sourceBuildInfoPath: resolve(ROOT, 'miniprogram', 'src', 'generated', 'build-info.ts'),
    distBuildInfoPath: resolve(prepared.packageRoot, 'generated', 'build-info.js'),
    uiEvidencePath: prepared.releaseUiEvidencePath,
  })
  console.log(`[OK] release UI qualification written: ${qualificationPath}`)
  return qualification
}

async function uploadBuiltMiniprogram({ version, desc, forceCi, beforeRemoteMutation }) {
  const options = { beforeRemoteMutation }
  console.log(`\nMiniprogram upload version: ${version}`)
  console.log(`Miniprogram upload desc: ${desc}`)

  if (!forceCi) {
    console.log('\n[primary] Uploading via WeChat DevTools CLI...')
    const result = await runOptionalDirectRemoteMutation(options, async () => await uploadMiniprogramViaDevtoolsCli(version, desc))
    if (result.ok) {
      console.log('[OK] Miniprogram uploaded via DevTools CLI (no preview QR generated)')
      return {
        method: 'devtools-cli',
        uploadInfoPath: resolve(ROOT, 'mp-upload-info.json'),
        uploadInfoSize: result.uploadInfoSize,
        uploadInfoMtimeMs: result.uploadInfoMtimeMs,
        uploadStartedAtMs: result.uploadStartedAtMs,
      }
    }
    if (!shouldFallbackAfterDevtoolsFailure({ target: 'miniprogram-upload', reason: result.reason, forceCi })) {
      throw new Error(`DevTools CLI upload failed (${result.reason}). Open WeChat DevTools, log in again if needed, then retry upload. miniprogram-ci fallback is only allowed with --use-ci.`)
    }
    console.log(`[!] DevTools CLI upload failed (${result.reason}) - falling back to miniprogram-ci`)
  } else {
    console.log('\n[--use-ci] Skipping DevTools CLI, using miniprogram-ci directly')
  }

  const receipt = await runOptionalDirectRemoteMutation(options, async () => await uploadMiniprogramViaMiniprogramCi(version, desc))
  console.log('[OK] Miniprogram uploaded via miniprogram-ci')
  return { method: 'miniprogram-ci', uploadInfoPath: '', receipt }
}

// ── Fallback preview path: miniprogram-ci ──
// 撞 IPv6/透明代理/WeChat CI 白名单的概率跟 cloud.uploadFunction 一样高。
async function deployMiniprogramViaMiniprogramCi() {
  console.log('Generating preview QR code via miniprogram-ci...')
  await ci.preview({
    project: getCiProject(),
    desc: 'auto preview',
    setting: { es6: true, minified: false },
    qrcodeFormat: 'terminal',
    qrcodeOutputDest: resolve(ROOT, 'preview-qr.jpg'),
  })
  console.log('Miniprogram preview ready! Scan preview-qr.jpg')
}

async function deployMiniprogram(options = {}) {
  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  const forceCi = process.argv.includes('--use-ci')

  if (!forceCi) {
    console.log('\n[primary] Generating preview via WeChat DevTools CLI...')
    const result = await runOptionalDirectRemoteMutation(options, async () => await deployMiniprogramViaDevtoolsCli())
    if (result.ok) {
      console.log('[✓] Miniprogram preview ready via DevTools CLI (preview-qr.png + preview-info.json)')
      return
    }
    console.log(`[!] DevTools CLI failed (${result.reason}) — falling back to miniprogram-ci`)
  } else {
    console.log('\n[--use-ci] Skipping DevTools CLI, using miniprogram-ci directly')
  }

  await runOptionalDirectRemoteMutation(options, async () => await deployMiniprogramViaMiniprogramCi())
  console.log('[✓] Miniprogram preview ready via miniprogram-ci')
}

async function uploadMiniprogram(options = {}) {
  const upload = resolveMiniprogramUploadMetadata()
  await buildAndGateMiniprogramUpload({ ...upload, releaseRunId: makeReleaseRunId() })
  const beforeRemoteMutation = typeof options.beforeRemoteMutation === 'function'
    ? () => assertDirectProductionDeployWorkspace({
        publishOnly: true,
        version: upload.version,
        desc: upload.desc,
      })
    : undefined
  await uploadBuiltMiniprogram({ ...upload, beforeRemoteMutation })
}

function buildAdminWeb(defaultRouterMode) {
  console.log('\nBuilding admin-web...')
  const env = { ...process.env, ...resolveAdminBuildEnvironment(defaultRouterMode) }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execSync(`${npm} run build`, { cwd: ADMIN_WEB_DIR, stdio: 'inherit', env })
  return env
}

async function inspectAdminWebPublication() {
  const target = (process.env.ADMIN_WEB_TARGET || 'aliyun').toLowerCase()
  if (target !== 'aliyun') throw new Error(`admin-web target ${target} has no reliable publication identity readback`)
  const script = `set -euo pipefail
current=${JSON.stringify(`${ADMIN_WEB_ALIYUN_ROOT}/current`)}
manifest="$current/.happyhome-file-manifest.sha256"
marker="$current/.happyhome-release.json"
test -f "$manifest" -a -f "$marker"
expected_manifest_sha="$(sed -nE 's/.*"fileManifestDigest":"([0-9a-f]{64})".*/\\1/p' "$marker")"
actual_manifest_sha="$(sha256sum "$manifest" | awk '{print $1}')"
test -n "$expected_manifest_sha" -a "$actual_manifest_sha" = "$expected_manifest_sha"
expected_files="$(mktemp)"
actual_files="$(mktemp)"
trap 'rm -f "$expected_files" "$actual_files"' EXIT
sed -E 's/^[0-9a-f]{64}  //' "$manifest" | LC_ALL=C sort > "$expected_files"
(cd "$current" && find . -type f ! -name '.happyhome-file-manifest.sha256' ! -name '.happyhome-release.json' -printf '%P\\n' | LC_ALL=C sort) > "$actual_files"
diff -u "$expected_files" "$actual_files" >/dev/null
(cd "$current" && sha256sum -c '.happyhome-file-manifest.sha256' >/dev/null)
cat "$marker"`
  const result = await runShellCapture(`ssh ${quote(ADMIN_WEB_ALIYUN_HOST)} ${quote(script)}`, { silentOutput: true })
  if (!result.ok) throw new Error(`admin-web publication identity readback failed: ${result.reason}`)
  return { ...JSON.parse(result.output), fileManifestDigestVerified: true, runtimeVerified: true }
}

async function deployAdminWebToCloudBase(options = {}) {
  const env = options.skipBuild ? process.env : buildAdminWeb('hash')
  const artifactRoot = options.artifactRoot || ADMIN_WEB_DIST
  const expectedDigest = options.artifact?.contentDigest || await computeDirectoryDigest(artifactRoot)
  const cloudPath = process.env.ADMIN_WEB_CLOUD_PATH || '/'
  const envId = getCloudEnvId()
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const args = [
    npx,
    '--yes',
    '--package',
    '@cloudbase/cli',
    'cloudbase',
    'hosting',
    'deploy',
    artifactRoot,
  ]
  if (cloudPath && cloudPath !== '/') args.push(cloudPath)
  args.push('-e', envId)

  console.log('\nDeploying admin-web dist to CloudBase static hosting...')
  console.log(`Using VITE_CLOUD_API_URL=${env.VITE_CLOUD_API_URL}`)
  const [result] = await runOptionalDirectRemoteMutation(options, async () => await runPinnedAdminArtifactMutation({
    artifactRoot,
    expectedDigest,
    runners: [async () => await runShell(args.map(quote).join(' '))],
  }))
  if (!result.ok) {
    throw new Error(`Admin web deploy failed: ${result.reason}. Ensure CloudBase CLI is logged in and static hosting is enabled for ${envId}.`)
  }
  console.log('[OK] Admin web deployed to CloudBase static hosting')
  console.log('Reminder: configure static hosting fallback/error page to index.html for Vue history routes.')
}

async function deployAdminWebToAliyun(options = {}) {
  const env = options.skipBuild ? process.env : buildAdminWeb('history')
  const stamp = Date.now()
  const archivePath = join(tmpdir(), `happyhome-admin-web-${stamp}.tgz`)
  const remoteArchivePath = `/tmp/happyhome-admin-web-${stamp}.tgz`
  const remoteScriptPath = `/tmp/deploy-happyhome-admin-${stamp}.sh`
  const localScriptPath = join(tmpdir(), `deploy-happyhome-admin-${stamp}.sh`)
  const stagingRoot = join(tmpdir(), `happyhome-admin-web-${stamp}`)
  let artifactMarker = ''
  const artifactRoot = options.artifactRoot || ADMIN_WEB_DIST
  const expectedDigest = options.artifact?.contentDigest || await computeDirectoryDigest(artifactRoot)

  console.log('\nPacking admin-web dist...')
  // --force-local: 在 Windows + Git Bash 下，tar 会把 "X:\..." 当成 remote host:path 解析失败。
  // 这个 flag 强制把带冒号的路径当本地路径处理。
  const tarHelp = execSync('tar --help', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const forceLocalFlag = tarHelp.includes('--force-local') ? '--force-local ' : ''
  // Git Bash tar needs --force-local for Windows drive-letter paths; Windows tar rejects it.

  console.log('\nDeploying admin-web dist to Aliyun Nginx host...')
  console.log(`Using VITE_CLOUD_API_URL=${env.VITE_CLOUD_API_URL}`)
  console.log(`Using VITE_ROUTER_MODE=${env.VITE_ROUTER_MODE}`)
  console.log(`Using ADMIN_WEB_SSH_HOST=${ADMIN_WEB_ALIYUN_HOST}`)
  let expectedArchiveDigest = ''
  let expectedScriptDigest = ''
  try {
    await runOptionalDirectRemoteMutation(options, async () => await runPinnedAdminArtifactMutation({
      artifactRoot,
      expectedDigest,
      runners: [async () => {
        rmSync(stagingRoot, { recursive: true, force: true })
        cpSync(artifactRoot, stagingRoot, { recursive: true, errorOnExist: true })
        const stagedDigest = await computeDirectoryDigest(stagingRoot)
        if (stagedDigest !== expectedDigest) throw new Error('immutable admin-web staging digest mismatch')
        const fileManifestPath = join(stagingRoot, '.happyhome-file-manifest.sha256')
        writeFileSync(fileManifestPath, await createDeterministicFileManifest(stagingRoot), 'utf8')
        artifactMarker = Buffer.from(JSON.stringify({
          componentDigest: options.artifact?.componentDigest || '',
          contentDigest: options.artifact?.contentDigest || '',
          fileManifestDigest: await computeFileSha256(fileManifestPath),
          runId: options.artifact?.runId || '',
          sourceSha: options.artifact?.sourceSha || '',
          versionId: options.artifact?.versionId || '',
        })).toString('base64')
        execSync(`tar ${forceLocalFlag}-czf ${quote(archivePath)} -C ${quote(stagingRoot)} .`, { cwd: ROOT, stdio: 'inherit' })
        expectedArchiveDigest = await computeFileSha256(archivePath)
      }],
    }))

    const remoteScript = `#!/usr/bin/env bash
set -euo pipefail
root=${JSON.stringify(ADMIN_WEB_ALIYUN_ROOT)}
archive=${JSON.stringify(remoteArchivePath)}
expected_archive_sha=${JSON.stringify(expectedArchiveDigest)}
actual_archive_sha="$(sha256sum "$archive" | awk '{print $1}')"
test "$actual_archive_sha" = "$expected_archive_sha"
release="$root/releases/$(date +%Y%m%d%H%M%S)"
sudo mkdir -p "$release"
sudo tar -xzf "$archive" -C "$release"
manifest="$release/.happyhome-file-manifest.sha256"
test -f "$manifest"
expected_files="$(mktemp)"
actual_files="$(mktemp)"
sed -E 's/^[0-9a-f]{64}  //' "$manifest" | LC_ALL=C sort > "$expected_files"
(cd "$release" && find . -type f ! -name '.happyhome-file-manifest.sha256' -printf '%P\\n' | LC_ALL=C sort) > "$actual_files"
diff -u "$expected_files" "$actual_files"
(cd "$release" && sha256sum -c '.happyhome-file-manifest.sha256')
rm -f "$expected_files" "$actual_files"
sudo chown -R root:root "$release"
sudo find "$release" -type d -exec chmod 755 {} \\;
sudo find "$release" -type f -exec chmod 644 {} \\;
echo ${JSON.stringify(artifactMarker)} | base64 -d | sudo tee "$release/.happyhome-release.json" >/dev/null
sudo ln -sfn "$release" "$root/current"
sudo nginx -t
sudo systemctl reload nginx
rm -f "$archive" ${JSON.stringify(remoteScriptPath)}
echo "[OK] Admin web deployed to $release"
readlink -f "$root/current"
`
    writeFileSync(localScriptPath, remoteScript, 'utf8')
    expectedScriptDigest = await computeFileSha256(localScriptPath)
    const remoteLaunchCommand = [
      `actual_script_sha=$(sha256sum ${quote(remoteScriptPath)} | awk '{print $1}')`,
      `test "$actual_script_sha" = ${quote(expectedScriptDigest)}`,
      `bash ${quote(remoteScriptPath)}`,
    ].join(' && ')

    const [uploadArchive] = await runOptionalDirectRemoteMutation(options, async () => await runPinnedAdminArchiveMutation({
      artifactRoot, expectedDigest, archivePath, expectedArchiveDigest, scriptPath: localScriptPath, expectedScriptDigest,
      runners: [async () => await runShell(`scp ${quote(archivePath)} ${quote(`${ADMIN_WEB_ALIYUN_HOST}:${remoteArchivePath}`)}`)],
    }))
    if (!uploadArchive.ok) throw new Error(`Admin web archive upload failed: ${uploadArchive.reason}`)
    const [uploadScript] = await runOptionalDirectRemoteMutation(options, async () => await runPinnedAdminArchiveMutation({
      artifactRoot, expectedDigest, archivePath, expectedArchiveDigest, scriptPath: localScriptPath, expectedScriptDigest,
      runners: [async () => await runShell(`scp ${quote(localScriptPath)} ${quote(`${ADMIN_WEB_ALIYUN_HOST}:${remoteScriptPath}`)}`)],
    }))
    if (!uploadScript.ok) throw new Error(`Admin web deploy script upload failed: ${uploadScript.reason}`)
    const [deploy] = await runOptionalDirectRemoteMutation(options, async () => await runPinnedAdminArchiveMutation({
      artifactRoot, expectedDigest, archivePath, expectedArchiveDigest, scriptPath: localScriptPath, expectedScriptDigest,
      runners: [async () => await runShell(`ssh ${quote(ADMIN_WEB_ALIYUN_HOST)} ${quote(remoteLaunchCommand)}`)],
    }))
    if (!deploy.ok) throw new Error(`Admin web Aliyun deploy failed: ${deploy.reason}`)
    console.log('[OK] Admin web deployed to Aliyun Nginx host')
  } finally {
    rmSync(archivePath, { force: true })
    rmSync(localScriptPath, { force: true })
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

async function ensureAdminUploadCors(options = {}) {
  const scriptPath = resolve(ROOT, 'scripts/ensure-cos-cors.mjs')
  console.log('\nEnsuring COS CORS for admin browser uploads...')
  const result = await runOptionalDirectRemoteMutation(
    options,
    async () => await runShell(`${quote(process.execPath)} ${quote(scriptPath)}`),
  )
  if (!result.ok) throw new Error(`Admin upload COS CORS configuration failed: ${result.reason}`)
}

async function deployAdminWeb(options = {}) {
  await ensureAdminUploadCors(options)
  const target = (process.env.ADMIN_WEB_TARGET || 'aliyun').toLowerCase()
  if (target === 'cloudbase') return deployAdminWebToCloudBase(options)
  if (target === 'aliyun') return deployAdminWebToAliyun(options)
  throw new Error(`Unknown ADMIN_WEB_TARGET=${target}. Expected aliyun or cloudbase.`)
}

async function collectMiniprogramBuildGateEvidence(preparedEvidence = {}) {
  const releaseUiEvidencePath = preparedEvidence.releaseUiEvidencePath || await findLatestReleaseUiEvidence(ROOT)
  return {
    buildInfoPath: resolve(ROOT, 'miniprogram/src/generated/build-info.ts'),
    distBuildInfoPath: resolve(ROOT, 'miniprogram/dist/build/mp-weixin/generated/build-info.js'),
    packageRoot: preparedEvidence.packageRoot || MP_DIST,
    packageDigest: preparedEvidence.packageDigest || await computeDirectoryDigest(MP_DIST),
    ...(preparedEvidence.qualificationPath ? {
      qualificationPath: preparedEvidence.qualificationPath,
      qualificationDigest: preparedEvidence.qualificationDigest,
      devToolsVersion: preparedEvidence.devToolsVersion,
    } : {}),
    ...(releaseUiEvidencePath ? { releaseUiEvidencePath } : {}),
  }
}

async function inspectExplicitUiQualification(qualificationPath, releaseContext) {
  const inspected = await inspectReleaseUiQualification({
    qualificationPath,
    root: ROOT,
    expected: {
      gitSha: releaseContext.gitSha,
      version: releaseContext.version,
      desc: releaseContext.desc,
    },
    currentDevToolsVersion: releaseContext.devToolsVersion,
  })
  return {
    packageRoot: inspected.packageRoot,
    packageDigest: inspected.packageDigest,
    releaseUiEvidencePath: inspected.uiEvidencePath,
    qualificationPath: inspected.qualificationPath,
    qualificationDigest: await computeFileSha256(inspected.qualificationPath),
    devToolsVersion: inspected.devToolsVersion,
  }
}

function releaseStageReuseCheck(context) {
  return async (runState, stageName) => {
    const reuse = await inspectReleaseStageReuse(runState, stageName, context)
    if (reuse.reusable && mustRevalidateRemoteReleaseStage(stageName)) {
      return { reusable: false, reason: `${stageName} remote state must be revalidated` }
    }
    return reuse
  }
}

function createFormalReleasePlan(gitSha, releaseStrategy, publishResume, forceRedeployCurrent = false) {
  const args = ['scripts/release-plan.mjs', `--mode=${releaseStrategy}`, `--head=${gitSha}`]
  if (forceRedeployCurrent) args.push('--force-redeploy-current')
  if (process.env.HH_RELEASE_INCLUDE_RAG === '1') args.push('--include-rag')
  if (publishResume) {
    args.push('--publish-resume', `--version=${publishResume.version}`, `--desc=${publishResume.desc}`)
  }
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `exit ${result.status}`
    throw new Error(`Formal release plan failed: ${detail}`)
  }
  if (result.stdout) process.stdout.write(result.stdout)
  const planPath = resolve(ROOT, '.codex-local', 'release-plans', `${gitSha}.json`)
  if (!existsSync(planPath)) throw new Error(`Formal release plan did not write ${planPath}`)
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const expectedPlanningStrategy = releaseStrategy === 'full-current'
    ? 'full-current'
    : plan.bootstrap ? 'bootstrap' : 'incremental'
  if (plan.mode !== releaseStrategy || plan.planningStrategy !== expectedPlanningStrategy || plan.headSha !== gitSha ||
    plan.forceRedeployCurrent !== forceRedeployCurrent || !plan.releaseRequired) {
    throw new Error('Formal release plan is missing, stale, or does not require a release')
  }
  return plan
}

function createProductionReleaseGuard(releaseContext, plan) {
  const store = createProductionReleaseStore({ root: ROOT })
  const governance = new ReleaseGovernance({ store })
  return new ProductionReleaseGuard({
    governance,
    gitSha: releaseContext.gitSha,
    owner: `formal-release:${process.env.COMPUTERNAME || process.env.HOSTNAME || 'unknown'}:${process.pid}`,
    plan,
    runId: releaseContext.runId,
  })
}

function releaseComponents({ adminDeployed, artifactManifest, cloudDeploy, plan, productionComponents }) {
  const plannedFunctions = cloudDeploy?.fns || []
  const functions = selectCloudProductionBindings({
    artifactManifest,
    currentBoundFunctions: cloudDeploy?.currentBoundFns || [],
    deployedFunctions: cloudDeploy?.deployedFns || [],
    plannedFunctions,
    priorFunctions: productionComponents?.cloud?.functions || {},
  })
  return {
    adminWeb: plan.targets.adminWeb ? selectStableProductionBinding({
      component: 'admin-web',
      current: artifactManifest.artifacts.adminWeb,
      mutated: adminDeployed,
      prior: productionComponents?.adminWeb,
      runId: artifactManifest.runId,
    }) : null,
    cloud: { functions },
    miniprogram: plan.targets.miniprogram ? selectStableProductionBinding({
      component: 'miniprogram',
      current: artifactManifest.artifacts.miniprogram,
      mutated: true,
      prior: productionComponents?.miniprogram,
      runId: artifactManifest.runId,
    }) : null,
  }
}

function cloudComponentLedgerOutcome({ artifact, attestation, deployed, prior, runId }) {
  return {
    ...attestation,
    artifactRunId: attestation.bindingSource === 'prior' && !deployed ? prior?.artifactRunId || '' : runId,
    componentDigest: artifact.componentDigest,
    runtimeDigest: artifact.runtimeDigest,
    status: deployed ? 'verified' : attestation.status,
    evidence: { deployed, freshProbeVerified: true },
  }
}

function readCloudReleaseProbes(functions) {
  return functions.map((functionName) => {
    const path = resolve(CLOUD_DIST, functionName, '__release.info.json')
    if (!existsSync(path)) throw new Error(`cloud release probe is missing for ${functionName}`)
    const probe = JSON.parse(readFileSync(path, 'utf8'))
    if (probe.functionName !== functionName || !/^[a-f0-9]{64}$/i.test(String(probe.probeToken || ''))) {
      throw new Error(`cloud release probe is invalid for ${functionName}`)
    }
    return probe
  })
}

async function verifyCloudReleaseProbes(probes) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const envId = getCloudEnvId()
  const verified = []
  for (const probe of probes) {
    const payloadPath = join(tmpdir(), `happyhome-release-probe-${probe.functionName}-${Date.now()}.json`)
    const payloadArgument = `"@${payloadPath}"`
    writeFileSync(payloadPath, JSON.stringify({ __happyhomeReleaseProbe: probe.probeToken }), 'utf8')
    try {
      const commandLine = [npx, '--yes', '--package', '@cloudbase/cli', 'tcb', 'fn', 'invoke', probe.functionName,
        '-d', payloadArgument, '--env-id', envId, '--json'].map(quote).join(' ')
      const result = await runCloudBaseCliCaptureWithRetry(commandLine, {
        displayCommandLine: `tcb fn invoke ${probe.functionName} <release-probe> --env-id ${envId} --json`,
        silentOutput: true,
      })
      const response = parseCliJson(result.output)
      if (!result.ok || !hasCloudReleaseProbeResponse(response, probe)) {
        throw new Error(`release probe verification failed for ${probe.functionName}`)
      }
      verified.push(probe.response)
    } finally {
      rmSync(payloadPath, { force: true })
    }
  }
  return verified
}

async function invokeCloudReleaseProbe({ artifact, functionName, probeToken, signal, stableAttestation = false }) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const envId = getCloudEnvId()
  const payloadPath = join(tmpdir(), `happyhome-release-attestation-${functionName}-${Date.now()}.json`)
  writeFileSync(payloadPath, JSON.stringify({ __happyhomeReleaseProbe: probeToken }), 'utf8')
  try {
    const commandLine = [npx, '--yes', '--package', '@cloudbase/cli', 'tcb', 'fn', 'invoke', functionName,
      '-d', `"@${payloadPath}"`, '--env-id', envId, '--json'].map(quote).join(' ')
    const result = await runCloudBaseCliCaptureWithRetry(commandLine, {
      displayCommandLine: `tcb fn invoke ${functionName} <release-attestation> --env-id ${envId} --json`,
      signal,
      silentOutput: true,
    })
    if (!result.ok) throw new Error(`fresh release probe failed for ${functionName}: ${result.reason}`)
    const response = parseCliJson(result.output)
    const matches = stableAttestation
      ? hasCloudReleaseComponentAttestationResponse(response, artifact)
      : hasCloudReleaseProbeResponse(response, artifact)
    if (!matches) throw new Error(`fresh release probe response mismatch for ${functionName}`)
    return { ...artifact, runtimeVerified: true }
  } finally {
    rmSync(payloadPath, { force: true })
  }
}

const RELEASE_ACTION_SCRIPTS = Object.freeze({
  'configure-rag-workers': 'configure:rag-workers',
  'ensure-indexes': 'ensure:indexes',
  'update-rag-env': 'update:rag-env',
})

function runReleaseNpmScript(script, env = {}, args = []) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const child = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', script, ...(args.length ? ['--', ...args] : [])], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      shell: isWindows,
      stdio: 'inherit',
      windowsHide: isWindows,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`release action npm run ${script} failed with ${signal || `exit ${code}`}`))
    })
  })
}

async function runDeclaredReleaseAction(action) {
  const script = RELEASE_ACTION_SCRIPTS[action]
  if (!script) throw new Error(`release action has no approved command: ${action}`)
  await runReleaseNpmScript(script)
}

async function runDeclaredReleaseMigration(migration, releaseContext) {
  const modulePath = verifyMigrationInputFile({ root: ROOT, migration })
  const migrationModule = await import(pathToFileURL(modulePath).href)
  const up = migrationModule.up || migrationModule.default
  if (typeof up !== 'function') throw new Error(`migration ${migration.id} must export up() or default()`)
  await up({ root: ROOT, releaseContext })
}

async function runFormalRelease(options = {}) {
  assertNoFormalReleaseOnlyFilter()
  execSync('git fetch --quiet origin main', { cwd: ROOT, stdio: 'inherit' })

  const prepareOnly = options.prepareOnly === true
  assertFormalReleaseCloudBasePath({ prepareOnly })

  const publishOnly = options.publishOnly === true
  const uiQualificationPath = getFlagValue('ui-qualification').trim()
  if (uiQualificationPath && !isAbsolute(uiQualificationPath)) throw new Error('--ui-qualification must be an absolute path')
  if (uiQualificationPath && !prepareOnly) throw new Error('--ui-qualification is accepted only by release-prepare')
  const fullCurrentExplicit = hasFlag('full-current')
  const releaseStrategy = fullCurrentExplicit ? 'full-current' : 'main'
  const forceRedeployCurrent = hasFlag('force-redeploy-current')
  if (forceRedeployCurrent && !fullCurrentExplicit) throw new Error('--force-redeploy-current requires explicit --full-current')
  if (publishOnly && !getExplicitReleaseRunId()) {
    throw new Error('release-publish requires an explicit --release-run-id=<id> or HH_RELEASE_RUN_ID; refusing implicit latest.')
  }
  const forceResume = publishOnly
  const resumeRunState = await getResumeRunState(forceResume)
  const miniprogramUpload = resolveMiniprogramUploadMetadata(resumeRunState?.context || {})
  assertFormalReleaseGitState(getFormalReleaseGitState({
    releaseStrategy,
    fullCurrentExplicit,
    publishOnly,
    allowReleaseBuildInfo: Boolean(uiQualificationPath),
    version: miniprogramUpload.version,
    desc: miniprogramUpload.desc,
  }))
  const releaseContext = {
    root: ROOT,
    gitSha: getGitSha(),
    version: miniprogramUpload.version,
    desc: miniprogramUpload.desc,
    envId: getCloudEnvId(),
    appid: APPID,
    releaseStrategy,
    forceRedeployCurrent,
  }
  const resumeQualificationPath = resumeRunState?.stages?.['miniprogram-build-gate']?.evidence?.qualificationPath || ''
  if (uiQualificationPath || resumeQualificationPath) releaseContext.devToolsVersion = readWechatDevToolsVersion()
  const releaseRunId = await resolveReleaseRunId(forceResume)
  releaseContext.runId = releaseRunId
  const selectedDagMode = releaseDagMode(process.env)
  const hasPinnedReleaseArtifacts = Boolean(resumeRunState?.formalPlan && resumeRunState?.artifactManifest)
  const formalPlan = hasPinnedReleaseArtifacts
    ? resumeRunState.formalPlan
    : createReleasePlanAfterResumeIdentityCheck({
        resumeRunState,
        gitSha: releaseContext.gitSha,
        releaseStrategy,
        forceRedeployCurrent,
        createPlan: (gitSha, strategy, force) => createFormalReleasePlan(gitSha, strategy, null, force),
      })
  if (!formalPlan || formalPlan.headSha !== releaseContext.gitSha || formalPlan.mode !== releaseStrategy || formalPlan.forceRedeployCurrent !== forceRedeployCurrent) {
    throw new Error('formal release plan is missing or does not match the pinned release identity')
  }
  releaseContext.cloudFunctions = formalPlan.targets.cloud.functions || []
  const releaseLedger = await createReleaseRunLedger({
    root: ROOT,
    runId: releaseRunId,
    command: ['node', 'scripts/deploy.mjs', ...process.argv.slice(2)].join(' '),
    gitSha: releaseContext.gitSha,
    version: releaseContext.version,
    desc: releaseContext.desc,
    envId: releaseContext.envId,
    releaseStrategy,
    dagMode: selectedDagMode,
    forceRedeployCurrent,
  })
  const resume = forceResume || hasFlag('resume')
  const reuseCheck = releaseStageReuseCheck(releaseContext)
  const releaseGuard = prepareOnly ? null : createProductionReleaseGuard(releaseContext, formalPlan)
  let oneShotBuildInfoPrepared = false
  const mutationFences = prepareOnly ? null : createFormalReleaseMutationFences({
    expectedGitSha: releaseContext.gitSha,
    fetchOriginMain: async () => execSync('git fetch --quiet origin main', { cwd: ROOT, stdio: 'inherit' }),
    readGitState: () => getFormalReleaseGitState({
      releaseStrategy,
      fullCurrentExplicit,
      publishOnly,
      allowReleaseBuildInfo: oneShotBuildInfoPrepared,
      version: miniprogramUpload.version,
      desc: miniprogramUpload.desc,
    }),
    releaseStrategy,
    fullCurrentExplicit,
    beforeRemoteMutation: async (stage) => await releaseGuard.beforeRemoteMutation(stage),
  })
  const revalidateFormalMutation = mutationFences?.remoteBoundary || null
  const localExactShaFence = mutationFences?.localExactShaFence || null
  let releaseGuardAcquired = false

  console.log(`[release-ledger] runId=${releaseLedger.runId}`)
  console.log(`[release-ledger] run=${releaseLedger.runPath}`)
  console.log(`[release-ledger] events=${releaseLedger.eventsPath}`)
  if (resume) console.log('[release-ledger] resume enabled; stages will be reused only after explicit evidence checks')
  if (prepareOnly) console.log('[release-ledger] prepare only; stopping after the formal plan and immutable artifacts are pinned')

  try {
    if (!prepareOnly) {
      await runLedgerStage(releaseLedger, 'release-preflight', {
        command: 'npm.cmd run release:preflight with exact release SHA and run-bound resume context',
      }, async () => {
        const evidencePath = resolve(dirname(releaseLedger.runPath), 'release-preflight.json')
        const preflightResume = resume
        await runReleaseNpmScript('release:preflight', {
          HH_RELEASE_HEAD_SHA: releaseContext.gitSha,
          HH_RELEASE_PREFLIGHT_EVIDENCE_PATH: evidencePath,
          HH_RELEASE_RESUME_CONTEXT_JSON: preflightResume ? JSON.stringify(resumeRunState) : '',
          HH_RELEASE_STRATEGY: releaseStrategy,
          HH_RELEASE_FULL_CURRENT_EXPLICIT: fullCurrentExplicit ? '1' : '0',
          HH_RELEASE_FORCE_REDEPLOY_CURRENT: forceRedeployCurrent ? '1' : '0',
          HH_RELEASE_PUBLISH_ONLY: publishOnly ? '1' : '0',
          HH_RELEASE_VERSION: releaseContext.version,
          HH_RELEASE_DESC: releaseContext.desc,
          TCB_ENV: releaseContext.envId,
        }, preflightResume ? ['--resume'] : [])
        const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
        if (evidence.ok !== true) {
          throw new Error('release preflight evidence is incomplete')
        }
        return { evidence: { evidencePath }, result: { status: 'passed', gitSha: releaseContext.gitSha } }
      })
      execSync('node scripts/ensure-release-control-plane.mjs --verify-only', { cwd: ROOT, stdio: 'inherit' })
      await releaseGuard.acquire()
      releaseGuardAcquired = true
    }

    if (formalPlan.targets.miniprogram) await runLedgerStage(releaseLedger, 'miniprogram-build-gate', {
      resume,
      mustReuse: publishOnly || hasPinnedReleaseArtifacts,
      reuseCheck,
      command: 'write build-info + npm run build:mp-weixin + npm run test:mp:release-gate -- --skip-mp-build',
    }, async () => {
      if (revalidateFormalMutation) await revalidateFormalMutation('artifact-build:miniprogram')
      const preparedEvidence = uiQualificationPath
        ? await inspectExplicitUiQualification(uiQualificationPath, releaseContext)
        : await buildAndGateMiniprogramUpload({
            ...miniprogramUpload,
            releaseRunId: releaseLedger.runId,
          })
      const evidence = await collectMiniprogramBuildGateEvidence(preparedEvidence)
      if (!publishOnly) oneShotBuildInfoPrepared = true
      return {
        evidence,
        result: { version: miniprogramUpload.version, desc: miniprogramUpload.desc },
      }
    })
    else await releaseLedger.skipStage('miniprogram-build-gate', { reason: 'release plan has no miniprogram changes' })

    let artifactManifest = releaseLedger.state.artifactManifest
    const toolchainIdentity = releaseToolchainIdentity()
    if (!artifactManifest) {
      if (formalPlan.targets.cloud.mode !== 'none') buildCloudArtifacts(formalPlan.targets.cloud.functions, releaseContext.gitSha)
      if (formalPlan.targets.adminWeb) buildAdminWeb('history')
      const snapshotPaths = await createImmutableArtifactSnapshots({
        root: ROOT,
        runId: releaseLedger.runId,
        plan: formalPlan,
        paths: { cloudRoot: CLOUD_DIST, adminWebRoot: ADMIN_WEB_DIST, miniprogramRoot: MP_DIST },
      })
      const componentDigests = await createFrontendComponentDigests(formalPlan, toolchainIdentity)
      artifactManifest = await createReleaseArtifactManifest({
        root: ROOT,
        runId: releaseLedger.runId,
        gitSha: releaseContext.gitSha,
        envId: releaseContext.envId,
        version: releaseContext.version,
        desc: releaseContext.desc,
        plan: formalPlan,
        componentDigests,
        toolchain: toolchainIdentity,
        paths: snapshotPaths,
      })
      await releaseLedger.pinReleaseArtifacts({ formalPlan, artifactManifest })
    }
    const currentFrontendDigests = await createFrontendComponentDigests(formalPlan, toolchainIdentity)
    const artifactTargetsMatchPlan = JSON.stringify(artifactManifest?.targets || null) === JSON.stringify({
      cloudFunctions: formalPlan.targets.cloud.functions || [],
      adminWeb: Boolean(formalPlan.targets.adminWeb),
      miniprogram: Boolean(formalPlan.targets.miniprogram),
    })
    if (!artifactManifest || artifactManifest.runId !== releaseLedger.runId || artifactManifest.gitSha !== releaseContext.gitSha ||
      artifactManifest.envId !== releaseContext.envId || artifactManifest.version !== releaseContext.version ||
      artifactManifest.desc !== releaseContext.desc || !artifactTargetsMatchPlan) {
      throw new Error('immutable artifact manifest is missing or does not match this release run')
    }
    for (const functionName of formalPlan.targets.cloud.functions || []) {
      const artifact = artifactManifest.artifacts?.cloud?.[functionName]
      if (!/^[a-f0-9]{64}$/i.test(String(artifact?.componentDigest || '')) || !/^[a-f0-9]{64}$/i.test(String(artifact?.runtimeDigest || ''))) {
        throw new Error(`immutable component digest is missing for cloud:${functionName}`)
      }
    }
    for (const [component, expected] of Object.entries(currentFrontendDigests)) {
      const artifact = artifactManifest.artifacts?.[component]
      if (!/^[a-f0-9]{64}$/i.test(String(artifact?.componentDigest || '')) || artifact.componentDigest !== expected) {
        throw new Error(`immutable component digest mismatch for ${component}`)
      }
    }

    if (prepareOnly) {
      await releaseLedger.complete('prepared')
      return
    }

    const productionState = await releaseGuard.getProductionState()
    const priorCloudFunctions = productionState?.components?.cloud?.functions || {}
    const priorProbeByFunction = new Map()
    const attestationSourceByFunction = new Map()
    const attestCloudWithPriorArtifact = async (input) => {
      const result = await attestCloudWithCurrentOrPrior({
        input,
        invokeCurrent: async (current) => ({ ...await invokeCloudReleaseProbe(current), bindingSource: 'current' }),
        loadPrior: async (current) => await loadPriorCloudAttestationProbe({
          root: ROOT,
          functionName: current.functionName,
          productionComponent: priorCloudFunctions[current.functionName],
          registerSecrets: (secrets) => releaseLedger.registerSecrets(secrets),
        }),
        invokePrior: async (current, prior) => {
          priorProbeByFunction.set(current.functionName, prior)
          return { ...await invokeCloudReleaseProbe({ ...current, probeToken: prior.probeToken, stableAttestation: true }), bindingSource: 'prior' }
        },
      })
      attestationSourceByFunction.set(input.functionName, result.bindingSource)
      return result
    }
    const verifyCloudDesiredState = async (input) => {
      if (input.deployed || attestationSourceByFunction.get(input.functionName) === 'current') return await invokeCloudReleaseProbe(input)
      const prior = priorProbeByFunction.get(input.functionName)
      if (!prior?.available) throw new Error('prior immutable cloud attestation proof is unavailable during verification')
      return await invokeCloudReleaseProbe({ ...input, probeToken: prior.probeToken, stableAttestation: true })
    }

    let cloudDeploy = { fns: [] }
    let cloudReleaseProbes = []
    let cloudOrchestration = { attestations: [], deployFunctions: [], verified: [] }
    let adminDeployed = false
    const ragCloudFunctions = new Set(['post-rag-worker', 'post-video-rag-worker'])
    const releaseCloudSmokeFunctions = (formalPlan.targets.cloud.functions || []).filter((name) => !ragCloudFunctions.has(name))

    {
      let ragCloud = { attestations: [], deployFunctions: [], verified: [] }
      let remainingCloud = { attestations: [], deployFunctions: [], verified: [] }
      let cloudSmokeSummary = null
      const plannedCloudFunctions = formalPlan.targets.cloud.functions || []
      const partition = partitionReleaseCloudFunctions(plannedCloudFunctions)
      const orchestrateSubset = async (functions, boundaryName) => {
        if (!functions.length) return { attestations: [], deployFunctions: [], verified: [] }
        await revalidateFormalMutation(boundaryName)
        const subsetManifest = {
          ...artifactManifest,
          targets: { ...artifactManifest.targets, cloudFunctions: [...functions] },
          artifacts: {
            ...artifactManifest.artifacts,
            cloud: Object.fromEntries(functions.map((name) => [name, artifactManifest.artifacts.cloud[name]])),
          },
        }
        return await orchestrateCloudArtifactRelease({
          root: ROOT,
          manifest: subsetManifest,
          forceRedeployCurrent,
          onSecrets: (secrets) => releaseLedger.registerSecrets(secrets),
          timeoutMs: getPositiveIntFlag('cloud-attestation-timeout-ms', 30_000, { max: 120_000 }),
          attest: async (input) => { await localExactShaFence(`attest:${input.functionName}`); return await attestCloudWithPriorArtifact(input) },
          deploy: async ({ artifactRoot, functionName }) => {
            const artifact = artifactManifest.artifacts.cloud[functionName]
            const result = await deployCloud({
              afterFunctionDeploy: async (fn, record) => await releaseGuard.recordStage(`cloud:${fn}`, { evidence: record }),
              artifactRoot: dirname(artifactRoot),
              beforeFunctionDeploy: createPinnedCloudDeployAttemptGuard({
                artifactRoot,
                expectedDigest: artifact.contentDigest,
                functionName,
                beforeFence: async (fn) => await localExactShaFence(`cloud-attempt:${fn}`),
              }),
              functions: [functionName],
              requireCloudBaseCli: true,
              skipBuild: true,
              sourceSha: releaseContext.gitSha,
            })
            if (result.path !== 'cloudbase-cli') throw new Error(`Formal release cloud deploy must use CloudBase CLI/COS; got ${result.path}`)
          },
          verify: async (input) => { await localExactShaFence(`verify:${input.functionName}`); return await verifyCloudDesiredState(input) },
        })
      }

      await executeReleaseDagV2({
        preflight: async () => await runLedgerStage(releaseLedger, 'release-index-prerequisite', {
          resume,
          reuseCheck,
          command: 'single fresh ensure:indexes prerequisite with structured ledger readback',
        }, async () => {
          const evidencePath = resolve(dirname(releaseLedger.runPath), 'ensure-indexes.json')
          await revalidateFormalMutation('ensure-indexes')
          await runReleaseNpmScript('ensure:indexes', {
            HH_RELEASE_INDEX_EVIDENCE_PATH: evidencePath,
            TCB_ENV: releaseContext.envId,
          })
          const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
          if (evidence.action !== 'ensure-indexes' || evidence.invocationCount !== 1 || evidence.status !== 'passed' || evidence.failures !== 0) {
            throw new Error('ensure-indexes structured readback is incomplete')
          }
          return { evidence: { evidencePath }, result: evidence }
        }),
        configureRag: async () => await runLedgerStage(releaseLedger, 'release-operations', {
          command: 'execute allowlisted release actions and idempotent migrations declared by release/changes',
        }, async () => {
          const state = await releaseGuard.getProductionState()
          const result = await executeReleaseOperations({
            appliedMigrations: { ...(state?.appliedMigrations || {}) },
            completedActions: new Set(['ensure-indexes']),
            guard: {
              beforeRemoteMutation: revalidateFormalMutation,
              recordStage: async (...args) => await releaseGuard.recordStage(...args),
              recordMigration: async (...args) => await releaseGuard.recordMigration(...args),
            },
            manifests: formalPlan.manifests,
            runAction: runDeclaredReleaseAction,
            runMigration: async (migration) => await runDeclaredReleaseMigration(migration, releaseContext),
          })
          return { result }
        }),
        deployRag: async () => await runLedgerStage(releaseLedger, 'cloud-deploy-rag-bootstrap', {
          command: 'fresh immutable attestation/deploy/verification for admin and post-rag-worker',
        }, async () => {
          ragCloud = await orchestrateSubset(partition.ragBootstrap, 'rag-cloud-deploy')
          return { result: ragCloud }
        }),
        deployRemainingCloud: async () => await runLedgerStage(releaseLedger, 'cloud-deploy-remaining', {
          command: 'fresh immutable attestation/deploy/verification for the exact remaining cloud partition',
        }, async () => {
          remainingCloud = await orchestrateSubset(partition.remaining, 'cloud-deploy')
          return { result: remainingCloud }
        }),
        runBasicCloudSmoke: async () => {
          if (!plannedCloudFunctions.length) return null
          if (!releaseCloudSmokeFunctions.length) {
            await releaseLedger.skipStage('cloud-smoke', { reason: 'release plan contains only post-release RAG workers' })
            return null
          }
          return await runLedgerStage(releaseLedger, 'cloud-smoke', {
            command: `DAG V2 actual cloud smoke (concurrency=${getCloudSmokeConcurrency()})`,
          }, async () => {
            await revalidateFormalMutation('cloud-smoke')
            cloudSmokeSummary = await runCloudSmoke(releaseCloudSmokeFunctions, releaseLedger.runId, {
              ensureIndexes: false,
              beforeSmokeCommand: async ({ stage }) => await localExactShaFence(`cloud-smoke:${stage}`),
              beforeFixtureCleanup: async ({ stage }) => await releaseGuard.beforeRemoteMutation(`cloud-smoke-cleanup:${stage}`),
            })
            const evidence = { summaryPath: resolve(cloudSmokeSummary.evidenceDir, 'summary.json') }
            await releaseGuard.recordStage('cloud-smoke', { evidence })
            return { evidence, result: cloudSmokeSummary }
          })
        },
        publishAdmin: async () => {
          cloudOrchestration = {
            attestations: [...ragCloud.attestations, ...remainingCloud.attestations],
            deployFunctions: [...ragCloud.deployFunctions, ...remainingCloud.deployFunctions],
            verified: [...ragCloud.verified, ...remainingCloud.verified],
          }
          if (plannedCloudFunctions.length) {
            cloudDeploy = {
               fns: plannedCloudFunctions,
               currentBoundFns: cloudOrchestration.attestations.filter((item) => item.bindingSource === 'current' && item.status === 'attested').map((item) => item.functionName),
               deployedFns: cloudOrchestration.deployFunctions,
               path: cloudOrchestration.deployFunctions.length ? 'cloudbase-cli' : 'attested',
               status: cloudOrchestration.deployFunctions.length ? 'deployed' : 'attested',
            }
            await releaseLedger.recordRemoteAttestations('cloud', cloudOrchestration.attestations)
            cloudReleaseProbes = await runLedgerStage(releaseLedger, 'cloud-version-probes', {
              command: 'record bounded fresh verification for every planned immutable cloud artifact',
            }, async () => {
              const probes = plannedCloudFunctions.map((name) => artifactManifest.artifacts.cloud[name])
              await releaseGuard.recordStage('cloud-version-probes', { evidence: { functions: cloudOrchestration.verified } })
              return probes
            })
          } else {
            await releaseLedger.skipStage('cloud-deploy-rag-bootstrap', { reason: 'release plan has no cloud function changes' })
            await releaseLedger.skipStage('cloud-deploy-remaining', { reason: 'release plan has no cloud function changes' })
            await releaseLedger.skipStage('cloud-version-probes', { reason: 'release plan has no cloud function changes' })
            await releaseLedger.skipStage('cloud-smoke', { reason: 'release plan has no cloud function changes' })
          }
          return { status: 'passed' }
        },
        publishMiniprogram: async () => ({ gated: true }),
      })

      const deployedCloudFunctions = new Set(cloudDeploy.deployedFns || [])
      for (const attestation of cloudOrchestration.attestations) {
        const deployed = deployedCloudFunctions.has(attestation.functionName)
        await releaseLedger.recordComponent(attestation.component, cloudComponentLedgerOutcome({
          artifact: artifactManifest.artifacts.cloud[attestation.functionName], attestation, deployed,
          prior: priorCloudFunctions[attestation.functionName], runId: artifactManifest.runId,
        }))
      }
    }

    if (formalPlan.targets.adminWeb) {
      const adminArtifact = artifactManifest.artifacts.adminWeb
      let adminAttestation = await attestAdminWebArtifact({
        root: ROOT, artifact: adminArtifact, forceRedeployCurrent, inspectRemote: inspectAdminWebPublication,
        priorBinding: productionState?.components?.adminWeb,
      })
      if (!adminAttestation.shouldDeploy) {
        try {
          selectStableProductionBinding({ component: 'admin-web', current: adminArtifact, mutated: false, prior: productionState?.components?.adminWeb, runId: artifactManifest.runId })
        } catch {
          adminAttestation = { component: 'admin-web', status: 'deploy-required', shouldDeploy: true, skipReason: 'prior deployed admin binding is unavailable' }
        }
      }
      await releaseLedger.recordRemoteAttestations('admin-web', [adminAttestation])
      if (!adminAttestation.shouldDeploy) {
        await releaseLedger.skipStage('admin-web-deploy', { reason: adminAttestation.skipReason, result: { status: 'attested' } })
        await releaseLedger.recordComponent('admin-web', { ...adminAttestation, artifactRunId: productionState?.components?.adminWeb?.artifactRunId || '', componentDigest: adminArtifact.componentDigest, evidence: { deployed: false, remoteBytesVerified: true } })
      } else await runLedgerStage(releaseLedger, 'admin-web-deploy', {
        command: 'fresh publication attestation + admin-web deploy',
      }, async () => {
        await deployAdminWeb({
          artifact: adminArtifact,
          artifactRoot: resolve(ROOT, adminArtifact.artifactPath),
          skipBuild: true,
          beforeRemoteMutation: async () => await revalidateFormalMutation('admin-web-deploy'),
        })
        adminDeployed = true
        await releaseGuard.recordStage('admin-web-deploy')
        await releaseLedger.recordComponent('admin-web', { status: 'deployed', skipReason: adminAttestation.skipReason, artifactRunId: artifactManifest.runId, componentDigest: adminArtifact.componentDigest, evidence: { deployed: true, remoteBytesVerified: true } })
        return { result: { target: process.env.ADMIN_WEB_TARGET || 'aliyun', status: 'deployed' } }
      })
    } else await releaseLedger.skipStage('admin-web-deploy', { reason: 'release plan has no admin-web changes' })

    if (formalPlan.targets.miniprogram) await runLedgerStage(releaseLedger, 'miniprogram-upload', {
      resume,
      reuseCheck,
      command: 'WeChat DevTools CLI upload or explicit miniprogram-ci fallback',
    }, async () => {
      const preparedPackageDigest = String(
        releaseLedger.state.stages['miniprogram-build-gate']?.evidence?.packageDigest || '',
      )
      if (!preparedPackageDigest) throw new Error('prepared miniprogram package digest is missing before upload')
      if (preparedPackageDigest !== artifactManifest.artifacts.miniprogram?.contentDigest) {
        throw new Error('prepared miniprogram package digest does not match the immutable artifact manifest')
      }
      const currentPackageDigest = await computeDirectoryDigest(MP_DIST)
      if (currentPackageDigest !== preparedPackageDigest) {
        throw new Error(`miniprogram package changed after release UI validation: expected ${preparedPackageDigest}, got ${currentPackageDigest}`)
      }
      const uploadResult = await uploadBuiltMiniprogram({
        ...miniprogramUpload,
        beforeRemoteMutation: async () => await revalidateFormalMutation('miniprogram-upload'),
      })
      const uploadEvidence = writeMiniprogramUploadEvidence({
        releaseRunId: releaseLedger.runId,
        version: miniprogramUpload.version,
        desc: miniprogramUpload.desc,
        packageDigest: currentPackageDigest,
        uploadResult,
      })
      await releaseGuard.recordStage('miniprogram-upload', { evidence: { uploadEvidencePath: uploadEvidence.evidencePath } })
      return {
        evidence: {
          uploadEvidencePath: uploadEvidence.evidencePath,
          uploadInfoPath: uploadResult.uploadInfoPath || '',
        },
        result: {
          version: miniprogramUpload.version,
          desc: miniprogramUpload.desc,
          method: uploadResult.method,
          packageDigest: currentPackageDigest,
          forceCi: miniprogramUpload.forceCi,
        },
      }
    })
    else await releaseLedger.skipStage('miniprogram-upload', { reason: 'release plan has no miniprogram changes' })

    if (formalPlan.targets.miniprogram) await runLedgerStage(releaseLedger, 'verify-upload', {
      resume,
      reuseCheck,
      command: 'verify build-info and mp-upload-info after upload',
    }, async () => {
      const { evidencePath: uploadEvidencePath, evidence: uploadEvidence } = readMiniprogramUploadEvidence(releaseLedger.runId)
      if (uploadEvidence.success !== true) throw new Error('upload evidence is not successful')
      if (uploadEvidence.releaseRunId !== releaseLedger.runId || !uploadEvidence.receiptId) throw new Error('upload evidence does not match release run receipt')
      if (uploadEvidence.appid !== APPID) throw new Error('upload evidence appid does not match')
      if (uploadEvidence.version !== miniprogramUpload.version || uploadEvidence.desc !== miniprogramUpload.desc) {
        throw new Error('upload evidence does not match uploaded version/desc')
      }
      const preparedPackageDigest = String(
        releaseLedger.state.stages['miniprogram-build-gate']?.evidence?.packageDigest || '',
      )
      if (!preparedPackageDigest || uploadEvidence.packageDigest !== preparedPackageDigest) {
        throw new Error('upload evidence package digest does not match prepared package')
      }
      const currentPackageDigest = await computeDirectoryDigest(MP_DIST)
      if (currentPackageDigest !== preparedPackageDigest) {
        throw new Error('uploaded miniprogram package changed before verification')
      }
      const uploadInfoPath = uploadEvidence.uploadInfoPath || ''
      let normalizedReceipt = null
      if (uploadEvidence.method === 'devtools-cli') {
        if (!uploadInfoPath) throw new Error('upload evidence uploadInfoPath is missing')
        if (!existsSync(uploadInfoPath)) throw new Error(`upload info file not found: ${uploadInfoPath}`)
        normalizedReceipt = normalizeMiniprogramUploadReceipt({
          method: uploadEvidence.method,
          uploadInfoText: readFileSync(uploadInfoPath, 'utf8'),
        })
      } else if (uploadEvidence.method === 'miniprogram-ci') {
        normalizedReceipt = uploadEvidence.normalizedReceipt || null
      }
      const receiptAttestation = attestMiniprogramReceipt({
        artifact: artifactManifest.artifacts.miniprogram,
        receipt: normalizedReceipt,
        expectedReceiptId: uploadEvidence.receiptId,
      })
      if (receiptAttestation.shouldUpload) throw new Error(receiptAttestation.skipReason)
      const buildInfoPath = resolve(ROOT, 'miniprogram/src/generated/build-info.ts')
      const buildInfo = readFileSync(buildInfoPath, 'utf8')
      if (!buildInfo.includes(miniprogramUpload.version) || !buildInfo.includes(miniprogramUpload.desc)) {
        throw new Error('build-info does not match uploaded version/desc')
      }
      return {
        evidence: { uploadEvidencePath, uploadInfoPath, buildInfoPath, packageDigest: currentPackageDigest },
        result: {
          version: miniprogramUpload.version,
          desc: miniprogramUpload.desc,
          method: uploadEvidence.method,
          packageDigest: currentPackageDigest,
          receiptAttestation,
        },
      }
    })
    else await releaseLedger.skipStage('verify-upload', { reason: 'release plan has no miniprogram changes' })

    if (formalPlan.targets.miniprogram) {
      const uploadStage = releaseLedger.state.stages['miniprogram-upload']
      const receiptAttestation = releaseLedger.state.stages['verify-upload']?.result?.receiptAttestation
      const miniprogramOutcome = {
        ...receiptAttestation,
        component: 'miniprogram',
        status: 'uploaded',
        skipReason: uploadStage?.reused ? receiptAttestation?.skipReason || uploadStage.reason : '',
        artifactRunId: artifactManifest.runId,
        componentDigest: artifactManifest.artifacts.miniprogram.componentDigest,
        evidence: { deployed: true, receiptReused: uploadStage?.reused === true, receiptId: receiptAttestation?.receiptId || '' },
      }
      await releaseLedger.recordRemoteAttestations('miniprogram', [miniprogramOutcome])
      await releaseLedger.recordComponent('miniprogram', miniprogramOutcome)
    }

    if (formalPlan.targets.miniprogram) {
      const cleanup = restoreReleaseOwnedBuildInfo({
        root: ROOT,
        version: miniprogramUpload.version,
        desc: miniprogramUpload.desc,
      })
      console.log(`[build-info] cleanup ${cleanup.status} ${cleanup.path}`)
    }

    if (releaseGuard) await completeProductionReleaseWithRemoteConfirmation({
      guard: releaseGuard,
      ledger: releaseLedger,
      components: releaseComponents({ adminDeployed, artifactManifest, cloudDeploy, plan: formalPlan, productionComponents: productionState?.components || {} }),
      evidence: { localReleaseRunId: releaseLedger.runId, planBaseSha: formalPlan.baseSha || null },
    })
    else await releaseLedger.complete('passed')
  } catch (error) {
    const persistedFailure = await persistFormalReleaseFailure({ error, guard: releaseGuard, guardAcquired: releaseGuardAcquired, ledger: releaseLedger })
    for (const persistenceError of persistedFailure.persistenceErrors) console.error(`[release-failure] ${persistenceError.target} ${persistenceError.code}`)
    if (error?.releaseRemotelyCompleted) console.error('[release-ledger] remote production state already proves success; run release:reconcile to repair the local ledger')
    throw error
  }
}

function assertDirectProductionDeployWorkspace({ publishOnly = false, version = '', desc = '' } = {}) {
  execSync('git fetch --quiet origin main', { cwd: ROOT, stdio: 'inherit' })
  assertFormalReleaseGitState(getFormalReleaseGitState({
    releaseStrategy: 'main',
    publishOnly,
    version,
    desc,
  }))
}

const target = process.argv[2] || 'all'
if (target === 'release') {
  await runFormalRelease()
} else if (target === 'release-ui-qualify') {
  await runReleaseUiQualification()
} else if (target === 'release-prepare') {
  await runFormalRelease({ prepareOnly: true })
} else if (target === 'release-publish') {
  await runFormalRelease({ publishOnly: true })
} else {
  assertDirectProductionDeployWorkspace()
  const directMutationOptions = {
    beforeRemoteMutation: assertDirectProductionDeployWorkspace,
    beforeFunctionDeploy: assertDirectProductionDeployWorkspace,
  }
  if (target === 'cloud' || target === 'all') {
    const cloudDeploy = await deployCloud(directMutationOptions)
    if (process.argv.includes('--smoke')) await runCloudSmoke(cloudDeploy.fns, '', {
      beforeEnsureIndexes: assertDirectProductionDeployWorkspace,
      beforeSmokeCommand: assertDirectProductionDeployWorkspace,
    })
  }
  if (target === 'miniprogram' || target === 'all') await deployMiniprogram(directMutationOptions)
  if (target === 'miniprogram-upload') await uploadMiniprogram(directMutationOptions)
  if (target === 'admin-web') await deployAdminWeb(directMutationOptions)
}
