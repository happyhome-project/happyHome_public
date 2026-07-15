import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')
const buildInfoPath = join(process.cwd(), 'miniprogram', 'src', 'generated', 'build-info.ts')
const buildInfoText = existsSync(buildInfoPath) ? readFileSync(buildInfoPath, 'utf8') : ''
const expectedVersion = process.env.HH_RELEASE_VERSION?.trim()
  || buildInfoText.match(/version:\s*["']([^"']+)["']/)?.[1]
  || ''

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
      openManualLogin: true,
      expectedTexts: ['使用 CloudBase Web 账号登录', '用户名', '密码', '确认登录'],
    })
    await runProfileCase(browser, port, {
      label: 'choose-avatar-login',
      setup: async (page) => {
        await page.addInitScript(() => {
          window.__HH_TEST_CHOOSE_AVATAR__ = true
        })
      },
      expectedTexts: ['登录', '退出当前社区'],
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
    const initialText = normalize(await page.locator('body').innerText())
    const buildVersion = await page.locator('.profile-page').getAttribute('data-build-version')
    const loginEntry = page.locator('[data-testid="profile-login-entry"]')

    if (!initialText.includes('登录')) {
      throw new Error(`${options.label}: default profile shell is missing the 登录 identity label`)
    }
    if (await loginEntry.count() !== 1) {
      throw new Error(`${options.label}: expected one profile login identity entry`)
    }

    if (options.openManualLogin) {
      if (await page.locator('[data-testid="h5-login-username"] input').count()) {
        throw new Error(`${options.label}: default profile shell unexpectedly opened the username form`)
      }
      await loginEntry.click({ force: true })
      await page.locator('[data-testid="h5-login-username"] input').waitFor()
      await page.locator('[data-testid="h5-login-username"] input').fill('profile-smoke-user')
      await page.locator('[data-testid="h5-login-password"] input').fill('profile-smoke-password')
      await page.locator('[data-testid="h5-login-nickname"] input').fill('Profile Smoke')
    }

    const text = normalize(await page.locator('body').innerText())
    console.log(`[${options.label}] ${text}`)

    if (!expectedVersion || buildVersion !== expectedVersion) {
      throw new Error(`${options.label}: profile build marker mismatch: expected ${expectedVersion || '(unknown)'}, got ${buildVersion || '(missing)'}`)
    }
    if (text.includes(expectedVersion)) {
      throw new Error(`${options.label}: profile build version leaked into visible text`)
    }
    if (/state:logged|login:[01]|cc:/.test(text)) {
      throw new Error(`${options.label}: profile internal debug label leaked`)
    }
    for (const expectedText of options.expectedTexts) {
      if (!text.includes(expectedText)) {
        throw new Error(`${options.label}: expected text missing: ${expectedText}`)
      }
    }
    if (text.length < 40) {
      throw new Error(`${options.label}: profile content is too short; possible blank page`)
    }
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
  } finally {
    await page.close()
  }
}
