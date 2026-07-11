import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import test from 'node:test'

import * as trustedPolicy from './trusted-workflow-policy.mjs'
import * as workflowIntegrator from '../integrate-workflow-pr.mjs'

import {
  APPROVAL_PREFIX,
  REQUIRED_VALIDATOR_CHECKS,
  applyAfterValidation,
  assertAttestation,
  assertWorkflowPaths,
  buildApprovalPhrase,
  createManifest,
  discoverWorkflowCandidate,
  executeTrustedApply,
  findValidatorRun,
  hashWorkflowDiff,
  obtainVerifiedAttestation,
  validateManifest,
  withIntegrationLock,
} from './trusted-workflow-policy.mjs'

const sha = (letter) => letter.repeat(40)
const base = sha('a')
const head = sha('b')
const validator = sha('c')
const diffSha256 = 'd'.repeat(64)

test('trusted workflow workspace accepts any clean synchronized main checkout of the public repository', () => {
  assert.equal(trustedPolicy.TRUSTED_REPOSITORY, 'happyhome-project/happyHome_public')
  assert.equal(typeof trustedPolicy.assertTrustedWorkflowWorkspace, 'function')
  assert.deepEqual(trustedPolicy.assertTrustedWorkflowWorkspace({
    root: 'D:\\arbitrary\\clean-main',
    repository: 'HappyHome-Project/HAPPYHOME_PUBLIC',
    isPrivate: false,
    repositoryUrl: 'https://github.com/happyhome-project/happyHome_public',
    originUrl: 'git@github.com:happyhome-project/happyHome_public.git',
    branch: 'main',
    status: '',
    headSha: base,
    originMainSha: base,
  }), {
    root: 'D:\\arbitrary\\clean-main',
    repository: 'happyhome-project/happyHome_public',
    branch: 'main',
    headSha: base,
    originMainSha: base,
  })
})

test('trusted workflow workspace rejects private, feature, dirty, and stale checkouts', () => {
  assert.equal(typeof trustedPolicy.assertTrustedWorkflowWorkspace, 'function')
  const valid = { root: 'D:\\main', repository: 'happyhome-project/happyHome_public', isPrivate: false, repositoryUrl: 'https://github.com/happyhome-project/happyHome_public', originUrl: 'git@github.com:happyhome-project/happyHome_public.git', branch: 'main', status: '', headSha: base, originMainSha: base }
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, repository: 'other-owner/private-repo' }), /trusted public repository/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, isPrivate: true }), /must remain public/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, repositoryUrl: 'https://github.example.com/happyhome-project/happyHome_public' }), /github\.com/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, originUrl: 'git@github.com:other-owner/private-repo.git' }), /origin.*trusted public repository/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, branch: 'codex/feature' }), /branch main/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, status: ' M scripts/file.mjs' }), /clean worktree/i)
  assert.throws(() => trustedPolicy.assertTrustedWorkflowWorkspace({ ...valid, headSha: head }), /origin\/main/i)
})

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
    runCreatedAt: '2026-07-11T00:00:00.000Z',
    validatedAt: '2026-07-11T00:10:00.000Z',
    checks: Object.fromEntries(REQUIRED_VALIDATOR_CHECKS.map((key) => [key, key === 'docs' ? 'not-present' : 'passed'])),
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
  const createdAt = '2026-07-11T00:10:00.000Z'
  const manifest = createManifest({
    prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'],
    diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234,
    attestation: attestation(), runCreatedAt: '2026-07-11T00:00:00.000Z', createdAt,
  })
  assert.equal(manifest.expiresAt, '2026-07-11T02:10:00.000Z')
  assert.match(manifest.approvalPhrase, /CREATED 2026-07-11T00:10:00\.000Z EXPIRES 2026-07-11T02:10:00\.000Z/)
  assert.equal(manifest.approvalPhrase, buildApprovalPhrase(manifest))
  assert.match(manifest.approvalPhrase, new RegExp(`^${APPROVAL_PREFIX}`))
  assert.doesNotThrow(() => validateManifest(manifest, {
    now: '2026-07-11T01:59:59.000Z', prNumber: 42, baseSha: base, headSha: head,
    changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator,
    requestId: 'req-42', runId: 1234, runCreatedAt: manifest.runCreatedAt, attestation: attestation(), approval: manifest.approvalPhrase,
  }))
  for (const drift of [
    { headSha: sha('e') }, { baseSha: sha('e') }, { diffSha256: 'e'.repeat(64) },
    { changedPaths: ['.github/workflows/drift.yml'] }, { validatorWorkflowSha: sha('e') },
  ]) assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation(), ...drift }), /drift|mismatch/i)
  assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T02:10:00.001Z', approval: manifest.approvalPhrase, attestation: attestation() }), /expired/i)
  assert.throws(() => validateManifest(manifest, { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: 'yes', attestation: attestation() }), /approval/i)
  for (const tamper of [{ expiresAt: '2026-07-12T02:10:00.000Z' }, { createdAt: '2026-07-11T00:00:00.000Z' }, { runCreatedAt: '2026-07-10T00:00:00.000Z' }]) {
    const changed = { ...manifest, ...tamper }
    changed.approvalPhrase = buildApprovalPhrase(changed)
    assert.throws(() => validateManifest(changed, { ...changed, runCreatedAt: manifest.runCreatedAt, now: '2026-07-11T01:00:00.000Z', approval: changed.approvalPhrase, attestation: attestation() }), /timestamp|two hours|mismatch/i)
  }
})

