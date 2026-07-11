import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  APPROVAL_PREFIX,
  applyAfterValidation,
  assertAttestation,
  assertWorkflowPaths,
  buildApprovalPhrase,
  createManifest,
  validateManifest,
} from './trusted-workflow-policy.mjs'

const sha = (letter) => letter.repeat(40)
const base = sha('a')
const head = sha('b')
const validator = sha('c')
const diffSha256 = 'd'.repeat(64)

function attestation(overrides = {}) {
  return {
    schemaVersion: 1,
    prNumber: 42,
    baseSha: base,
    headSha: head,
    diffSha256,
    requestId: 'req-42',
    runId: 1234,
    validatorWorkflowSha: validator,
    conclusion: 'success',
    checks: { offline: 'passed', governance: 'passed', docs: 'not-present' },
    ...overrides,
  }
}

test('workflow path policy accepts only workflow yaml and protects trust roots', () => {
  assert.deepEqual(assertWorkflowPaths(['.github/workflows/example.yml', '.github/workflows/other.yaml']), [
    '.github/workflows/example.yml', '.github/workflows/other.yaml',
  ])
  assert.throws(() => assertWorkflowPaths(['README.md']), /only workflow YAML/i)
  assert.throws(() => assertWorkflowPaths(['.github/workflows/trusted-workflow-validator.yml']), /trust root/i)
  assert.throws(() => assertWorkflowPaths(['scripts/lib/trusted-workflow-policy.mjs']), /only workflow YAML|trust root/i)
})

test('manifest binds every identity field and exact approval, and expires after two hours', () => {
  const createdAt = '2026-07-11T00:00:00.000Z'
  const manifest = createManifest({
    prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'],
    diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234,
    attestation: attestation(), createdAt,
  })
  assert.equal(manifest.expiresAt, '2026-07-11T02:00:00.000Z')
  assert.equal(manifest.approvalPhrase, buildApprovalPhrase(manifest))
  assert.match(manifest.approvalPhrase, new RegExp(`^${APPROVAL_PREFIX}`))
  assert.doesNotThrow(() => validateManifest(manifest, {
    now: '2026-07-11T01:59:59.000Z', prNumber: 42, baseSha: base, headSha: head,
    changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator,
    requestId: 'req-42', runId: 1234, attestation: attestation(), approval: manifest.approvalPhrase,
  }))
  for (const drift of [
    { headSha: sha('e') }, { baseSha: sha('e') }, { diffSha256: 'e'.repeat(64) },
    { changedPaths: ['.github/workflows/drift.yml'] }, { validatorWorkflowSha: sha('e') },
  ]) assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation(), ...drift }), /drift|mismatch/i)
  assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T02:00:00.001Z', approval: manifest.approvalPhrase, attestation: attestation() }), /expired/i)
  assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: 'yes', attestation: attestation() }), /approval/i)
})

test('attestation must be successful and exactly match the trusted request', () => {
  const expected = attestation()
  assert.doesNotThrow(() => assertAttestation(expected, expected))
  assert.throws(() => assertAttestation(attestation({ conclusion: 'failure' }), expected), /successful/i)
  assert.throws(() => assertAttestation(attestation({ headSha: sha('e') }), expected), /headSha.*mismatch/i)
  assert.throws(() => assertAttestation(attestation({ diffSha256: 'e'.repeat(64) }), expected), /diffSha256.*mismatch/i)
})

test('apply invokes merge only after every manifest and attestation check passes', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, attestation: attestation(), createdAt: '2026-07-11T00:00:00.000Z' })
  let merged = false
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  await assert.rejects(() => applyAfterValidation({ manifest, current: { ...current, headSha: sha('e') }, merge: async () => { merged = true } }), /drift/i)
  assert.equal(merged, false)
  await applyAfterValidation({ manifest, current, merge: async () => { merged = true } })
  assert.equal(merged, true)
})

test('validator is dispatch-only, hosted Windows, read-only, fixed npm, and uploads attestation', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/trusted-workflow-validator.yml', import.meta.url), 'utf8')
  assert.match(workflow, /^on:\s*\r?\n\s+workflow_dispatch:/m)
  assert.doesNotMatch(workflow, /pull_request:|push:|self-hosted|secrets\./)
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/)
  assert.match(workflow, /runs-on:\s*windows-latest/)
  assert.match(workflow, /npm@11\.11\.0/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /trusted-workflow-attestation\.json/)
})
