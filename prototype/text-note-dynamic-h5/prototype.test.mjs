import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

async function source(name) {
  return readFile(join(root, name), 'utf8')
}

test('prototype exposes the complete four-route experience', async () => {
  const app = await source('app.mjs')
  for (const route of ['compose', 'preview', 'home', 'detail']) {
    assert.match(app, new RegExp(`['"\`]#/${route}['"\`]`))
  }
})

test('prototype contains all six production themes and reuses production SVG assets', async () => {
  const [app, css, layout] = await Promise.all([
    source('app.mjs'),
    source('styles.css'),
    source('layout.mjs'),
  ])
  for (const theme of ['paper', 'mint', 'slate', 'headline', 'quote', 'notice']) {
    assert.match(layout, new RegExp(`\\b${theme}:\\s*\\{`))
    assert.match(css, new RegExp(`\\.theme-${theme}\\b`))
  }
  assert.match(app, /TEXT_NOTE_THEMES/)
  assert.match(app, /miniprogram\/src\/static\/text-note-covers/)
})

test('generation, tools, publish, and detail states have stable interaction contracts', async () => {
  const [html, app] = await Promise.all([source('index.html'), source('app.mjs')])
  assert.match(html, /data-testid="app-root"/)
  for (const testId of [
    'title-input',
    'body-input',
    'generate-button',
    'generation-overlay',
    'deck-preview',
    'theme-rail',
    'topic-tool',
    'location-tool',
    'next-button',
    'publish-button',
    'published-card',
    'detail-deck',
  ]) {
    assert.match(app, new RegExp(`data-testid=["'\`]${testId}["'\`]`))
  }
})

test('generation copy describes real layout work without AI-writing claims', async () => {
  const app = await source('app.mjs')
  assert.match(app, /正在识别段落结构/)
  assert.match(app, /正在为正文分页/)
  assert.match(app, /正在套用社区主题/)
  assert.doesNotMatch(app, /AI帮你写|智能改写|自动摘要/)
})

test('production SVG owns footer branding and the carousel owns the only page counter', async () => {
  const app = await source('app.mjs')
  assert.doesNotMatch(app, /HAPPY HOME · 邻里共享/)
  assert.doesNotMatch(app, /note-card__footer/)
  assert.match(app, /class="deck-count"/)
})

test('dynamic generation validates every page against the rendered card dimensions', async () => {
  const [app, css] = await Promise.all([source('app.mjs'), source('styles.css')])
  assert.match(app, /paginateBodyToFit/)
  assert.match(app, /note-card-measurement/)
  assert.match(app, /scrollHeight/)
  assert.match(app, /createMeasuredDeck/)
  assert.match(css, /\.note-card-measurement/)
  assert.match(css, /max-height:\s*58%/)
})

test('preview uses one selection layer without duplicate page thumbnails or redundant heading', async () => {
  const [app, css] = await Promise.all([source('app.mjs'), source('styles.css')])
  assert.doesNotMatch(app, /page-rail|page-thumb|选择页面|<h2[^>]*>选择排版风格<\/h2>/)
  assert.doesNotMatch(css, /\.page-rail|\.page-thumb|\.section-heading/)
  assert.match(app, /class="theme-rail"/)
})

test('preview follows the reference hierarchy while keeping HappyHome actions', async () => {
  const [app, css] = await Promise.all([source('app.mjs'), source('styles.css')])
  assert.match(app, /renderPreviewAppBar/)
  assert.match(app, /class="app-bar__edit"[^>]*>编辑<\/button>/)
  assert.match(app, /<h1>预览<\/h1>/)
  assert.match(app, /class="preview-actions__hint">选择喜欢的排版<\/span>/)
  assert.match(app, /data-action="next" data-testid="next-button">下一步<\/button>/)
  assert.match(app, /state\.sheet = 'publish-confirm'/)
  assert.match(app, /data-testid="publish-button">发布<\/button>/)
  assert.match(css, /\.generation-preview\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s)
  assert.match(css, /\.note-card\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5/s)
  assert.doesNotMatch(css, /\.screen--preview \.note-card\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*5/s)
})

test('preview carousel uses slide stride so the next page can remain visibly discoverable', async () => {
  const app = await source('app.mjs')
  assert.match(app, /function carouselSlideStride/)
  assert.match(app, /getBoundingClientRect\(\)\.width/)
  assert.match(app, /columnGap/)
  assert.match(app, /targetIndex \* carouselSlideStride\(carousel\)/)
})

test('desktop review frame matches the 390 by 844 mobile acceptance viewport', async () => {
  const css = await source('styles.css')
  assert.match(css, /@media \(min-width:\s*700px\)[\s\S]*?\.prototype-shell\s*\{[^}]*width:\s*390px[^}]*height:\s*min\(844px,/)
})

test('the selected theme remains visible without hiding the leading templates', async () => {
  const [app, css] = await Promise.all([source('app.mjs'), source('styles.css')])
  assert.match(app, /const PREVIEW_THEME_ORDER = \['paper', 'mint', 'slate', 'notice', 'headline', 'quote'\]/)
  assert.match(app, /PREVIEW_THEME_ORDER\.map/)
  assert.match(app, /function syncThemeRail/)
  assert.match(app, /selected\.offsetLeft/)
  assert.match(app, /rail\.scrollLeft/)
  assert.doesNotMatch(app, /rail\.clientWidth - selected\.offsetWidth\) \/ 2/)
  assert.match(css, /\.theme-rail::after\s*\{[^}]*flex:\s*0\s+0\s+12px/s)
  assert.match(css, /\.theme-option\s*\{[^}]*width:\s*58px[^}]*min-width:\s*58px/s)
})
