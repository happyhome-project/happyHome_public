import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const ROOT = process.cwd()
const DEFAULT_BASE_URL = 'http://127.0.0.1:5180'
const BASE_URL = String(process.env.ADMIN_WEB_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'admin-image-group-ui')

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = value
  }
}

loadDotEnv(path.join(ROOT, 'admin-web', '.env.local'))

const cloudApiUrl = String(process.env.CLOUD_API_URL || process.env.VITE_CLOUD_API_URL || '').replace(/\/+$/, '')
const username = process.env.VITE_ADMIN_USERNAME || 'admin'
const password = process.env.VITE_ADMIN_PASSWORD || 'happyhome2024'

if (!cloudApiUrl) throw new Error('CLOUD_API_URL or VITE_CLOUD_API_URL is required')

function requestJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body)
    const req = transport.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let data = {}
        try { data = raw ? JSON.parse(raw) : {} } catch { data = { raw } }
        if ((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300) resolve(data)
        else reject(new Error(`${res.statusCode}: ${data?.error || raw}`))
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function admin(action, params = {}, token = '') {
  return requestJson(`${cloudApiUrl}/admin`, { action, ...params }, token ? { authorization: `Bearer ${token}` } : {})
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return true
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (!child?.pid) return resolve()
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      killer.on('close', resolve)
      killer.on('error', resolve)
      return
    }
    try { child.kill('SIGTERM') } catch {}
    resolve()
  })
}

function quoteCmdArg(value) {
  const text = String(value)
  if (!/[\s"&|<>^]/.test(text)) return text
  return `"${text.replace(/"/g, '\\"')}"`
}

function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    return spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', ['npm.cmd', ...args.map(quoteCmdArg)].join(' ')],
      options,
    )
  }
  return spawn('npm', args, options)
}

function writeSolidPng(filePath, rgb) {
  const png = new PNG({ width: 48, height: 36 })
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2
      png.data[idx] = rgb[0]
      png.data[idx + 1] = rgb[1]
      png.data[idx + 2] = rgb[2]
      png.data[idx + 3] = 255
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(png))
}

