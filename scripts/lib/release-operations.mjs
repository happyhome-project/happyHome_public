import { RELEASE_ACTIONS } from './release-plan.mjs'

function unique(values) {
  return [...new Set(values)]
}

function migrationEntries(manifests) {
  return manifests.flatMap((manifest) => (manifest.migrations || []).map((migration) => ({ ...migration, changeId: manifest.changeId })))
}

export async function executeReleaseOperations({
  appliedMigrations = new Set(),
  guard,
  manifests = [],
  runAction,
  runMigration,
} = {}) {
  if (!guard?.beforeRemoteMutation || !guard?.recordStage || !guard?.recordMigration) throw new Error('release operations require a production release guard')
  if (typeof runAction !== 'function' || typeof runMigration !== 'function') throw new Error('release operations require action and migration runners')

  const actions = unique(manifests.flatMap((manifest) => manifest.actions || []))
  for (const action of actions) {
    if (!RELEASE_ACTIONS.has(action)) throw new Error(`unknown action: ${action}`)
    await guard.beforeRemoteMutation(`action:${action}`)
    await runAction(action)
    await guard.recordStage(`action:${action}`)
  }

  const migrations = []
  for (const migration of migrationEntries(manifests)) {
    if (!migration?.id || !migration?.module) throw new Error(`migration requires id and module in ${migration?.changeId || 'manifest'}`)
    if (!String(migration.module).startsWith('release/migrations/') || !String(migration.module).endsWith('.mjs')) {
      throw new Error(`migration module must be under release/migrations: ${migration.module}`)
    }
    if (appliedMigrations.has(migration.id)) continue
    await guard.beforeRemoteMutation(`migration:${migration.id}`)
    await runMigration(migration)
    await guard.recordMigration(migration.id)
    appliedMigrations.add(migration.id)
    await guard.recordStage(`migration:${migration.id}`)
    migrations.push(migration.id)
  }
  return { actions, migrations }
}
