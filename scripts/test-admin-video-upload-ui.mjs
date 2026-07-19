import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const DEFAULT_BASE_URL = 'http://127.0.0.1:5180'
const BASE_URL = String(process.env.ADMIN_WEB_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
const API_BASE = String(process.env.CLOUD_API_URL || process.env.VITE_CLOUD_API_URL || '').replace(/\/+$/, '')
const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'admin-video-upload-ui')

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

const cloudApiUrl = String(process.env.CLOUD_API_URL || process.env.VITE_CLOUD_API_URL || API_BASE).replace(/\/+$/, '')
const username = process.env.VITE_ADMIN_USERNAME
const password = process.env.VITE_ADMIN_PASSWORD

if (!cloudApiUrl) throw new Error('CLOUD_API_URL or VITE_CLOUD_API_URL is required')
if (!username || !password) throw new Error('VITE_ADMIN_USERNAME and VITE_ADMIN_PASSWORD are required')

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

async function ensureAdminWebServer() {
  if (await waitForHttp(`${BASE_URL}/login`, 3000)) return null
  const url = new URL(BASE_URL)
  const port = url.port || '5180'
  const child = spawn('npm.cmd', [
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

async function createFixture(token) {
  const runId = Date.now().toString(36)
  const { communityId } = await admin('community.createAdmin', {
    name: `CodexVideoUpload-${runId}`,
    description: 'temporary admin video upload UI fixture',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  }, token)
  const { sectionId } = await admin('section.create', {
    communityId,
    name: `Video-${runId}`,
    icon: 'video',
    order: 0,
    type: 'evergreen',
  }, token)
  const widgetRes = await admin('section.updateWidgets', {
    communityId,
    sectionId,
    widgets: [{ widgetId: '', type: 'video_group', label: 'Video list', fieldKey: '', required: false, showInList: false }],
  }, token)
  return { communityId, sectionId, widgetId: widgetRes.widgets?.[0]?.widgetId }
}

async function cleanupFixture(communityId, token) {
  if (!communityId) return
  try { await admin('community.disable', { communityId }, token) } catch {}
  try { await admin('community.hardDelete', { communityId }, token) } catch (error) {
    console.warn(`[cleanup] failed for ${communityId}: ${error?.message || error}`)
  }
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const coverPath = path.join(ARTIFACT_DIR, 'cover.jpg')
  const videoPath = path.join(ARTIFACT_DIR, 'video.mp4')
  fs.writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50]))

  const server = await ensureAdminWebServer()
  const login = await admin('auth.login', { username, password })
  const token = login.token
  const fixture = await createFixture(token)
  const title = `Codex upload E2E ${Date.now()}`

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
    await page.locator('.widget-block button').click()
    await page.locator('.video-item-editor input[type="text"]').fill(title)
    await page.locator('input[type="file"]').nth(0).setInputFiles(coverPath)
    await page.waitForFunction(() => document.querySelectorAll('.preview-row').length >= 1, null, { timeout: 15000 })
    await page.locator('input[type="file"]').nth(1).setInputFiles(videoPath)
    await page.waitForFunction(() => document.querySelectorAll('.preview-row').length >= 2, null, { timeout: 15000 })
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'after-upload.png'), fullPage: true })

    await page.locator('.actions .el-button--primary').click()
    await page.waitForURL(new RegExp(`/posts/${fixture.communityId}$`), { timeout: 15000 })
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'after-publish.png'), fullPage: true })

    const postList = await admin('post.listAdmin', { communityId: fixture.communityId }, token)
    const created = (postList.posts || []).find((post) => JSON.stringify(post.content || {}).includes(title))
    const content = created?.content?.[fixture.widgetId]?.[0]
    const badEvents = events.filter((event) =>
      (event.includes('requestfailed') && event.includes('cos.ap-shanghai')) ||
      event.includes('CORS') ||
      event.includes('blocked by CORS')
    )
    const cos204Count = events.filter((event) => event.includes('response:204') && event.includes('cos.ap-shanghai')).length

    if (!created) throw new Error('published post was not found by admin API')
    if (!String(content?.cover || '').startsWith('cloud://')) throw new Error('cover fileID was not persisted')
    if (!String(content?.fileID || '').startsWith('cloud://')) throw new Error('video fileID was not persisted')
    if (cos204Count < 2) throw new Error(`expected 2 COS 204 uploads, got ${cos204Count}`)
    if (badEvents.length) throw new Error(`upload browser errors: ${badEvents.join('; ')}`)

    console.log('[admin-video-upload-ui] PASS')
    console.log(JSON.stringify({
      baseURL: BASE_URL,
      communityId: fixture.communityId,
      sectionId: fixture.sectionId,
      postId: created._id,
      cos204Count,
      screenshots: [
        path.join(ARTIFACT_DIR, 'after-upload.png'),
        path.join(ARTIFACT_DIR, 'after-publish.png'),
      ],
    }, null, 2))
  } catch (error) {
    console.error('[admin-video-upload-ui] browser events')
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
