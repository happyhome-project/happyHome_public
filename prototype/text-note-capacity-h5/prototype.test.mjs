import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const read = (name) => readFileSync(join(root, name), 'utf8')

test('renders one capacity card for every production template', () => {
  const app = read('app.mjs')
  assert.match(app, /TEMPLATE_CONFIGS\.map/)
  assert.match(app, /data-template=/)
  assert.match(app, /estimateFullCjkCount/)
})

test('exposes current, recommended and limit comparisons with a safe-area overlay', () => {
  const app = read('app.mjs')
  const html = read('index.html')

  assert.match(app, /current|recommended|limit/)
  assert.match(app, /safe-area/)
  assert.match(app, /js-measure-content/)
  assert.match(app, /content\.getBoundingClientRect\(\)\.height/)
  assert.match(html, /data-testid="mode-switch"/)
  assert.match(html, /data-testid="safe-toggle"/)
})

test('keeps the page responsive without horizontally clipping the six-card gallery', () => {
  const styles = read('styles.css')
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/)
  assert.match(styles, /grid-template-columns:\s*1fr/)
  assert.match(styles, /overflow-wrap:\s*anywhere/)
})
