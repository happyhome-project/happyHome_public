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
 * 详见 memory/feedback_deploy_force_ipv4.md 和 feedback_deploy_pitfalls.md
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
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { parseArgs as parseCloudSmokeArgs, runCloudReleaseSmoke } from './cloud-release-smoke.mjs'
import { deployFunctionsWithConcurrency } from './lib/cloudbase-function-deploy.mjs'
import { createProductionReleaseStore } from './lib/cloudbase-release-store.mjs'
import {
  analyzeDevtoolsCloudDeployOutput,
  analyzeDevtoolsUploadInfo,
  analyzeDevtoolsUploadOutput,
} from './lib/deploy-output.mjs'
import { parsePositiveIntOption } from './lib/release-concurrency.mjs'
import {
  assertFormalReleaseGitState,
  mustRevalidateRemoteReleaseStage,
  shouldFallbackAfterDevtoolsFailure,
} from './lib/release-policy.mjs'
import {
  assertReleaseCapabilitySeparation,
  assertReleaseFunctionSecurityConfig,
} from './lib/release-security-policy.mjs'
import {
  createReleaseRunLedger,
  computeDirectoryDigest,
  findLatestReleaseUiEvidence,
  inspectReleaseStageReuse,
  loadReleaseRun,
  loadLatestReleaseRun,
  makeReleaseRunId,
  runLedgerStage,
} from './lib/release-run-ledger.mjs'
import { ProductionReleaseGuard } from './lib/production-release-guard.mjs'
import { hasCloudReleaseProbeResponse } from './lib/cloud-release-probe.mjs'
import { executeReleaseOperations } from './lib/release-operations.mjs'
import { ReleaseGovernance } from './lib/release-governance.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPID = 'wx673b17363cd6b4a6'
const KEY_PATH = process.env.MP_PRIVATE_KEY_PATH || resolve(ROOT, `private.${APPID}.key`)
const MP_DIST = resolve(ROOT, 'miniprogram/dist/build/mp-weixin')
const CLOUD_DIST = resolve(ROOT, 'cloud/dist')
const ADMIN_WEB_DIR = resolve(ROOT, 'admin-web')
const ADMIN_WEB_DIST = resolve(ROOT, 'admin-web/dist')
const DEFAULT_CLOUD_ENV = 'cloudbase-3gh862acb1505ff3'
const CLOUD_ENV = process.env.TCB_ENV || DEFAULT_CLOUD_ENV
const ADMIN_WEB_DEFAULT_API_URL = 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com'
const ADMIN_WEB_ALIYUN_HOST = process.env.ADMIN_WEB_SSH_HOST || 'aliyun'
const ADMIN_WEB_ALIYUN_ROOT = process.env.ADMIN_WEB_REMOTE_ROOT || '/var/www/happyhome-admin'
const CLOUD_FUNCTIONS = ['user', 'community', 'member', 'section', 'post', 'post-rag-worker', 'post-video-rag-worker', 'admin', 'http-gateway', 'home-prefetch']

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

