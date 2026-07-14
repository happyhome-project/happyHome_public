/**
 * WeChat DevTools release UI gate.
 *
 * This script opens the built mp-weixin package through the DevTools automator
 * websocket and proves the release-critical paths:
 *   - HH_RELEASE_HOME_COLD_START_NONEMPTY
 *   - HH_RELEASE_HOME_IMAGES_RENDERED
 *   - HH_RELEASE_HOME_ARCHIVE_TABS_STICKY
 *   - HH_RELEASE_HOME_DETAIL_NONEMPTY
 *   - HH_RELEASE_LOGIN_VERSION
 *   - HH_RELEASE_PROFILE_LOGIN_CLEAN
 *
 * It does not upload, does not generate QR codes, and does not require an
 * auto-replay recording.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { withValidationLease } from './lib/validation-lease.mjs'
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

import {
  assertReleaseUiEvidence,
  assertColdStartDevToolsEnabled,
  buildDevToolsAutoArgs,
  buildDevToolsCacheArgs,
  buildDevToolsCloseArgs,
  buildDevToolsQuitPortArgs,
} from './lib/mp-release-ui-policy.mjs'
import { requireAdminInternalToken } from './lib/admin-internal-token.mjs'
import {
  analyzeCloudInvoke,
  buildTcbCommand,
  defaultRunner as runCloudBaseCommand,
  extractFunctionResult,
  parseFirstJson,
} from './cloud-release-smoke.mjs'
import { computeDirectoryDigest } from './lib/release-run-ledger.mjs'
import { runReleaseUiChecks } from './lib/release-ui-check-runner.mjs'
import { cleanupReleaseFixtureWithRetry } from './lib/release-ui-fixture-cleanup.mjs'
import { applyAndWaitForReleaseFixtureSelection } from './lib/release-ui-fixture-selection.mjs'
import { invokeTrustedAdminCloud } from './lib/trusted-admin-invoke.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_IDE_PORT = 21929
const DEFAULT_AUTO_PORT = 9420
const HOME_POST_SELECTORS = ['.live-row', '.guide-card', '.arc-item', '.post-card']
const RELEASE_FIXTURE_PREFIX = 'HH_RELEASE_UI_'
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function expectedBuildVersion() {
  try {
    const source = readFileSync(resolve(ROOT, 'miniprogram', 'src', 'generated', 'build-info.ts'), 'utf8')
    return source.match(/version:\s*["']([^"']+)["']/)?.[1] || ''
  } catch {
    return ''
  }
}

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

function runPowerShell(script, options = {}) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: options.timeout || 30000 },
  )
}

function canConnect(host, port, timeoutMs = 700) {
  return new Promise((resolveConnect) => {
    const socket = net.createConnection({ host, port })
    const done = (ok) => {
      socket.removeAllListeners()
      socket.destroy()
      resolveConnect(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitForTcpPort(port, options = {}) {
  const host = options.host || '127.0.0.1'
  const timeoutMs = Number(options.timeoutMs || 15000)
  const intervalMs = Number(options.intervalMs || 500)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) return true
    await sleep(intervalMs)
  }
  return false
}

async function waitForTcpPortClosed(port, options = {}) {
  const host = options.host || '127.0.0.1'
  const timeoutMs = Number(options.timeoutMs || 10000)
  const intervalMs = Number(options.intervalMs || 500)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await canConnect(host, port))) return true
    await sleep(intervalMs)
  }
  return false
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ])
}

function resolveProjectPath() {
  const projectPath = String(process.env.WECHAT_DEVTOOLS_PROJECT_PATH || DEFAULT_PROJECT_PATH).trim()
  return projectPath && existsSync(projectPath) ? projectPath : ''
}

function resolveCliPath() {
  const explicit = String(process.env.WECHAT_DEVTOOLS_CLI_PATH || process.env.WX_DEVTOOLS_CLI || '').trim()
  if (explicit) return existsSync(explicit) ? explicit : ''
  if (process.platform !== 'win32') return ''

  const bases = [
    'X:\\Program Files (x86)\\Tencent',
    'C:\\Program Files (x86)\\Tencent',
    'C:\\Program Files\\Tencent',
  ]
  for (const base of bases) {
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const cliPath = resolve(base, entry.name, 'cli.bat')
      if (existsSync(cliPath)) return cliPath
    }
  }
  return ''
}

function detectIdePort() {
  const explicit = Number(process.env.WECHAT_DEVTOOLS_PORT || 0)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return detectRunningDevToolsIdePort() || DEFAULT_IDE_PORT
}

function detectAutoPort() {
  const explicit = Number(process.env.WECHAT_DEVTOOLS_AUTO_PORT || process.env.WS_PORT || 0)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return DEFAULT_AUTO_PORT
}

function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(String(text || '').trim())
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}

function probeIdeHttpPort(port) {
  if (!Number.isFinite(port) || port <= 0 || process.platform !== 'win32') return false
  const script = [
    `$url = 'http://127.0.0.1:${port}/open'`,
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
    '  }',
    '}',
  ].join('; ')
  const result = runPowerShell(script, { timeout: 5000 })
  const probe = parseJsonArray(result.stdout)[0] || {}
  return probe.status >= 300 &&
    probe.status < 400 &&
    String(probe.location || '').startsWith('/v2/')
}

function detectRunningDevToolsIdePort() {
  if (process.platform !== 'win32') return 0
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$devtools = Get-Process wechatdevtools -ErrorAction SilentlyContinue',
    'if (-not $devtools) { @() | ConvertTo-Json -Compress; return }',
    '$conns = Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in $devtools.Id }',
    '$ports = $conns | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object',
    '$ports | ConvertTo-Json -Compress',
  ].join('; ')
  const result = runPowerShell(script, { timeout: 10000 })
  for (const rawPort of parseJsonArray(result.stdout)) {
    const port = Number(rawPort)
    if (probeIdeHttpPort(port)) return port
  }
  return 0
}

function envPositiveInt(name, fallback) {
  const explicit = Number(process.env[name] || 0)
  return Number.isFinite(explicit) && explicit > 0 ? Math.floor(explicit) : fallback
}

function readOptionalText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function uniqueExistingDirs(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => resolve(String(item))))].filter((item) => existsSync(item))
}

function devToolsDefaultDirs() {
  if (process.platform !== 'win32') return []
  const localAppDataDirs = uniqueExistingDirs([
    process.env.LOCALAPPDATA,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local') : '',
  ])
  const result = []
  for (const localAppData of localAppDataDirs) {
    const userDataRoot = join(localAppData, '微信开发者工具', 'User Data')
    if (!existsSync(userDataRoot)) continue
    for (const entry of readdirSync(userDataRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const defaultDir = join(userDataRoot, entry.name, 'Default')
      if (existsSync(defaultDir)) result.push(defaultDir)
    }
  }
  return uniqueExistingDirs(result)
}

function makeBackupPath(path) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  let candidate = `${path}.codex-stale-${stamp}`
  for (let index = 2; existsSync(candidate); index += 1) {
    candidate = `${path}.codex-stale-${stamp}-${index}`
  }
  return candidate
}

function moveCacheDir(path, label, moved) {
  if (!existsSync(path)) return
  const backup = makeBackupPath(path)
  try {
    renameSync(path, backup)
    moved.push({ path, backup, label })
  } catch (error) {
    console.warn(`[release-ui] failed to move DevTools ${label} cache ${path}: ${error?.message || error}`)
  }
}

function clearDevToolsRuntimeCacheDirs(reason) {
  if (process.env.HH_RELEASE_UI_RENAME_DEVTOOLS_CACHE === '0') return []
  const moved = []
  for (const defaultDir of devToolsDefaultDirs()) {
    const profileRoot = dirname(defaultDir)
    moveCacheDir(join(profileRoot, 'WeappCache', 'WeappCompileCache'), 'compile', moved)

    const extRoot = join(defaultDir, 'Storage', 'ext', 'mbeenbnhnmdhkbicabncjghgnikfbgjh')
    if (!existsSync(extRoot)) continue
    for (const entry of readdirSync(extRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const storageRoot = join(extRoot, entry.name)
      moveCacheDir(join(storageRoot, 'Cache'), 'extension HTTP', moved)
      moveCacheDir(join(storageRoot, 'Code Cache'), 'extension code', moved)
    }
  }
  for (const item of moved) {
    console.log(`[release-ui] moved DevTools ${item.label} cache ${item.path} -> ${item.backup} (${reason})`)
  }
  return moved
}

async function clearStaleIdePortFiles(idePort) {
  if (process.env.HH_RELEASE_UI_CLEAR_STALE_IDE === '0') return []
  const moved = []
  for (const defaultDir of devToolsDefaultDirs()) {
    const ideStatusPath = join(defaultDir, '.ide-status')
    const idePath = join(defaultDir, '.ide')
    if (!existsSync(ideStatusPath) || !existsSync(idePath)) continue
    const raw = readOptionalText(idePath).trim()
    const recordedPort = Number(raw)
    if (!Number.isFinite(recordedPort) || recordedPort <= 0) {
      const backup = makeBackupPath(idePath)
      renameSync(idePath, backup)
      moved.push({ idePath, backup, raw, reason: 'invalid port' })
      continue
    }
    if (recordedPort === idePort) continue
    const listening = await canConnect('127.0.0.1', recordedPort, 500)
    if (listening) {
      console.warn(`[release-ui] DevTools .ide points to active port ${recordedPort}; keeping ${idePath}`)
      continue
    }
    const backup = makeBackupPath(idePath)
    renameSync(idePath, backup)
    moved.push({ idePath, backup, raw, reason: 'stale port' })
  }
  for (const item of moved) {
    console.log(`[release-ui] moved stale DevTools IDE port file ${item.idePath} -> ${item.backup} (${item.reason}: ${item.raw})`)
  }
  return moved
}

function stopStaleDevToolsAutoProcesses({ cliPath, projectPath, autoPort }) {
  if (process.platform !== 'win32' || process.env.HH_RELEASE_UI_STOP_STALE_AUTOMATOR === '0') return 0
  const root = dirname(cliPath)
  const script = `
$root = ${quoteForPowerShell(root)}
$project = ${quoteForPowerShell(projectPath)}
$autoPort = ${quoteForPowerShell(String(autoPort))}
$autoTargets = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and
  $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and
  $_.CommandLine -and
  $_.CommandLine.Contains('auto --project') -and
  $_.CommandLine.Contains($project) -and
  $_.CommandLine.Contains('--auto-port') -and
  $_.CommandLine.Contains($autoPort)
}
$autoPortProcessIds = @(
  Get-NetTCPConnection -State Listen -LocalPort ([int]$autoPort) -ErrorAction SilentlyContinue |
    ForEach-Object { $_.OwningProcess } |
    Where-Object { $_ -gt 0 } |
    Sort-Object -Unique
)
$portTargets = @()
if ($autoPortProcessIds.Count -gt 0) {
  $portTargets = Get-CimInstance Win32_Process | Where-Object {
    $autoPortProcessIds -contains $_.ProcessId -and
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine -and
    $_.CommandLine.Contains('--type=renderer')
  }
}
$targets = @($autoTargets) + @($portTargets) | Sort-Object -Property ProcessId -Unique
$count = 0
foreach ($p in $targets) {
  $count += 1
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output $count
`
  const result = runPowerShell(script, { timeout: 30000 })
  const count = Number(String(result.stdout || '').trim().split(/\s+/).pop() || 0)
  if (result.status !== 0) {
    console.warn(`[release-ui] failed to stop stale DevTools auto processes: ${(result.stderr || result.stdout || '').trim()}`)
    return 0
  }
  if (count > 0) {
    console.log(`[release-ui] stopped ${count} stale DevTools auto process(es) for this project`)
  }
  return count
}

function stopDevToolsPortProcesses({ cliPath, ports, reason }) {
  if (process.platform !== 'win32' || process.env.HH_RELEASE_UI_FORCE_STOP_PORT_PROCESS === '0') return 0
  const root = dirname(cliPath)
  const portValues = ports.map((port) => `[int]${Number(port)}`).join(',')
  const script = `
$root = ${quoteForPowerShell(root)}
$ports = @(${portValues})
$portProcessIds = @(
  Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue |
    ForEach-Object { $_.OwningProcess } |
    Where-Object { $_ -gt 0 } |
    Sort-Object -Unique
)
$targets = @()
if ($portProcessIds.Count -gt 0) {
  $targets = Get-CimInstance Win32_Process | Where-Object {
    $portProcessIds -contains $_.ProcessId -and
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)
  }
}
$count = 0
foreach ($p in $targets) {
  $count += 1
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Output $count
`
  const result = runPowerShell(script, { timeout: 30000 })
  const count = Number(String(result.stdout || '').trim().split(/\s+/).pop() || 0)
  if (result.status !== 0) {
    console.warn(`[release-ui] failed to stop DevTools port process(es): ${(result.stderr || result.stdout || '').trim()}`)
    return 0
  }
  if (count > 0) {
    console.log(`[release-ui] stopped ${count} DevTools process(es) still listening after ${reason}`)
  }
  return count
}

function runAutomatorStart(cliPath, args, label) {
  if (label) console.log(`[release-ui] ${label}`)
  const result = runCli(cliPath, args, { timeout: 120000 })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) {
    throw new Error(`DevTools cli auto failed with status ${result.status}: ${output.trim()}`)
  }
  if (!/auto/i.test(output)) {
    throw new Error('DevTools cli auto did not report automation start.')
  }
  return output
}

function runDevToolsMaintenance(cliPath, args, label, options = {}) {
  console.log(`[release-ui] ${label}`)
  const result = runCli(cliPath, args, { timeout: options.timeout || 120000 })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.status !== 0) {
    const message = `DevTools maintenance command failed with status ${result.status}: ${output.trim()}`
    if (options.required) throw new Error(message)
    console.warn(`[release-ui] ${message}`)
  }
  return output
}

async function quitDevTools(cliPath, idePort, autoPort, reason) {
  console.log(`[release-ui] quit DevTools before auto (${reason})`)
  const quitResult = runCli(cliPath, buildDevToolsQuitPortArgs({ idePort }), { timeout: 60000 })
  process.stdout.write(quitResult.stdout || '')
  process.stderr.write(quitResult.stderr || '')
  if (quitResult.status !== 0) {
    console.warn(`[release-ui] DevTools quit returned status ${quitResult.status}`)
  }
  if (!(await waitForTcpPortClosed(autoPort, { timeoutMs: 12000 }))) {
    console.warn(`[release-ui] automator port ${autoPort} was still reachable after quit`)
  }
  if (!(await waitForTcpPortClosed(idePort, { timeoutMs: 20000 }))) {
    console.warn(`[release-ui] IDE HTTP port ${idePort} was still reachable after quit; stopping the owning DevTools process`)
    stopDevToolsPortProcesses({ cliPath, ports: [idePort], reason })
    if (!(await waitForTcpPortClosed(idePort, { timeoutMs: 12000 }))) {
      console.warn(`[release-ui] IDE HTTP port ${idePort} was still reachable after forced stop`)
    }
  }
  await sleep(1500)
  clearDevToolsRuntimeCacheDirs(reason)
}

async function refreshDevToolsProjectCache({ cliPath, projectPath, idePort, autoPort }) {
  if (process.env.HH_RELEASE_UI_REFRESH_DEVTOOLS_CACHE === '0') return
  runDevToolsMaintenance(
    cliPath,
    buildDevToolsCloseArgs({ projectPath, idePort }),
    'close DevTools project before cache refresh',
  )
  for (const clean of ['compile', 'file', 'session', 'storage', 'network']) {
    runDevToolsMaintenance(
      cliPath,
      buildDevToolsCacheArgs({ clean, projectPath, idePort }),
      `clean DevTools ${clean} cache`,
      { required: true },
    )
  }
  await quitDevTools(cliPath, idePort, autoPort, 'after cache refresh')
}

async function startAutomator({ cliPath, projectPath, idePort, autoPort }) {
  const args = buildDevToolsAutoArgs({ projectPath, idePort, autoPort })
  if (process.env.HH_RELEASE_UI_COLD_START_DEVTOOLS !== '0') {
    stopStaleDevToolsAutoProcesses({ cliPath, projectPath, autoPort })
    await clearStaleIdePortFiles(idePort)
    await refreshDevToolsProjectCache({ cliPath, projectPath, idePort, autoPort })
    await clearStaleIdePortFiles(idePort)
    await quitDevTools(cliPath, idePort, autoPort, 'avoid stale compiled package/cache')
  }
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      runAutomatorStart(cliPath, args, attempt === 1 ? 'start DevTools automator' : 'retry DevTools automator after cleanup')
      if (await waitForTcpPort(autoPort, { timeoutMs: attempt === 1 ? 15000 : 25000 })) return
      throw new Error(`DevTools cli auto reported success, but automator websocket port ${autoPort} did not open.`)
    } catch (error) {
      lastError = error
      if (attempt >= 2) break
      console.warn(`[release-ui] DevTools auto attempt failed: ${error?.message || error}`)
      console.warn('[release-ui] cleaning release-owned DevTools auto processes and retrying once after DevTools settles')
      stopStaleDevToolsAutoProcesses({ cliPath, projectPath, autoPort })
      await clearStaleIdePortFiles(idePort)
      await quitDevTools(cliPath, idePort, autoPort, 'auto attempt failed')
      await sleep(5000)
    }
  }
  throw lastError || new Error('DevTools automator failed to start.')
}

async function connectMiniProgram(autoPort) {
  let lastError = null
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    for (const host of ['127.0.0.1', 'localhost']) {
      try {
        const conn = await withTimeout(
          Connection.default.create(`ws://${host}:${autoPort}`),
          5000,
          `DevTools automator websocket connect ${host}:${autoPort}`,
        )
        return new MiniProgram.default(conn)
      } catch (error) {
        lastError = error
      }
    }
    await sleep(1000)
  }
  throw new Error(`Cannot connect to DevTools automator websocket on port ${autoPort}: ${lastError?.message || lastError}`)
}

async function pageText(page) {
  const root = await page.$('page').catch(() => null)
  if (!root) return ''
  return String(await root.text().catch(() => '') || '')
}

async function verifyHomeColdStart(mp) {
  console.log('[release-ui] verify cold-start home shell')
  await sleep(6000)
  const page = await withTimeout(mp.currentPage(), 10000, 'get cold-start release home page')
  const text = await withTimeout(pageText(page), 10000, 'read cold-start release home text')
  const appTabBarCount = (await withTimeout(page.$$('.app-tabbar'), 10000, 'find cold-start custom app tab bar').catch(() => [])).length
  const layout = await withTimeout(mp.evaluate(() => new Promise((resolveLayout) => {
    try {
      wx.createSelectorQuery()
        .select('.phone-inner').boundingClientRect()
        .select('.home-shell').boundingClientRect()
        .exec((rects) => {
          const items = Array.isArray(rects) ? rects : []
          resolveLayout({
            phoneInner: items[0] || null,
            homeShell: items[1] || null,
          })
        })
    } catch (error) {
      resolveLayout({ error: String(error?.message || error) })
    }
  })), 15000, 'capture cold-start release home layout')
  const visible = (rect) => Number(rect?.width || 0) > 1 && Number(rect?.height || 0) > 1
  const passed = (page.path || '').includes('pages/index/index') &&
    text.trim().length >= 20 &&
    visible(layout?.phoneInner) &&
    visible(layout?.homeShell) &&
    appTabBarCount > 0
  return {
    passed,
    path: page.path || '',
    textLength: text.length,
    textSample: text.slice(0, 300),
    appTabBarCount,
    layout,
  }
}

async function captureHomeImageProbe(mp) {
  return await mp.evaluate(() => {
    try {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const page = pages && pages[0]
      const vm = page && (page.$vm || page.$vue || page)
      const getterCandidates = [
        vm && vm.getReleaseHomeImageProbe,
        vm && vm.$ && vm.$.setupState && vm.$.setupState.getReleaseHomeImageProbe,
        vm && vm.$ && vm.$.ctx && vm.$.ctx.getReleaseHomeImageProbe,
        vm && vm.$ && vm.$.exposed && vm.$.exposed.getReleaseHomeImageProbe,
        page && page.getReleaseHomeImageProbe,
      ]
      const getter = getterCandidates.find((candidate) => typeof candidate === 'function')
      if (typeof getter !== 'function') {
        return {
          ok: false,
          error: 'getReleaseHomeImageProbe unavailable',
          vmKeys: vm ? Object.keys(vm).slice(0, 40) : [],
          setupStateKeys: vm && vm.$ && vm.$.setupState ? Object.keys(vm.$.setupState).slice(0, 40) : [],
          ctxKeys: vm && vm.$ && vm.$.ctx ? Object.keys(vm.$.ctx).slice(0, 40) : [],
          currentImageCount: 0,
          loadedCount: 0,
          failedCount: 0,
          pendingCount: 0,
          hasRendered: false,
          loaded: [],
          failed: [],
        }
      }
      const probe = getter()
      return { ok: true, ...probe }
    } catch (error) {
      return {
        ok: false,
        error: String(error?.message || error),
        currentImageCount: 0,
        loadedCount: 0,
        failedCount: 0,
        pendingCount: 0,
        hasRendered: false,
        loaded: [],
        failed: [],
      }
    }
  })
}

async function waitForHomeImagesRendered(mp, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 15000)
  const intervalMs = Number(options.intervalMs || 1000)
  const deadline = Date.now() + timeoutMs
  let lastProbe = null

  while (Date.now() < deadline) {
    lastProbe = await withTimeout(captureHomeImageProbe(mp), 15000, 'capture release home image probe')
    if (lastProbe?.ok === false) return lastProbe
    if (lastProbe?.satisfied) return lastProbe
    await sleep(intervalMs)
  }

  return lastProbe || {
    ok: false,
    error: 'home image probe timed out without data',
    currentImageCount: 0,
    loadedCount: 0,
    failedCount: 0,
    pendingCount: 0,
    hasRendered: false,
    loaded: [],
    failed: [],
  }
}

async function captureStorage(mp) {
  return await mp.evaluate(() => {
    const keys = ['user_store', 'community_store', 'dev-gateway', 'test-openid']
    const values = {}
    for (const key of keys) {
      try {
        values[key] = wx.getStorageSync(key)
      } catch {}
    }
    return values
  })
}

async function captureStorageWithRetry({ mp, autoPort, attempts = 3 }) {
  let currentMp = mp
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const storage = await withTimeout(
        captureStorage(currentMp),
        15000,
        `capture release UI storage attempt ${attempt}`,
      )
      return { mp: currentMp, storage }
    } catch (error) {
      lastError = error
      console.warn(`[release-ui] capture storage attempt ${attempt} failed: ${error?.message || error}`)
      if (attempt >= attempts) break
      try { await withTimeout(currentMp.disconnect(), 5000, 'disconnect stale release UI automator') } catch {}
      await sleep(2000)
      currentMp = await connectMiniProgram(autoPort)
    }
  }
  throw lastError || new Error('capture release UI storage failed')
}

async function disconnectMiniProgramQuietly(mp, label) {
  if (!mp) return
  try {
    await withTimeout(mp.disconnect(), 5000, label)
  } catch {}
}

async function runAutomatorTaskWithRetry({ state, autoPort, label, attempts = 2, timeoutMs = 90000, task, recover }) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(
        task(state.mp, attempt),
        timeoutMs,
        `${label} attempt ${attempt}`,
      )
      return { result, attempt }
    } catch (error) {
      lastError = error
      console.warn(`[release-ui] ${label} attempt ${attempt} failed: ${error?.message || error}`)
      if (attempt >= attempts) break
      if (recover) {
        await recover({ state, attempt, error })
      } else {
        await disconnectMiniProgramQuietly(state.mp, `disconnect stale automator after ${label} attempt ${attempt}`)
        await sleep(2500)
        state.mp = await connectMiniProgram(autoPort)
      }
    }
  }
  throw lastError || new Error(`${label} failed`)
}

async function restoreStorage(mp, snapshot) {
  await mp.evaluate((values) => {
    const keys = ['user_store', 'community_store', 'dev-gateway', 'test-openid']
    for (const key of keys) {
      try {
        if (values && Object.prototype.hasOwnProperty.call(values, key) && values[key] !== '' && values[key] != null) {
          wx.setStorageSync(key, values[key])
        } else {
          wx.removeStorageSync(key)
        }
      } catch {}
    }
    return true
  }, snapshot || {})
}

function stringifyError(error) {
  return String(error?.message || error?.errMsg || error || 'unknown error')
}

function makeEvidenceRetryError(label, result) {
  const error = new Error(`${label} did not pass: ${JSON.stringify(result)}`)
  error.releaseUiResult = result
  return error
}

function makeReleaseRunId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`
}

function makeFixtureAdminCtx(runId) {
  return {
    accountId: `release-ui-${runId}`,
    role: 'superAdmin',
    userId: `release-ui-owner-${runId}`,
    username: 'release-ui',
  }
}

function summarizeReleaseFixture(fixture) {
  if (!fixture) return null
  return {
    runId: fixture.runId,
    configured: fixture.configured === true,
    communityId: fixture.communityId || '',
    sectionId: fixture.sectionId || '',
    postId: fixture.postId || '',
  }
}

async function callMpCloud(mp, name, data, options = {}) {
  const action = String(data?.action || '')
  const timeoutMs = Number(options.timeoutMs || 60000)
  if (name === 'admin' && action === 'community.hardDelete') {
    return await invokeTrustedAdminCloud(data, { timeoutMs, attempts: Number(options.attempts || 2) })
  }
  if (name === 'admin') return await callTrustedAdminCloud(data, { timeoutMs })
  const response = await withTimeout(
    mp.evaluate(async (fnName, payload) => {
      const wxRef = typeof wx !== 'undefined' ? wx : null
      if (!wxRef?.cloud?.callFunction) {
        return { ok: false, error: 'wx.cloud.callFunction unavailable' }
      }
      return await new Promise((resolveCall) => {
        wxRef.cloud.callFunction({
          name: fnName,
          data: payload,
          success: (res) => resolveCall({ ok: true, result: res.result }),
          fail: (error) => resolveCall({
            ok: false,
            error: String(error?.errMsg || error?.message || error),
            raw: error,
          }),
        })
      })
    }, name, data),
    timeoutMs,
    `${name}/${action || 'callFunction'}`,
  )

  if (!response?.ok) {
    throw new Error(`[wx.cloud] ${name}/${action}: ${response?.error || 'call failed'}`)
  }
  const result = response.result
  if (result?.error) throw new Error(`[wx.cloud] ${name}/${action}: ${result.error}`)
  if (result?.success === false) {
    throw new Error(`[wx.cloud] ${name}/${action}: ${result.message || result.errMsg || 'request failed'}`)
  }
  return result
}

async function captureHomeImageLayout(mp) {
  return await withTimeout(mp.evaluate(() => new Promise((resolveLayout) => {
    try {
      wx.createSelectorQuery()
        .selectAll('.community-avatar-image, .guide-cover')
        .boundingClientRect((rects) => {
          const items = (Array.isArray(rects) ? rects : []).map((rect) => ({
            width: Number(rect?.width || 0),
            height: Number(rect?.height || 0),
          }))
          resolveLayout({
            count: items.length,
            visibleCount: items.filter((item) => item.width > 1 && item.height > 1).length,
            items,
          })
        })
        .exec()
    } catch (error) {
      resolveLayout({ count: 0, visibleCount: 0, items: [], error: String(error) })
    }
  })), 15000, 'capture release home image layout')
}

async function callTrustedAdminCloud(data, options = {}) {
  const action = String(data?.action || '')
  const tempDir = mkdtempSync(join(tmpdir(), 'happyhome-release-admin-'))
  const payloadPath = join(tempDir, 'payload.json')
  const payload = Object.assign({}, data, { _internalToken: requireAdminInternalToken() })
  try {
    writeFileSync(payloadPath, JSON.stringify(payload), 'utf8')
    const built = buildTcbCommand([
      'fn', 'invoke', 'admin',
      '-d', `@${payloadPath}`,
      '--env-id', process.env.TCB_ENV || 'cloudbase-3gh862acb1505ff3',
      '--json',
    ])
    const result = await runCloudBaseCommand(built.command, built.args, {
      cwd: ROOT,
      env: process.env,
      timeoutMs: Number(options.timeoutMs || 60000),
    })
    const parsed = parseFirstJson(`${result.stdout || ''}${result.stderr || ''}`)
    const cloudInvoke = analyzeCloudInvoke(parsed)
    const functionResult = extractFunctionResult(parsed)
    const functionError = functionResult?.error || functionResult?.message || cloudInvoke?.errMsg || ''
    if (result.status !== 0 || !parsed || (cloudInvoke && !cloudInvoke.ok) || functionResult?.success === false || functionResult?.error) {
      throw new Error(`[trusted admin] ${action}: ${functionError || result.error || result.stderr || 'invoke failed'}`)
    }
    return functionResult
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function createReleaseFixture(mp) {
  const runId = makeReleaseRunId()
  const adminCtx = makeFixtureAdminCtx(runId)
  const name = `${RELEASE_FIXTURE_PREFIX}${runId}`
  const fixture = { runId, adminCtx, configured: false, communityId: '', sectionId: '', postId: '', sectionIds: [], postIds: [] }

  try {
    const community = await callMpCloud(mp, 'admin', {
      action: 'community.createAdmin',
      _actAs: adminCtx,
      name,
      description: 'temporary release UI fixture',
      coverImage: '/static/logo.png',
      location: { province: 'release', city: 'release', district: 'release', address: 'release-ui' },
      joinType: 'open',
    })
    fixture.communityId = String(community.communityId || '')
    if (!fixture.communityId) throw new Error('community.createAdmin did not return communityId')

    const createArchive = async ({ name: sectionName, order, postCount }) => {
      const section = await callMpCloud(mp, 'admin', {
        action: 'section.create',
        _actAs: adminCtx,
        communityId: fixture.communityId,
        name: sectionName,
        icon: sectionName.slice(0, 1),
        order,
        type: 'evergreen',
      })
      const sectionId = String(section.sectionId || '')
      if (!sectionId) throw new Error('section.create did not return sectionId')
      fixture.sectionIds.push(sectionId)

      const widgetsResult = await callMpCloud(mp, 'admin', {
        action: 'section.updateWidgets',
        _actAs: adminCtx,
        sectionId,
        widgets: [
          { type: 'short_text', label: 'Title', fieldKey: 'title', required: true, showInList: true, widgetId: '' },
          { type: 'summary', label: 'Summary', fieldKey: 'summary', required: false, showInList: true, widgetId: '' },
        ],
      })
      const widgets = Array.isArray(widgetsResult.widgets) ? widgetsResult.widgets : []
      const titleWidget = widgets.find((widget) => widget.type === 'short_text') || widgets[0]
      const summaryWidget = widgets.find((widget) => widget.type === 'summary')
      if (!titleWidget?.widgetId) throw new Error('section.updateWidgets did not return a title widget')

      for (let index = 0; index < postCount; index += 1) {
        const content = { [titleWidget.widgetId]: `${sectionName} ${index + 1} ${runId}` }
        if (summaryWidget?.widgetId) content[summaryWidget.widgetId] = 'Automated release validation post.'
        const post = await callMpCloud(mp, 'admin', {
          action: 'post.createAdmin',
          _actAs: adminCtx,
          communityId: fixture.communityId,
          sectionId,
          content,
        }, { timeoutMs: 90000 })
        const postId = String(post.postId || '')
        if (!postId) throw new Error('post.createAdmin did not return postId')
        fixture.postIds.push(postId)
        if (post.auditStatus !== 'pass') {
          await callMpCloud(mp, 'admin', { action: 'audit.approveAdmin', _actAs: adminCtx, postId })
        }
      }
      return sectionId
    }

    fixture.sectionId = await createArchive({ name: '长内容', order: 0, postCount: 3 })
    await createArchive({ name: '短内容', order: 1, postCount: 1 })
    fixture.postId = fixture.postIds[0] || ''

    return fixture
  } catch (error) {
    if (fixture.communityId) {
      try {
        const cleanup = await cleanupReleaseFixture(mp, fixture)
        if (!cleanup.ok) throw new Error(`fixture cleanup failed: ${JSON.stringify(cleanup)}`)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'release fixture creation and cleanup both failed')
      }
    }
    throw error
  }
}

async function seedCurrentViewerIntoCommunity(mp, fixture) {
  const selection = await applyAndWaitForReleaseFixtureSelection({
    communityId: fixture.communityId,
    apply: () => callMpCloud(mp, 'member', { action: 'apply', communityId: fixture.communityId }),
    bootstrap: () => callMpCloud(mp, 'post', {
      action: 'bootstrap',
      currentCommunityId: fixture.communityId,
      limitPerSection: 20,
    }),
  })
  const snapshot = selection.snapshot
  const viewerOpenId = String(snapshot.viewerOpenId || '')
  if (!viewerOpenId) throw new Error('post.bootstrap did not return viewerOpenId')

  await withTimeout(mp.evaluate((seed) => {
    wx.setStorageSync('user_store', {
      openId: seed.viewerOpenId,
      nickName: 'HH Release Bot',
      avatarUrl: '',
      role: 'user',
      isLoggedIn: true,
      backgroundFetchToken: seed.backgroundFetchToken || '',
      backgroundFetchTokenExpiresAt: seed.backgroundFetchTokenExpiresAt || '',
    })
    wx.setStorageSync('community_store', {
      currentCommunityId: seed.currentCommunityId,
      currentSectionIndex: 0,
    })
    const pages = getCurrentPages()
    const vm = pages && pages[0] && (pages[0].$vm || pages[0].$vue || pages[0])
    const pinia = vm && (vm.$pinia || (vm.$ && vm.$appContext && vm.$appContext.config.globalProperties.$pinia))
    if (pinia) {
      for (const [storeId, store] of pinia._s) {
        if (storeId === 'user') {
          store.$patch({
            openId: seed.viewerOpenId,
            nickName: 'HH Release Bot',
            avatarUrl: '',
            role: 'user',
            isLoggedIn: true,
            backgroundFetchToken: seed.backgroundFetchToken || '',
            backgroundFetchTokenExpiresAt: seed.backgroundFetchTokenExpiresAt || '',
          })
        }
        if (storeId === 'community') {
          store.$patch({
            currentCommunityId: seed.currentCommunityId,
            currentSectionIndex: 0,
            myCommunities: seed.communities || [],
            currentSections: seed.sections || [],
          })
        }
      }
    }
    return true
  }, snapshot), 30000, 'seed release viewer storage')

  return snapshot
}

async function seedReleaseLogin(mp, context = {}) {
  const configuredCommunityId = String(process.env.HH_RELEASE_TEST_COMMUNITY_ID || '').trim()
  const fixture = configuredCommunityId
    ? {
        runId: 'configured-community',
        configured: true,
        communityId: configuredCommunityId,
        sectionId: '',
        postId: '',
        adminCtx: null,
      }
    : context.releaseFixture || await createReleaseFixture(mp)
  context.releaseFixture = fixture
  const snapshot = await seedCurrentViewerIntoCommunity(mp, fixture)
  return { fixture, snapshot }
}

async function cleanupReleaseFixture(mp, fixture) {
  if (!fixture || fixture.configured || !fixture.communityId || !fixture.adminCtx) {
    return { ok: true, skipped: true, reason: 'no temporary fixture cleanup required' }
  }
  const cleanup = await cleanupReleaseFixtureWithRetry({
    actions: ['community.disable', 'community.hardDelete'],
    invoke: async (action) => await callMpCloud(mp, 'admin', {
        action,
        _actAs: fixture.adminCtx,
        communityId: fixture.communityId,
      }, { timeoutMs: 90000, attempts: 1 }),
  })
  return {
    ...cleanup,
    communityId: fixture.communityId,
  }
}

async function forceLogout(mp) {
  return await withTimeout(mp.evaluate(() => {
    const result = { ok: false, stores: [], errors: [] }
    try { wx.clearStorageSync() } catch (error) { result.errors.push(`clear:${String(error)}`) }
    try {
      const pages = getCurrentPages()
      const vm = pages && pages[0] && (pages[0].$vm || pages[0].$vue || pages[0])
      const pinia = vm && (vm.$pinia || (vm.$ && vm.$appContext && vm.$appContext.config.globalProperties.$pinia))
      if (!pinia) return { ...result, error: 'no pinia found' }
      for (const [id, store] of pinia._s) {
        result.stores.push(id)
        if (id === 'user') {
          if (typeof store.logout === 'function') store.logout()
          else store.$patch({ openId: '', nickName: '', avatarUrl: '', role: 'user', isLoggedIn: false })
        }
        if (id === 'community' && typeof store.clearCommunityState === 'function') store.clearCommunityState()
      }
      result.ok = true
      return result
    } catch (error) {
      result.errors.push(String(error))
      return result
    }
  }), 30000, 'force release UI logged-out state')
}

async function findFirstPost(page) {
  for (const selector of HOME_POST_SELECTORS) {
    const nodes = await page.$$(selector).catch(() => [])
    if (nodes.length) return { selector, node: nodes[0], count: nodes.length }
  }
  return null
}

async function captureHomeTabsLayout(mp) {
  return await withTimeout(mp.evaluate(() => new Promise((resolveLayout) => {
    try {
      const query = wx.createSelectorQuery()
      query.selectAll('.section-tabs-sticky-shell').boundingClientRect()
      query.select('.home-topbar').boundingClientRect()
      query.select('.home-search-sticky-shell').boundingClientRect()
      query.selectAll('.arc-item').boundingClientRect()
      query.selectAll('.section-tab.active').boundingClientRect()
      query.selectViewport().scrollOffset()
      query.exec((items) => {
        const tabs = Array.isArray(items?.[0]) ? items[0] : []
        const topbar = items?.[1] || null
        const search = items?.[2] || null
        const cards = Array.isArray(items?.[3]) ? items[3] : []
        const activeTabs = Array.isArray(items?.[4]) ? items[4] : []
        const viewport = items?.[5] || {}
        const safeTop = Number(wx.getWindowInfo?.().safeArea?.top || 0)
        resolveLayout({ tabs, topbar, search, cardCount: cards.length, activeTabCount: activeTabs.length, scrollTop: Number(viewport.scrollTop || 0), safeTop })
      })
    } catch (error) {
      resolveLayout({ tabs: [], search: null, cardCount: 0, activeTabCount: 0, scrollTop: 0, safeTop: 0, error: String(error) })
    }
  })), 15000, 'capture home archive tabs layout')
}

async function scrollHomeTo(mp, scrollTop) {
  await withTimeout(mp.evaluate((top) => new Promise((resolveScroll) => {
    wx.pageScrollTo({ scrollTop: top, duration: 0, complete: resolveScroll })
  }), scrollTop), 15000, 'scroll release home')
  await sleep(500)
}

async function captureOptionalReleaseUiScreenshot(mp, path) {
  if (process.env.HH_RELEASE_UI_CAPTURE_SCREENSHOT !== '1' && process.env.HH_CAPTURE_RELEASE_SCREENSHOT !== '1') {
    return { status: 'skipped', reason: 'structured layout evidence is authoritative for the release gate' }
  }
  const timeoutMs = envPositiveInt('HH_RELEASE_UI_SCREENSHOT_TIMEOUT_MS', 15000)
  try {
    await withTimeout(mp.screenshot({ path }), timeoutMs, 'capture optional release UI screenshot')
    return { status: 'captured', path }
  } catch (error) {
    const message = String(error?.message || error)
    console.warn(`[release-ui] optional screenshot unavailable: ${message}`)
    return { status: 'warning', error: message }
  }
}

async function verifyHomeArchiveTabs(mp, context, evidenceDir) {
  if (!context.releaseFixture) throw new Error('release archive tabs fixture was not provisioned')
  await seedCurrentViewerIntoCommunity(mp, context.releaseFixture)
  const home = await withTimeout(mp.reLaunch('/pages/index/index'), 30000, 'open release archive fixture home')
  await sleep(7000)
  await scrollHomeTo(mp, 0)
  const before = await captureHomeTabsLayout(mp)
  const searchScrollTop = before.scrollTop + Math.max(0, Number(before.search?.top || 0) - Number(before.topbar?.bottom || 0)) + 40
  await scrollHomeTo(mp, searchScrollTop)
  const searchPinned = await captureHomeTabsLayout(mp)
  const tagsScrollTop = searchPinned.scrollTop + Math.max(0, Number(searchPinned.tabs?.[0]?.top || 0) - Number(searchPinned.search?.bottom || 0)) + 40
  await scrollHomeTo(mp, tagsScrollTop)
  const tagsPinned = await captureHomeTabsLayout(mp)
  const tabs = await withTimeout(home.$$('.section-tab'), 10000, 'find release archive tabs')
  if (tabs.length === 2) {
    await withTimeout(tabs[1].tap(), 15000, 'switch to short release archive')
    await sleep(700)
  }
  const shortArchive = await captureHomeTabsLayout(mp)
  const screenshotEvidence = await captureOptionalReleaseUiScreenshot(
    mp,
    resolve(evidenceDir, 'home-archive-tabs-sticky.png'),
  )

  const pinnedTop = Number(tagsPinned.tabs?.[0]?.top || 0)
  const passed = before.tabs?.length === 1 &&
    searchPinned.tabs?.length === 1 &&
    tagsPinned.tabs?.length === 1 &&
    tabs.length === 2 &&
    Number(before.topbar?.height || 0) > 1 &&
    Number(before.search?.height || 0) > 1 &&
    Number(before.tabs?.[0]?.top || 0) > Number(before.topbar?.bottom || 0) + 16 &&
    Number(before.tabs?.[0]?.top || 0) >= Number(before.search?.bottom || 0) &&
    searchPinned.scrollTop > 0 &&
    tagsPinned.scrollTop > searchPinned.scrollTop &&
    Math.abs(Number(searchPinned.search?.top || 0) - Number(searchPinned.topbar?.bottom || 0)) <= 8 &&
    Math.abs(Number(tagsPinned.search?.top || 0) - Number(tagsPinned.topbar?.bottom || 0)) <= 8 &&
    Math.abs(pinnedTop - Number(tagsPinned.search?.bottom || 0)) <= 8 &&
    Math.abs(Number(before.topbar?.top || 0) - Number(tagsPinned.topbar?.top || 0)) <= 2 &&
    tagsPinned.cardCount === 3 &&
    shortArchive.cardCount === 1 &&
    shortArchive.activeTabCount === 1 &&
    Math.abs(shortArchive.scrollTop - tagsPinned.scrollTop) <= 8 &&
    Math.abs(Number(shortArchive.tabs?.[0]?.top || 0) - pinnedTop) <= 4

  return { passed, before, searchPinned, tagsPinned, shortArchive, tabCount: tabs.length, screenshotEvidence }
}

async function verifyHomeDetail(mp, context = {}) {
  console.log('[release-ui] open home')
  let releaseSeed = null
  let home = await withTimeout(mp.reLaunch('/pages/index/index'), 30000, 'open release home page')
  await sleep(6000)
  let target = await withTimeout(findFirstPost(home), 15000, 'find release home post')

  if (!target) {
    console.log(context.releaseFixture
      ? '[release-ui] no post candidates in current session; reusing temporary release fixture'
      : '[release-ui] no post candidates in current session; creating temporary release fixture')
    releaseSeed = await seedReleaseLogin(mp, context)
    context.releaseFixture = releaseSeed.fixture
    home = await withTimeout(mp.reLaunch('/pages/index/index'), 30000, 'open release home page after fixture')
    await sleep(7000)
    target = await withTimeout(findFirstPost(home), 15000, 'find release home post after fixture')
  }

  const homeImages = await waitForHomeImagesRendered(mp)
  const homeImageLayout = await captureHomeImageLayout(mp)
  const homeText = await withTimeout(pageText(home), 10000, 'read release home text')

  if (!target) {
    const fixture = releaseSeed?.fixture ? ` fixture=${JSON.stringify(summarizeReleaseFixture(releaseSeed.fixture))}` : ''
    throw new Error(`Home page has no tappable post candidates after release fixture. textLength=${homeText.length}.${fixture}`)
  }

  console.log(`[release-ui] tap first post via ${target.selector}`)
  await withTimeout(target.node.tap(), 15000, 'tap release home post')
  await sleep(6000)
  const detail = await withTimeout(mp.currentPage(), 10000, 'get release detail page')
  const detailText = await withTimeout(pageText(detail), 10000, 'read release detail text')
  const contentCount = (await withTimeout(detail.$$('.content'), 10000, 'find release detail content').catch(() => [])).length
  const errorCount = (await withTimeout(detail.$$('.detail-state-title'), 10000, 'find release detail error state').catch(() => [])).length
  const detailPath = detail.path || ''

  const passed = detailPath.includes('pages/detail/index') &&
    detailText.trim().length >= 20 &&
    contentCount > 0 &&
    errorCount === 0

  return {
    passed,
    homeImages,
    homeImageLayout,
    homeImagesRendered: Boolean(
      homeImages?.ok !== false &&
      homeImages?.satisfied &&
      Number(homeImages?.loadedCount || 0) > 0 &&
      Number(homeImageLayout?.visibleCount || 0) >= Number(homeImages?.loadedCount || 0)
    ),
    homeTextLength: homeText.length,
    homeTextSample: homeText.slice(0, 300),
    detailPath,
    detailTextLength: detailText.length,
    detailTextSample: detailText.slice(0, 300),
    tappedSelector: target.selector,
    tappedSelectorCount: target.count,
    contentCount,
    errorCount,
    releaseFixture: summarizeReleaseFixture(releaseSeed?.fixture || context.releaseFixture),
  }
}

async function verifyProfileLoginClean(mp) {
  console.log('[release-ui] force logged-out state')
  const logoutResult = await forceLogout(mp)
  console.log(`[release-ui] logout result: ${JSON.stringify(logoutResult)}`)
  console.log('[release-ui] open profile/login page')
  let page
  try {
    page = await withTimeout(mp.reLaunch('/pages/profile/index'), 30000, 'open release profile page')
  } catch (error) {
    console.log(`[release-ui] reLaunch profile failed, fallback switchTab: ${error?.message || error}`)
    page = await withTimeout(mp.switchTab('/pages/profile/index'), 30000, 'switch release profile tab')
  }
  await sleep(4000)
  const text = await withTimeout(pageText(page), 10000, 'read release profile text')
  const profilePage = await withTimeout(page.$('.profile-page'), 10000, 'find release profile root')
  const buildVersionAttribute = profilePage
    ? String(await withTimeout(profilePage.attribute('data-build-version'), 10000, 'read release profile build marker') || '')
    : ''
  const loginEntryCount = (await withTimeout(
    page.$$('[data-testid="profile-login-entry"]'),
    10000,
    'find release profile login identity entry',
  ).catch(() => [])).length
  const loginIdentityVisible = text.includes('登录')
  const debugLeakVisible = /state:logged|login:[01]|cc:|DEV 登录|Home 诊断/.test(text)
  const expectedVersion = expectedBuildVersion()
  const versionTextVisible = Boolean(expectedVersion && text.includes(expectedVersion))
  const buildIdentityPassed = Boolean(expectedVersion && buildVersionAttribute === expectedVersion && !text.includes(expectedVersion))
  return {
    cleanPassed: text.trim().length >= 20 &&
      Boolean(profilePage) &&
      loginEntryCount === 1 &&
      loginIdentityVisible &&
      !debugLeakVisible &&
      !versionTextVisible,
    buildIdentityPassed,
    versionPassed: buildIdentityPassed,
    logoutResult,
    path: page.path || '',
    textLength: text.length,
    textSample: text.slice(0, 300),
    debugLeakVisible,
    loginEntryCount,
    loginIdentityVisible,
    expectedVersion,
    buildVersionAttribute,
    versionTextVisible,
  }
}

function createEvidenceDir() {
  const dir = process.env.HH_RELEASE_UI_EVIDENCE_DIR
    ? resolve(process.env.HH_RELEASE_UI_EVIDENCE_DIR)
    : resolve(ROOT, '.codex-local', 'release-evidence', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  rmSync(resolve(dir, 'release-ui-evidence.json'), { force: true })
  rmSync(resolve(dir, 'release-ui-evidence.failed.json'), { force: true })
  return dir
}

async function writeEvidence({ mp, evidenceDir, evidence }) {
  const jsonPath = resolve(evidenceDir, 'release-ui-evidence.json')
  writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
  if (process.env.HH_CAPTURE_RELEASE_SCREENSHOT === '1') {
    evidence.finalScreenshot = await captureOptionalReleaseUiScreenshot(mp, resolve(evidenceDir, 'last-page.png'))
    writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
  }
  return jsonPath
}

async function main() {
  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  const idePort = detectIdePort()
  const autoPort = detectAutoPort()

  assertColdStartDevToolsEnabled()

  if (!cliPath) throw new Error('WeChat DevTools CLI was not found. Set WECHAT_DEVTOOLS_CLI_PATH.')
  if (!projectPath) throw new Error('mp-weixin build output was not found. Run the mp-weixin build first.')
  const packageDigest = await computeDirectoryDigest(projectPath)
  const expectedPackageDigest = String(process.env.HH_RELEASE_PACKAGE_DIGEST || '').trim()
  if (expectedPackageDigest && packageDigest !== expectedPackageDigest) {
    throw new Error(`DevTools project package digest mismatch: expected ${expectedPackageDigest}, got ${packageDigest}`)
  }

  console.log('[DevTools release UI gate]')
  console.log(`cliPath: ${cliPath}`)
  console.log(`projectPath: ${projectPath}`)
  console.log(`idePort: ${idePort}`)
  console.log(`autoPort: ${autoPort}`)

  await startAutomator({ cliPath, projectPath, idePort, autoPort })
  let mp = await connectMiniProgram(autoPort)
  const mpState = { mp }
  const evidenceDir = createEvidenceDir()
  let originalStorage = {}
  const runContext = { releaseFixture: null }

  const evidence = {
    createdAt: new Date().toISOString(),
    releaseRunId: String(process.env.HH_RELEASE_RUN_ID || ''),
    gitSha: String(process.env.HH_RELEASE_GIT_SHA || ''),
    devToolsVersion: String(process.env.HH_RELEASE_DEVTOOLS_VERSION || ''),
    packageDigest,
    cliPath,
    projectPath,
    idePort,
    autoPort,
    markers: [],
  }

  try {
    const storageCapture = await captureStorageWithRetry({ mp: mpState.mp, autoPort })
    mpState.mp = storageCapture.mp
    mp = mpState.mp
    originalStorage = storageCapture.storage

    const uiChecks = await runReleaseUiChecks({
      coldStart: async () => {
        try {
          const run = await runAutomatorTaskWithRetry({
            state: mpState,
            autoPort,
            label: 'verify cold-start release home UI',
            attempts: envPositiveInt('HH_RELEASE_UI_HOME_ATTEMPTS', 3),
            timeoutMs: envPositiveInt('HH_RELEASE_UI_HOME_TIMEOUT_MS', 90000),
            task: async (currentMp) => {
              const result = await verifyHomeColdStart(currentMp)
              if (!result.passed) throw makeEvidenceRetryError('cold-start release home evidence', result)
              return result
            },
            recover: async ({ state, attempt }) => {
              await disconnectMiniProgramQuietly(state.mp, `disconnect failed cold-start attempt ${attempt}`)
              await startAutomator({ cliPath, projectPath, idePort, autoPort })
              state.mp = await connectMiniProgram(autoPort)
            },
          })
          mp = mpState.mp
          evidence.homeColdStartAttempt = run.attempt
          evidence.homeColdStart = run.result
          evidence.markers.push('HH_RELEASE_HOME_COLD_START_NONEMPTY')
          console.log('HH_RELEASE_HOME_COLD_START_NONEMPTY')
        } catch (error) {
          if (error?.releaseUiResult) evidence.homeColdStart = error.releaseUiResult
          throw error
        }
      },
      provisionFixture: async () => {
        runContext.releaseFixture = await createReleaseFixture(mpState.mp)
      },
      archiveTabs: async () => {
        try {
          const run = await runAutomatorTaskWithRetry({
            state: mpState,
            autoPort,
            label: 'verify release home archive tabs',
            attempts: envPositiveInt('HH_RELEASE_UI_HOME_ATTEMPTS', 3),
            timeoutMs: envPositiveInt('HH_RELEASE_UI_HOME_TIMEOUT_MS', 90000),
            task: async (currentMp) => {
              const result = await verifyHomeArchiveTabs(currentMp, runContext, evidenceDir)
              if (!result.passed) throw makeEvidenceRetryError('release home archive tabs evidence', result)
              return result
            },
            recover: async ({ state, attempt }) => {
              await disconnectMiniProgramQuietly(state.mp, `disconnect failed archive tabs attempt ${attempt}`)
              await startAutomator({ cliPath, projectPath, idePort, autoPort })
              state.mp = await connectMiniProgram(autoPort)
            },
          })
          mp = mpState.mp
          evidence.homeArchiveTabs = run.result
          evidence.markers.push('HH_RELEASE_HOME_ARCHIVE_TABS_STICKY')
          console.log('HH_RELEASE_HOME_ARCHIVE_TABS_STICKY')
        } catch (error) {
          if (error?.releaseUiResult) evidence.homeArchiveTabs = error.releaseUiResult
          throw error
        }
      },
      homeDetail: async () => {
        const run = await runAutomatorTaskWithRetry({
          state: mpState,
          autoPort,
          label: 'verify release home/detail UI',
          attempts: envPositiveInt('HH_RELEASE_UI_HOME_ATTEMPTS', 3),
          timeoutMs: envPositiveInt('HH_RELEASE_UI_HOME_TIMEOUT_MS', 90000),
          task: (currentMp) => verifyHomeDetail(currentMp, runContext),
        })
        mp = mpState.mp
        evidence.homeDetailAttempt = run.attempt
        evidence.homeDetail = run.result
        evidence.homeImages = run.result.homeImages
        if (run.result.homeImagesRendered) {
          evidence.markers.push('HH_RELEASE_HOME_IMAGES_RENDERED')
          console.log('HH_RELEASE_HOME_IMAGES_RENDERED')
        }
        if (run.result.passed) {
          evidence.markers.push('HH_RELEASE_HOME_DETAIL_NONEMPTY')
          console.log('HH_RELEASE_HOME_DETAIL_NONEMPTY')
        }
        if (!run.result.homeImagesRendered || !run.result.passed) {
          throw makeEvidenceRetryError('release home/detail evidence', run.result)
        }
      },
      profile: async () => {
        try {
          const run = await runAutomatorTaskWithRetry({
            state: mpState,
            autoPort,
            label: 'verify release profile/login UI',
            attempts: envPositiveInt('HH_RELEASE_UI_PROFILE_ATTEMPTS', 3),
            timeoutMs: envPositiveInt('HH_RELEASE_UI_PROFILE_TIMEOUT_MS', 70000),
            task: async (currentMp) => {
              const result = await verifyProfileLoginClean(currentMp)
              if (!result.cleanPassed || !result.buildIdentityPassed) {
                throw makeEvidenceRetryError('release profile/login evidence', result)
              }
              return result
            },
            recover: async ({ state, attempt, error }) => {
              await disconnectMiniProgramQuietly(state.mp, `disconnect stale automator after profile/login attempt ${attempt}`)
              if (error?.releaseUiResult?.buildIdentityPassed === false) {
                console.warn('[release-ui] profile version mismatch; cold-restarting DevTools before retry')
                await startAutomator({ cliPath, projectPath, idePort, autoPort })
                state.mp = await connectMiniProgram(autoPort)
                return
              }
              await sleep(2500)
              state.mp = await connectMiniProgram(autoPort)
            },
          })
          mp = mpState.mp
          evidence.profileLoginAttempt = run.attempt
          evidence.profileLoginClean = run.result
          if (run.result.buildIdentityPassed) {
            evidence.markers.push('HH_RELEASE_LOGIN_VERSION')
            console.log('HH_RELEASE_LOGIN_VERSION')
          }
          if (run.result.cleanPassed) {
            evidence.markers.push('HH_RELEASE_PROFILE_LOGIN_CLEAN')
            console.log('HH_RELEASE_PROFILE_LOGIN_CLEAN')
          }
        } catch (error) {
          if (error?.releaseUiResult) evidence.profileLoginClean = error.releaseUiResult
          throw error
        }
      },
      cleanup: async () => {
        if (!runContext.releaseFixture) return
        const fixture = runContext.releaseFixture
        try {
          evidence.releaseFixtureCleanup = await withTimeout(
            cleanupReleaseFixture(mpState.mp, fixture),
            60000,
            'cleanup release UI fixture',
          )
          if (!evidence.releaseFixtureCleanup.ok) {
            throw new Error(`Release fixture cleanup failed: ${JSON.stringify(evidence.releaseFixtureCleanup)}`)
          }
        } finally {
          runContext.releaseFixture = null
        }
      },
    })
    evidence.uiChecks = uiChecks.stages
    if (!uiChecks.ok) {
      throw new AggregateError(
        uiChecks.failures.map((failure) => new Error(`${failure.stage}: ${failure.error}`)),
        `Release UI checks failed: ${uiChecks.failures.map((failure) => failure.stage).join(', ')}`,
      )
    }

    assertReleaseUiEvidence({
      homeColdStartNonEmpty: evidence.homeColdStart?.passed,
      homeImagesRendered: evidence.homeDetail?.homeImagesRendered,
      homeArchiveTabsSticky: evidence.homeArchiveTabs?.passed,
      homeDetailNonEmpty: evidence.homeDetail?.passed,
      loginBuildIdentityVerified: evidence.profileLoginClean?.buildIdentityPassed,
      profileLoginClean: evidence.profileLoginClean?.cleanPassed,
    })

    const jsonPath = await writeEvidence({ mp: mpState.mp, evidenceDir, evidence })
    console.log(`[OK] DevTools release UI evidence passed: ${jsonPath}`)
  } catch (error) {
    mp = mpState.mp || mp
    evidence.error = String(error?.message || error)
    let finalError = error
    if (runContext.releaseFixture) {
      try {
        evidence.releaseFixtureCleanup = await withTimeout(
          cleanupReleaseFixture(mp, runContext.releaseFixture),
          60000,
          'cleanup failed release UI fixture',
        )
        runContext.releaseFixture = null
        if (!evidence.releaseFixtureCleanup.ok) {
          finalError = new AggregateError(
            [error, new Error(`Release fixture cleanup failed: ${JSON.stringify(evidence.releaseFixtureCleanup)}`)],
            'release UI gate and fixture cleanup both failed',
          )
        }
      } catch (cleanupError) {
        evidence.releaseFixtureCleanup = {
          ok: false,
          error: stringifyError(cleanupError),
        }
        runContext.releaseFixture = null
        finalError = new AggregateError([error, cleanupError], 'release UI gate and fixture cleanup both failed')
      }
    }
    const jsonPath = resolve(evidenceDir, 'release-ui-evidence.failed.json')
    writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
    console.error(`[release-ui] failed evidence saved: ${jsonPath}`)
    throw finalError
  } finally {
    let finalCleanupError = null
    if (runContext.releaseFixture) {
      try {
        const finalCleanup = await withTimeout(cleanupReleaseFixture(mp, runContext.releaseFixture), 60000, 'cleanup leftover release UI fixture')
        if (!finalCleanup.ok) finalCleanupError = new Error(`Release fixture final cleanup failed: ${JSON.stringify(finalCleanup)}`)
      } catch (cleanupError) {
        finalCleanupError = cleanupError
      } finally {
        runContext.releaseFixture = null
      }
    }
    try { await withTimeout(restoreStorage(mp, originalStorage), 15000, 'restore release UI storage') } catch {}
    try { await withTimeout(mpState.mp.disconnect(), 15000, 'disconnect release UI automator') } catch {}
    try {
      if (
        !existsSync(resolve(evidenceDir, 'release-ui-evidence.json')) &&
        !existsSync(resolve(evidenceDir, 'release-ui-evidence.failed.json'))
      ) {
        rmSync(evidenceDir, { recursive: true, force: true })
      }
    } catch {}
    if (finalCleanupError) throw finalCleanupError
  }
}

withValidationLease({ command: 'test-mp-release-ui' }, main).catch((error) => {
  console.error(`[FAIL] ${error?.message || error}`)
  process.exit(1)
})