async function ensureAdminWebServer() {
  if (await waitForHttp(`${BASE_URL}/login`, 3000)) return null
  const url = new URL(BASE_URL)
  const port = url.port || '5180'
  const child = spawnNpm([
    'run',
    'dev',
    '--workspace',
    'admin-web',
    '--',
    '--host',
    url.hostname,
    '--port',
    port,
    '--strictPort',
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_CLOUD_API_URL: cloudApiUrl,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  if (!(await waitForHttp(`${BASE_URL}/login`, 30000))) {
    await stopProcessTree(child)
    throw new Error(`admin-web did not start at ${BASE_URL}`)
  }
  return child
}

async function cleanupFixture(communityId, token) {
  if (!communityId) return
  try { await admin('community.disable', { communityId }, token) } catch {}
  try { await admin('community.hardDelete', { communityId }, token) } catch (error) {
    console.warn(`[cleanup] failed for ${communityId}: ${error?.message || error}`)
  }
}

async function createFixture(token) {
  const runId = Date.now().toString(36)
  let communityId = ''
  try {
    const community = await admin('community.createAdmin', {
      name: `CodexImageUpload-${runId}`,
      description: 'temporary image group upload UI fixture',
      coverImage: '',
      location: { address: 'Temporary test address', lat: 30.6, lng: 104.0 },
      joinType: 'open',
    }, token)
    communityId = community.communityId
    const { sectionId } = await admin('section.create', {
      communityId,
      name: `Guide-${runId}`,
      icon: 'map',
      order: 0,
      type: 'evergreen',
      displayTemplate: 'guide_note',
    }, token)
    return {
      communityId,
      sectionId,
      titleWidgetId: 'guide_title',
      imageWidgetId: 'guide_images',
    }
  } catch (error) {
    await cleanupFixture(communityId, token)
    throw error
  }
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const img1 = path.join(ARTIFACT_DIR, 'fixture-a.png')
  const img2 = path.join(ARTIFACT_DIR, 'fixture-b.png')
  writeSolidPng(img1, [220, 56, 56])
  writeSolidPng(img2, [48, 140, 72])

  const server = await ensureAdminWebServer()
  const login = await admin('auth.login', { username, password })
  const token = login.token
  const fixture = await createFixture(token)
  const title = `Codex image group E2E ${Date.now()}`

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const events = []
  page.on('console', (msg) => events.push(`console:${msg.type()}:${msg.text()}`))
  page.on('pageerror', (err) => events.push(`pageerror:${err.message}`))
  page.on('requestfailed', (req) => events.push(`requestfailed:${req.method()} ${req.url()} ${req.failure()?.errorText}`))
  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('/admin') || url.includes('cos.ap-shanghai')) {
      events.push(`response:${res.status()} ${url.slice(0, 180)}`)
    }
  })

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
    await page.locator('[data-testid="login-username-field"] input').fill(username)
    await page.locator('[data-testid="login-password-field"] input').fill(password)
    await page.locator('[data-testid="login-submit"]').click()
    await page.waitForURL(/\/(approval|communities)/, { timeout: 15000 })

    await page.goto(`${BASE_URL}/posts/${fixture.communityId}/new?sectionId=${fixture.sectionId}`, { waitUntil: 'networkidle' })
    await page.locator('input.el-input__inner:not([readonly])').first().fill(title)
    await page.locator('input[type="file"]').first().setInputFiles([img1, img2])
    await page.waitForFunction(
      () => document.querySelectorAll('.image-item').length >= 2 &&
        !document.querySelector('.progress-row'),
      null,
      { timeout: 30000 },
    )
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.image-item img'))
        .filter((img) => {
          const el = img
          const rect = el.getBoundingClientRect()
          return /^https?:\/\//.test(el.getAttribute('src') || '') &&
            el.complete &&
            el.naturalWidth > 0 &&
            el.naturalHeight > 0 &&
            rect.width >= 190 &&
            rect.height >= 140
        }).length >= 2,
      null,
      { timeout: 30000 },
    )
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'after-image-upload.png'), fullPage: true })
    const renderedThumbCount = await page.locator('.image-item img[src^="http"]').evaluateAll((imgs) =>
      imgs.filter((img) => {
        const rect = img.getBoundingClientRect()
        return img.complete &&
          img.naturalWidth > 0 &&
          img.naturalHeight > 0 &&
          rect.width >= 190 &&
          rect.height >= 140
      }).length
    )
    const visibleImageUrlCount = await page.locator('.image-item').evaluateAll((items) =>
      items.filter((item) => /cloud:\/\/|https?:\/\//.test(item.textContent || '')).length
    )
    if (visibleImageUrlCount > 0) throw new Error(`image URL text should be hidden, found ${visibleImageUrlCount} visible image URL rows`)

    await page.locator('input[placeholder="驾车到达用时"]').fill('约30分钟')
    await page.locator('.location-admin-editor .keyword-input input').fill('太平水库')
    await page.locator('.location-admin-editor .region-input input').fill('绵竹')
    await page.locator('.location-admin-editor .search-row button').click()
    await page.locator('.candidate-item').first().waitFor({ timeout: 20000 })
    await page.locator('.candidate-item').first().click()
    await page.locator('.selected-summary').waitFor({ timeout: 10000 })

    await page.locator('.actions .el-button--primary').click()
    await page.waitForURL(new RegExp(`/posts/${fixture.communityId}$`), { timeout: 15000 })
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'after-image-publish.png'), fullPage: true })
    await page.getByRole('button', { name: '详情' }).first().click()
    await page.locator('.el-dialog').waitFor({ timeout: 15000 })
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.el-dialog .image-group-detail img'))
        .filter((img) => {
          const el = img
          const rect = el.getBoundingClientRect()
          return /^https?:\/\//.test(el.getAttribute('src') || '') &&
            el.complete &&
            el.naturalWidth > 0 &&
            el.naturalHeight > 0 &&
            rect.width >= 230 &&
            rect.height >= 170
        }).length >= 2,
      null,
      { timeout: 30000 },
    )
    const detailVisibleImageUrlCount = await page.locator('.el-dialog').evaluate((dialog) =>
      /cloud:\/\/|https?:\/\//.test(dialog.textContent || '') ? 1 : 0
    )
    if (detailVisibleImageUrlCount > 0) throw new Error('detail dialog should not display image URL text')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'after-detail-open.png'), fullPage: true })

    const postList = await admin('post.listAdmin', { communityId: fixture.communityId, sectionId: fixture.sectionId }, token)
    const created = (postList.posts || []).find((post) => post.content?.[fixture.titleWidgetId] === title)
    const images = created?.content?.[fixture.imageWidgetId]
    const cos204Count = events.filter((event) => event.includes('response:204') && event.includes('cos.ap-shanghai')).length
    const corsErrors = events.filter((event) => /CORS|blocked by CORS/i.test(event))

    if (!created) throw new Error('published image-group post was not found by admin API')
    if (!Array.isArray(images) || images.length !== 2) throw new Error(`expected 2 image fileIDs, got ${JSON.stringify(images)}`)
    if (!images.every((fileID) => String(fileID).startsWith('cloud://'))) throw new Error(`expected cloud fileIDs, got ${JSON.stringify(images)}`)
    if (renderedThumbCount < 2) throw new Error(`expected 2 rendered image thumbnails, got ${renderedThumbCount}`)
    if (cos204Count < 2) throw new Error(`expected 2 COS 204 uploads, got ${cos204Count}`)
    if (corsErrors.length) throw new Error(`CORS browser errors: ${corsErrors.join('; ')}`)

    console.log('[admin-image-group-upload-ui] PASS')
    console.log(JSON.stringify({
      baseURL: BASE_URL,
      communityId: fixture.communityId,
      sectionId: fixture.sectionId,
      postId: created._id,
      imageCount: images.length,
      renderedThumbCount,
      cos204Count,
      screenshots: [
        path.join(ARTIFACT_DIR, 'after-image-upload.png'),
        path.join(ARTIFACT_DIR, 'after-image-publish.png'),
        path.join(ARTIFACT_DIR, 'after-detail-open.png'),
      ],
    }, null, 2))
  } catch (error) {
    console.error('[admin-image-group-upload-ui] browser events')
    console.error(JSON.stringify(events, null, 2))
    throw error
  } finally {
    await browser.close()
    await cleanupFixture(fixture.communityId, token)
    if (server) await stopProcessTree(server)
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error)
  process.exit(1)
})
