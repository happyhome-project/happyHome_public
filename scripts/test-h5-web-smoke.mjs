#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createH5WebLauncher } from './h5-web.mjs'
import { SECTION_IDS } from './lib/h5-test-tenant.mjs'
import { loadTenantConfig, runCli as runTenantCli } from './h5-test-tenant.mjs'
import { withValidationLease } from './lib/validation-lease.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SAFE_KEYS = new Set(['mode', 'runId', 'cwd', 'branch', 'head', 'port', 'counts', 'geometry', 'routes', 'cleanup', 'top'])
export function sanitizeEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeEvidence)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => SAFE_KEYS.has(key) || ['long', 'short', 'empty', 'posts', 'created', 'stickyTop', 'searchTop', 'viewportHeight', 'ok'].includes(key)).map(([key, item]) => [key, sanitizeEvidence(item)]))
}

async function realRead({ running, home = homedir() }) {
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
    for (const [name, id, expected] of [['long', SECTION_IDS.long, 20], ['short', SECTION_IDS.short, 1], ['empty', SECTION_IDS.empty, 0]]) {
      await page.getByTestId(`home-section-tab-${id}`).last().click()
      await page.waitForTimeout(100)
      counts[name] = await page.getByTestId('home-post-card').count()
      if (name === 'long' ? counts[name] < expected : counts[name] !== expected) throw new Error(`unexpected ${name} homepage count: ${counts[name]}`)
    }
    await page.getByTestId(`home-section-tab-${SECTION_IDS.long}`).last().click()
    const firstCard = page.getByTestId('home-post-card').first()
    const postId = await firstCard.getAttribute('data-post-id')
    if (!postId) throw new Error('long homepage card is missing exact post id')
    await firstCard.click()
    await page.getByTestId('detail-ready').waitFor()
    if (!(await page.getByTestId('detail-ready').getAttribute('data-post-id'))?.includes(postId)) throw new Error('detail did not open the exact homepage post')
    await page.goto(`${running.url}/#/pages/section/index?sectionId=${encodeURIComponent(SECTION_IDS.long)}`)
    await page.getByTestId('section-ready').waitFor()
    if (await page.getByTestId('section-ready').getAttribute('data-section-id') !== SECTION_IDS.long) throw new Error('section page loaded the wrong section')
    if (await page.getByTestId('section-post-card').count() < 20) throw new Error('long section did not render its real posts')
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
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const content = `H5 smoke ${runId}`
  const pngPath = join(ROOT, '.codex-local', 'h5-web-smoke', runId, 'pixel.png')
  await mkdir(dirname(pngPath), { recursive: true })
  await writeFile(pngPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  let postUrl = ''
  let postId = ''
  let created = false
  let deleted = false
  const cleanup = async () => {
    try {
      if (created && !deleted) {
        if (!postUrl) {
          await page.goto(`${running.url}/#/pages/index/index`)
          await page.getByTestId(`home-section-tab-${SECTION_IDS.short}`).last().click()
          const exact = page.getByText(content, { exact: true })
          await exact.waitFor()
          const card = exact.locator('xpath=ancestor::*[@data-post-id][1]')
          postId = (await card.getAttribute('data-post-id')) || ''
          if (!postId) throw new Error(`cleanup could not locate exact post id for ${runId}`)
          await card.click()
          postUrl = page.url()
        } else await page.goto(postUrl)
        await page.getByTestId('post-delete').click()
        await page.getByText('确定', { exact: true }).click()
        await page.waitForURL((url) => url.toString() !== postUrl)
        deleted = true
        await page.goto(postUrl)
        await page.getByText(/详情加载失败|帖子不存在|已删除/).waitFor()
      }
    } finally {
      await browser.close()
      await unlink(pngPath).catch(() => {})
    }
    if (created && !deleted) throw new Error(`write smoke cleanup failed for run ${runId}`)
  }
  try {
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
    await page.getByTestId('create-submit').click()
    created = true
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
    try { await cleanup() } catch (cleanupError) { throw new AggregateError([error, cleanupError], `${error.message}; cleanup failed`) }
    throw error
  }
}

async function writeEvidence(root, evidence) {
  const path = join(root, '.codex-local', 'h5-web-smoke', evidence.runId, 'summary.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 })
}

export async function runH5WebSmoke({ mode = 'read', runId = randomUUID(), root = ROOT, deps = {} } = {}) {
  if (!['read', 'write'].includes(mode)) throw new Error('mode must be read or write')
  const d = { doctor: () => runTenantCli({ argv: ['doctor'], root }), launcher: createH5WebLauncher({ root }), browseRead: realRead, browseWrite: realWrite, lease: withValidationLease, writeEvidence: (e) => writeEvidence(root, e), ...deps }
  await d.doctor()
  const running = await d.launcher.start()
  try {
    const execute = async () => {
      const result = mode === 'read' ? await d.browseRead({ running, runId }) : await d.browseWrite({ running, runId })
      try {
        const evidence = sanitizeEvidence({ mode, runId, cwd: running.git.cwd, branch: running.git.branch, head: running.git.head, port: running.port, ...result })
        await d.writeEvidence(evidence)
        return evidence
      } finally { await result?.cleanup?.() }
    }
    return mode === 'write' ? await d.lease({ command: `h5-web-smoke:write:${runId}` }, execute) : await execute()
  } finally { await running.stop() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.slice(2).find((arg) => arg.startsWith('--mode='))?.slice(7) || 'read'
  runH5WebSmoke({ mode }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`[h5-web-smoke] ${error.message}`); process.exitCode = 1 })
}