test('attestation must be successful and exactly match the trusted request', () => {
  const expected = attestation()
  assert.doesNotThrow(() => assertAttestation(expected, expected))
  assert.throws(() => assertAttestation(attestation({ conclusion: 'failure' }), expected), /successful/i)
  assert.throws(() => assertAttestation(attestation({ headSha: sha('e') }), expected), /headSha.*mismatch/i)
  assert.throws(() => assertAttestation(attestation({ diffSha256: 'e'.repeat(64) }), expected), /diffSha256.*mismatch/i)
  assert.throws(() => assertAttestation(attestation({ checks: {} }), expected), /required validator check/i)
  assert.throws(() => assertAttestation(attestation({ checks: { ...expected.checks, governance: undefined } }), expected), /required validator check/i)
})

test('apply invokes merge only after every manifest and attestation check passes', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  let merged = false
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  await assert.rejects(() => applyAfterValidation({ manifest, current: { ...current, headSha: sha('e') }, merge: async () => { merged = true } }), /drift/i)
  assert.equal(merged, false)
  await applyAfterValidation({ manifest, current, merge: async () => { merged = true } })
  assert.equal(merged, true)
})

test('validator run discovery requires the exact request and successful main-definition run', () => {
  const run = findValidatorRun([{ databaseId: 9, displayTitle: 'trusted req-42', status: 'completed', conclusion: 'success', headSha: base, createdAt: '2026-07-11T00:00:00Z' }], 'req-42', base)
  assert.equal(run.databaseId, 9)
  assert.throws(() => findValidatorRun([{ ...run, conclusion: 'failure' }], 'req-42', base), /successful/i)
  assert.throws(() => findValidatorRun([{ ...run, headSha: head }], 'req-42', base), /main definition/i)
})

test('artifact is downloaded, read, and fully verified in order', async () => {
  const events = [], expected = attestation()
  await obtainVerifiedAttestation({ downloadArtifact: async () => events.push('download'), readArtifact: async () => { events.push('read'); return expected }, expected })
  assert.deepEqual(events, ['download', 'read'])
  await assert.rejects(() => obtainVerifiedAttestation({ downloadArtifact: async () => {}, readArtifact: async () => attestation({ checks: {} }), expected }), /required validator check/i)
})

test('apply enqueues the exact head, waits for MERGED, then pulls and returns terminal evidence', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const events = [], mergeCommit = sha('f')
  let originMain = base
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: mergeCommit } },
  ]
  const result = await executeTrustedApply({
    manifest,
    current,
    refreshBase: async () => { events.push(`fetch-base:${originMain}`); return originMain },
    readPullRequest: async () => { const state = states.shift(); if (state.state === 'MERGED') originMain = mergeCommit; events.push(`read-pr:${state.state}`); return state },
    enqueue: async (exactHead) => { events.push(`enqueue:${exactHead}`) },
    dequeue: async () => { events.push('dequeue') },
    readMergeParents: async (mergeCommitOid) => { assert.equal(originMain, mergeCommit); events.push(`read-parents:${mergeCommitOid}`); return [base, head] },
    delay: async () => { events.push('delay') },
    pull: async () => events.push('pull'),
  })
  assert.deepEqual(events, [`fetch-base:${base}`, 'read-pr:OPEN', `enqueue:${head}`, 'read-pr:OPEN', `fetch-base:${base}`, 'delay', 'read-pr:MERGED', `read-parents:${mergeCommit}`, 'pull'])
  assert.deepEqual(result, { state: 'MERGED', mergedAt: '2026-07-11T01:02:00.000Z', mergeCommitOid: mergeCommit })
})

