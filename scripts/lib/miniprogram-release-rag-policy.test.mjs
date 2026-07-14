import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('mini-program formal gate delegates only the RAG specialist static test', () => {
  const source = readFileSync(new URL('../miniprogram-release-gate.mjs', import.meta.url), 'utf8')
  assert.match(source, /shouldRunRagSpecialistVerification\(process\.env\)/)
  assert.match(source, /RAG specialist static verification delegated/)
  assert.match(source, /run\('detail\/profile compiled runtime syntax guard'/)
  assert.match(source, /run\('profile critical path guard'/)
  assert.match(source, /run\('H5 profile blank-page smoke'/)
  assert.match(source, /run\('WeChat DevTools release UI evidence'/)
})
