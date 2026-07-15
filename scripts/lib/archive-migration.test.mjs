import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { executeArchiveMigration, planArchiveMigration } from './archive-migration.mjs'
import { validateChangeManifests } from './release-plan.mjs'
import { verifyMigrationInputFile } from './release-component-registry.mjs'

test('plans only evergreen sections and preserves existing topics', () => {
  const input = {
    communityId: 'community-1',
    sections: [
      { _id: 'evergreen-2', communityId: 'community-1', name: '闲置', type: 'evergreen', order: 2 },
      { _id: 'live-1', communityId: 'community-1', name: '活动召集', type: 'realtime', order: 1 },
      { _id: 'evergreen-1', communityId: 'community-1', name: ' #亲子出游 ', type: 'evergreen', order: 1 },
    ],
    posts: [
      { _id: 'post-1', communityId: 'community-1', sectionId: 'evergreen-1', status: 'active', auditStatus: 'pass', topics: ['PET'], createdAt: '2026-07-14T10:00:00.000Z' },
      { _id: 'post-live', communityId: 'community-1', sectionId: 'live-1', status: 'active', auditStatus: 'pass', createdAt: '2026-07-14T11:00:00.000Z' },
    ],
  }

  const plan = planArchiveMigration(input)

  assert.deepEqual(plan.topicUpserts.map((item) => item.displayName), ['亲子出游', '闲置'])
  assert.equal(plan.postUpdates.length, 1)
  assert.deepEqual(plan.postUpdates[0].data.topics, ['PET', '亲子出游'])
  assert.equal(plan.postUpdates[0].data.origin, 'legacy_section')
  assert.equal(plan.topicLinks.length, 2)
  assert.equal(plan.skippedRealtime, 1)
})

test('migration plan is deterministic and warns instead of dropping media-less legacy posts', () => {
  const input = {
    communityId: 'community-1',
    sections: [{ _id: 'section-1', communityId: 'community-1', name: '家书', type: 'evergreen', order: 1 }],
    posts: [{ _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', createdAt: 'invalid' }],
  }

  const first = planArchiveMigration(input)
  const second = planArchiveMigration(input)

  assert.deepEqual(first, second)
  assert.equal(first.postUpdates.length, 1)
  assert.equal(first.postUpdates[0].data.auditStatus, 'pass')
  assert.equal(first.warnings[0].postId, 'post-1')
  assert.match(first.topicLinks[0]._id, /^apt_[a-f0-9]{40}$/)
})

test('archive release manifest uses only executable release operations', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../release/changes/20260714-archive-user-visible.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => validateChangeManifests([manifest]))
  assert.equal(manifest.migrations.length, 1)
  assert.equal(manifest.migrations[0].id, 'archive-posts-v1')
  assert.doesNotThrow(() => verifyMigrationInputFile({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    migration: manifest.migrations[0],
  }))
})

test('archive wrapper repair is a new immutable migration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../release/changes/20260715-archive-posts-wrapper-repair.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => validateChangeManifests([manifest]))
  assert.equal(manifest.migrations.length, 1)
  assert.equal(manifest.migrations[0].id, 'archive-posts-v2-wrapper-repair')
  assert.doesNotThrow(() => verifyMigrationInputFile({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    migration: manifest.migrations[0],
  }))
})

test('archive legacy display projection is a new immutable migration', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../release/changes/20260715-archive-legacy-display-projection.json', import.meta.url), 'utf8'))
  assert.doesNotThrow(() => validateChangeManifests([manifest]))
  assert.equal(manifest.migrations.length, 1)
  assert.equal(manifest.migrations[0].id, 'archive-posts-v3-display-projection')
  assert.doesNotThrow(() => verifyMigrationInputFile({
    root: fileURLToPath(new URL('../..', import.meta.url)),
    migration: manifest.migrations[0],
  }))
})

test('archive migration pins the current migration logic digest', async () => {
  const migrationSource = await readFile(new URL('../../release/migrations/20260715-archive-posts-v1.mjs', import.meta.url), 'utf8')
  const logicBytes = await readFile(new URL('./archive-migration.mjs', import.meta.url))
  const pinnedDigest = migrationSource.match(/ARCHIVE_MIGRATION_LOGIC_SHA256 = '([a-f0-9]{64})'/)?.[1]
  const actualDigest = createHash('sha256').update(logicBytes).digest('hex')

  assert.equal(pinnedDigest, actualDigest)
})

