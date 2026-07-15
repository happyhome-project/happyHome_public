import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createReleaseSession,
  readLatestReleaseSessionPath,
  readReleaseSession,
  repairReleaseSession,
} from './release-session-identity.mjs'

const SHA = 'a'.repeat(40)
const UUID = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-07-16T02:03:04.000Z')

async function root() {
  return await mkdtemp(join(tmpdir(), 'happyhome-release-session-'))
}

test('create generates one machine identity and collision-safe human labels', async () => {
  const cwd = await root()
  const created = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', strategy: 'full-current', now: NOW, uuid: UUID })
  assert.equal(created.session.sessionId, UUID)
  assert.equal(created.session.identity.gitSha, SHA)
  assert.equal(created.session.identity.releaseRunId, '20260716T100304-public-main-aaaaaaaaaaaa-11111111')
  assert.equal(created.session.release.version, '1.0.260716100304.86331153')
  assert.equal(created.session.release.desc, 'current-main-aaaaaaaaaaaa')
  assert.deepEqual(await readReleaseSession(created.path), created.session)
  assert.equal(await readLatestReleaseSessionPath(cwd), created.path)
  const second = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', strategy: 'full-current', now: NOW, uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })
  assert.notEqual(second.session.identity.releaseRunId, created.session.identity.releaseRunId)
  assert.notEqual(second.session.release.version, created.session.release.version)
})

test('repair changes actual labels before a formal ledger exists', async () => {
  const cwd = await root()
  const created = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', strategy: 'full-current', now: NOW, uuid: UUID })
  const repaired = await repairReleaseSession({
    root: cwd,
    sessionPath: created.path,
    changes: { releaseRunId: 'manual-readable-id', version: '1.0.9', desc: 'correct-label' },
    reason: 'operator corrected labels before prepare',
    now: new Date('2026-07-16T02:04:00.000Z'),
  })
  assert.equal(repaired.identity.releaseRunId, 'manual-readable-id')
  assert.equal(repaired.release.version, '1.0.9')
  assert.equal(repaired.release.desc, 'correct-label')
  assert.equal(repaired.repairs.length, 1)
  assert.deepEqual(repaired.aliases, {})
})

test('repair records aliases after prepare without changing historical release identity', async () => {
  const cwd = await root()
  const created = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', strategy: 'full-current', now: NOW, uuid: UUID })
  const runDir = join(cwd, '.codex-local', 'release-runs', created.session.identity.releaseRunId)
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify({
    runId: created.session.identity.releaseRunId,
    status: 'prepared',
    context: { gitSha: SHA, version: created.session.release.version, desc: created.session.release.desc, envId: 'env-test', releaseStrategy: 'full-current' },
  })}\n`)
  const repaired = await repairReleaseSession({
    root: cwd,
    sessionPath: created.path,
    changes: { releaseRunId: 'preferred-run', version: '1.0.10', desc: 'preferred-desc', displayName: 'July release' },
    reason: 'correct human labels after prepare',
    now: new Date('2026-07-16T02:05:00.000Z'),
  })
  assert.equal(repaired.identity.releaseRunId, created.session.identity.releaseRunId)
  assert.equal(repaired.release.version, created.session.release.version)
  assert.equal(repaired.release.desc, created.session.release.desc)
  assert.deepEqual(repaired.aliases, { releaseRunId: 'preferred-run', version: '1.0.10', desc: 'preferred-desc', displayName: 'July release' })
})

test('latest pointer repair requires an exact matching formal ledger', async () => {
  const cwd = await root()
  const created = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', strategy: 'full-current', now: NOW, uuid: UUID })
  const runs = join(cwd, '.codex-local', 'release-runs')
  const runDir = join(runs, created.session.identity.releaseRunId)
  await mkdir(runDir, { recursive: true })
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify({
    runId: created.session.identity.releaseRunId,
    context: { gitSha: SHA, version: created.session.release.version, desc: created.session.release.desc, envId: 'env-test', releaseStrategy: 'full-current' },
  })}\n`)
  await repairReleaseSession({ root: cwd, sessionPath: created.path, changes: {}, repairLatest: true, reason: 'restore local pointer', now: NOW })
  assert.deepEqual(JSON.parse(await readFile(join(runs, 'latest.json'), 'utf8')), { runId: created.session.identity.releaseRunId })
  const tampered = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'))
  tampered.context.gitSha = 'b'.repeat(40)
  await writeFile(join(runDir, 'run.json'), JSON.stringify(tampered))
  await assert.rejects(
    repairReleaseSession({ root: cwd, sessionPath: created.path, changes: {}, repairLatest: true, reason: 'must reject mismatch', now: NOW }),
    /ledger.*gitSha/i,
  )
})

test('repair refuses an empty reason and malformed security identity', async () => {
  const cwd = await root()
  await assert.rejects(createReleaseSession({ root: cwd, gitSha: 'short', envId: 'env-test', now: NOW, uuid: UUID }), /gitSha/)
  const created = await createReleaseSession({ root: cwd, gitSha: SHA, envId: 'env-test', now: NOW, uuid: UUID })
  await assert.rejects(repairReleaseSession({ root: cwd, sessionPath: created.path, changes: { desc: 'x' }, reason: '' }), /reason/)
})
