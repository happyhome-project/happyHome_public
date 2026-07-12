#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createH5WebLauncher } from './h5-web.mjs'
import { SECTION_IDS } from './lib/h5-test-tenant.mjs'
import { createCloudBaseTenantStore, loadTenantConfig, runCli as runTenantCli } from './h5-test-tenant.mjs'
import { withValidationLease } from './lib/validation-lease.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const H5_SMOKE_LAST_CREATED_POST_ID_KEY = 'hh-h5-smoke-last-created-post-id'
const H5_SMOKE_UPLOADED_FILE_IDS_KEY = 'hh-h5-smoke-uploaded-file-ids'
export const EXPECTED_HOME_VISIBLE_LONG = 20
const SAFE_KEYS = new Set(['mode', 'runId', 'cwd', 'branch', 'head', 'port', 'counts', 'geometry', 'routes', 'cleanup', 'top', 'status', 'cleanupOk'])
export function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => SAFE_KEYS.has(key) || ['long', 'short', 'empty', 'posts', 'created', 'stickyTop', 'searchTop', 'viewportHeight', 'ok'].includes(key)).map(([key, item]) => [key, sanitizeEvidence(item)]))
}

export function validateReadEvidence({ doctor, visible }) {
  const stored = doctor?.counts?.activePostsBySection
  if (JSON.stringify(stored) !== JSON.stringify([30, 1, 0])) throw new Error(`unexpected tenant doctor stored counts: ${JSON.stringify(stored)}`)
  if (visible?.long !== EXPECTED_HOME_VISIBLE_LONG) throw new Error(`unexpected visible long count: ${visible?.long}`)
  if (visible?.short !== 1) throw new Error(`unexpected visible short count: ${visible?.short}`)
  if (visible?.empty !== 0) throw new Error(`unexpected visible empty count: ${visible?.empty}`)
}

export async function resolveCleanupIntent({ intent, capturedPostId = async () => '', capturedFileIDs = async () => [], locate, remove, removeFiles }) {
  if (!intent) return { found: false }
  const postId = String(await capturedPostId() || await locate(intent.content) || '').trim()
  if (!postId) throw new Error(`cleanup unconfirmed for run ${intent.runId || 'unknown'}`)
  const fileIDs = [...new Set((await capturedFileIDs()).map((value) => String(value || '').trim()).filter(Boolean))]
  if (!fileIDs.length) throw new Error(`storage cleanup unconfirmed for run ${intent.runId || 'unknown'}`)
  await remove(postId)
  await removeFiles(fileIDs)
  return { found: true, postId, fileIDs }
}

async function realRead({ running, doctor, home = homedir() }) {
  const config = loadTenantConfig({ home })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${running.url}/#/pages/profile/index`)
    if (!(await page.getByTestId('h5-login-username').isVisible())) await page.getByText('登录', { exact: true }).first().click()
    await page.getByTestId('h5-login-username').fill(config.username)
    await page.getByTestId('h5-login-password').fill(config.password)
    await page.getByTestId('h5-login-nickname').fill(`H5 smoke ${Date.now()}`)
    await page.getByTestId('h5-login-submit').click()
    await page.getByTestId('profile-page').waitFor()
    await page.goto(`${running.url}/#/pages/index/index`)
    const counts = {}
    for (const [name, id] of [['long', SECTION_IDS.long], ['short', SECTION_IDS.short], ['empty', SECTION_IDS.empty]]) {
      await page.getByTestId(`home-section-tab-${id}`).last().click()
      await page.waitForFunction((sectionId) => document.querySelector(`[data-testid="home-section-tab-${sectionId}"][data-active="true"]`), id)
      const expected = name === 'long' ? EXPECTED_HOME_VISIBLE_LONG : name === 'short' ? 1 : 0
      await page.waitForFunction((count) => document.querySelectorAll('[data-testid="home-post-card"]').length === count, expected)
      counts[name] = await page.getByTestId('home-post-card').count()
    }
    validateReadEvidence({ doctor, visible: counts })
    await page.getByTestId(`home-section-tab-${SECTION_IDS.long}`).last().click()
    const firstCard = page.getByTestId('home-post-card').first()
    const postId = await firstCard.getAttribute('data-post-id')
    if (!postId) throw new Error('long homepage card is missing exact post id')
    await firstCard.click()
    await page.getByTestId('detail-ready').waitFor()
    const detailUrl = new URL(page.url())
    const detailQuery = new URLSearchParams(detailUrl.hash.includes('?') ? detailUrl.hash.slice(detailUrl.hash.indexOf('?') + 1) : '')
    if (detailQuery.get('postId') !== postId) throw new Error('detail URL did not contain the exact homepage postId')
    if (await page.getByTestId('detail-ready').getAttribute('data-post-id') !== postId) throw new Error('detail did not render the exact homepage post')
    await page.goto(`${running.url}/#/pages/section/index?sectionId=${encodeURIComponent(SECTION_IDS.long)}`)
    await page.getByTestId('section-ready').waitFor()
    if (await page.getByTestId('section-ready').getAttribute('data-section-id') !== SECTION_IDS.long) throw new Error('section page loaded the wrong section')
    if (await page.getByTestId('section-post-card').count() !== EXPECTED_HOME_VISIBLE_LONG) throw new Error('long section did not render exactly 20 posts')
    await page.goto(`${running.url}/#/pages/profile/index`)
    await page.getByTestId('profile-page').waitFor()
    const routes = ['home', `section:${SECTION_IDS.long}`, `detail:${postId}`, 'profile']
    await page.goto(`${running.url}/#/pages/index/index`)
    const geometry = await page.evaluate(() => ({ viewportHeight: innerHeight, searchTop: document.querySelector('.home-search')?.getBoundingClientRect().top ?? null, stickyTop: document.querySelector('.section-tabs')?.getBoundingClientRect().top ?? null }))
    return { routes, counts, geometry }
  } finally { await browser.close() }
}

