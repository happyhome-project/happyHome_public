import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  APPROVAL_PREFIX,
  applyAfterValidation,
  assertAttestation,
  assertWorkflowPaths,
  buildApprovalPhrase,
  createManifest,
  discoverWorkflowCandidate,
  hashWorkflowDiff,
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

function renameRepository(t, source, destination) {
  const root = mkdtempSync(join(tmpdir(), 'happyhome-workflow-rename-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com')
  mkdirSync(join(root, source.replace(/\/[^/]+$/, '')), { recursive: true })
  writeFileSync(join(root, source), 'name: original\n', 'utf8')
  git('add', '.'); git('commit', '-qm', 'base'); const baseSha = git('rev-parse', 'HEAD').trim()
  mkdirSync(join(root, destination.replace(/\/[^/]+$/, '')), { recursive: true })
  git('mv', source, destination); git('commit', '-qam', 'rename'); const headSha = git('rev-parse', 'HEAD').trim()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, baseSha, headSha, runCommand: (command, args, options) => execFileSync(command, args, { cwd: options.cwd, encoding: options.encoding === 'buffer' ? null : (options.encoding || 'utf8') }) }
}

test('canonical discovery rejects a non-workflow source renamed into workflows', (t) => {
  const repo = renameRepository(t, 'docs/source.yml', '.github/workflows/source.yml')
  assert.throws(() => discoverWorkflowCandidate(repo), /only workflow YAML/i)
})

test('canonical discovery protects validator source path across rename', (t) => {
  const repo = renameRepository(t, '.github/workflows/trusted-workflow-validator.yml', '.github/workflows/renamed.yml')
  assert.throws(() => discoverWorkflowCandidate(repo), /trust root/i)
})

test('canonical discovery hashes the exact full no-renames binary diff', (t) => {
  const repo = renameRepository(t, '.github/workflows/old.yml', '.github/workflows/new.yml')
  const result = discoverWorkflowCandidate(repo)
  const exactDiff = execFileSync('git', ['diff', '--binary', '--no-ext-diff', '--no-renames', repo.baseSha, repo.headSha], { cwd: repo.root })
  assert.equal(result.diffSha256, hashWorkflowDiff(exactDiff))
  assert.deepEqual(result.changedPaths, ['.github/workflows/new.yml', '.github/workflows/old.yml'])
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
  assert.match(workflow, /run-name:.*inputs\.requestId/)
  assert.doesNotMatch(workflow, /pull_request:|push:|self-hosted|secrets\./)
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/)
  assert.match(workflow, /runs-on:\s*windows-latest/)
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.headSha \}\}/)
  assert.match(workflow, /node-version:\s*24/)
  assert.match(workflow, /npm@11\.11\.0/)
  assert.match(workflow, /run:\s*npm ci/)
  for (const gate of ['cloud test', 'cloud run build', 'admin-web run type-check', 'admin-web run build', 'miniprogram run type-check', 'miniprogram run test:unit', 'miniprogram run build:mp-weixin', 'test:deploy-output', 'test:governance']) assert.match(workflow, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(workflow, /scripts\['docs:check'\]/)
  assert.match(workflow, /docs=\$docs/)
  for (const field of ['schemaVersion', 'prNumber', 'baseSha', 'headSha', 'diffSha256', 'requestId', 'runId', 'validatorWorkflowSha', 'conclusion', 'checks']) assert.match(workflow, new RegExp(`${field}=`))
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /trusted-workflow-attestation\.json/)
})
