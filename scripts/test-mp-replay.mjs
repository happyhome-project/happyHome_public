/**
 * WeChat DevTools auto-replay runner.
 *
 * Strict release mode:
 *   HH_REQUIRE_RELEASE_REPLAY=1 npm.cmd run test:mp:replay -- --replay-config-path <file-or-dir>
 *
 * The replay config/file tree must contain these labels so the release gate can
 * prove it is not merely checking that DevTools can start:
 *   HH_RELEASE_HOME_DETAIL_NONEMPTY
 *   HH_RELEASE_PROFILE_LOGIN_CLEAN
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  assertAutoReplayFinished,
  assertReleaseReplayCoverage,
  buildAutoReplayArgs,
  resolveReplayConfigPath,
  shouldRequireReleaseReplay,
} from './lib/mp-replay-policy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const DEFAULT_DEVTOOLS_PORT = 21929
const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_CLI_PATH = process.platform === 'win32'
  ? 'X:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat'
  : ''

function quoteForPowerShell(arg) {
  const str = String(arg)
  return `'${str.replace(/'/g, "''")}'`
}

function runCli(cliPath, args, options = {}) {
  const baseOptions = { encoding: 'utf8', ...options }
  if (process.platform === 'win32') {
    const psCommand = `& ${quoteForPowerShell(cliPath)} ${args.map(quoteForPowerShell).join(' ')}`
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], baseOptions)
  }
  return spawnSync(cliPath, args, baseOptions)
}

function resolveCliPath() {
  const cliPath = String(
    process.env.WECHAT_DEVTOOLS_CLI_PATH ||
    process.env.WX_DEVTOOLS_CLI ||
    DEFAULT_CLI_PATH
  ).trim()
  if (!cliPath || !existsSync(cliPath)) return ''
  return cliPath
}

function resolveProjectPath() {
  const projectPath = String(process.env.WECHAT_DEVTOOLS_PROJECT_PATH || DEFAULT_PROJECT_PATH).trim()
  if (!projectPath || !existsSync(projectPath)) return ''
  return projectPath
}

function detectRunningDevtoolsPort() {
  if (process.platform !== 'win32') return 0
  const psCommand = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$conns = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -in @("127.0.0.1","::1","0.0.0.0","::") }',
    '$items = foreach ($c in $conns) {',
    '  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue',
    '  if ($p -and ($p.ProcessName -like "*wechatdevtools*")) {',
    '    $status = 0',
    '    $location = ""',
    '    try {',
    '      $req = [System.Net.WebRequest]::Create("http://127.0.0.1:$($c.LocalPort)/open")',
    '      $req.AllowAutoRedirect = $false',
    '      $req.Timeout = 1000',
    '      $res = $req.GetResponse()',
    '      $status = [int]$res.StatusCode',
    '      $location = [string]$res.Headers["Location"]',
    '      $res.Close()',
    '    } catch {',
    '      if ($_.Exception.Response) {',
    '        $status = [int]$_.Exception.Response.StatusCode',
    '        $location = [string]$_.Exception.Response.Headers["Location"]',
    '        $_.Exception.Response.Close()',
    '      }',
    '    }',
    '    [pscustomobject]@{ port = $c.LocalPort; process = $p.ProcessName; status = $status; location = $location; isIde = ($status -ge 300 -and $status -lt 400 -and $location -like "/v2/*") }',
    '  }',
    '}',
    '$items | Sort-Object @{ Expression = { if ($_.isIde) { 0 } else { 1 } } }, port -Unique | ConvertTo-Json -Compress',
  ].join('; ')

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCommand],
    { encoding: 'utf8', timeout: 10000 }
  )
  const text = String(result.stdout || '').trim()
  if (!text) return 0
  try {
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    const row = rows.find((item) => item?.isIde && Number(item?.port) > 0) ||
      rows.find((item) => Number(item?.port) > 0)
    return Number(row?.port || 0)
  } catch {
    return 0
  }
}

function resolveDevtoolsPort() {
  const explicit = process.env.WECHAT_DEVTOOLS_PORT
  if (explicit) return Number(explicit)
  return detectRunningDevtoolsPort() || DEFAULT_DEVTOOLS_PORT
}

function fail(message) {
  console.error(`[FAIL] ${message}`)
  process.exit(1)
}

function main() {
  const replayConfigPath = resolveReplayConfigPath({ cwd: ROOT })
  const requireReleaseReplay = shouldRequireReleaseReplay()

  if (requireReleaseReplay) {
    try {
      assertReleaseReplayCoverage(replayConfigPath)
    } catch (error) {
      fail(`${error?.message || error}\nRecord/label DevTools replay cases with HH_RELEASE_HOME_DETAIL_NONEMPTY and HH_RELEASE_PROFILE_LOGIN_CLEAN before release upload.`)
    }
  }

  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  const devtoolsPort = resolveDevtoolsPort()

  if (!Number.isFinite(devtoolsPort) || devtoolsPort <= 0) fail('Invalid WECHAT_DEVTOOLS_PORT. It must be a positive number.')
  if (!cliPath) fail('WECHAT_DEVTOOLS_CLI_PATH is invalid or not found.')
  if (!projectPath) fail('WECHAT_DEVTOOLS_PROJECT_PATH is invalid or not found.')

  console.log('[DevTools auto-replay]')
  console.log(`cliPath: ${cliPath}`)
  console.log(`projectPath: ${projectPath}`)
  console.log(`port: ${devtoolsPort}`)
  if (replayConfigPath) console.log(`replayConfigPath: ${replayConfigPath}`)
  if (requireReleaseReplay) console.log('releaseReplay: required')

  const args = buildAutoReplayArgs({ projectPath, port: devtoolsPort, replayConfigPath })
  const result = runCli(cliPath, args, { timeout: 300000 })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')

  if (result.status !== 0) fail(`auto-replay exited with status ${result.status}`)
  try {
    assertAutoReplayFinished(output)
  } catch (error) {
    fail(error?.message || error)
  }

  console.log('[OK] DevTools auto-replay completed.')
}

main()
