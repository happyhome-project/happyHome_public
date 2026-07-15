import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  applyArchiveLegacyProjectionRepair,
  planArchiveLegacyProjectionRepair,
} from '../../scripts/lib/archive-legacy-projection-node-sdk.mjs'

const ARCHIVE_LEGACY_PROJECTION_SHA256 = '98c1ee3c09a83d1af9ddc7a96a0c1fb69af378cea89000be1436225f2963cbd1'
const ARCHIVE_LEGACY_PROJECTION_NODE_SDK_SHA256 = 'ada25cbda1875873c43d1ee67c01419570468aaa8810cc1d3e9d5ed4a64219ac'

function normalizedTextDigest(url) {
  const text = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  return createHash('sha256').update(text).digest('hex')
}

function verifyDependencies() {
  const dependencies = [
    ['projector', new URL('../../scripts/lib/archive-legacy-projection.mjs', import.meta.url), ARCHIVE_LEGACY_PROJECTION_SHA256],
    ['Node SDK planner', new URL('../../scripts/lib/archive-legacy-projection-node-sdk.mjs', import.meta.url), ARCHIVE_LEGACY_PROJECTION_NODE_SDK_SHA256],
  ]
  for (const [label, url, expected] of dependencies) {
    if (normalizedTextDigest(url) !== expected) throw new Error(`archive-posts-v3 ${label} digest mismatch`)
  }
}

export async function up({ root = process.cwd(), releaseContext } = {}) {
  verifyDependencies()
  const env = String(releaseContext?.envId || process.env.TCB_ENV || '').trim()
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || '').trim()
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || '').trim()
  if (!env || !secretId || !secretKey) {
    throw new Error('archive-posts-v3 requires release env and Tencent Cloud credentials')
  }

  const database = CloudBase.init({ env, secretId, secretKey }).database()
  const plan = await planArchiveLegacyProjectionRepair(database)
  if (plan.summary.emptyTitleCount !== 0) {
    throw new Error(`archive-posts-v3 refuses to apply ${plan.summary.emptyTitleCount} empty-title posts`)
  }
  const evidenceRoot = resolve(root, '.codex-local', 'release-evidence')
  const evidenceDir = resolve(evidenceRoot, `archive-posts-v3-${Date.now()}-${process.pid}`)
  await mkdir(evidenceRoot, { recursive: true })
  await mkdir(evidenceDir)
  const beforePayload = `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    envId: env,
    summary: plan.summary,
    records: plan.backup,
  }, null, 2)}\n`
  const beforePath = resolve(evidenceDir, 'before.json')
  await writeFile(beforePath, beforePayload, { encoding: 'utf8', flag: 'wx' })
  const persistedBefore = await readFile(beforePath)
  const beforeSha256 = createHash('sha256').update(persistedBefore).digest('hex')
  if (createHash('sha256').update(beforePayload).digest('hex') !== beforeSha256) {
    throw new Error('archive-posts-v3 before snapshot readback mismatch')
  }
  const summary = await applyArchiveLegacyProjectionRepair(database, plan)
  await writeFile(resolve(evidenceDir, 'after.json'), `${JSON.stringify({
    schemaVersion: 1,
    verifiedAt: new Date().toISOString(),
    envId: env,
    beforeSha256,
    planDigest: plan.summary.planDigest,
    residualPlanDigest: summary.residualPlanDigest,
    summary,
  }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(`[archive-posts-v3] ${JSON.stringify(summary)}`)
}
