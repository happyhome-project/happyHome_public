import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeDevtoolsCloudDeployOutput } from './deploy-output.mjs'

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
