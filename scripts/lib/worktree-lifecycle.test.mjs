import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { acquireIntegrationLock } from './integrate-pr-policy.mjs'

import {
  confirmNoOwner,
  createRetirementManifest,
  createRetirementRecord,
  createWorktreePlan,
  decideSync,
  evaluateLeaseOwner,
  evaluateRetirement,
  executeHeartbeatCriticalSection,
  executeRetirementCriticalSection,
  verifyCreateTargetBoundary,
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
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'fast_forward',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 0, detached: true }), {
    action: 'reset_detached',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: false, behind: 3, ahead: 2, detached: false }), {
    action: 'manual_merge',
  })
  assert.deepEqual(decideSync({ activeOwner: true, ownerState: 'active', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'active_owner',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'unknown', isDirty: false, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'unknown_owner',
  })
  assert.deepEqual(decideSync({ activeOwner: false, ownerState: 'inactive', isDirty: true, behind: 3, ahead: 0, detached: false }), {
    action: 'blocked',
    reason: 'dirty',
  })
})

test('sync exposes an explicit no-owner confirmation path without overriding active leases', () => {
  const scriptPath = fileURLToPath(new URL('../worktree.mjs', import.meta.url))
  const source = readFileSync(scriptPath, 'utf8')
  assert.match(source, /confirmNoOwner\(ownerState\(identity\.root, identity\.root\), flags\.has\('confirm-no-owner'\)\)/)

  const confirmed = confirmNoOwner({ activeOwner: false, ownerState: 'unknown' }, true)
  assert.deepEqual(decideSync({ ...confirmed, isDirty: false, behind: 1, ahead: 0 }), { action: 'fast_forward' })
  const active = confirmNoOwner({ activeOwner: true, ownerState: 'active' }, true)
  assert.deepEqual(decideSync({ ...active, isDirty: false, behind: 1, ahead: 0 }), { action: 'blocked', reason: 'active_owner' })
})

test('retirement apply requires the prepare manifest to match live identity', () => {
  const manifest = createRetirementManifest({
    manifestId: '11111111-1111-4111-8111-111111111111',
    path: 'X:/worktrees/finished/happyHome',
    branch: 'codex/finished',
    head: 'a'.repeat(40),
    main: 'b'.repeat(40),
    preparedAt: '2026-07-11T12:00:00.000Z',
    expiresAt: '2026-07-11T12:15:00.000Z',
    confirmNoOwner: true,
  })
  const manifestPath = 'X:/repo/.git/happyhome-worktrees/retire/manifest.json'
  const record = createRetirementRecord({ manifest, manifestPath })
  const options = {
    manifestPath,
    managedDirectory: 'X:/repo/.git/happyhome-worktrees/retire',
    record,
    now: Date.parse('2026-07-11T12:05:00.000Z'),
  }

  assert.doesNotThrow(() => verifyRetirementManifest(manifest, { ...manifest }, options))
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, head: 'c'.repeat(40) }, options), /head/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest, branch: 'codex/other' }, options), /branch/i)
  assert.throws(() => verifyRetirementManifest({ ...manifest, schemaVersion: undefined }, { ...manifest }, options), /schema/i)
  assert.throws(() => verifyRetirementManifest({ ...manifest, confirmNoOwner: false }, { ...manifest }, options), /record|digest/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, record: null }), /record/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, now: Date.parse('2026-07-11T12:16:00.000Z') }), /expired/i)
  assert.throws(() => verifyRetirementManifest(manifest, { ...manifest }, { ...options, manifestPath: 'X:/tmp/manifest.json' }), /managed|path/i)
})

test('retirement rechecks owner state and removes only inside the shared lease lock', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-retire-lock-'))
  const lockPath = join(directory, 'leases.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let locked = false
  let ownerState = 'inactive'
  let removed = false
  const withLeaseLock = (action) => {
    const release = acquireIntegrationLock(lockPath, { prNumber: 'retire-test' })
    locked = true
    try {
      return action()
    } finally {
      locked = false
      release()
    }
  }

  ownerState = 'active'
  assert.throws(() => executeRetirementCriticalSection({
    withLeaseLock,
    probe: () => ({ ownerState }),
    verify: (probe) => {
      if (probe.ownerState !== 'inactive') throw new Error('active owner')
    },
    remove: () => { removed = true },
  }), /active owner/i)
  assert.equal(removed, false)

  ownerState = 'inactive'
  executeRetirementCriticalSection({
    withLeaseLock,
    probe: () => ({ ownerState }),
    verify: () => assert.equal(locked, true),
    remove: () => {
      assert.equal(locked, true)
      assert.throws(() => acquireIntegrationLock(lockPath, { prNumber: 'heartbeat' }), /already in progress/i)
      removed = true
    },
  })
  assert.equal(removed, true)
  assert.equal(locked, false)
})

test('heartbeat acquires the shared lease lock before reading worktree identity', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'happyhome-heartbeat-lock-'))
  const lockPath = join(directory, 'leases.lock')
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const events = []

  executeHeartbeatCriticalSection({
    withLeaseLock: (action) => {
      const release = acquireIntegrationLock(lockPath, { prNumber: 'heartbeat' })
      try {
        return action()
      } finally {
        release()
      }
    },
    readIdentity: () => {
      assert.throws(() => acquireIntegrationLock(lockPath, { prNumber: 'retire' }), /already in progress/i)
      events.push('identity')
      return { root: 'X:/worktree' }
    },
    writeLease: (identity) => {
      events.push(`lease:${identity.root}`)
    },
  })

  assert.deepEqual(events, ['identity', 'lease:X:/worktree'])
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

test('create rejects a reparse or ancestor identity change after fetch', () => {
  const before = {
    targetExists: false,
    hasReparseAncestor: false,
    anchorPath: 'x:/worktrees',
    anchorRealPath: 'x:/worktrees',
    anchorDevice: '1',
    anchorInode: '2',
  }

  assert.doesNotThrow(() => verifyCreateTargetBoundary(before, { ...before }))
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, hasReparseAncestor: true }), /reparse/i)
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, anchorInode: '3' }), /changed/i)
  assert.throws(() => verifyCreateTargetBoundary(before, { ...before, targetExists: true }), /exists/i)
})