async function realWrite({ running, runId, home = homedir() }) {
  const config = loadTenantConfig({ home })
  const tenantStore = await createCloudBaseTenantStore({ config, home })
  let browser
  let page
  const content = `H5 smoke ${runId}`
  const pngPath = join(ROOT, '.codex-local', 'h5-web-smoke', runId, 'pixel.png')
  let postUrl = ''
  let postId = ''
  let cleanupIntent = null
  let deleted = false
  const cleanup = async () => {
    try {
      if (cleanupIntent && !deleted) {
        await resolveCleanupIntent({ intent: cleanupIntent, capturedPostId: async () => String(await page.evaluate((key) => sessionStorage.getItem(key) || '', H5_SMOKE_LAST_CREATED_POST_ID_KEY)), capturedFileIDs: async () => {
          const raw = await page.evaluate((key) => sessionStorage.getItem(key) || '[]', H5_SMOKE_UPLOADED_FILE_IDS_KEY)
          try { return JSON.parse(raw) } catch { return [] }
        }, locate: async () => {
          if (postId) return postId
          await page.goto(`${running.url}/#/pages/index/index`)
          await page.getByTestId(`home-section-tab-${SECTION_IDS.short}`).last().click()
          const exact = page.getByText(content, { exact: true })
          try { await exact.waitFor({ timeout: 5_000 }) } catch { return '' }
          postId = (await exact.locator('xpath=ancestor::*[@data-post-id][1]').getAttribute('data-post-id')) || ''
          return postId
        }, remove: async (exactPostId) => {
          postUrl ||= `${running.url}/#/pages/detail/index?postId=${encodeURIComponent(exactPostId)}`
          await page.goto(postUrl)
          await page.getByTestId('post-delete').click()
          await page.getByText('确定', { exact: true }).click()
          await page.waitForURL((url) => url.toString() !== postUrl)
          deleted = true
          await page.goto(postUrl)
          await page.getByText(/详情加载失败|帖子不存在|已删除/).waitFor()
        }, removeFiles: async (fileIDs) => tenantStore.deleteFiles(fileIDs) })
      }
    } finally {
      await page?.evaluate((key) => sessionStorage.removeItem(key), H5_SMOKE_LAST_CREATED_POST_ID_KEY).catch(() => {})
      await page?.evaluate((key) => sessionStorage.removeItem(key), H5_SMOKE_UPLOADED_FILE_IDS_KEY).catch(() => {})
      await browser?.close()
      await unlink(pngPath).catch(() => {})
    }
  }
  try {
    await mkdir(dirname(pngPath), { recursive: true })
    await writeFile(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${running.url}/#/pages/profile/index`)
    if (!(await page.getByTestId('h5-login-username').isVisible())) await page.getByText('登录', { exact: true }).first().click()
    await page.getByTestId('h5-login-username').fill(config.username)
    await page.getByTestId('h5-login-password').fill(config.password)
    await page.getByTestId('h5-login-nickname').fill(`H5 smoke ${runId.slice(0, 8)}`)
    await page.getByTestId('h5-login-submit').click()
    await page.goto(`${running.url}/#/pages/create/index`)
    await page.getByTestId(`create-section-${SECTION_IDS.short}`).click()
    await page.getByTestId('widget-input-hh-web-h5-v1-widget-short').fill(content)
    await page.getByTestId('widget-image-input-hh-web-h5-v1-widget-short-image').setInputFiles(pngPath)
    await page.evaluate((key) => sessionStorage.removeItem(key), H5_SMOKE_LAST_CREATED_POST_ID_KEY)
    await page.evaluate((key) => sessionStorage.removeItem(key), H5_SMOKE_UPLOADED_FILE_IDS_KEY)
    cleanupIntent = { runId, content }
    await page.getByTestId('create-submit').click()
    await page.getByText(content, { exact: true }).waitFor()
    const card = page.getByText(content, { exact: true }).locator('xpath=ancestor::*[@data-post-id][1]')
    postId = (await card.getAttribute('data-post-id')) || ''
    if (!postId) throw new Error('created post card is missing exact post id')
    await card.click()
    await page.getByTestId('post-delete').waitFor()
    postUrl = page.url()
    if (!postUrl.includes(encodeURIComponent(postId)) && !postUrl.includes(postId)) throw new Error('detail URL is missing exact created post id')
    const imageUrl = await page.getByTestId('detail-content-image').getAttribute('src')
    if (!/^https:\/\//.test(imageUrl || '')) throw new Error(`created post image did not resolve to an HTTPS storage URL for run ${runId}`)
    return { counts: { created: 1 }, geometry: {}, cleanup, storageUrlVerified: true }
  } catch (error) {
    try { await cleanup(); error.cleanupOk = true } catch (cleanupError) { const aggregate = new AggregateError([error, cleanupError], `${error.message}; cleanup failed`); aggregate.cleanupOk = false; throw aggregate }
    throw error
  }
}

async function writeEvidence(root, evidence) {
  const path = join(root, '.codex-local', 'h5-web-smoke', evidence.runId, 'summary.json')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => {}) }
}

