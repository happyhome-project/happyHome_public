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
