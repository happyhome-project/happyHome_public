/**
 * WeChat DevTools release UI gate.
 *
 * This script opens the built mp-weixin package through the DevTools automator
 * websocket and proves the two release-critical paths:
 *   - HH_RELEASE_HOME_DETAIL_NONEMPTY
 *   - HH_RELEASE_LOGIN_READY
 *
 * It does not upload, does not generate QR codes, and does not require an
 * auto-replay recording.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import Connection from 'miniprogram-automator/out/Connection.js'
import MiniProgram from 'miniprogram-automator/out/MiniProgram.js'

import {
  assertReleaseUiEvidence,
  buildDevToolsAutoArgs,
} from './lib/mp-release-ui-policy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_IDE_PORT = 21929
const DEFAULT_AUTO_PORT = 9420
const DEFAULT_RELEASE_OPENID = 'h5-qa-user-001'
const DEFAULT_RELEASE_COMMUNITY_ID = '6ded7a7769e789c1000879305ec314da'
const HOME_POST_SELECTORS = ['.live-row', '.guide-card', '.arc-item', '.post-card']
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

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

function startAutomator({ cliPath, projectPath, idePort, autoPort }) {
  const args = buildDevToolsAutoArgs({ projectPath, idePort, autoPort })
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
}

async function connectMiniProgram(autoPort) {
  let lastError = null
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    for (const host of ['127.0.0.1', 'localhost']) {
      try {
        const conn = await Connection.default.create(`ws://${host}:${autoPort}`)
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

async function seedReleaseLogin(mp) {
  const openid = String(process.env.HH_RELEASE_TEST_OPENID || DEFAULT_RELEASE_OPENID)
  const communityId = String(process.env.HH_RELEASE_TEST_COMMUNITY_ID || DEFAULT_RELEASE_COMMUNITY_ID)
  const nickName = String(process.env.HH_RELEASE_TEST_NICKNAME || 'HH Release Bot')
  await mp.evaluate(async (id, commId, nn) => {
    wx.setStorageSync('dev-gateway', '1')
    wx.setStorageSync('test-openid', id)
    wx.setStorageSync('user_store', {
      openId: id,
      nickName: nn,
      avatarUrl: '',
      role: 'user',
      isLoggedIn: true,
    })
    wx.setStorageSync('community_store', {
      currentCommunityId: commId,
      currentSectionIndex: 0,
    })
    const pages = getCurrentPages()
    const vm = pages && pages[0] && (pages[0].$vm || pages[0].$vue || pages[0])
    const pinia = vm && (vm.$pinia || (vm.$ && vm.$appContext && vm.$appContext.config.globalProperties.$pinia))
    if (pinia) {
      for (const [storeId, store] of pinia._s) {
        if (typeof store.loadFromStorage === 'function') store.loadFromStorage()
        if (storeId === 'community' && typeof store.loadMyCommunities === 'function') {
          await store.loadMyCommunities()
          if (commId && typeof store.switchCommunity === 'function') await store.switchCommunity(commId)
        }
      }
    }
    return true
  }, openid, communityId, nickName)
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

async function verifyHomeDetail(mp) {
  console.log('[release-ui] open home')
  let home = await mp.reLaunch('/pages/index/index')
  await sleep(6000)
  let homeText = await pageText(home)
  let target = await findFirstPost(home)

  if (!target) {
    console.log('[release-ui] no post candidates in current session; seeding release login fixture')
    await seedReleaseLogin(mp)
    home = await mp.reLaunch('/pages/index/index')
    await sleep(7000)
    homeText = await pageText(home)
    target = await findFirstPost(home)
  }

  if (!target) {
    throw new Error(`Home page has no tappable post candidates. textLength=${homeText.length}. Log into DevTools or configure HH_RELEASE_TEST_OPENID/HH_RELEASE_TEST_COMMUNITY_ID.`)
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
    detailPath,
    detailTextLength: detailText.length,
    detailTextSample: detailText.slice(0, 300),
    tappedSelector: target.selector,
    tappedSelectorCount: target.count,
    contentCount,
    errorCount,
  }
}

async function verifyLoginPageReady(mp) {
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
  const hasLoginText = /微信登录|DEV 登录|确认登录|登录/.test(text)
  return {
    passed: text.trim().length >= 20 && loginFormCount > 0 && hasLoginText,
    logoutResult,
    path: page.path || '',
    textLength: text.length,
    textSample: text.slice(0, 300),
    loginFormCount,
    hasLoginText,
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

  startAutomator({ cliPath, projectPath, idePort, autoPort })
  const mp = await connectMiniProgram(autoPort)
  const evidenceDir = createEvidenceDir()
  const originalStorage = await captureStorage(mp)

  const evidence = {
    createdAt: new Date().toISOString(),
    cliPath,
    projectPath,
    idePort,
    autoPort,
    markers: [],
  }

  try {
    const homeDetail = await verifyHomeDetail(mp)
    evidence.homeDetail = homeDetail
    if (homeDetail.passed) {
      evidence.markers.push('HH_RELEASE_HOME_DETAIL_NONEMPTY')
      console.log('HH_RELEASE_HOME_DETAIL_NONEMPTY')
    }

    const loginPage = await verifyLoginPageReady(mp)
    evidence.loginPage = loginPage
    if (loginPage.passed) {
      evidence.markers.push('HH_RELEASE_LOGIN_READY')
      console.log('HH_RELEASE_LOGIN_READY')
    }

    assertReleaseUiEvidence({
      homeDetailNonEmpty: homeDetail.passed,
      loginPageReady: loginPage.passed,
    })

    const jsonPath = await writeEvidence({ mp, evidenceDir, evidence })
    console.log(`[OK] DevTools release UI evidence passed: ${jsonPath}`)
  } catch (error) {
    evidence.error = String(error?.message || error)
    const jsonPath = resolve(evidenceDir, 'release-ui-evidence.failed.json')
    writeFileSync(jsonPath, JSON.stringify(evidence, null, 2), 'utf8')
    console.error(`[release-ui] failed evidence saved: ${jsonPath}`)
    throw error
  } finally {
    try { await restoreStorage(mp, originalStorage) } catch {}
    try { await mp.disconnect() } catch {}
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