test('archive repair migration pins its executable helper digests', async () => {
  const migrationSource = await readFile(new URL('../../release/migrations/20260715-archive-posts-v2.mjs', import.meta.url), 'utf8')
  const normalizedDigest = async (url) => createHash('sha256').update((await readFile(url, 'utf8')).replace(/\r\n/g, '\n')).digest('hex')
  const pinnedRepairDigest = migrationSource.match(/ARCHIVE_MIGRATION_REPAIR_SHA256 = '([a-f0-9]{64})'/)?.[1]

  assert.equal(pinnedRepairDigest, await normalizedDigest(new URL('./archive-migration-repair.mjs', import.meta.url)))
})

test('archive legacy display migration pins both executable helper digests', async () => {
  const migrationSource = await readFile(new URL('../../release/migrations/20260715-archive-posts-v3-display-projection.mjs', import.meta.url), 'utf8')
  const normalizedDigest = async (url) => createHash('sha256').update((await readFile(url, 'utf8')).replace(/\r\n/g, '\n')).digest('hex')
  const pinnedProjectorDigest = migrationSource.match(/ARCHIVE_LEGACY_PROJECTION_SHA256 = '([a-f0-9]{64})'/)?.[1]
  const pinnedNodeSdkDigest = migrationSource.match(/ARCHIVE_LEGACY_PROJECTION_NODE_SDK_SHA256 = '([a-f0-9]{64})'/)?.[1]

  assert.equal(pinnedProjectorDigest, await normalizedDigest(new URL('./archive-legacy-projection.mjs', import.meta.url)))
  assert.equal(pinnedNodeSdkDigest, await normalizedDigest(new URL('./archive-legacy-projection-node-sdk.mjs', import.meta.url)))
})

test('archive repair entrypoints persist exclusive snapshots and bind apply to the dry-run digest', async () => {
  const cliSource = await readFile(new URL('../repair-archive-posts-wrapper.mjs', import.meta.url), 'utf8')
  const migrationSource = await readFile(new URL('../../release/migrations/20260715-archive-posts-v2.mjs', import.meta.url), 'utf8')

  assert.match(cliSource, /expected-plan-digest/)
  assert.match(cliSource, /flag: 'wx'/)
  assert.match(cliSource, /beforeSha256/)
  assert.match(migrationSource, /before\.json/)
  assert.match(migrationSource, /flag: 'wx'/)
  assert.match(migrationSource, /beforeSha256/)
})

test('archive legacy display entrypoints persist exclusive snapshots and bind apply to reviewed counts and digest', async () => {
  const cliSource = await readFile(new URL('../repair-archive-legacy-projection.mjs', import.meta.url), 'utf8')
  const migrationSource = await readFile(new URL('../../release/migrations/20260715-archive-posts-v3-display-projection.mjs', import.meta.url), 'utf8')

  assert.match(cliSource, /expected-plan-digest/)
  assert.match(cliSource, /expected-changed-posts/)
  assert.match(cliSource, /flag: 'wx'/)
  assert.match(cliSource, /beforeSha256/)
  assert.match(cliSource, /residualPlanDigest/)
  assert.match(migrationSource, /before\.json/)
  assert.match(migrationSource, /flag: 'wx'/)
  assert.match(migrationSource, /beforeSha256/)
  assert.match(migrationSource, /residualPlanDigest/)
})

test('migration preserves administrator topic fields and never writes document ids as data', async () => {
  const input = {
    communityId: 'community-1',
    sections: [{ _id: 'section-1', communityId: 'community-1', name: '亲子出游', type: 'evergreen', order: 1 }],
    posts: [{ _id: 'post-1', communityId: 'community-1', sectionId: 'section-1', status: 'active', createdAt: '2026-07-14T00:00:00.000Z' }],
    archiveTopics: [{ _id: 'existing', communityId: 'community-1', topicKey: '亲子出游', displayName: '周末亲子游', origins: ['admin'], enabled: false, adminOrder: 3 }],
  }
  const writes = []
  await executeArchiveMigration({
    set: async (collection, id, data) => writes.push({ collection, id, data }),
    update: async () => {},
  }, input, { apply: true })
  const topicWrite = writes.find((write) => write.collection === 'archive_topics')
  assert.equal(topicWrite.data.displayName, '周末亲子游')
  assert.deepEqual(topicWrite.data.origins, ['admin', 'legacy'])
  assert.equal(topicWrite.data.enabled, false)
  assert.equal(topicWrite.data.adminOrder, 3)
  assert.equal(Object.hasOwn(topicWrite.data, '_id'), false)
  assert.equal(writes.some((write) => Object.hasOwn(write.data, '_id')), false)
})
