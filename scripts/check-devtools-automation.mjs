/**
 * WeChat DevTools automation capability check.
 *
 * This script separates three different facts:
 * 1. IDE HTTP service is reachable.
 * 2. Legacy miniprogram-automator WebSocket is available only when the CLI
 *    supports --auto-port.
 * 3. Current DevTools auto-replay can run through the HTTP service.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_DEVTOOLS_PORT = 21929
const DEFAULT_CLI_CANDIDATES = process.platform === 'win32'
  ? [
      'X:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
      'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
    ]
  : [
      '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    ]

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
  const explicit = String(process.env.WECHAT_DEVTOOLS_CLI_PATH || '').trim()
  if (explicit) return existsSync(explicit) ? explicit : ''
  return DEFAULT_CLI_CANDIDATES.find((candidate) => existsSync(candidate)) || ''
}

function resolveProjectPath() {
  const projectPath = String(process.env.WECHAT_DEVTOOLS_PROJECT_PATH || DEFAULT_PROJECT_PATH).trim()
  return projectPath && existsSync(projectPath) ? projectPath : ''
}

async function resolveDevtoolsVersion(cliPath) {
  if (!cliPath || process.platform !== 'win32') return ''
  const packagePath = resolve(dirname(cliPath), 'code', 'package.nw', 'package.json')
  try {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'))
    return String(pkg.version || '')
  } catch {
    return ''
  }
}

function probeHttpPort(port, path = '/open') {
  if (!Number.isFinite(port) || port <= 0) return null
  const psCommand = [
    `$url = 'http://127.0.0.1:${port}${path}'`,
    '$ErrorActionPreference = "SilentlyContinue"',
    'try {',
    '  $req = [System.Net.WebRequest]::Create($url)',
    '  $req.AllowAutoRedirect = $false',
    '  $req.Timeout = 1200',
    '  $res = $req.GetResponse()',
    '  $code = [int]$res.StatusCode',
    '  $location = [string]$res.Headers["Location"]',
    '  $res.Close()',
    '  [pscustomobject]@{ status = $code; location = $location } | ConvertTo-Json -Compress',
    '} catch {',
    '  if ($_.Exception.Response) {',
    '    $res = $_.Exception.Response',
    '    $code = [int]$res.StatusCode',
    '    $location = [string]$res.Headers["Location"]',
    '    $res.Close()',
    '    [pscustomobject]@{ status = $code; location = $location } | ConvertTo-Json -Compress',
    '  } else {',
    '    [pscustomobject]@{ status = 0; location = ""; error = $_.Exception.Message } | ConvertTo-Json -Compress',
    '  }',
    '}',
  ].join('; ')

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCommand],
    { encoding: 'utf8', timeout: 5000 }
  )
  const text = String(result.stdout || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function detectRunningDevtoolsPort() {
  const explicit = process.env.WECHAT_DEVTOOLS_PORT
  if (explicit) return Number(explicit)
  if (process.platform !== 'win32') return DEFAULT_DEVTOOLS_PORT

  const psCommand = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$devtools = Get-Process wechatdevtools -ErrorAction SilentlyContinue',
    '$conns = Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $devtools.Id }',
    '$ports = $conns | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object',
    '$ports | ConvertTo-Json -Compress',
  ].join('; ')

  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCommand],
    { encoding: 'utf8', timeout: 10000 }
  )
  const text = String(result.stdout || '').trim()
  if (!text) return DEFAULT_DEVTOOLS_PORT
  let ports = []
  try {
    const parsed = JSON.parse(text)
    ports = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    ports = []
  }
  for (const rawPort of ports) {
    const port = Number(rawPort)
    const probe = probeHttpPort(port, '/open')
    if (probe?.status >= 300 && probe?.status < 400 && String(probe.location || '').startsWith('/v2/')) {
      return port
    }
  }
  return DEFAULT_DEVTOOLS_PORT
}

function assertCliCommandSupported(cliPath, command) {
  const result = runCli(cliPath, [command, '--help'], { timeout: 30000 })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0) {
    throw new Error(`cli ${command} --help failed with status ${result.status}`)
  }
  return output
}

function runAutoReplay(cliPath, projectPath, port) {
  const result = runCli(
    cliPath,
    ['auto-replay', '--project', projectPath, '--port', String(port), '--replay-all', '--trust-project'],
    { timeout: 300000 }
  )
  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) {
    throw new Error(`auto-replay exited with status ${result.status}`)
  }
  if (!output.includes('auto-replay finish')) {
    throw new Error('auto-replay did not report finish marker')
  }
}

async function main() {
  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  const port = detectRunningDevtoolsPort()

  if (!cliPath) throw new Error('WECHAT_DEVTOOLS_CLI_PATH is invalid or DevTools CLI was not found')
  if (!projectPath) throw new Error('WECHAT_DEVTOOLS_PROJECT_PATH is invalid or mp-weixin build output is missing')
  if (!Number.isFinite(port) || port <= 0) throw new Error('WECHAT_DEVTOOLS_PORT is invalid')

  const version = await resolveDevtoolsVersion(cliPath)
  const autoHelp = assertCliCommandSupported(cliPath, 'auto')
  const replayHelp = assertCliCommandSupported(cliPath, 'auto-replay')
  const supportsAutoPort = autoHelp.includes('--auto-port')
  const supportsAutoReplay = replayHelp.includes('--replay-all')
  const httpProbe = probeHttpPort(port, '/open')
  const isIdeHttpPort = httpProbe?.status >= 300 &&
    httpProbe?.status < 400 &&
    String(httpProbe.location || '').startsWith('/v2/')

  console.log('[DevTools automation capability]')
  console.log(`cliPath: ${cliPath}`)
  console.log(`version: ${version || '(unknown)'}`)
  console.log(`projectPath: ${projectPath}`)
  console.log(`httpPort: ${port}`)
  console.log(`httpPortProbe: status=${httpProbe?.status ?? 0} location=${httpProbe?.location || ''}`)
  console.log(`legacyAutomatorWebSocket: ${supportsAutoPort ? 'available-by-cli-help' : 'unavailable-cli-auto-port-missing'}`)
  console.log(`autoReplay: ${supportsAutoReplay ? 'available' : 'unavailable'}`)

  if (!isIdeHttpPort) {
    throw new Error(`port ${port} is not the DevTools IDE HTTP service port`)
  }
  if (!supportsAutoReplay) {
    throw new Error('cli auto-replay --help does not expose --replay-all')
  }
  if (!supportsAutoPort && process.env.HH_REQUIRE_LEGACY_AUTOMATOR === '1') {
    throw new Error('legacy miniprogram-automator is required, but cli auto --help lacks --auto-port')
  }

  if (!supportsAutoPort) {
    console.log('note: legacy miniprogram-automator WebSocket is not counted as passed on this DevTools version.')
    console.log('note: running official DevTools auto-replay through the IDE HTTP service instead.')
  }

  runAutoReplay(cliPath, projectPath, port)
  console.log('[OK] DevTools auto-replay finished via IDE HTTP service.')
}

main().catch((error) => {
  console.error(`[FAIL] ${error?.message || error}`)
  process.exit(1)
})
