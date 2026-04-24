/**
 * One-click deployment script.
 *
 * Usage:
 *   node scripts/deploy.mjs cloud                # upload all cloud functions
 *   node scripts/deploy.mjs cloud --only=post    # upload only post (comma-separated ok)
 *   node scripts/deploy.mjs miniprogram          # upload mini program (preview QR)
 *   node scripts/deploy.mjs all                  # cloud + miniprogram
 *
 * Flags:
 *   --only=a,b,c   filter cloud functions by name
 *   --use-ci       skip DevTools CLI primary path, go straight to miniprogram-ci
 *                  (useful when DevTools is not installed on the machine)
 *
 * Deploy path resolution:
 *   Primary   = WeChat DevTools CLI `cloud functions deploy`
 *     - Uses the IDE's own network stack, sidesteps透明代理/IPv6 whitelist issues
 *     - Requires WeChat DevTools installed AND IDE logged in as admin (扫码过)
 *   Fallback  = miniprogram-ci `cloud.uploadFunction`
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
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawn } from 'child_process'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const APPID = 'wx673b17363cd6b4a6'
const KEY_PATH = resolve(ROOT, `private.${APPID}.key`)
const MP_DIST = resolve(ROOT, 'miniprogram/dist/build/mp-weixin')
const CLOUD_DIST = resolve(ROOT, 'cloud/dist')
const CLOUD_ENV = 'cloudbase-3gh862acb1505ff3'
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

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: MP_DIST,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
})

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
  const quote = (s) => (/[ \t&|<>()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s)
  const commandLine = [cli, ...args].map(quote).join(' ')
  console.log(`[DevTools CLI] ${commandLine}`)

  return await new Promise((res) => {
    const proc = spawn(commandLine, { stdio: 'inherit', shell: true })
    proc.on('exit', (code) => res({ ok: code === 0, reason: code === 0 ? 'ok' : `exit code ${code}` }))
    proc.on('error', (err) => res({ ok: false, reason: String(err?.message || err) }))
  })
}

// ── Fallback deploy path: miniprogram-ci ──
// Subject to WeChat CI IP 白名单 (mp.weixin.qq.com → 开发管理 → 代码上传)
// Prone to IPv6/transparent-proxy issues despite DNS patching.
async function deployCloudViaMiniprogramCi(fns) {
  for (const fn of fns) {
    console.log(`[miniprogram-ci] Uploading: ${fn}`)
    await ci.cloud.uploadFunction({
      project,
      name: fn,
      path: resolve(CLOUD_DIST, fn),
      env: CLOUD_ENV,
      remoteNpmInstall: true,
    })
    console.log(`  OK: ${fn}`)
  }
}

async function deployCloud() {
  console.log('\nBuilding cloud functions...')
  execSync('node build.mjs', { cwd: resolve(ROOT, 'cloud'), stdio: 'inherit' })

  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const onlyList = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null
  const fns = onlyList && onlyList.length
    ? CLOUD_FUNCTIONS.filter((f) => onlyList.includes(f))
    : CLOUD_FUNCTIONS
  if (onlyList) console.log(`Filtering to: ${fns.join(', ')}`)

  const forceCi = process.argv.includes('--use-ci')

  if (!forceCi) {
    console.log('\n[primary] Attempting deploy via WeChat DevTools CLI...')
    const result = await deployCloudViaDevtoolsCli(fns)
    if (result.ok) {
      console.log('[✓] Cloud functions deployed via DevTools CLI')
      return
    }
    console.log(`[!] DevTools CLI failed (${result.reason}) — falling back to miniprogram-ci`)
  } else {
    console.log('\n[--use-ci] Skipping DevTools CLI, using miniprogram-ci directly')
  }

  console.log('\n[fallback] Deploying via miniprogram-ci...')
  await deployCloudViaMiniprogramCi(fns)
  console.log('[✓] Cloud functions deployed via miniprogram-ci')
}

async function deployMiniprogram() {
  console.log('\nBuilding miniprogram...')
  execSync('npm run build:mp-weixin', { cwd: resolve(ROOT, 'miniprogram'), stdio: 'inherit' })

  console.log('Generating preview QR code...')
  await ci.preview({
    project,
    desc: 'auto preview',
    setting: { es6: true, minified: false },
    qrcodeFormat: 'terminal',
    qrcodeOutputDest: resolve(ROOT, 'preview-qr.jpg'),
  })
  console.log('Miniprogram preview ready! Scan preview-qr.jpg')
}

const target = process.argv[2] || 'all'
if (target === 'cloud' || target === 'all') await deployCloud()
if (target === 'miniprogram' || target === 'all') await deployMiniprogram()
