import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')
const buildInfoPath = join(process.cwd(), 'miniprogram', 'src', 'generated', 'build-info.ts')
const buildInfoText = existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
const buildInfoVersion = buildInfoText.match(/version:\s*["']([^"']+)["']/)?.[1] || ''
const expectedVersion = process.env.EXPECTED_PROFILE_VERSION ||
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

  try {
    await runProfileCase(browser, port, {
      label: 'fallback-login',
      setup: null,
      expectedTexts: ['确认登录', 'DEV 登录'],
    })
    await runProfileCase(browser, port, {
      label: 'choose-avatar-login',
      setup: async (page) => {
        await page.addInitScript(() => {
          window.__HH_TEST_CHOOSE_AVATAR__ = true
        })
      },
      expectedTexts: ['微信登录', 'DEV 登录'],
    })
    console.log('H5 profile smoke passed')
  } finally {
    await browser.close()
    server.close()
  }
})

async function runProfileCase(browser, port, options) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })

  try {
    if (options.setup) await options.setup(page)
    await page.goto(`http://127.0.0.1:${port}/#/pages/profile/index`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const text = normalize(await page.locator('body').innerText())

    console.log(`[${options.label}] ${text}`)

    if (!text.includes(`ver: ${expectedVersion}`)) {
      throw new Error(`${options.label}: profile version missing: expected ver: ${expectedVersion}`)
    }
    if (!text.includes('state:logged-out login:0')) {
      throw new Error(`${options.label}: profile debug state missing`)
    }
    for (const expectedText of options.expectedTexts) {
      if (!text.includes(expectedText)) {
        throw new Error(`${options.label}: expected text missing: ${expectedText}`)
      }
    }
    if (text.length < 80) {
      throw new Error(`${options.label}: profile content is too short; possible blank page`)
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  } finally {
    await page.close()
  }
}
