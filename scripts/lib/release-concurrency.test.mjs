import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePositiveIntOption, runBounded } from './release-concurrency.mjs'

test('parsePositiveIntOption accepts bounded positive integers and rejects unsafe values', () => {
  assert.equal(parsePositiveIntOption('3', 2, { min: 1, max: 5 }), 3)
  assert.equal(parsePositiveIntOption('0', 2, { min: 1, max: 5 }), 2)
  assert.equal(parsePositiveIntOption('9', 2, { min: 1, max: 5 }), 5)
  assert.equal(parsePositiveIntOption('not-a-number', 2, { min: 1, max: 5 }), 2)
})

test('runBounded preserves result order while limiting active tasks', async () => {
  let active = 0
  let maxActive = 0
  const tasks = Array.from({ length: 5 }, (_, index) => async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise((resolve) => setTimeout(resolve, 20 - index))
    active -= 1
    return index
  })

  const results = await runBounded(tasks, 2)

  assert.deepEqual(results, [0, 1, 2, 3, 4])
  assert.equal(maxActive, 2)
})

test('runBounded rethrows task failures after in-flight work settles', async () => {
  let active = 0
  let settled = 0
  const tasks = [
    async () => {
      active += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      settled += 1
      return 'ok'
    },
    async () => {
      active += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      settled += 1
      throw new Error('boom')
    },
    async () => {
      active += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      settled += 1
      return 'late'
    },
  ]

  await assert.rejects(() => runBounded(tasks, 3), /boom/)
  assert.equal(active, 0)
  assert.equal(settled, 3)
})

test('runBounded drains queued tasks before reporting a failure', async () => {
  const started = []
  const tasks = ['a', 'b', 'c', 'd'].map((name) => async () => {
    started.push(name)
    if (name === 'b') throw new Error('boom')
    return name
  })

  await assert.rejects(() => runBounded(tasks, 2), /boom/)
  assert.deepEqual(started, ['a', 'b', 'c', 'd'])
})
