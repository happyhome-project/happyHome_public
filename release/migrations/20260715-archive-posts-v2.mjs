import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { applyArchiveMigrationRepair, planArchiveMigrationRepair } from '../../scripts/lib/archive-migration-repair.mjs'

const ARCHIVE_MIGRATION_REPAIR_SHA256 = '5b6c57be8e4b979a99286714506428d15241e459c9660872ab0312cc569f4d4b'

function normalizedTextDigest(url) {
  const text = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(text).digest('hex')
}

function verifyDependencies() {
  const dependencies = [
    ['archive repair orchestration', new URL('../../scripts/lib/archive-migration-repair.mjs', import.meta.url), ARCHIVE_MIGRATION_REPAIR_SHA256],
  ]
  for (const [label, url, expected] of dependencies) {
    if (normalizedTextDigest(url) !== expected) throw new Error(`archive-posts-v2 ${label} digest mismatch`)
  }
}

export async function up({ root = process.cwd(), releaseContext } = {}) {
  verifyDependencies()
  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) {
    throw new Error('archive-posts-v2 requires release env and Tencent Cloud credentials')
  }

  const database = CloudBase.init({ env, secretId, secretKey }).database()
  const repair = await planArchiveMigrationRepair(database)
  const evidenceRoot = resolve(root, '.codex-local', 'release-evidence')
  const evidenceDir = resolve(evidenceRoot, `archive-posts-v2-${Date.now()}-${process.pid}`)
  await mkdir(evidenceRoot, { recursive: true })
  await mkdir(evidenceDir)
  const beforePayload = `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    envId: env,
    summary: repair.summary,
    records: repair.backup,
  }, null, 2)}\n`
  const beforePath = resolve(evidenceDir, 'before.json')
  await writeFile(beforePath, beforePayload, { encoding: 'utf8', flag: 'wx' })
  const persistedBefore = await readFile(beforePath)
  const beforeSha256 = createHash('sha256').update(persistedBefore).digest('hex')
  if (createHash('sha256').update(beforePayload).digest('hex') !== beforeSha256) {
    throw new Error('archive-posts-v2 before snapshot readback mismatch')
  }
  const summary = await applyArchiveMigrationRepair(database, repair)
  await writeFile(resolve(evidenceDir, 'after.json'), `${JSON.stringify({
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    envId: env,
    beforeSha256,
    planDigest: repair.summary.planDigest,
    summary,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`[archive-posts-v2] ${JSON.stringify(summary)}`)
}
