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
 *   node scripts/deploy.mjs release              # cloud + admin-web + miniprogram-upload
 *
 * Flags:
 *   --only=a,b,c   filter cloud functions by name
 *   --version=x    version for miniprogram-upload (default: 1.0.YYMMDDHHmm)
 *   --desc=x       description for miniprogram-upload
 *   --use-tcb      force CloudBase CLI deploy path for cloud functions
 *   --use-ci       skip DevTools/CloudBase CLI paths, go straight to miniprogram-ci
 *                  (useful when DevTools is not installed on the machine)
 *
 * Deploy path resolution:
 *   Primary   = WeChat DevTools CLI `cloud functions deploy`
 *     - Uses the IDE's own network stack, sidesteps transparent proxy/IPv6 whitelist issues
 *     - Requires WeChat DevTools installed and IDE login/signing state to be valid
 *     - Parses output because DevTools can exit 0 while cloud deploy rows fail
 *   Diagnostic fallback = CloudBase CLI `fn deploy`
 *     - Official CloudBase path; on this machine auth works, but COS upload can time out
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
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { analyzeDevtoolsCloudDeployOutput, analyzeDevtoolsUploadOutput } from './lib/deploy-output.mjs'
import { shouldFallbackAfterDevtoolsFailure } from './lib/release-policy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPID = 'wx673b17363cd6b4a6'
const KEY_PATH = process.env.MP_PRIVATE_KEY_PATH || resolve(ROOT, `private.${APPID}.key`)
const MP_DIST = resolve(ROOT, 'miniprogram/dist/build/mp-weixin')
const CLOUD_DIST = resolve(ROOT, 'cloud/dist')
const ADMIN_WEB_DIR = resolve(ROOT, 'admin-web')
const ADMIN_WEB_DIST = resolve(ROOT, 'admin-web/dist')
const CLOUD_ENV = 'cloudbase-3gh862acb1505ff3'
const ADMIN_WEB_DEFAULT_API_URL = 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com'
const ADMIN_WEB_ALIYUN_HOST = process.env.ADMIN_WEB_SSH_HOST || 'aliyun'
const ADMIN_WEB_ALIYUN_ROOT = process.env.ADMIN_WEB_REMOTE_ROOT || '/var/www/happyhome-admin'
const CLOUD_FUNCTIONS = ['user', 'community', 'member', 'section', 'post', 'admin', 'http-gateway']

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

function getShortGitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
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
      process.stdout.write(text)
    })
    proc.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      process.stderr.write(text)
    })
    proc.on('exit', (code) => {
      const output = `${stdout}${stderr}`
      res({ ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}`, output })
    })
    proc.on('error', (err) => res({ ok: false, reason: String(err?.message || err), output: `${stdout}${stderr}` }))
  })
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

  const paths = fns.map((fn) => resolve(CLOUD_DIST, fn))
  const args = [
    'cloud', 'functions', 'deploy',
    '--env', CLOUD_ENV,
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

async function deployCloudViaCloudBaseCli(fns) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const tcb = (...args) => [npx, '--yes', '--package', '@cloudbase/cli', 'cloudbase', ...args].map(quote).join(' ')

  const authProbe = await runShellCapture(
    tcb('fn', 'list', '--env-id', CLOUD_ENV, '--json'),
    { displayCommandLine: `cloudbase fn list --env-id ${CLOUD_ENV} --json` }
  )
  if (!authProbe.ok) {
    return {
      ok: false,
      reason: `CloudBase CLI auth/env probe failed: ${authProbe.reason}. Run "cloudbase login" or "cloudbase login --apiKeyId <id> --apiKey <key>" and retry.`,
    }
  }

  for (const fn of fns) {
    const fnDir = resolve(CLOUD_DIST, fn)
    const result = await runShellCapture(
      tcb('fn', 'deploy', fn, '--dir', fnDir, '--force', '--yes', '--env-id', CLOUD_ENV, '--json'),
      { displayCommandLine: `cloudbase fn deploy ${fn} --dir ${fnDir} --force --yes --env-id ${CLOUD_ENV} --json` }
    )
    if (!result.ok) return { ok: false, reason: `CloudBase CLI deploy ${fn} failed: ${result.reason}` }
  }

  return { ok: true, reason: 'ok' }
}

// ── Fallback deploy path: miniprogram-ci ──
// Subject to WeChat CI IP 白名单 (mp.weixin.qq.com → 开发管理 → 代码上传)
// Prone to IPv6/transparent-proxy issues despite DNS patching.
async function deployCloudViaMiniprogramCi(fns) {
  for (const fn of fns) {
    console.log(`[miniprogram-ci] Uploading: ${fn}`)
    await ci.cloud.uploadFunction({
      project: getCiProject(),
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: CLOUD_ENV,
      remoteNpmInstall: true,
    })
    console.log(`  OK: ${fn}`)
  }
}

async function deployCloud() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const onlyList = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null
  const fns = onlyList && onlyList.length
    ? CLOUD_FUNCTIONS.filter((f) => onlyList.includes(f))
    : CLOUD_FUNCTIONS
  if (onlyList) console.log(`Filtering to: ${fns.join(', ')}`)

  console.log('\nBuilding cloud functions...')
  execSync('node build.mjs', {
    cwd: resolve(ROOT, 'cloud'),
    stdio: 'inherit',
    env: { ...process.env, HH_CLOUD_BUILD_ONLY: onlyList ? fns.join(',') : '' },
  })

  const forceCi = process.argv.includes('--use-ci')
  const forceTcb = process.argv.includes('--use-tcb')

  if (forceTcb) {
    console.log('\n[--use-tcb] Attempting deploy via CloudBase CLI...')
    const tcbResult = await deployCloudViaCloudBaseCli(fns)
    if (tcbResult.ok) {
      console.log('[OK] Cloud functions deployed via CloudBase CLI')
      return
    }
    const nextPath = forceCi ? 'falling back to miniprogram-ci' : 'trying WeChat DevTools CLI'
    console.log(`[!] CloudBase CLI failed (${tcbResult.reason}) - ${nextPath}`)
  }

  if (!forceCi) {
    console.log('\n[primary] Attempting deploy via WeChat DevTools CLI...')
    const result = await deployCloudViaDevtoolsCli(fns)
    if (result.ok) {
      console.log('[OK] Cloud functions deployed via DevTools CLI')
      return
    }
    if (!shouldFallbackAfterDevtoolsFailure({ target: 'cloud', reason: result.reason, forceCi })) {
      throw new Error(`DevTools CLI cloud deploy failed (${result.reason}). Open WeChat DevTools, log in again, then retry deploy.`)
    }
    if (!forceTcb) {
      console.log(`[!] DevTools CLI failed (${result.reason}) - trying CloudBase CLI`)

      console.log('\n[fallback] Attempting deploy via CloudBase CLI...')
      const tcbResult = await deployCloudViaCloudBaseCli(fns)
      if (tcbResult.ok) {
        console.log('[OK] Cloud functions deployed via CloudBase CLI')
        return
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
  const args = [
    'upload',
    '--project', MP_DIST,
    '--version', version,
    '--desc', desc,
    '--info-output', infoPath,
  ]

  const commandLine = [cli, ...args].map(quote).join(' ')
  console.log(`[DevTools CLI] ${commandLine}`)
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
  return { ok: true, reason: `ok; info-output=${infoPath}` }
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

function resolveMiniprogramUploadMetadata() {
  const stamp = getLocalTimestamp()
  const shortSha = getShortGitSha()
  return {
    version: getFlagValue('version') || `1.0.${stamp.yy}${stamp.MM}${stamp.dd}${stamp.hh}${stamp.mm}`,
    desc: getFlagValue('desc') || `trial ${stamp.yyyy}-${stamp.MM}-${stamp.dd} ${stamp.hh}:${stamp.mm} ${shortSha}`,
    forceCi: process.argv.includes('--use-ci'),
  }
}

function buildAndGateMiniprogramUpload({ version, desc }) {
  writeMiniprogramBuildInfo(version, desc)

  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  console.log('\nRunning miniprogram release gate...')
  execSync('npm run test:mp:release-gate -- --skip-mp-build', { cwd: ROOT, stdio: 'inherit' })
}

async function uploadBuiltMiniprogram({ version, desc, forceCi }) {
  console.log(`\nMiniprogram upload version: ${version}`)
  console.log(`Miniprogram upload desc: ${desc}`)

  if (!forceCi) {
    console.log('\n[primary] Uploading via WeChat DevTools CLI...')
    const result = await uploadMiniprogramViaDevtoolsCli(version, desc)
    if (result.ok) {
      console.log('[OK] Miniprogram uploaded via DevTools CLI (no preview QR generated)')
      return
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
  buildAndGateMiniprogramUpload(upload)
  await uploadBuiltMiniprogram(upload)
}

function buildAdminWeb(defaultRouterMode) {
  console.log('\nBuilding admin-web...')
  const env = {
    ...process.env,
    VITE_CLOUD_API_URL: process.env.VITE_CLOUD_API_URL || ADMIN_WEB_DEFAULT_API_URL,
    VITE_ROUTER_MODE: process.env.VITE_ROUTER_MODE || defaultRouterMode,
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execSync(`${npm} run build`, { cwd: ADMIN_WEB_DIR, stdio: 'inherit', env })
  return env
}

async function deployAdminWebToCloudBase() {
  const env = buildAdminWeb('hash')
  const cloudPath = process.env.ADMIN_WEB_CLOUD_PATH || '/'
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
  args.push('-e', CLOUD_ENV)

  console.log('\nDeploying admin-web dist to CloudBase static hosting...')
  console.log(`Using VITE_CLOUD_API_URL=${env.VITE_CLOUD_API_URL}`)
  const result = await runShell(args.map(quote).join(' '))
  if (!result.ok) {
    throw new Error(`Admin web deploy failed: ${result.reason}. Ensure CloudBase CLI is logged in and static hosting is enabled for ${CLOUD_ENV}.`)
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

const target = process.argv[2] || 'all'
if (target === 'release') {
  const miniprogramUpload = resolveMiniprogramUploadMetadata()
  buildAndGateMiniprogramUpload(miniprogramUpload)
  await deployCloud()
  await deployAdminWeb()
  await uploadBuiltMiniprogram(miniprogramUpload)
} else {
  if (target === 'cloud' || target === 'all') await deployCloud()
  if (target === 'miniprogram' || target === 'all') await deployMiniprogram()
  if (target === 'miniprogram-upload') await uploadMiniprogram()
  if (target === 'admin-web') await deployAdminWeb()
}
