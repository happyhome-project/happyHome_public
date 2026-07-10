import assert from 'node:assert/strict'
import test from 'node:test'

import { parseReleaseLockCommand, summarizeReleaseLockInspection } from './release-lock-command.mjs'

test('release lock command requires explicit recover identity, reason, and evidence file', () => {
  assert.deepEqual(parseReleaseLockCommand(['status']), { command: 'status' })
  assert.throws(() => parseReleaseLockCommand(['recover', '--run-id', 'run-1']), /fencing-token/i)
  assert.deepEqual(parseReleaseLockCommand([
    'recover', '--run-id', 'run-1', '--fencing-token', '2', '--reason', 'verified', '--evidence-file', 'evidence.json',
  ]), {
    command: 'recover', evidenceFile: 'evidence.json', fencingToken: 2, reason: 'verified', runId: 'run-1',
  })
})

test('release lock inspection summary never includes release credentials', () => {
  const output = summarizeReleaseLockInspection({
    lock: { owner: 'host', runId: 'run-1', status: 'active', fencingToken: 2, secretKey: 'never-print' },
    state: { gitSha: 'abc', lastSuccessfulRunId: 'run-0', nextFencingToken: 3, secretId: 'never-print' },
  })
  assert.match(output, /run-1/)
  assert.doesNotMatch(output, /never-print/)
})
