import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')
const buildInfoPath = join(process.cwd(), 'miniprogram', 'src', 'generated', 'build-info.ts')
const buildInfoText = existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
const buildInfoVersion = buildInfoText.match(/version:\s*["']([^"']+)["']/)?.[1] || ''
const expectedVersion = process.env.EXPECTED_DETAIL_VERSION ||
  buildInfoVersion.replace(/^1\.0\./, '0.7.')

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
}

if (!existsSync(join(root, 'index.html'))) {
  console.error('Missing H5 build output. Run npm.cmd --workspace miniprogram run build:h5 first.')
  process.exit(1)
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  let filePath = join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
  if (!existsSync(filePath)) filePath = join(root, 'index.html')
  res.setHeader('Content-Type', contentTypes[extname(filePath)] || 'application/octet-stream')
  res.end(readFileSync(filePath))
})

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  try {
    await page.goto(`http://127.0.0.1:${port}/#/pages/detail/index?postId=hh-release-smoke`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    const loginGuardCount = await page.locator('.hh-login-guard').count()
    const text = normalize(await page.locator('body').innerText())
    console.log(`[detail-logged-out] ${text}`)

    if (loginGuardCount < 1) {
      throw new Error('detail page did not render LoginGuard in logged-out smoke case')
    }
    if (!text.includes(`ver: ${expectedVersion}`)) {
      throw new Error(`detail version missing: expected ver: ${expectedVersion}`)
    }
    if (text.length < 40) {
      throw new Error('detail content is too short; possible blank page')
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    console.log('H5 detail smoke passed')
  } finally {
    await page.close()
    await browser.close()
    server.close()
  }
})
