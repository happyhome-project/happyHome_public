import assert from 'node:assert/strict'
import test from 'node:test'

import {
  confirmNoOwner,
  createWorktreePlan,
  decideSync,
  evaluateLeaseOwner,
  evaluateRetirement,
  verifyRetirementManifest,
} from './worktree-lifecycle.mjs'

const cleanBase = {
  activeOwner: false,
  ownerState: 'inactive',
  hasOperation: false,
  isCanonicalMain: false,
  isDirty: false,
  openPr: false,
  uniqueCommits: 0,
  headInMain: true,
  pathIsReparsePoint: false,
}

test('retirement requires an inactive clean worktree whose head is in main', () => {
  assert.deepEqual(evaluateRetirement(cleanBase), { eligible: true, reasons: [] })

  for (const [field, value, reason] of [
    ['activeOwner', true, 'active_owner'],
    ['ownerState', 'unknown', 'unknown_owner'],
    ['hasOperation', true, 'git_operation'],
    ['isDirty', true, 'dirty'],
    ['openPr', true, 'open_pr'],
    ['uniqueCommits', 1, 'unique_commits'],
    ['headInMain', false, 'head_not_in_main'],
    ['pathIsReparsePoint', true, 'reparse_point'],
  ]) {
    assert.deepEqual(evaluateRetirement({ ...cleanBase, [field]: value }), {
      eligible: false,
      reasons: [reason],
    })
  }
})

test('retirement refuses the canonical main workspace even when clean', () => {
  assert.deepEqual(evaluateRetirement({ ...cleanBase, isCanonicalMain: true }), {
    eligible: false,
    reasons: ['canonical_main'],
  })
})

test('owner confirmation never overrides a recorded active lease', () => {
  assert.deepEqual(confirmNoOwner({ activeOwner: true, ownerState: 'active' }, true), {
    activeOwner: true,
    ownerState: 'active',
  })
  assert.deepEqual(confirmNoOwner({ activeOwner: false, ownerState: 'unknown' }, true), {
    activeOwner: false,
    ownerState: 'inactive',
  })
})

test('stale or missing leases stay unknown rather than becoming inactive', () => {
  const now = Date.parse('2026-07-11T12:00:00.000Z')
  assert.deepEqual(evaluateLeaseOwner(null, { now }), { activeOwner: false, ownerState: 'unknown', stale: false })
  assert.deepEqual(evaluateLeaseOwner({ state: 'active', lastSeenAt: '2026-07-11T11:59:00.000Z' }, { now }), {
    activeOwner: true, ownerState: 'active', stale: false,
  })
  assert.deepEqual(evaluateLeaseOwner({ state: 'active', lastSeenAt: '2026-07-10T11:00:00.000Z' }, { now }), {
    activeOwner: false, ownerState: 'unknown', stale: true,
  })
  assert.deepEqual(evaluateLeaseOwner({ state: 'inactive' }, { now }), {
    activeOwner: false, ownerState: 'inactive', stale: false,
  })
})

test('sync permits only clean, ownerless fast-forward or detached resets', () => {
  assert.deepEqual(decideSync({ activeOwner: false, isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'fast_forward',
  })
  assert.deepEqual(decideSync({ activeOwner: false, isDirty: false, behind: 3, ahead: 0, detached: true }), {
    action: 'reset_detached',
  })
  assert.deepEqual(decideSync({ activeOwner: false, isDirty: false, behind: 3, ahead: 2, detached: false }), {
    action: 'manual_merge',
  })
  assert.deepEqual(decideSync({ activeOwner: true, isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'active_owner',
  })
  assert.deepEqual(decideSync({ activeOwner: false, isDirty: true, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'dirty',
  })
})

test('retirement apply requires the prepare manifest to match live identity', () => {
  const manifest = {
    path: 'X:/worktrees/finished/happyHome',
    branch: 'codex/finished',
    head: 'a'.repeat(40),
    main: 'b'.repeat(40),
  }

  assert.doesNotThrow(() => verifyRetirementManifest(manifest, { ...manifest }))
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, head: 'c'.repeat(40) }), /head/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, branch: 'codex/other' }), /branch/i)
})

test('new worktrees use an explicit safe codex branch name and path', () => {
  assert.deepEqual(createWorktreePlan({
    name: 'docs-governance',
    path: 'X:/Users/<user>/.codex/worktrees/docs-governance/happyHome',
  }), {
    branch: 'codex/docs-governance',
    path: 'X:/Users/<user>/.codex/worktrees/docs-governance/happyHome',
  })
  assert.throws(() => createWorktreePlan({ name: '../main', path: 'X:/tmp/happyHome' }), /safe/i)
  assert.throws(() => createWorktreePlan({ name: 'docs', path: '' }), /path/i)
  assert.throws(() => createWorktreePlan({ name: 'docs', path: 'child-worktree' }), /absolute/i)
})
