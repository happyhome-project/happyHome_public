import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')
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

function isExpectedSmokeConsoleError(text) {
  return text.includes('Failed to load resource: the server responded with a status of 500') ||
    text.includes('[client-log] cloud.call.fail') ||
    text.includes('[client-log] section.load.fail')
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
    const text = message.text()
    if (message.type() === 'error' && !isExpectedSmokeConsoleError(text)) {
      errors.push(`console: ${text}`)
    }
  })

  try {
    await page.goto(`http://127.0.0.1:${port}/#/pages/section/index?sectionId=hh-release-section-smoke`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)

    const renderedStateCount = await page.locator('.state.error, .retry-btn, .guide-list, .default-list, .hh-login-guard').count()
    const text = normalize(await page.locator('body').innerText())
    console.log(`[section-logged-out] ${text}`)

    if (renderedStateCount < 1) {
      throw new Error('section page did not render a stable logged-out state')
    }
    if (text.length < 12) {
      throw new Error('section content is too short; possible blank page')
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    console.log('H5 section smoke passed')
  } finally {
    await page.close()
    await browser.close()
    server.close()
  }
})