test('merge queue terminal wait polls OPEN and succeeds only for MERGED', async () => {
  assert.equal(typeof trustedPolicy.waitForMergeQueueTerminal, 'function')
  const events = []
  const states = [{ state: 'OPEN' }, { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } }]
  const result = await trustedPolicy.waitForMergeQueueTerminal({
    refreshBase: async () => { events.push('fetch-base'); return base },
    readPullRequest: async () => { const state = states.shift(); events.push(state.state); return state },
    dequeue: async () => events.push('dequeue'),
    delay: async () => events.push('delay'),
    maxAttempts: 2,
    expectedBaseSha: base,
    expectedHeadSha: head,
  })
  assert.deepEqual(events, ['OPEN', 'fetch-base', 'delay', 'MERGED'])
  assert.deepEqual(result, { state: 'MERGED', mergedAt: '2026-07-11T01:02:00.000Z', mergeCommitOid: sha('f') })
})

test('merge queue terminal wait rejects closed-without-merge and timeout', async () => {
  assert.equal(typeof trustedPolicy.waitForMergeQueueTerminal, 'function')
  const baseOptions = { refreshBase: async () => base, dequeue: async () => {}, expectedBaseSha: base, delay: async () => {}, maxAttempts: 1 }
  await assert.rejects(() => trustedPolicy.waitForMergeQueueTerminal({ ...baseOptions, readPullRequest: async () => ({ state: 'CLOSED' }) }), /closed without merge/i)
  await assert.rejects(() => trustedPolicy.waitForMergeQueueTerminal({ ...baseOptions, readPullRequest: async () => ({ state: 'MERGED', mergedAt: null, mergeCommit: null }) }), /merge terminal evidence/i)
  await assert.rejects(() => trustedPolicy.waitForMergeQueueTerminal({ ...baseOptions, readPullRequest: async () => ({ state: 'MERGED', headRefOid: sha('e'), mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } }), expectedHeadSha: head }), /merged head.*mismatch/i)
  let reads = 0, dequeues = 0
  await assert.rejects(() => trustedPolicy.waitForMergeQueueTerminal({ ...baseOptions, readPullRequest: async () => { reads += 1; return { state: 'OPEN' } }, dequeue: async () => { dequeues += 1 }, maxAttempts: 2 }), /timed out.*dequeued.*fresh prepare/i)
  assert.equal(reads, 3)
  assert.equal(dequeues, 1)
})

test('OPEN queue wait dequeues once and rejects without pull when base advances', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const bases = [base, sha('e')], events = []
  await assert.rejects(() => executeTrustedApply({
    manifest, current,
    refreshBase: async () => { const value = bases.shift(); events.push(`base:${value}`); return value },
    readPullRequest: async () => { events.push('read-pr'); return { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' } },
    enqueue: async () => events.push('enqueue'),
    dequeue: async (id) => events.push(`dequeue:${id}`),
    readMergeParents: async () => { events.push('read-parents'); return [base, head] },
    delay: async () => {},
    maxAttempts: 1,
    pull: async () => events.push('pull'),
  }), /base advanced.*fresh prepare required/i)
  assert.deepEqual(events, [`base:${base}`, 'read-pr', 'enqueue', 'read-pr', `base:${sha('e')}`, 'read-pr', 'dequeue:PR_node_42'])
})

test('base drift preserves the primary error when dequeue cleanup fails', async () => {
  let error
  try {
    await trustedPolicy.waitForMergeQueueTerminal({ refreshBase: async () => sha('e'), readPullRequest: async () => ({ state: 'OPEN' }), dequeue: async () => { throw new Error('graphql unavailable') }, expectedBaseSha: base, maxAttempts: 1 })
  } catch (caught) { error = caught }
  assert.ok(error)
  assert.match(error.message, /base advanced/i)
  assert.match(error.message, /fresh prepare required.*dequeue cleanup failed.*graphql unavailable/i)
})

test('MERGED terminal with parents bound to a new base rejects without pull', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  let pulls = 0
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } },
  ]
  await assert.rejects(() => executeTrustedApply({ manifest, current, refreshBase: async () => base, readPullRequest: async () => states.shift(), enqueue: async () => {}, dequeue: async () => {}, readMergeParents: async () => [sha('e'), head], pull: async () => { pulls += 1 } }), /merge commit parents.*base/i)
  assert.equal(pulls, 0)
})

