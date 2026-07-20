import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8')
const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8')

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test('defines all six cover themes', () => {
  for (const id of ['paper', 'mint', 'slate', 'headline', 'quote', 'notice']) {
    assert.match(source, new RegExp(`id: '${id}'`))
    assert.match(styles, new RegExp(`text-theme--${id}`))
  }
})

test('keeps writing and cover selection as separate steps', () => {
  assert.doesNotMatch(functionBody('renderCompose'), /renderThemePicker/)
  assert.match(functionBody('renderPreview'), /renderThemePicker/)
  assert.match(functionBody('renderPreview'), /选择文字封面/)
})

test('notice cover is explicitly labelled', () => {
  const coverRenderer = functionBody('renderTextCover')
  assert.match(coverRenderer, /cover-notice-label/)
  assert.match(coverRenderer, /通知公告/)
  assert.match(styles, /cover-notice-label/)
})

test('real title and first paragraph both drive the cover', () => {
  const coverRenderer = functionBody('renderTextCover')
  assert.match(coverRenderer, /post\.title/)
  assert.match(coverRenderer, /coverText\(post\.body\)/)
  assert.match(coverRenderer, /cover-title/)
})

test('cover picker follows radio-group keyboard behavior', () => {
  assert.match(functionBody('renderThemePicker'), /tabindex=/)
  assert.match(functionBody('bindInteractions'), /ArrowRight/)
  assert.match(functionBody('bindInteractions'), /ArrowLeft/)
})

test('location belongs to cover preview instead of writing step', () => {
  assert.doesNotMatch(functionBody('renderCompose'), /设置地点|location-tool/)
  assert.match(functionBody('renderPreview'), /renderLocationTool/)
  assert.match(functionBody('renderPreview'), /renderLocationSheet/)
})

test('location picker supports selecting replacing and clearing a place', () => {
  assert.match(functionBody('renderLocationTool'), /设置地点/)
  assert.match(functionBody('renderLocationTool'), /data-action="clear-location"/)
  assert.match(functionBody('renderLocationSheet'), /data-location-id=/)
  assert.match(functionBody('bindInteractions'), /state\.draft\.location/)
  assert.match(functionBody('handleAction'), /clear-location/)
})

test('published detail renders location while waterfall card stays unchanged', () => {
  assert.doesNotMatch(functionBody('renderCard'), /detail-location|post\.location/)
  assert.match(functionBody('renderDetail'), /renderDetailLocation/)
  assert.match(functionBody('publishDraft'), /location: normalizeLocation/)
})