export async function runH5WebSmoke({ mode = 'read', runId = randomUUID(), root = ROOT, deps = {} } = {}) {
  if (!['read', 'write'].includes(mode)) throw new Error('mode must be read or write')
  const d = { doctor: () => runTenantCli({ argv: ['doctor'], root }), launcher: createH5WebLauncher({ root }), browseRead: realRead, browseWrite: realWrite, lease: withValidationLease, writeEvidence: (e) => writeEvidence(root, e), ...deps }
  const execute = async () => {
    let running
    let result
    let cleanupAttempted = false
    let cleanupOk = mode === 'read' ? true : false
    try {
      const doctor = await d.doctor()
      running = await d.launcher.start()
      result = mode === 'read' ? await d.browseRead({ running, runId, doctor }) : await d.browseWrite({ running, runId })
      if (result?.cleanup) { cleanupAttempted = true; await result.cleanup(); cleanupOk = true }
      const evidence = sanitizeEvidence({ status: 'passed', cleanupOk, mode, runId, cwd: running.git.cwd, branch: running.git.branch, head: running.git.head, port: running.port, ...result })
      await d.writeEvidence(evidence)
      return evidence
    } catch (error) {
      if (result?.cleanup && !cleanupAttempted) {
        cleanupAttempted = true
        try { await result.cleanup(); cleanupOk = true } catch (cleanupError) { cleanupOk = false; error = new AggregateError([error, cleanupError], `${error.message}; cleanup failed`) }
      } else if (error?.cleanupOk === true) cleanupOk = true
      const failed = sanitizeEvidence({ status: 'failed', cleanupOk, mode, runId, ...(running ? { cwd: running.git.cwd, branch: running.git.branch, head: running.git.head, port: running.port } : {}) })
      await d.writeEvidence(failed)
      throw error
    } finally { await running?.stop() }
  }
  return mode === 'write' ? await d.lease({ command: `h5-web-smoke:write:${runId}` }, execute) : await execute()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.slice(2).find((arg) => arg.startsWith('--mode='))?.slice(7) || 'read'
  runH5WebSmoke({ mode }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`[h5-web-smoke] ${error.message}`); process.exitCode = 1 })
}
