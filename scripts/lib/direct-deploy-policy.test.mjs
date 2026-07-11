import assert from 'node:assert/strict'
import test from 'node:test'

import { runDirectRemoteMutation } from './direct-deploy-policy.mjs'

test('direct remote mutation revalidates after build-time workspace drift', async () => {
  let dirty = false
  let mutated = false
  dirty = true

  await assert.rejects(() => runDirectRemoteMutation({
    revalidate: () => {
      if (dirty) throw new Error('direct deploy requires a clean worktree')
    },
    mutate: async () => { mutated = true },
  }), /clean worktree/i)

  assert.equal(mutated, false)
})

test('direct remote mutation runs the guard immediately before the mutation', async () => {
  const events = []
  await runDirectRemoteMutation({
    revalidate: async () => { events.push('guard') },
    mutate: async () => { events.push('mutation') },
  })
  assert.deepEqual(events, ['guard', 'mutation'])
})
