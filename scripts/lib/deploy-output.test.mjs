import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeDevtoolsCloudDeployOutput, analyzeDevtoolsUploadOutput } from './deploy-output.mjs'

test('detects DevTools cloud deploy table failures even when process exits 0', () => {
  const output = `
    × deploy cloudfunctions
    ┌──────────────┬─────────┬────────────────────────────────────────────┐
    │ name         │ success │ error                                      │
    ├──────────────┼─────────┼────────────────────────────────────────────┤
    │ admin        │ false   │ getCloudAPISignedHeader failed: {"ret":41002} │
    └──────────────┴─────────┴────────────────────────────────────────────┘
  `

  const result = analyzeDevtoolsCloudDeployOutput(output)

  assert.equal(result.ok, false)
  assert.match(result.reason, /failed cloud function rows/i)
  assert.match(result.reason, /DevTools CLI failure marker/i)
})

test('accepts normal DevTools cloud deploy success output', () => {
  const output = `
    √ deploy cloudfunctions
    ┌──────────────┬─────────┐
    │ name         │ success │
    ├──────────────┼─────────┤
    │ admin        │ true    │
    └──────────────┴─────────┘
  `

  assert.deepEqual(analyzeDevtoolsCloudDeployOutput(output), { ok: true, reason: 'ok' })
})

test('detects DevTools upload compile failures even when process exits 0', () => {
  const output = `
    [error] {
      code: 10,
      message: "Error: ENOENT: no such file or directory, open 'utils/profile-admin-tools.js'"
    }
    × compile_start
  `

  const result = analyzeDevtoolsUploadOutput(output)

  assert.equal(result.ok, false)
  assert.match(result.reason, /DevTools CLI failure marker/i)
  assert.match(result.reason, /missing file/i)
})

test('accepts normal DevTools upload output', () => {
  const output = `
    √ Upload
    √ compile_start
    √ upload
  `

  assert.deepEqual(analyzeDevtoolsUploadOutput(output), { ok: true, reason: 'ok' })
})
