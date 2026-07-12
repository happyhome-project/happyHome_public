import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { evaluateSemanticSearch, nearestRankPercentile, validateEvaluationDataset } from './post-semantic-search-eval.mjs'

const dataset = JSON.parse(readFileSync(new URL('../fixtures/post-semantic-search-eval.json', import.meta.url), 'utf8'))

test('committed evaluation dataset has exactly 30 diverse labeled Chinese cases', () => {
  const summary = validateEvaluationDataset(dataset)
  assert.equal(summary.caseCount, 30)
  assert.deepEqual(summary.requiredTopics, ['family-thrift', 'gardening-service', 'lost-found', 'parent-route'])
  assert.ok(summary.fixtureAliasCount >= 5)
  assert.ok(dataset.every((item) => Array.isArray(item.forbiddenFixtureAliases)))
})

test('evaluation computes Recall@5 and Top3 precision exactly', () => {
  const cases = [{ id: 'a', query: '查询', topic: 'family-thrift', relevantFixtureAliases: ['p1', 'p2'] }]
  const report = evaluateSemanticSearch(cases, new Map([['a', ['p1', 'wrong', 'p2', 'x', 'y']]]))
  assert.equal(report.recallAt5, 1)
  assert.equal(report.top3Precision, 2 / 3)
})

test('evaluation hard gates relevance, forbidden ids, p95 and error rate', () => {
  const cases = Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, query: `查询${index}`, topic: 'family-thrift', relevantFixtureAliases: [`p${index}`], forbiddenFixtureAliases: ['member-secret'] }))
  const results = new Map(cases.map((item, index) => [item.id, index === 9 ? [] : [item.relevantFixtureAliases[0]]]))
  const report = evaluateSemanticSearch(cases, results, { durationsMs: [...Array(9).fill(100), 2000], errors: 0, forbiddenIds: [] })
  assert.equal(report.recallAt5, 0.9)
  assert.equal(report.p95Ms, 2000)
  assert.equal(report.passed, true)
  assert.equal(evaluateSemanticSearch(cases, results, { durationsMs: [...Array(9).fill(100), 2001], errors: 0 }).passed, false)
  assert.equal(evaluateSemanticSearch(cases, results, { durationsMs: Array(100).fill(100), errors: 2 }).passed, false)
  results.set('c0', ['p0', 'member-secret'])
  assert.equal(evaluateSemanticSearch(cases, results).passed, false)
  assert.equal(evaluateSemanticSearch(cases, results, { forbiddenIds: [] }).forbiddenCount, 1)
})

test('nearest-rank percentile uses ceil rank and production latency gate requires 100 runs', () => {
  assert.equal(nearestRankPercentile([1, 2, 3, 4, 5], 0.95), 5)
  assert.throws(() => evaluateSemanticSearch([], new Map(), { durationsMs: Array(99).fill(1), enforceProductionRunCount: true }), /100/)
})

test('dataset rejects production ids, duplicate ids and missing aliases', () => {
  assert.throws(() => validateEvaluationDataset(dataset.map((item, index) => index ? item : { ...item, relevantFixtureAliases: [] })), /alias/i)
  assert.throws(() => validateEvaluationDataset(dataset.map((item, index) => index ? item : { ...item, relevantFixtureAliases: ['prod-123'] })), /production/i)
})
