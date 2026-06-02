/**
 * 小程序真实测试（DevTools CLI auto-replay）
 *
 * 适用于新版微信开发者工具在 miniprogram-automator 协议不兼容时的回退方案。
 *
 * 可选环境变量：
 *   WECHAT_DEVTOOLS_CLI_PATH
 *   WECHAT_DEVTOOLS_PROJECT_PATH
 *   WECHAT_DEVTOOLS_PORT
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

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
  const cliPath = String(process.env.WECHAT_DEVTOOLS_CLI_PATH || DEFAULT_CLI_PATH).trim()
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
  } catch (_error) {
    return 0
  }
}

function resolveDevtoolsPort() {
  const explicit = process.env.WECHAT_DEVTOOLS_PORT
  if (explicit) return Number(explicit)
  return detectRunningDevtoolsPort() || DEFAULT_DEVTOOLS_PORT
}

function main() {
  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  const devtoolsPort = resolveDevtoolsPort()

  if (!Number.isFinite(devtoolsPort) || devtoolsPort <= 0) {
    console.error('❌ Invalid WECHAT_DEVTOOLS_PORT. It must be a positive number.')
    process.exit(1)
  }
  if (!cliPath) {
    console.error('❌ WECHAT_DEVTOOLS_CLI_PATH is invalid or not found.')
    process.exit(1)
  }
  if (!projectPath) {
    console.error('❌ WECHAT_DEVTOOLS_PROJECT_PATH is invalid or not found.')
    process.exit(1)
  }

  console.log('🎬 Running DevTools auto-replay...')
  console.log(`   cliPath: ${cliPath}`)
  console.log(`   projectPath: ${projectPath}`)
  console.log(`   port: ${devtoolsPort}`)

  const args = [
    'auto-replay',
    '--project', projectPath,
    '--port', String(devtoolsPort),
    '--replay-all',
    '--trust-project',
  ]

  const result = runCli(cliPath, args, { timeout: 300000 })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')

  if (result.status !== 0) {
    console.error(`❌ auto-replay exited with status ${result.status}`)
    process.exit(result.status || 1)
  }
  if (!output.includes('auto-replay finish')) {
    console.error('❌ auto-replay did not report finish marker.')
    process.exit(1)
  }

  console.log('✅ DevTools auto-replay completed.')
}

main()
