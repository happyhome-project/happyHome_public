#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createH5WebLauncher } from './h5-web.mjs'
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
    const routes = []
    for (const route of ['pages/index/index', 'pages/section/index', 'pages/detail/index', 'pages/profile/index']) {
      await page.goto(`${running.url}/#/${route}`); routes.push(route)
    }
    await page.goto(`${running.url}/#/pages/index/index`)
    const geometry = await page.evaluate(() => ({ viewportHeight: innerHeight, searchTop: document.querySelector('.home-search')?.getBoundingClientRect().top ?? null, stickyTop: document.querySelector('.section-tabs')?.getBoundingClientRect().top ?? null }))
    const text = await page.locator('body').innerText()
    return { routes, counts: { long: (text.match(/基线长档案/g) || []).length, short: (text.match(/基线短档案/g) || []).length, empty: (text.match(/基线空档案/g) || []).length }, geometry }
  } finally { await browser.close() }
}

async function realWrite({ running, runId, home = homedir() }) {
  const config = loadTenantConfig({ home })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  let postUrl = ''
  let deleted = false
  try {
    await page.goto(`${running.url}/#/pages/profile/index`)
    if (!(await page.getByTestId('h5-login-username').isVisible())) await page.getByText('登录', { exact: true }).first().click()
    await page.getByTestId('h5-login-username').fill(config.username)
    await page.getByTestId('h5-login-password').fill(config.password)
    await page.getByTestId('h5-login-nickname').fill(`H5 smoke ${runId.slice(0, 8)}`)
    await page.getByTestId('h5-login-submit').click()
    await page.goto(`${running.url}/#/pages/create/index`)
    await page.getByTestId('create-section-hh-web-h5-v1-section-short').click()
    const content = `H5 smoke ${runId}`
    await page.getByTestId('widget-input-hh-web-h5-v1-widget-short').fill(content)
    await page.getByTestId('create-submit').click()
    await page.getByText(content, { exact: true }).waitFor()
    await page.getByText(content, { exact: true }).click()
    await page.getByTestId('post-delete').waitFor()
    postUrl = page.url()
    const storageUrls = await page.locator('img').evaluateAll((images) => images.map((image) => image.getAttribute('src') || '').filter((src) => /^cloud:\/\/|^https:\/\//.test(src)))
    await page.getByTestId('post-delete').click()
    await page.getByText('确定', { exact: true }).click()
    await page.waitForURL((url) => url.toString() !== postUrl)
    deleted = true
    await page.goto(postUrl)
    await page.getByText(/详情加载失败|帖子不存在|已删除/).waitFor()
    if (storageUrls.length === 0) throw new Error(`write smoke did not observe a resolved storage URL for run ${runId}`)
    return { counts: { created: 1 }, geometry: {}, cleanup: async () => {}, storageUrlVerified: storageUrls.length > 0 }
  } finally {
    await browser.close()
    if (!deleted && postUrl) throw new Error(`write smoke cleanup failed for run ${runId}`)
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
