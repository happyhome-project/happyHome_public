#!/usr/bin/env node
import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import {
  applyArchiveLegacyProjectionRepair,
  planArchiveLegacyProjectionRepair,
} from './lib/archive-legacy-projection-node-sdk.mjs'
import { withValidationLease } from './lib/validation-lease.mjs'

function flag(name) {
  const prefix = `--${name}=`
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || ''
}

function expectedCount(name) {
  const raw = flag(name)
  if (!/^\d+$/.test(raw)) throw new Error(`--${name}=<non-negative integer> is required with --apply`)
  return Number(raw)
}

function assertBackupDirectory(value) {
  const root = resolve(process.cwd())
  const target = resolve(root, value)
  const local = relative(root, target).replace(/\\/g, '/')
  if (!local.startsWith('.codex-local/archive-repair/')) {
    throw new Error('--backup-dir must be inside .codex-local/archive-repair/')
  }
  return target
}

async function run() {
  const apply = process.argv.includes('--apply')
  const credentials = resolveCloudBaseReleaseCredentials()
  const database = CloudBase.init({
    env: credentials.envId,
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
  }).database()
  const plan = await planArchiveLegacyProjectionRepair(database)
  console.log(`[archive-legacy-projection:plan] ${JSON.stringify(plan.summary)}`)
  if (!apply) return

  const expectedPlanDigest = flag('expected-plan-digest')
  if (!/^[a-f0-9]{64}$/.test(expectedPlanDigest)) throw new Error('--expected-plan-digest=<sha256> is required with --apply')
  if (plan.summary.planDigest !== expectedPlanDigest) {
    throw new Error(`archive legacy projection plan changed after dry-run: expected ${expectedPlanDigest}, got ${plan.summary.planDigest}`)
  }
  const expectedChangedPosts = expectedCount('expected-changed-posts')
  if (plan.summary.changedPostCount !== expectedChangedPosts) {
    throw new Error(`changedPostCount changed after dry-run: expected ${expectedChangedPosts}, got ${plan.summary.changedPostCount}`)
  }
  if (plan.summary.emptyTitleCount !== 0) {
    throw new Error(`archive legacy projection refuses to apply ${plan.summary.emptyTitleCount} empty-title posts`)
  }

  const backupDir = assertBackupDirectory(flag('backup-dir'))
  await mkdir(dirname(backupDir), { recursive: true })
  await mkdir(backupDir)
  const beforePayload = `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    envId: credentials.envId,
    summary: plan.summary,
    records: plan.backup,
  }, null, 2)}\n`
  const beforePath = resolve(backupDir, 'before.json')
  await writeFile(beforePath, beforePayload, { encoding: 'utf8', flag: 'wx' })
  const persistedBefore = await readFile(beforePath)
  const beforeSha256 = createHash('sha256').update(persistedBefore).digest('hex')
  if (createHash('sha256').update(beforePayload).digest('hex') !== beforeSha256) {
    throw new Error('archive legacy projection before snapshot readback mismatch')
  }

  const result = await applyArchiveLegacyProjectionRepair(database, plan)
  await writeFile(resolve(backupDir, 'after.json'), `${JSON.stringify({
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    envId: credentials.envId,
    beforeSha256,
    planDigest: plan.summary.planDigest,
    residualPlanDigest: result.residualPlanDigest,
    result,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`[archive-legacy-projection:applied] ${JSON.stringify(result)}`)
}

if (process.argv.includes('--apply')) {
  await withValidationLease({ command: 'repair-archive-legacy-projection' }, run)
} else {
  await run()
}
