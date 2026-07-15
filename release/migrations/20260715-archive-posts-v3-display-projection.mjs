import CloudBase from '@cloudbase/node-sdk'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  applyArchiveLegacyProjectionRepair,
  planArchiveLegacyProjectionRepair,
} from '../../scripts/lib/archive-legacy-projection-node-sdk.mjs'

const ARCHIVE_LEGACY_PROJECTION_SHA256 = '9a7f480c9aacd7b54b1a204e88851c9a59ddde44e9343e4f828741f98c08917c'
const ARCHIVE_LEGACY_PROJECTION_NODE_SDK_SHA256 = 'eb4431a25de7197814495e13b1c3642578559e7d216659926b1572791d7b1501'

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
