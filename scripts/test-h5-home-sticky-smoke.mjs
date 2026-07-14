import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const root = join(process.cwd(), 'miniprogram', 'dist', 'build', 'h5')
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' }
if (!existsSync(join(root, 'index.html'))) throw new Error('Missing H5 build output')

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
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.home-search-sticky-shell')
    await page.evaluate(() => {
      document.querySelectorAll('.guest-intro-mask').forEach((node) => node.remove())
      const shell = document.querySelector('.home-shell')
      const search = document.querySelector('.home-search-sticky-shell')
      if (!shell || !search) throw new Error('home sticky fixture anchors missing')
      shell.style.minHeight = '420px'
      const scope = [...search.attributes].find((attr) => attr.name.startsWith('data-v-'))?.name || ''
      const spacer = document.createElement('div')
      spacer.style.height = '520px'
      if (scope) spacer.setAttribute(scope, '')
      const tabs = document.createElement('div')
      tabs.className = 'section-tabs-sticky-shell'
      tabs.innerHTML = '<div class="section-tabs"><div class="section-tabs-inner"><div class="section-tab active"><span>全部</span></div><div class="section-tab"><span>邻里</span></div></div></div>'
      if (scope) tabs.querySelectorAll('*').forEach((node) => node.setAttribute(scope, ''))
      if (scope) tabs.setAttribute(scope, '')
      search.after(spacer, tabs)
      document.body.style.minHeight = '1800px'
    })

    const rects = () => page.evaluate(() => {
      const topbar = document.querySelector('.home-topbar').getBoundingClientRect()
      const search = document.querySelector('.home-search-sticky-shell').getBoundingClientRect()
      const tabs = document.querySelector('.section-tabs-sticky-shell').getBoundingClientRect()
      return { topbar, search, tabs, scrollY: window.scrollY }
    })
    const before = await rects()
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.home-search-sticky-shell').offsetTop + 40))
    await page.waitForTimeout(100)
    const searchPinned = await rects()
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.section-tabs-sticky-shell').offsetTop + 40))
    await page.waitForTimeout(100)
    const tagsPinned = await rects()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(100)
    const restored = await rects()

    const close = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance
    if (!(before.search.top > before.topbar.bottom + 20)) throw new Error('search is not initially in document flow')
    if (!close(searchPinned.search.top, searchPinned.topbar.bottom)) throw new Error('search did not pin below masthead')
    if (!close(tagsPinned.search.top, tagsPinned.topbar.bottom)) throw new Error('search moved during tags pin')
    if (!close(tagsPinned.tabs.top, tagsPinned.search.bottom)) throw new Error('tags did not pin below search')
    if (!close(restored.search.top, before.search.top)) throw new Error('reverse scroll did not release search sticky state')
    console.log('[h5-home-sticky-smoke] PASS')
  } finally {
    await browser.close()
    server.close()
  }
})
