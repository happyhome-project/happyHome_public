/**
 * WeChat DevTools release UI gate.
 *
 * This script opens the built mp-weixin package through the DevTools automator
 * websocket and proves the release-critical paths:
 *   - HH_RELEASE_HOME_DETAIL_NONEMPTY
 *   - HH_RELEASE_LOGIN_VERSION
 *   - HH_RELEASE_PROFILE_LOGIN_CLEAN
 *
 * It does not upload, does not generate QR codes, and does not require an
 * auto-replay recording.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

import {
  assertReleaseUiEvidence,
  buildDevToolsAutoArgs,
  buildDevToolsCacheArgs,
  buildDevToolsCloseArgs,
  buildDevToolsQuitPortArgs,
} from './lib/mp-release-ui-policy.mjs'

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
  return DEFAULT_IDE_PORT
}

function detectAutoPort() {
  const explicit = Number(process.env.WECHAT_DEVTOOLS_AUTO_PORT || process.env.WS_PORT || 0)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  return DEFAULT_AUTO_PORT
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
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ExecutablePath -and
  $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and
  $_.CommandLine -and
  $_.CommandLine.Contains('auto --project') -and
  $_.CommandLine.Contains($project) -and
  $_.CommandLine.Contains('--auto-port') -and
  $_.CommandLine.Contains($autoPort)
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
    console.warn(`[release-ui] failed to stop stale DevTools auto processes: ${(result.stderr || result.stdout || '').trim()}`)
    return 0
  }
  if (count > 0) {
    console.log(`[release-ui] stopped ${count} stale DevTools auto process(es) for this project`)
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
  await sleep(1500)
}

async function refreshDevToolsProjectCache({ cliPath, projectPath, idePort, autoPort }) {
  if (process.env.HH_RELEASE_UI_REFRESH_DEVTOOLS_CACHE === '0') return
  runDevToolsMaintenance(
    cliPath,
    buildDevToolsCloseArgs({ projectPath, idePort }),
    'close DevTools project before cache refresh',
  )
  for (const clean of ['compile', 'file']) {
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

async function createReleaseFixture(mp) {
  const runId = makeReleaseRunId()
  const adminCtx = makeFixtureAdminCtx(runId)
  const name = `${RELEASE_FIXTURE_PREFIX}${runId}`
  const fixture = { runId, adminCtx, configured: false, communityId: '', sectionId: '', postId: '' }

  try {
    const community = await callMpCloud(mp, 'admin', {
      action: 'community.createAdmin',
      _actAs: adminCtx,
      name,
      description: 'temporary release UI fixture',
      coverImage: '',
      location: { province: 'release', city: 'release', district: 'release', address: 'release-ui' },
      joinType: 'open',
    })
    fixture.communityId = String(community.communityId || '')
    if (!fixture.communityId) throw new Error('community.createAdmin did not return communityId')

    const section = await callMpCloud(mp, 'admin', {
      action: 'section.create',
      _actAs: adminCtx,
      communityId: fixture.communityId,
      name: 'Release UI',
      icon: 'R',
      order: 0,
      type: 'realtime',
    })
    fixture.sectionId = String(section.sectionId || '')
    if (!fixture.sectionId) throw new Error('section.create did not return sectionId')

    const widgetsResult = await callMpCloud(mp, 'admin', {
      action: 'section.updateWidgets',
      _actAs: adminCtx,
      sectionId: fixture.sectionId,
      widgets: [
        { type: 'short_text', label: 'Title', fieldKey: 'title', required: true, showInList: true, widgetId: '' },
        { type: 'summary', label: 'Summary', fieldKey: 'summary', required: false, showInList: true, widgetId: '' },
      ],
    })
    const widgets = Array.isArray(widgetsResult.widgets) ? widgetsResult.widgets : []
    const titleWidget = widgets.find((widget) => widget.type === 'short_text') || widgets[0]
    const summaryWidget = widgets.find((widget) => widget.type === 'summary')
    if (!titleWidget?.widgetId) throw new Error('section.updateWidgets did not return a title widget')

    const content = {
      [titleWidget.widgetId]: `Release UI fixture ${runId}`,
    }
    if (summaryWidget?.widgetId) {
      content[summaryWidget.widgetId] = 'Automated release validation post.'
    }

    const post = await callMpCloud(mp, 'admin', {
      action: 'post.createAdmin',
      _actAs: adminCtx,
      communityId: fixture.communityId,
      sectionId: fixture.sectionId,
      content,
    }, { timeoutMs: 90000 })
    fixture.postId = String(post.postId || '')
    if (!fixture.postId) throw new Error('post.createAdmin did not return postId')

    if (post.auditStatus !== 'pass') {
      await callMpCloud(mp, 'admin', {
        action: 'audit.approveAdmin',
        _actAs: adminCtx,
        postId: fixture.postId,
      })
    }

    return fixture
  } catch (error) {
    if (fixture.communityId) {
      try { await cleanupReleaseFixture(mp, fixture) } catch {}
    }
    throw error
  }
}

async function seedCurrentViewerIntoCommunity(mp, fixture) {
  try {
    await callMpCloud(mp, 'member', { action: 'apply', communityId: fixture.communityId })
  } catch (error) {
    const message = stringifyError(error)
    if (!/already|active|member|成员|宸叉槸/.test(message)) throw error
  }

  const snapshot = await callMpCloud(mp, 'post', {
    action: 'bootstrap',
    currentCommunityId: fixture.communityId,
    limitPerSection: 20,
  })
  const viewerOpenId = String(snapshot.viewerOpenId || '')
  if (!viewerOpenId) throw new Error('post.bootstrap did not return viewerOpenId')
  if (String(snapshot.currentCommunityId || '') !== fixture.communityId) {
    throw new Error(`post.bootstrap did not select release fixture community ${fixture.communityId}`)
  }

  await mp.evaluate((seed) => {
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
  }, snapshot)

  return snapshot
}

async function seedReleaseLogin(mp) {
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
    : await createReleaseFixture(mp)
  const snapshot = await seedCurrentViewerIntoCommunity(mp, fixture)
  return { fixture, snapshot }
}

async function cleanupReleaseFixture(mp, fixture) {
  if (!fixture || fixture.configured || !fixture.communityId || !fixture.adminCtx) {
    return { ok: true, skipped: true, reason: 'no temporary fixture cleanup required' }
  }
  const steps = []
  for (const action of ['community.disable', 'community.hardDelete']) {
    try {
      await callMpCloud(mp, 'admin', {
        action,
        _actAs: fixture.adminCtx,
        communityId: fixture.communityId,
      }, { timeoutMs: 90000 })
      steps.push({ action, ok: true })
    } catch (error) {
      steps.push({ action, ok: false, error: stringifyError(error) })
      break
    }
  }
  return {
    ok: steps.every((step) => step.ok),
    communityId: fixture.communityId,
    steps,
  }
}

async function forceLogout(mp) {
  return await mp.evaluate(() => {
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
  })
}

async function findFirstPost(page) {
  for (const selector of HOME_POST_SELECTORS) {
    const nodes = await page.$$(selector).catch(() => [])
    if (nodes.length) return { selector, node: nodes[0], count: nodes.length }
  }
  return null
}

async function verifyHomeDetail(mp, context = {}) {
  console.log('[release-ui] open home')
  let releaseSeed = null
  let home = await mp.reLaunch('/pages/index/index')
  await sleep(6000)
  let homeText = await pageText(home)
  let target = await findFirstPost(home)

  if (!target) {
    console.log('[release-ui] no post candidates in current session; creating temporary release fixture')
    releaseSeed = await seedReleaseLogin(mp)
    context.releaseFixture = releaseSeed.fixture
    home = await mp.reLaunch('/pages/index/index')
    await sleep(7000)
    homeText = await pageText(home)
    target = await findFirstPost(home)
  }

  if (!target) {
    const fixture = releaseSeed?.fixture ? ` fixture=${JSON.stringify(summarizeReleaseFixture(releaseSeed.fixture))}` : ''
    throw new Error(`Home page has no tappable post candidates after release fixture. textLength=${homeText.length}.${fixture}`)
  }

  console.log(`[release-ui] tap first post via ${target.selector}`)
  await target.node.tap()
  await sleep(6000)
  const detail = await mp.currentPage()
  const detailText = await pageText(detail)
  const contentCount = (await detail.$$('.content').catch(() => [])).length
  const errorCount = (await detail.$$('.detail-state-title').catch(() => [])).length
  const detailPath = detail.path || ''

  const passed = detailPath.includes('pages/detail/index') &&
    detailText.trim().length >= 20 &&
    contentCount > 0 &&
    errorCount === 0

  return {
    passed,
    homeTextLength: homeText.length,
    homeTextSample: homeText.slice(0, 300),
    detailPath,
    detailTextLength: detailText.length,
    detailTextSample: detailText.slice(0, 300),
    tappedSelector: target.selector,
    tappedSelectorCount: target.count,
    contentCount,
    errorCount,
    releaseFixture: summarizeReleaseFixture(releaseSeed?.fixture),
  }
}

async function verifyProfileLoginClean(mp) {
  console.log('[release-ui] force logged-out state')
  const logoutResult = await forceLogout(mp)
  console.log(`[release-ui] logout result: ${JSON.stringify(logoutResult)}`)
  console.log('[release-ui] open profile/login page')
  let page
  try {
    page = await mp.switchTab('/pages/profile/index')
  } catch (error) {
    console.log(`[release-ui] switchTab profile failed, fallback reLaunch: ${error?.message || error}`)
    page = await mp.reLaunch('/pages/profile/index')
  }
  await sleep(4000)
  const text = await pageText(page)
  const loginFormCount = (await page.$$('.login-form').catch(() => [])).length
  const debugLeakVisible = /state:logged|login:[01]|cc:/.test(text)
  const expectedVersion = expectedBuildVersion()
  const versionVisible = Boolean(expectedVersion && text.includes(expectedVersion))
  return {
    cleanPassed: text.trim().length >= 20 && loginFormCount > 0 && !debugLeakVisible,
    versionPassed: text.trim().length >= 20 && loginFormCount > 0 && versionVisible,
    logoutResult,
    path: page.path || '',
    textLength: text.length,
    textSample: text.slice(0, 300),
    loginFormCount,
    debugLeakVisible,
    expectedVersion,
    versionVisible,
  }
}

function createEvidenceDir() {
  const dir = resolve(ROOT, '.codex-local', 'release-evidence', new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

async function writeEvidence({ mp, evidenceDir, evidence }) {
  const jsonPath = resolve(evidenceDir, 'release-ui-evidence.json')
  writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
  if (process.env.HH_CAPTURE_RELEASE_SCREENSHOT === '1') {
    try {
      await mp.screenshot({ path: resolve(evidenceDir, 'last-page.png') })
    } catch (error) {
      evidence.screenshotError = String(error?.message || error)
      writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
    }
  }
  return jsonPath
}

async function main() {
  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()
  const idePort = detectIdePort()
  const autoPort = detectAutoPort()

  if (!cliPath) throw new Error('WeChat DevTools CLI was not found. Set WECHAT_DEVTOOLS_CLI_PATH.')
  if (!projectPath) throw new Error('mp-weixin build output was not found. Run the mp-weixin build first.')

  console.log('[DevTools release UI gate]')
  console.log(`cliPath: ${cliPath}`)
  console.log(`projectPath: ${projectPath}`)
  console.log(`idePort: ${idePort}`)
  console.log(`autoPort: ${autoPort}`)

  await startAutomator({ cliPath, projectPath, idePort, autoPort })
  const mp = await connectMiniProgram(autoPort)
  const evidenceDir = createEvidenceDir()
  const originalStorage = await withTimeout(captureStorage(mp), 15000, 'capture release UI storage')
  const runContext = { releaseFixture: null }

  const evidence = {
    createdAt: new Date().toISOString(),
    cliPath,
    projectPath,
    idePort,
    autoPort,
    markers: [],
  }

  try {
    const homeDetail = await withTimeout(verifyHomeDetail(mp, runContext), 150000, 'verify release home/detail UI')
    evidence.homeDetail = homeDetail
    if (homeDetail.passed) {
      evidence.markers.push('HH_RELEASE_HOME_DETAIL_NONEMPTY')
      console.log('HH_RELEASE_HOME_DETAIL_NONEMPTY')
    }

    const profileLoginClean = await withTimeout(verifyProfileLoginClean(mp), 90000, 'verify release profile/login UI')
    evidence.profileLoginClean = profileLoginClean
    if (profileLoginClean.versionPassed) {
      evidence.markers.push('HH_RELEASE_LOGIN_VERSION')
      console.log('HH_RELEASE_LOGIN_VERSION')
    }
    if (profileLoginClean.cleanPassed) {
      evidence.markers.push('HH_RELEASE_PROFILE_LOGIN_CLEAN')
      console.log('HH_RELEASE_PROFILE_LOGIN_CLEAN')
    }

    assertReleaseUiEvidence({
      homeDetailNonEmpty: homeDetail.passed,
      loginVersionVisible: profileLoginClean.versionPassed,
      profileLoginClean: profileLoginClean.cleanPassed,
    })

    if (runContext.releaseFixture) {
      evidence.releaseFixtureCleanup = await withTimeout(
        cleanupReleaseFixture(mp, runContext.releaseFixture),
        60000,
        'cleanup release UI fixture',
      )
      runContext.releaseFixture = null
      if (!evidence.releaseFixtureCleanup.ok) {
        throw new Error(`Release fixture cleanup failed: ${JSON.stringify(evidence.releaseFixtureCleanup)}`)
      }
    }

    const jsonPath = await writeEvidence({ mp, evidenceDir, evidence })
    console.log(`[OK] DevTools release UI evidence passed: ${jsonPath}`)
  } catch (error) {
    evidence.error = String(error?.message || error)
    if (runContext.releaseFixture) {
      try {
        evidence.releaseFixtureCleanup = await withTimeout(
          cleanupReleaseFixture(mp, runContext.releaseFixture),
          60000,
          'cleanup failed release UI fixture',
        )
        runContext.releaseFixture = null
      } catch (cleanupError) {
        evidence.releaseFixtureCleanup = {
          ok: false,
          error: stringifyError(cleanupError),
        }
      }
    }
    const jsonPath = resolve(evidenceDir, 'release-ui-evidence.failed.json')
    writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
    console.error(`[release-ui] failed evidence saved: ${jsonPath}`)
    throw error
  } finally {
    if (runContext.releaseFixture) {
      try { await withTimeout(cleanupReleaseFixture(mp, runContext.releaseFixture), 60000, 'cleanup leftover release UI fixture') } catch {}
      runContext.releaseFixture = null
    }
    try { await withTimeout(restoreStorage(mp, originalStorage), 15000, 'restore release UI storage') } catch {}
    try { await withTimeout(mp.disconnect(), 15000, 'disconnect release UI automator') } catch {}
    try {
      if (
        !existsSync(resolve(evidenceDir, 'release-ui-evidence.json')) &&
        !existsSync(resolve(evidenceDir, 'release-ui-evidence.failed.json'))
      ) {
        rmSync(evidenceDir, { recursive: true, force: true })
      }
    } catch {}
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error?.message || error}`)
  process.exit(1)
})
