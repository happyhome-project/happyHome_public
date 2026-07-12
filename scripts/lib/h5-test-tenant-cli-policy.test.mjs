import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../h5-test-tenant.mjs', import.meta.url), 'utf8')

test('CLI apply requires both fixture prefix and an existing prepare manifest', () => {
  assert.match(source, /HAPPYHOME_FIXTURE_PREFIX/)
  assert.match(source, /prepare\.json/)
  assert.match(source, /applyTenant/)
})

test('CLI doctor uses read-only inspection and never calls a mutation helper directly', () => {
  const doctorBranch = source.slice(source.indexOf("case 'doctor'"), source.indexOf("case 'apply'"))
  assert.match(doctorBranch, /doctorTenant/)
  assert.doesNotMatch(doctorBranch, /setDocument|createEndUser|applyTenant/)
})