test('OPEN base drift that becomes MERGED before dequeue succeeds only with original parents', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const merged = { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } }
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    merged,
  ]
  const bases = [base, sha('e')], events = []
  const result = await executeTrustedApply({ manifest, current, refreshBase: async () => bases.shift(), readPullRequest: async () => states.shift(), enqueue: async () => events.push('enqueue'), dequeue: async () => events.push('dequeue'), readMergeParents: async () => [base, head], pull: async () => events.push('pull') })
  assert.deepEqual(events, ['enqueue', 'pull'])
  assert.equal(result.mergeCommitOid, sha('f'))
})

test('OPEN base drift that becomes MERGED before dequeue rejects mismatched parents', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } },
  ]
  const bases = [base, sha('e')]
  let pulls = 0
  await assert.rejects(() => executeTrustedApply({ manifest, current, refreshBase: async () => bases.shift(), readPullRequest: async () => states.shift(), enqueue: async () => {}, dequeue: async () => {}, readMergeParents: async () => [sha('e'), head], pull: async () => { pulls += 1 } }), /merge commit parents.*base/i)
  assert.equal(pulls, 0)
})

test('dequeue failure race that becomes MERGED validates parents and succeeds', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    { state: 'OPEN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } },
  ]
  const bases = [base, sha('e')], events = []
  const result = await executeTrustedApply({ manifest, current, refreshBase: async () => bases.shift(), readPullRequest: async () => states.shift(), enqueue: async () => events.push('enqueue'), dequeue: async () => { events.push('dequeue'); throw new Error('race') }, readMergeParents: async () => [base, head], pull: async () => events.push('pull') })
  assert.deepEqual(events, ['enqueue', 'dequeue', 'pull'])
  assert.equal(result.mergeCommitOid, sha('f'))
})

test('timeout while still OPEN dequeues once and rejects without pull', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  let dequeues = 0, pulls = 0
  await assert.rejects(() => executeTrustedApply({ manifest, current, refreshBase: async () => base, readPullRequest: async () => ({ id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' }), enqueue: async () => {}, dequeue: async () => { dequeues += 1 }, readMergeParents: async () => [base, head], delay: async () => {}, maxAttempts: 1, pull: async () => { pulls += 1 } }), /timed out.*dequeued.*fresh prepare/i)
  assert.equal(dequeues, 1)
  assert.equal(pulls, 0)
})

test('timeout pre-dequeue reread that is MERGED validates parents and succeeds', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } },
  ]
  const events = []
  const result = await executeTrustedApply({ manifest, current, refreshBase: async () => base, readPullRequest: async () => states.shift(), enqueue: async () => {}, dequeue: async () => events.push('dequeue'), readMergeParents: async () => [base, head], delay: async () => {}, maxAttempts: 1, pull: async () => events.push('pull') })
  assert.deepEqual(events, ['pull'])
  assert.equal(result.mergeCommitOid, sha('f'))
})

test('timeout dequeue failure followed by MERGED validates parents and succeeds', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  const states = [
    { id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' },
    { state: 'OPEN' },
    { state: 'OPEN' },
    { state: 'MERGED', headRefOid: head, mergedAt: '2026-07-11T01:02:00.000Z', mergeCommit: { oid: sha('f') } },
  ]
  const events = []
  const result = await executeTrustedApply({ manifest, current, refreshBase: async () => base, readPullRequest: async () => states.shift(), enqueue: async () => {}, dequeue: async () => { events.push('dequeue'); throw new Error('race') }, readMergeParents: async () => [base, head], delay: async () => {}, maxAttempts: 1, pull: async () => events.push('pull') })
  assert.deepEqual(events, ['dequeue', 'pull'])
  assert.equal(result.mergeCommitOid, sha('f'))
})

test('timeout dequeue failure while still OPEN preserves timeout and cleanup errors', async () => {
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  let pulls = 0
  await assert.rejects(() => executeTrustedApply({ manifest, current, refreshBase: async () => base, readPullRequest: async () => ({ id: 'PR_node_42', state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: base, headRefOid: head, mergeStateStatus: 'CLEAN' }), enqueue: async () => {}, dequeue: async () => { throw new Error('graphql unavailable') }, readMergeParents: async () => [base, head], delay: async () => {}, maxAttempts: 1, pull: async () => { pulls += 1 } }), /timed out.*dequeue cleanup failed.*graphql unavailable/i)
  assert.equal(pulls, 0)
})

