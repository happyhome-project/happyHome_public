import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../eval-post-semantic-search.mjs', import.meta.url), 'utf8')

test('evaluation command owns live fixtures, defaults to 100 runs and emits evidence metrics', () => {
  assert.match(source, /runLiveSemanticEvaluation/)
  assert.match(source, /latencyRuns:\s*100/)
  assert.doesNotMatch(source, /results-file/)
  assert.match(source, /post-semantic-eval\.json/)
  assert.match(source, /createFixtures/)
  assert.match(source, /cleanup/)
  assert.match(source, /recallAt5/)
  assert.match(source, /top3Precision/)
  assert.doesNotMatch(source, /console\.log\([^\n]*(query|items|postId|snippet|openid|token)/i)
})
