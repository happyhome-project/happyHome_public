import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const buildCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npmCommand
const buildArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', `${npmCommand} --workspace miniprogram run build:h5`]
  : ['--workspace', 'miniprogram', 'run', 'build:h5']
const build = spawnSync(buildCommand, buildArgs, {
  cwd: process.cwd(),
  stdio: 'inherit',
  windowsHide: true,
})
if (build.error) throw build.error
if (build.status !== 0) throw new Error(`Current H5 build failed with exit code ${build.status}`)

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

async function launchSmokeBrowser() {
  const candidates = [
    { label: 'Playwright Chromium', options: { headless: true } },
    { label: 'system Edge', options: { headless: true, channel: 'msedge' } },
    { label: 'system Chrome', options: { headless: true, channel: 'chrome' } },
  ]
  const failures = []
  for (const candidate of candidates) {
    try {
      return await chromium.launch(candidate.options)
    } catch (error) {
      failures.push(`${candidate.label}: ${String(error?.message || error).split(/\r?\n/, 1)[0]}`)
    }
  }
  throw new Error(`No Chromium-compatible browser is available for the H5 sticky smoke. ${failures.join(' | ')}`)
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port
  const browser = await launchSmokeBrowser()
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.home-search-sticky-shell')
    await page.evaluate(() => {
      document.querySelectorAll('.guest-intro-mask').forEach((node) => node.remove())
      const shell = document.querySelector('.home-shell')
      const search = document.querySelector('.home-search-sticky-shell')
      const archive = document.querySelector('.archive-topic-shell')
      const tabs = document.querySelector('.section-tabs-sticky-shell')
      const topicTabs = document.querySelector('.archive-topic-tabs')
      if (!shell || !search || !archive || !tabs || !topicTabs) {
        throw new Error('visible home sticky fixture anchors missing')
      }
      shell.style.minHeight = '420px'
      const scope = [...search.attributes].find((attr) => attr.name.startsWith('data-v-'))?.name || ''
      const spacer = document.createElement('div')
      spacer.style.height = '520px'
      if (scope) spacer.setAttribute(scope, '')
      search.after(spacer)
      archive.style.minHeight = '900px'
      document.body.style.minHeight = '1800px'
    })

    const rects = () => page.evaluate(() => {
      const topbar = document.querySelector('.home-topbar').getBoundingClientRect()
      const hero = document.querySelector('.home-shell').getBoundingClientRect()
      const searchElement = document.querySelector('.home-search-sticky-shell')
      const tabsElement = document.querySelector('.section-tabs-sticky-shell')
      const topicTabsElement = document.querySelector('.archive-topic-tabs')
      const search = searchElement.getBoundingClientRect()
      const tabs = tabsElement.getBoundingClientRect()
      const topicTabs = topicTabsElement.getBoundingClientRect()
      const surface = (element) => {
        const style = getComputedStyle(element)
        return {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
          backdropFilter: style.backdropFilter || style.webkitBackdropFilter || 'none',
        }
      }
      return {
        topbar,
        hero,
        search,
        tabs,
        topicTabs,
        topbarSurface: surface(document.querySelector('.home-topbar')),
        heroSurface: surface(document.querySelector('.home-shell')),
        searchSurface: surface(searchElement),
        tabsSurface: surface(tabsElement),
        topicTabsSurface: surface(topicTabsElement),
        scrollY: window.scrollY,
      }
    })
    const before = await rects()
    await page.evaluate(() => {
      const element = document.querySelector('.home-search-sticky-shell')
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 40)
    })
    await page.waitForTimeout(100)
    const searchPinned = await rects()
    await page.evaluate(() => {
      const element = document.querySelector('.section-tabs-sticky-shell')
      window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY + 40)
    })
    await page.waitForTimeout(100)
    const tagsPinned = await rects()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(100)
    const restored = await rects()

    const close = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance
    const flatSurface = (surface) => (
      surface.backgroundImage === 'none'
      && surface.boxShadow === 'none'
      && surface.backdropFilter === 'none'
    )
    if (!flatSurface(before.searchSurface) || before.searchSurface.backgroundColor !== 'rgb(230, 244, 246)') {
      throw new Error(`search sticky wrapper has the wrong surface: ${JSON.stringify(before.searchSurface)}`)
    }
    if (!flatSurface(before.tabsSurface) || before.tabsSurface.backgroundColor !== before.searchSurface.backgroundColor) {
      throw new Error(`tags sticky wrapper does not share the quote surface: ${JSON.stringify(before.tabsSurface)}`)
    }
    if (!flatSurface(before.topicTabsSurface) || before.topicTabsSurface.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      throw new Error(`archive topic tabs should leave its wrapper surface visible: ${JSON.stringify(before.topicTabsSurface)}`)
    }
    if (!close(before.hero.bottom, before.search.bottom)) throw new Error(`hero gradient does not cover the search surface: hero=${before.hero.bottom}, search=${before.search.bottom}`)
    const sharedHighlight = 'rgba(84, 211, 160, 0.21)'
    if (!before.topbarSurface.backgroundImage.includes('rgb(207, 245, 242)') || !before.topbarSurface.backgroundImage.includes('rgb(221, 244, 244)')) {
      throw new Error(`masthead does not use the continuous hero palette: ${before.topbarSurface.backgroundImage}`)
    }
    if (!before.topbarSurface.backgroundImage.includes(sharedHighlight) || !before.heroSurface.backgroundImage.includes(sharedHighlight)) {
      throw new Error(`masthead and hero do not share one highlight: topbar=${before.topbarSurface.backgroundImage}, hero=${before.heroSurface.backgroundImage}`)
    }
    if (!before.heroSurface.backgroundImage.includes('rgb(221, 244, 244)') || !before.heroSurface.backgroundImage.includes('rgb(222, 244, 244)') || !before.heroSurface.backgroundImage.includes('rgb(230, 244, 246)')) {
      throw new Error(`hero gradient loses its mint color before the search surface: ${before.heroSurface.backgroundImage}`)
    }
    if (!close(before.search.height, 51, 2)) throw new Error(`search surface height is not compact: ${before.search.height}`)
    if (!(before.topicTabs.height < 36)) throw new Error(`topic tabs top inset is still too tall: ${before.topicTabs.height}`)
    if (!(before.search.top > before.topbar.bottom + 20)) throw new Error('search is not initially in document flow')
    if (!close(searchPinned.search.top, searchPinned.topbar.bottom)) throw new Error('search did not pin below masthead')
    if (!close(tagsPinned.search.top, tagsPinned.topbar.bottom)) throw new Error('search moved during tags pin')
    if (!close(tagsPinned.tabs.top, tagsPinned.search.bottom)) throw new Error('tags did not pin below search')
    if (!close(tagsPinned.topicTabs.top, tagsPinned.tabs.top)) throw new Error('visible archive topic tabs escaped the sticky shell')
    if (!close(restored.search.top, before.search.top)) throw new Error('reverse scroll did not release search sticky state')
    if (!close(restored.tabs.top, before.tabs.top)) throw new Error('reverse scroll did not release visible topic tabs')
    console.log('[h5-home-sticky-smoke] PASS')
  } finally {
    await browser.close()
    server.close()
  }
})
