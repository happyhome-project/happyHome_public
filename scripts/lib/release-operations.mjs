import { RELEASE_ACTIONS } from './release-plan.mjs'
import { classifyReleaseOperations, validateMigrationModulePath } from './release-component-registry.mjs'
export const POST_DEPLOY_RELEASE_ACTIONS = new Set(['verify-post-rag-timer','backfill-post-rag-v2','eval-post-semantic-search'])

function unique(values) {
  return [...new Set(values)]
}
const ACTION_ORDER=['ensure-indexes','ensure-tencent-rag-index','configure-rag-network','update-rag-env','configure-rag-workers','verify-post-rag-timer','backfill-post-rag-v2','eval-post-semantic-search']
function orderedActions(values){return unique(values).sort((a,b)=>{const ai=ACTION_ORDER.indexOf(a),bi=ACTION_ORDER.indexOf(b);return(ai<0?999:ai)-(bi<0?999:bi)})}

function migrationEntries(manifests) {
  return manifests.flatMap((manifest) => (manifest.migrations || []).map((migration) => ({ ...migration, changeId: manifest.changeId })))
}

export async function executeReleaseOperations({
  appliedMigrations = {},
  completedActions = new Set(),
  guard,
  manifests = [],
  runAction,
  runMigration,
} = {}) {
  if (!guard?.beforeRemoteMutation || !guard?.recordStage || !guard?.recordMigration) throw new Error('release operations require a production release guard')
  if (typeof runAction !== 'function' || typeof runMigration !== 'function') throw new Error('release operations require action and migration runners')

  const actions = orderedActions(manifests.flatMap((manifest) => manifest.actions || []))
  for (const action of actions) {
    if (!RELEASE_ACTIONS.has(action)) throw new Error(`unknown action: ${action}`)
    if (POST_DEPLOY_RELEASE_ACTIONS.has(action) || completedActions.has(action)) continue
    await guard.beforeRemoteMutation(`action:${action}`)
    await runAction(action)
    await guard.recordStage(`action:${action}`)
  }

  const migrations = []
  for (const migration of migrationEntries(manifests)) {
    if (!migration?.id || !migration?.module) throw new Error(`migration requires id and module in ${migration?.changeId || 'manifest'}`)
    validateMigrationModulePath(migration.module)
    if (!/^[a-f0-9]{64}$/i.test(String(migration.inputDigest || ''))) throw new Error(`migration inputDigest is required for ${migration.id}`)
    const applied = appliedMigrations instanceof Map
      ? appliedMigrations.get(migration.id)
      : appliedMigrations instanceof Set
        ? (appliedMigrations.has(migration.id) ? {} : null)
        : appliedMigrations?.[migration.id]
    if (applied) {
      if (!applied.inputDigest) throw new Error(`applied migration ${migration.id} has no inputDigest; refusing to guess or rerun`)
      if (applied.inputDigest !== migration.inputDigest) throw new Error(`applied migration ${migration.id} inputDigest mismatch`)
      continue
    }
    await guard.beforeRemoteMutation(`migration:${migration.id}`)
    await runMigration(migration)
    await guard.recordMigration({ id: migration.id, inputDigest: migration.inputDigest, module: migration.module })
    const record = { inputDigest: migration.inputDigest, module: migration.module }
    if (appliedMigrations instanceof Map) appliedMigrations.set(migration.id, record)
    else if (!(appliedMigrations instanceof Set)) appliedMigrations[migration.id] = record
    await guard.recordStage(`migration:${migration.id}`)
    migrations.push(migration.id)
  }
  return {
    actions: actions.filter(action => !POST_DEPLOY_RELEASE_ACTIONS.has(action) && !completedActions.has(action)),
    deferredActions: actions.filter(action => POST_DEPLOY_RELEASE_ACTIONS.has(action)),
    migrations,
    operationKinds: classifyReleaseOperations(manifests),
    ...(completedActions.size ? { completedActions: actions.filter(action => completedActions.has(action)) } : {}),
  }
}
