import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  assertCanonicalReleaseSessionGitState,
  buildReleaseSessionInvocation,
  runReleaseSessionCli,
} from '../release-session.mjs'

const SHA = 'a'.repeat(40)

function session() {
  return {
    schemaVersion: 1,
    sessionId: '11111111-2222-4333-8444-555555555555',
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    identity: { gitSha: SHA, envId: 'env-test', strategy: 'full-current', releaseRunId: 'machine-run-id' },
    release: { version: '1.0.9', desc: 'actual-desc' },
    aliases: { version: 'pretty-version', desc: 'pretty-desc' },
    repairs: [],
  }
}

test('prepare and publish invocations use the same actual session identity and ignore aliases', () => {
  const value = session()
  assert.deepEqual(buildReleaseSessionInvocation(value, 'prepare'), {
    command: process.execPath,
    args: ['scripts/deploy.mjs', 'release-prepare', '--full-current', '--release-run-id=machine-run-id', '--version=1.0.9', '--desc=actual-desc'],
  })
  assert.deepEqual(buildReleaseSessionInvocation(value, 'publish'), {
    command: process.execPath,
    args: ['scripts/deploy.mjs', 'release-publish', '--use-tcb', '--full-current', '--resume', '--release-run-id=machine-run-id', '--version=1.0.9', '--desc=actual-desc', '--cloud-deploy-concurrency=2', '--cloud-smoke-concurrency=3'],
  })
})

test('canonical session git guard rejects drift but allows exact public main', () => {
  const root = 'C:/Project/Claude/happyHome_public'
  const valid = { root, branch: 'main', headSha: SHA, originMainSha: SHA, originUrl: 'https://github.com/happyhome-project/happyHome_public.git', changedPaths: [] }
  assert.doesNotThrow(() => assertCanonicalReleaseSessionGitState(valid))
  assert.throws(() => assertCanonicalReleaseSessionGitState({ ...valid, branch: 'codex/x' }), /main/)
  assert.throws(() => assertCanonicalReleaseSessionGitState({ ...valid, changedPaths: ['file'] }), /clean/)
  assert.throws(() => assertCanonicalReleaseSessionGitState({ ...valid, originMainSha: 'b'.repeat(40) }), /origin\/main/)
})

test('prepare retry allows only the release-owned build-info marker', () => {
  const root = 'C:/Project/Claude/happyHome_public'
  const valid = { root, branch: 'main', headSha: SHA, originMainSha: SHA, originUrl: 'https://github.com/happyhome-project/happyHome_public.git', changedPaths: ['miniprogram/src/generated/build-info.ts'] }
  assert.doesNotThrow(() => assertCanonicalReleaseSessionGitState(valid, { action: 'prepare', expectedGitSha: SHA }))
  assert.throws(() => assertCanonicalReleaseSessionGitState({ ...valid, changedPaths: [...valid.changedPaths, 'package.json'] }, { action: 'prepare', expectedGitSha: SHA }), /package\.json/)
})

test('repair command updates local session without invoking deployment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-release-session-cli-'))
  const path = join(root, 'session.json')
  await writeFile(path, `${JSON.stringify(session())}\n`)
  let spawnCount = 0
  const result = await runReleaseSessionCli({
    argv: ['repair', `--session=${path}`, '--desc=corrected', '--reason=label correction'],
    root,
    gitState: { root, branch: 'main', headSha: SHA, originMainSha: SHA, originUrl: 'https://github.com/happyhome-project/happyHome_public.git', changedPaths: [] },
    enforceCanonicalRoot: false,
    spawn: () => { spawnCount += 1; return { status: 0 } },
  })
  assert.equal(result.release.desc, 'corrected')
  assert.equal(spawnCount, 0)
})

test('prepare preserves child exit status and never manufactures success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-release-session-cli-'))
  const path = join(root, 'session.json')
  await writeFile(path, `${JSON.stringify(session())}\n`)
  await assert.rejects(runReleaseSessionCli({
    argv: ['prepare', `--session=${path}`],
    root,
    gitState: { root, branch: 'main', headSha: SHA, originMainSha: SHA, originUrl: 'https://github.com/happyhome-project/happyHome_public.git', changedPaths: [] },
    enforceCanonicalRoot: false,
    spawn: () => ({ status: 17 }),
  }), /exit code 17/)
})

test('create maintains latest session so prepare needs no copied path or labels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happyhome-release-session-cli-'))
  const gitState = { root, branch: 'main', headSha: SHA, originMainSha: SHA, originUrl: 'https://github.com/happyhome-project/happyHome_public.git', changedPaths: [] }
  const created = await runReleaseSessionCli({ argv: ['create', '--full-current'], root, gitState, enforceCanonicalRoot: false, now: new Date('2026-07-16T00:00:00.000Z') })
  let invocation
  await runReleaseSessionCli({
    argv: ['prepare'],
    root,
    gitState,
    enforceCanonicalRoot: false,
    spawn: (command, args) => { invocation = { command, args }; return { status: 0 } },
  })
  assert.equal(invocation.args.find(arg => arg.startsWith('--release-run-id=')), `--release-run-id=${created.session.identity.releaseRunId}`)
  assert.equal(invocation.args.find(arg => arg.startsWith('--version=')), `--version=${created.session.release.version}`)
})