test('workflow integrator bootstraps trust from the public repository and reports the terminal merge commit', () => {
  const script = readFileSync(new URL('../integrate-workflow-pr.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(script, /CANONICAL_MAIN_WORKSPACE/)
  assert.match(script, /gh[\s\S]*repo[\s\S]*view[\s\S]*nameWithOwner,isPrivate,url/)
  assert.match(script, /remote', 'get-url', 'origin'/)
  assert.match(script, /TRUSTED_REPOSITORY/)
  assert.match(script, /assertTrustedWorkflowWorkspace/)
  assert.match(script, /inspectTrustedWorkspace\(root\)\s*\r?\n/)
  assert.match(script, /inspectTrustedWorkspace\(root, \{ fetch: true \}\)/)
  assert.equal(script.match(/inspectTrustedWorkspace\(root, \{ fetch: true \}\)/g)?.length, 1)
  const candidateInspection = script.slice(script.indexOf('function inspectCandidate'), script.indexOf('function downloadAttestation'))
  assert.doesNotMatch(candidateInspection, /\['fetch', 'origin', 'main'\]/)
  assert.match(script, /enqueue:\s*async\s*\(exactHead\)/)
  assert.match(script, /mergedAt,mergeCommit/)
  assert.match(script, /dequeuePullRequest\(input:\{id:\$id\}\)/)
  assert.match(script, /--hostname[\s\S]*github\.com/)
  const mergeParentReader = script.slice(script.indexOf('readMergeParents:'), script.indexOf('pull: async', script.indexOf('readMergeParents:')))
  assert.match(mergeParentReader, /merge-base[\s\S]*--is-ancestor[\s\S]*origin\/main/)
  assert.match(script, /git[\s\S]*show[\s\S]*--format=%P/)
  assert.match(script, /terminal\.mergeCommitOid/)
})

test('workflow integration lock matches normal integrator git common-dir semantics on Windows', () => {
  assert.equal(typeof workflowIntegrator.workflowIntegrationLockPath, 'function')
  const absoluteRoot = 'D:\\repo\\linked-main'
  const absoluteCommonDir = 'D:\\repo\\.git'
  assert.equal(workflowIntegrator.workflowIntegrationLockPath(absoluteRoot, absoluteCommonDir), win32.join(absoluteCommonDir, 'happyhome-integrate-pr.lock'))

  const relativeRoot = 'D:\\repo\\linked-main'
  const relativeCommonDir = '..\\.git'
  assert.equal(workflowIntegrator.workflowIntegrationLockPath(relativeRoot, relativeCommonDir), win32.join(win32.resolve(relativeRoot, relativeCommonDir), 'happyhome-integrate-pr.lock'))

  const normalIntegrator = readFileSync(new URL('../integrate-pr.mjs', import.meta.url), 'utf8')
  assert.match(normalIntegrator, /gitCommonDir[\s\S]*happyhome-integrate-pr\.lock/)
})

test('apply refuses a base-advance race and always releases its lock on failure', async () => {
  let merged = false, released = false
  const manifest = createManifest({ prNumber: 42, baseSha: base, headSha: head, changedPaths: ['.github/workflows/example.yml'], diffSha256, validatorWorkflowSha: validator, requestId: 'req-42', runId: 1234, runCreatedAt: '2026-07-11T00:00:00.000Z', attestation: attestation(), createdAt: '2026-07-11T00:10:00.000Z' })
  const current = { ...manifest, now: '2026-07-11T01:00:00.000Z', approval: manifest.approvalPhrase, attestation: attestation() }
  await assert.rejects(() => withIntegrationLock(async () => () => { released = true }, () => executeTrustedApply({ manifest, current, refreshBase: async () => sha('e'), readPullRequest: async () => ({}), enqueue: async () => { merged = true }, pull: async () => {} })), /base.*advanced/i)
  assert.equal(merged, false); assert.equal(released, true)
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
  for (const field of ['schemaVersion', 'prNumber', 'baseSha', 'headSha', 'diffSha256', 'requestId', 'runId', 'validatorWorkflowSha', 'validatedAt', 'conclusion', 'checks']) assert.match(workflow, new RegExp(`${field}=`))
  assert.match(workflow, /actions\/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5/)
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/)
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/)
  assert.match(workflow, /trusted-workflow-attestation\.json/)
})
