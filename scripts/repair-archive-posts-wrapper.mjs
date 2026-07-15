#!/usr/bin/env node
import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

import { resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import { applyArchiveMigrationRepair, planArchiveMigrationRepair } from './lib/archive-migration-repair.mjs'

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

const apply = process.argv.includes('--apply')
const credentials = resolveCloudBaseReleaseCredentials()
const database = CloudBase.init({ env: credentials.envId, secretId: credentials.secretId, secretKey: credentials.secretKey }).database()
const repair = await planArchiveMigrationRepair(database)
console.log(`[archive-repair:plan] ${JSON.stringify(repair.summary)}`)

if (apply) {
  const expectedPlanDigest = flag('expected-plan-digest')
  if (!/^[a-f0-9]{64}$/.test(expectedPlanDigest)) throw new Error('--expected-plan-digest=<sha256> is required with --apply')
  if (repair.summary.planDigest !== expectedPlanDigest) {
    throw new Error(`archive repair plan changed after dry-run: expected ${expectedPlanDigest}, got ${repair.summary.planDigest}`)
  }
  const expected = {
    malformedTopicCount: expectedCount('expected-malformed-topics'),
    malformedPostCount: expectedCount('expected-malformed-posts'),
    malformedLinkCount: expectedCount('expected-malformed-links'),
  }
  for (const [key, value] of Object.entries(expected)) {
    if (repair.summary[key] !== value) throw new Error(`${key} changed after dry-run: expected ${value}, got ${repair.summary[key]}`)
  }
  const backupDir = assertBackupDirectory(flag('backup-dir'))
  await mkdir(dirname(backupDir), { recursive: true })
  await mkdir(backupDir)
  const beforePayload = `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    envId: credentials.envId,
    summary: repair.summary,
    records: repair.backup,
  }, null, 2)}\n`
  const beforePath = resolve(backupDir, 'before.json')
  await writeFile(beforePath, beforePayload, { encoding: 'utf8', flag: 'wx' })
  const persistedBefore = await readFile(beforePath)
  const beforeSha256 = createHash('sha256').update(persistedBefore).digest('hex')
  if (createHash('sha256').update(beforePayload).digest('hex') !== beforeSha256) throw new Error('archive repair before snapshot readback mismatch')
  const result = await applyArchiveMigrationRepair(database, repair)
  await writeFile(resolve(backupDir, 'after.json'), `${JSON.stringify({
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    envId: credentials.envId,
    beforeSha256,
    planDigest: repair.summary.planDigest,
    result,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`[archive-repair:applied] ${JSON.stringify(result)}`)
}