function getGitOutput(command) {
  return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function getFormalReleaseGitState({ publishOnly, version, desc }) {
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
    branch: getGitOutput('git branch --show-current'),
    headSha: getGitOutput('git rev-parse HEAD'),
    originMainSha: getGitOutput('git rev-parse origin/main'),
    changedPaths: [...changedPaths],
    publishOnly,
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
  const buildId = `mp-${version}`
  const content = [
    'export const BUILD_INFO = {',
    `  version: ${JSON.stringify(version)},`,
    `  desc: ${JSON.stringify(desc)},`,
    `  buildId: ${JSON.stringify(buildId)},`,
    '}',
    '',
  ].join('\n')

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
  return new Promise((res) => {
    const proc = spawn(commandLine, {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })

    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      if (!options.silentOutput) process.stdout.write(text)
    })
    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      if (!options.silentOutput) process.stderr.write(text)
    })
    proc.on('exit', (code) => {
      const output = `${stdout}${stderr}`
      res({ ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}`, output })
    })
    proc.on('error', (err) => res({ ok: false, reason: String(err?.message || err), output: `${stdout}${stderr}` }))
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function isTransientCloudBaseCliFailure(result) {
  const text = `${result?.reason || ''}\n${result?.output || ''}`
  return /ECONNRESET|ETIMEDOUT|TLS connection|socket disconnected|network timeout|ENOTFOUND|EAI_AGAIN|_a\.includes is not a function|e\.message\.includes is not a function/i.test(text)
}

async function runCloudBaseCliCaptureWithRetry(commandLine, options = {}, attempts = 3) {
  let lastResult = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runShellCapture(commandLine, {
      ...options,
      displayCommandLine: attempt === 1
        ? options.displayCommandLine
        : `${options.displayCommandLine || commandLine} (retry ${attempt}/${attempts})`,
    })
    if (result.ok) return result
    lastResult = result
    if (!isTransientCloudBaseCliFailure(result) || attempt >= attempts) break
    console.warn(`[CloudBase CLI] transient failure; retrying in ${attempt * 3000}ms`)
    await sleep(attempt * 3000)
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
    // 详见 memory/feedback_devtools_automator_usage.md 坑 #6
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
        if (typeof options.beforeFunctionDeploy === 'function') await options.beforeFunctionDeploy(fn)
        const fnDir = resolve(CLOUD_DIST, fn)
        return await runCloudBaseCliCaptureWithRetry(
          confirmDefault(tcb('fn', 'deploy', fn, '--force', '--env-id', envId, '--deployMode', 'cos', '--json')),
          {
            cwd: fnDir,
            displayCommandLine: `cd ${fnDir} && <confirm default> | tcb fn deploy ${fn} --force --env-id ${envId} --deployMode cos --json`,
            // CloudBase CLI 3.5.8 prompts to accept the merged existing function
            // config; its --yes path throws "_a.includes is not a function".
          }
        )
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
  const evidence = {
    success: true,
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
async function deployCloudViaMiniprogramCi(fns) {
  const envId = getCloudEnvId()
  for (const fn of fns) {
    console.log(`[miniprogram-ci] Uploading: ${fn}`)
    await ci.cloud.uploadFunction({
      project: getCiProject(),
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: envId,
      remoteNpmInstall: true,
    })
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

  console.log('\nBuilding cloud functions...')
  execSync('node build.mjs', {
    cwd: resolve(ROOT, 'cloud'),
    stdio: 'inherit',
    env: {
      ...process.env,
      HH_CLOUD_BUILD_ONLY: fns.length < CLOUD_FUNCTIONS.length ? fns.join(',') : '',
      HH_RELEASE_SOURCE_SHA: options.sourceSha || process.env.HH_RELEASE_SOURCE_SHA || 'unknown',
    },
  })

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
    const result = await deployCloudViaDevtoolsCli(fns)
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
  await deployCloudViaMiniprogramCi(fns)
  console.log('[OK] Cloud functions deployed via miniprogram-ci')
  return { fns, path: 'miniprogram-ci' }
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
  }
  console.log('\nEnsuring release database collections and indexes...')
  if (typeof options.beforeEnsureIndexes === 'function') await options.beforeEnsureIndexes()
  execSync('npm.cmd run ensure:indexes', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TCB_ENV: smokeOptions.envId },
  })
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
// 详见 memory/feedback_deploy_force_ipv4.md。
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
  await ci.upload({
    project: getCiProject(),
    version,
    desc,
    setting: { es6: true, minified: false },
  })
  console.log('Miniprogram upload finished via miniprogram-ci')
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

async function buildAndGateMiniprogramUpload({ version, desc, releaseRunId }) {
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
      WECHAT_DEVTOOLS_PROJECT_PATH: MP_DIST,
    },
  })
  return {
    packageRoot: MP_DIST,
    packageDigest,
    releaseUiEvidencePath: resolve(releaseUiEvidenceDir, 'release-ui-evidence.json'),
  }
}

async function uploadBuiltMiniprogram({ version, desc, forceCi }) {
  console.log(`\nMiniprogram upload version: ${version}`)
  console.log(`Miniprogram upload desc: ${desc}`)

  if (!forceCi) {
    console.log('\n[primary] Uploading via WeChat DevTools CLI...')
    const result = await uploadMiniprogramViaDevtoolsCli(version, desc)
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

  await uploadMiniprogramViaMiniprogramCi(version, desc)
  console.log('[OK] Miniprogram uploaded via miniprogram-ci')
  return { method: 'miniprogram-ci', uploadInfoPath: '' }
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

async function deployMiniprogram() {
  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  const forceCi = process.argv.includes('--use-ci')

  if (!forceCi) {
    console.log('\n[primary] Generating preview via WeChat DevTools CLI...')
    const result = await deployMiniprogramViaDevtoolsCli()
    if (result.ok) {
      console.log('[✓] Miniprogram preview ready via DevTools CLI (preview-qr.png + preview-info.json)')
      return
    }
    console.log(`[!] DevTools CLI failed (${result.reason}) — falling back to miniprogram-ci`)
  } else {
    console.log('\n[--use-ci] Skipping DevTools CLI, using miniprogram-ci directly')
  }

  await deployMiniprogramViaMiniprogramCi()
  console.log('[✓] Miniprogram preview ready via miniprogram-ci')
}

async function uploadMiniprogram() {
  const upload = resolveMiniprogramUploadMetadata()
  await buildAndGateMiniprogramUpload({ ...upload, releaseRunId: makeReleaseRunId() })
  await uploadBuiltMiniprogram(upload)
}

function buildAdminWeb(defaultRouterMode) {
  console.log('\nBuilding admin-web...')
  const env = {
    ...process.env,
    VITE_CLOUD_API_URL: process.env.VITE_CLOUD_API_URL || ADMIN_WEB_DEFAULT_API_URL,
    VITE_ROUTER_MODE: process.env.VITE_ROUTER_MODE || defaultRouterMode,
    VITE_AMAP_JS_KEY: process.env.VITE_AMAP_JS_KEY || process.env.AMAP_JS_KEY || process.env.GAODE_JS_KEY || '',
    VITE_AMAP_SECURITY_CODE: process.env.VITE_AMAP_SECURITY_CODE || process.env.AMAP_SECURITY_CODE || process.env.GAODE_SECURITY_CODE || '',
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execSync(`${npm} run build`, { cwd: ADMIN_WEB_DIR, stdio: 'inherit', env })
  return env
}

async function deployAdminWebToCloudBase() {
  const env = buildAdminWeb('hash')
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
    ADMIN_WEB_DIST,
  ]
  if (cloudPath && cloudPath !== '/') args.push(cloudPath)
  args.push('-e', envId)

  console.log('\nDeploying admin-web dist to CloudBase static hosting...')
  console.log(`Using VITE_CLOUD_API_URL=${env.VITE_CLOUD_API_URL}`)
  const result = await runShell(args.map(quote).join(' '))
  if (!result.ok) {
    throw new Error(`Admin web deploy failed: ${result.reason}. Ensure CloudBase CLI is logged in and static hosting is enabled for ${envId}.`)
  }
  console.log('[OK] Admin web deployed to CloudBase static hosting')
  console.log('Reminder: configure static hosting fallback/error page to index.html for Vue history routes.')
}

async function deployAdminWebToAliyun() {
  const env = buildAdminWeb('history')
  const stamp = Date.now()
  const archivePath = join(tmpdir(), `happyhome-admin-web-${stamp}.tgz`)
  const remoteArchivePath = `/tmp/happyhome-admin-web-${stamp}.tgz`
  const remoteScriptPath = `/tmp/deploy-happyhome-admin-${stamp}.sh`
  const localScriptPath = join(tmpdir(), `deploy-happyhome-admin-${stamp}.sh`)

  console.log('\nPacking admin-web dist...')
  // --force-local: 在 Windows + Git Bash 下，tar 会把 "X:\..." 当成 remote host:path 解析失败。
  // 这个 flag 强制把带冒号的路径当本地路径处理。
  const tarHelp = execSync('tar --help', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const forceLocalFlag = tarHelp.includes('--force-local') ? '--force-local ' : ''
  // Git Bash tar needs --force-local for Windows drive-letter paths; Windows tar rejects it.
  execSync(`tar ${forceLocalFlag}-czf ${quote(archivePath)} -C ${quote(ADMIN_WEB_DIST)} .`, { cwd: ROOT, stdio: 'inherit' })

  const remoteScript = `#!/usr/bin/env bash
set -euo pipefail
root=${JSON.stringify(ADMIN_WEB_ALIYUN_ROOT)}
archive=${JSON.stringify(remoteArchivePath)}
release="$root/releases/$(date +%Y%m%d%H%M%S)"
sudo mkdir -p "$release"
sudo tar -xzf "$archive" -C "$release"
sudo chown -R root:root "$release"
sudo find "$release" -type d -exec chmod 755 {} \\;
sudo find "$release" -type f -exec chmod 644 {} \\;
sudo ln -sfn "$release" "$root/current"
sudo nginx -t
sudo systemctl reload nginx
rm -f "$archive" ${JSON.stringify(remoteScriptPath)}
echo "[OK] Admin web deployed to $release"
readlink -f "$root/current"
`
  writeFileSync(localScriptPath, remoteScript, 'utf8')

  console.log('\nDeploying admin-web dist to Aliyun Nginx host...')
  console.log(`Using VITE_CLOUD_API_URL=${env.VITE_CLOUD_API_URL}`)
  console.log(`Using VITE_ROUTER_MODE=${env.VITE_ROUTER_MODE}`)
  console.log(`Using ADMIN_WEB_SSH_HOST=${ADMIN_WEB_ALIYUN_HOST}`)
  const uploadArchive = await runShell(`scp ${quote(archivePath)} ${quote(`${ADMIN_WEB_ALIYUN_HOST}:${remoteArchivePath}`)}`)
  if (!uploadArchive.ok) throw new Error(`Admin web archive upload failed: ${uploadArchive.reason}`)
  const uploadScript = await runShell(`scp ${quote(localScriptPath)} ${quote(`${ADMIN_WEB_ALIYUN_HOST}:${remoteScriptPath}`)}`)
  if (!uploadScript.ok) throw new Error(`Admin web deploy script upload failed: ${uploadScript.reason}`)
  const deploy = await runShell(`ssh ${quote(ADMIN_WEB_ALIYUN_HOST)} ${quote(`bash ${remoteScriptPath}`)}`)
  if (!deploy.ok) throw new Error(`Admin web Aliyun deploy failed: ${deploy.reason}`)
  console.log('[OK] Admin web deployed to Aliyun Nginx host')
}

async function deployAdminWeb() {
  const target = (process.env.ADMIN_WEB_TARGET || 'aliyun').toLowerCase()
  if (target === 'cloudbase') return deployAdminWebToCloudBase()
  if (target === 'aliyun') return deployAdminWebToAliyun()
  throw new Error(`Unknown ADMIN_WEB_TARGET=${target}. Expected aliyun or cloudbase.`)
}

async function collectMiniprogramBuildGateEvidence(preparedEvidence = {}) {
  const releaseUiEvidencePath = preparedEvidence.releaseUiEvidencePath || await findLatestReleaseUiEvidence(ROOT)
  return {
    buildInfoPath: resolve(ROOT, 'miniprogram/src/generated/build-info.ts'),
    distBuildInfoPath: resolve(ROOT, 'miniprogram/dist/build/mp-weixin/generated/build-info.js'),
    packageRoot: preparedEvidence.packageRoot || MP_DIST,
    packageDigest: preparedEvidence.packageDigest || await computeDirectoryDigest(MP_DIST),
    ...(releaseUiEvidencePath ? { releaseUiEvidencePath } : {}),
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

function createFormalReleasePlan(gitSha) {
  const result = spawnSync(process.execPath, ['scripts/release-plan.mjs', '--mode=main', `--head=${gitSha}`], {
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
  if (plan.mode !== 'main' || plan.headSha !== gitSha || !plan.releaseRequired) {
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

function releaseComponents({ cloudDeploy, cloudReleaseProbes = [], miniprogramUpload, plan, releaseContext }) {
  const probeByFunction = new Map(cloudReleaseProbes.map((probe) => [probe.functionName, probe]))
  const functions = Object.fromEntries((cloudDeploy?.fns || []).map((name) => [name,
    probeByFunction.get(name) || { sourceSha: releaseContext.gitSha, buildId: `cloud-${releaseContext.gitSha.slice(0, 12)}-${name}` },
  ]))
  return {
    adminWeb: plan.targets.adminWeb ? { sourceSha: releaseContext.gitSha } : null,
    cloud: { functions },
    miniprogram: plan.targets.miniprogram ? {
      buildId: `mp-${miniprogramUpload.version}`,
      sourceSha: releaseContext.gitSha,
      version: miniprogramUpload.version,
    } : null,
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
    writeFileSync(payloadPath, JSON.stringify({ __happyhomeReleaseProbe: probe.probeToken }), 'utf8')
    try {
      const commandLine = [npx, '--yes', '--package', '@cloudbase/cli', 'tcb', 'fn', 'invoke', probe.functionName,
        '-d', `@${payloadPath}`, '--env-id', envId, '--json'].map(quote).join(' ')
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

const RELEASE_ACTION_SCRIPTS = Object.freeze({
  'configure-rag-network': 'configure:rag-network',
  'configure-rag-workers': 'configure:rag-workers',
  'ensure-indexes': 'ensure:indexes',
  'ensure-tencent-rag-index': 'ensure:tencent-rag-index',
  'update-rag-env': 'update:rag-env',
})

function runReleaseNpmScript(script) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const child = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', script], {
      cwd: ROOT,
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
  const modulePath = resolve(ROOT, migration.module)
  const migrationModule = await import(new URL(`file:///${modulePath.replace(/\\/g, '/')}`).href)
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
  if (publishOnly && !getExplicitReleaseRunId()) {
    throw new Error('release-publish requires an explicit --release-run-id=<id> or HH_RELEASE_RUN_ID; refusing implicit latest.')
  }
  const forceResume = publishOnly
  const resumeRunState = await getResumeRunState(forceResume)
  const miniprogramUpload = resolveMiniprogramUploadMetadata(resumeRunState?.context || {})
  assertFormalReleaseGitState(getFormalReleaseGitState({
    publishOnly,
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
  }
  const releaseRunId = await resolveReleaseRunId(forceResume)
  releaseContext.runId = releaseRunId
  const formalPlan = prepareOnly ? null : createFormalReleasePlan(releaseContext.gitSha)
  releaseContext.cloudFunctions = formalPlan?.targets.cloud.functions || []
  const releaseLedger = await createReleaseRunLedger({
    root: ROOT,
    runId: releaseRunId,
    command: ['node', 'scripts/deploy.mjs', ...process.argv.slice(2)].join(' '),
    gitSha: releaseContext.gitSha,
    version: releaseContext.version,
    desc: releaseContext.desc,
    envId: releaseContext.envId,
  })
  const resume = forceResume || hasFlag('resume')
  const reuseCheck = releaseStageReuseCheck(releaseContext)
  const releaseGuard = prepareOnly ? null : createProductionReleaseGuard(releaseContext, formalPlan)

  console.log(`[release-ledger] runId=${releaseLedger.runId}`)
  console.log(`[release-ledger] run=${releaseLedger.runPath}`)
  console.log(`[release-ledger] events=${releaseLedger.eventsPath}`)
  if (resume) console.log('[release-ledger] resume enabled; stages will be reused only after explicit evidence checks')
  if (prepareOnly) console.log('[release-ledger] prepare only; stopping after miniprogram build/gate evidence')

  try {
    if (!prepareOnly) {
      execSync('node scripts/ensure-release-control-plane.mjs', { cwd: ROOT, stdio: 'inherit' })
      await releaseGuard.acquire()
    }

    if (!formalPlan || formalPlan.targets.miniprogram) await runLedgerStage(releaseLedger, 'miniprogram-build-gate', {
      resume,
      mustReuse: publishOnly,
      reuseCheck,
      command: 'write build-info + npm run build:mp-weixin + npm run test:mp:release-gate -- --skip-mp-build',
    }, async () => {
      const preparedEvidence = await buildAndGateMiniprogramUpload({
        ...miniprogramUpload,
        releaseRunId: releaseLedger.runId,
      })
      return {
        evidence: await collectMiniprogramBuildGateEvidence(preparedEvidence),
        result: { version: miniprogramUpload.version, desc: miniprogramUpload.desc },
      }
    })
    else await releaseLedger.skipStage('miniprogram-build-gate', { reason: 'release plan has no miniprogram changes' })

    if (prepareOnly) {
      await releaseLedger.complete('prepared')
      return
    }

    await runLedgerStage(releaseLedger, 'release-operations', {
      command: 'execute allowlisted release actions and idempotent migrations declared by release/changes',
    }, async () => {
      const state = await releaseGuard.getProductionState()
      const result = await executeReleaseOperations({
        appliedMigrations: new Set(Object.keys(state?.appliedMigrations || {})),
        guard: releaseGuard,
        manifests: formalPlan.manifests,
        runAction: runDeclaredReleaseAction,
        runMigration: async (migration) => await runDeclaredReleaseMigration(migration, releaseContext),
      })
      return { result }
    })

    let cloudDeploy = { fns: [] }
    let cloudReleaseProbes = []
    if (formalPlan.targets.cloud.mode !== 'none') cloudDeploy = await runLedgerStage(releaseLedger, 'cloud-deploy', {
      resume,
      reuseCheck,
      command: `npm.cmd --workspace cloud run build && CloudBase CLI/COS fn deploy (concurrency=${getCloudDeployConcurrency()})`,
    }, async () => {
      const result = await deployCloud({
        afterFunctionDeploy: async (fn, record) => await releaseGuard.recordStage(`cloud:${fn}`, { evidence: record }),
        beforeFunctionDeploy: async (fn) => await releaseGuard.beforeRemoteMutation(`cloud:${fn}`),
        functions: formalPlan.targets.cloud.functions,
        requireCloudBaseCli: true,
        sourceSha: releaseContext.gitSha,
      })
      if (result.path !== 'cloudbase-cli') {
        throw new Error(`Formal release cloud deploy must use CloudBase CLI/COS before smoke; got ${result.path}. Rerun with --use-tcb.`)
      }
      return result
    })
    else await releaseLedger.skipStage('cloud-deploy', { reason: 'release plan has no cloud function changes' })

    if (cloudDeploy.fns.length) cloudReleaseProbes = await runLedgerStage(releaseLedger, 'cloud-version-probes', {
      command: 'invoke each deployed cloud function with its internal release probe token',
    }, async () => {
      const probes = readCloudReleaseProbes(cloudDeploy.fns)
      const verified = await verifyCloudReleaseProbes(probes)
      await releaseGuard.recordStage('cloud-version-probes', { evidence: { functions: verified.map((probe) => probe.functionName) } })
      return verified
    })
    else await releaseLedger.skipStage('cloud-version-probes', { reason: 'release plan has no cloud function changes' })

    if (cloudDeploy.fns.length) await runLedgerStage(releaseLedger, 'cloud-smoke', {
      resume,
      reuseCheck,
      command: `npm.cmd run test:cloud:release-smoke (concurrency=${getCloudSmokeConcurrency()})`,
    }, async () => {
      const summary = await runCloudSmoke(cloudDeploy.fns, releaseLedger.runId, {
        beforeEnsureIndexes: async () => await releaseGuard.beforeRemoteMutation('ensure-indexes'),
      })
      await releaseGuard.recordStage('cloud-smoke', { evidence: { summaryPath: resolve(summary.evidenceDir, 'summary.json') } })
      return {
        evidence: { summaryPath: resolve(summary.evidenceDir, 'summary.json') },
        result: {
          status: summary.status,
          evidenceDir: summary.evidenceDir,
          concurrency: summary.concurrency,
          labels: summary.labels,
          missingLabels: summary.missingLabels,
        },
      }
    })
    else await releaseLedger.skipStage('cloud-smoke', { reason: 'release plan has no cloud function changes' })

    if (formalPlan.targets.adminWeb) await runLedgerStage(releaseLedger, 'admin-web-deploy', {
      resume,
      reuseCheck,
      command: 'npm.cmd --workspace admin-web run build + admin-web deploy',
    }, async () => {
      await releaseGuard.beforeRemoteMutation('admin-web-deploy')
      await deployAdminWeb()
      await releaseGuard.recordStage('admin-web-deploy')
      return { result: { target: process.env.ADMIN_WEB_TARGET || 'aliyun' } }
    })
    else await releaseLedger.skipStage('admin-web-deploy', { reason: 'release plan has no admin-web changes' })

    if (formalPlan.targets.miniprogram) await runLedgerStage(releaseLedger, 'miniprogram-upload', {
      resume,
      reuseCheck,
      command: 'WeChat DevTools CLI upload or explicit miniprogram-ci fallback',
    }, async () => {
      const preparedPackageDigest = String(
        releaseLedger.state.stages['miniprogram-build-gate']?.evidence?.packageDigest || '',
      )
      if (!preparedPackageDigest) throw new Error('prepared miniprogram package digest is missing before upload')
      const currentPackageDigest = await computeDirectoryDigest(MP_DIST)
      if (currentPackageDigest !== preparedPackageDigest) {
        throw new Error(`miniprogram package changed after release UI validation: expected ${preparedPackageDigest}, got ${currentPackageDigest}`)
      }
      await releaseGuard.beforeRemoteMutation('miniprogram-upload')
      const uploadResult = await uploadBuiltMiniprogram(miniprogramUpload)
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
      if (uploadEvidence.method === 'devtools-cli') {
        if (!uploadInfoPath) throw new Error('upload evidence uploadInfoPath is missing')
        if (!existsSync(uploadInfoPath)) throw new Error(`upload info file not found: ${uploadInfoPath}`)
      }
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
        },
      }
    })
    else await releaseLedger.skipStage('verify-upload', { reason: 'release plan has no miniprogram changes' })

    if (releaseGuard) await releaseGuard.complete({
      components: releaseComponents({ cloudDeploy, cloudReleaseProbes, miniprogramUpload, plan: formalPlan, releaseContext }),
      evidence: { localReleaseRunId: releaseLedger.runId, planBaseSha: formalPlan.baseSha || null },
    })
    await releaseLedger.complete('passed')
  } catch (error) {
    if (releaseGuard && !releaseGuard.finished) {
      try {
        await releaseGuard.fail(error, { localReleaseRunId: releaseLedger.runId })
      } catch (guardError) {
        console.error(`[release-lock] failed to record release failure: ${guardError?.message || guardError}`)
      }
    }
    await releaseLedger.complete('failed')
    throw error
  }
}

const target = process.argv[2] || 'all'
if (target === 'release') {
  await runFormalRelease()
} else if (target === 'release-prepare') {
  await runFormalRelease({ prepareOnly: true })
} else if (target === 'release-publish') {
  await runFormalRelease({ publishOnly: true })
} else {
  if (target === 'cloud' || target === 'all') {
    const cloudDeploy = await deployCloud()
    if (process.argv.includes('--smoke')) await runCloudSmoke(cloudDeploy.fns)
  }
  if (target === 'miniprogram' || target === 'all') await deployMiniprogram()
  if (target === 'miniprogram-upload') await uploadMiniprogram()
  if (target === 'admin-web') await deployAdminWeb()
}
