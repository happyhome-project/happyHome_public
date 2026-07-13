import { CLOUD_RELEASE_COMPONENTS, RELEASE_ACTION_KINDS, classifyReleaseOperations, validateMigrationModulePath } from './release-component-registry.mjs'

export const ALL_CLOUD_FUNCTIONS = CLOUD_RELEASE_COMPONENTS
export const RELEASE_ACTIONS = new Set(Object.keys(RELEASE_ACTION_KINDS))

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^[ADMR]\d*\t(?:[^\t]+\t)?/, '')
}

function changeStatus(value) {
  return String(value || '').match(/^([ADMR])\d*\t/)?.[1] || 'M'
}

function unique(values) {
  return [...new Set(values)].sort()
}

function allCloud(allFunctions, reason) {
  return { functions: [...allFunctions].sort(), mode: 'all', reasons: [reason] }
}

export function classifyReleaseImpact({ changedPaths = [], allFunctions = ALL_CLOUD_FUNCTIONS, functionInputs = {} }) {
  const paths = changedPaths.map((value) => ({ path: normalizePath(value), status: changeStatus(value) }))
  const sharedRootInput = paths.find(({ path }) => path === 'package.json' || path === 'package-lock.json' || path === 'project.config.json')
  const miniprogram = Boolean(sharedRootInput) || paths.some(({ path }) => path.startsWith('miniprogram/'))
  const adminWeb = Boolean(sharedRootInput) || paths.some(({ path }) => path.startsWith('admin-web/'))
  const cloudPaths = paths.filter(({ path }) => path.startsWith('cloud/'))
  let cloud = { functions: [], mode: 'none', reasons: [] }

  const cloudReleaseInput = paths.find(({ path }) => path === 'scripts/lib/cloud-release-probe.mjs')
  const forceAll = sharedRootInput || cloudReleaseInput || cloudPaths.find(({ path, status }) => status === 'D' || status === 'R'
    || path === 'cloud/build.mjs'
    || path === 'cloud/package.json'
    || path === 'cloud/package-lock.json'
    || path === 'cloud/tsconfig.json'
    || path.startsWith('cloud/typings/'))
  if (forceAll) {
    cloud = allCloud(allFunctions, `conservative:${forceAll.path}`)
  } else {
    const direct = cloudPaths
      .map(({ path }) => path.match(/^cloud\/functions\/([^/]+)\//)?.[1])
      .filter(Boolean)
    const shared = cloudPaths.filter(({ path }) => path.startsWith('cloud/lib/') || path.startsWith('cloud/shared/'))
    const functions = new Set(direct)
    const reasons = unique(direct.map((name) => `direct:${name}`))
    for (const { path } of shared) {
      const affected = Object.entries(functionInputs)
        .filter(([, inputs]) => (inputs || []).map(normalizePath).includes(path))
        .map(([name]) => name)
      if (!affected.length) {
        cloud = allCloud(allFunctions, `unmapped:${path}`)
        break
      }
      affected.forEach((name) => functions.add(name))
      reasons.push(`shared:${path}`)
    }
    if (cloud.mode !== 'all' && functions.size) {
      cloud = { functions: unique([...functions]), mode: 'exact', reasons: unique(reasons) }
    }
  }

  return { adminWeb, cloud, miniprogram }
}

export function validateChangeManifests(manifests = []) {
  const changeIds = new Set()
  const migrationIds = new Set()
  for (const manifest of manifests) {
    if (manifest?.schemaVersion !== 1) throw new Error('release change manifest schemaVersion must be 1')
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(manifest.changeId || ''))) throw new Error('release change manifest requires a changeId')
    if (changeIds.has(manifest.changeId)) throw new Error(`duplicate changeId: ${manifest.changeId}`)
    changeIds.add(manifest.changeId)
    for (const action of manifest.actions || []) {
      if (!RELEASE_ACTIONS.has(action)) throw new Error(`unknown action: ${action}`)
    }
    for (const migration of manifest.migrations || []) {
      const id = migration?.id
      if (!id || !migration?.module) throw new Error(`migration requires an id and module in ${manifest.changeId}`)
      validateMigrationModulePath(migration.module)
      if (!/^[a-f0-9]{64}$/i.test(String(migration.inputDigest || ''))) {
        throw new Error(`migration inputDigest is required for ${id}`)
      }
      if (migrationIds.has(id)) throw new Error(`duplicate migration id: ${id}`)
      migrationIds.add(id)
    }
  }
  return { changeIds: [...changeIds], migrationIds: [...migrationIds] }
}

export function selectChangeManifestsForDiff(manifests = [], changedPaths = []) {
  const changed = new Set(changedPaths.map(normalizePath))
  return manifests.filter((manifest) => changed.has(normalizePath(manifest?.source)))
}

export function selectChangeManifests(mode, manifests = [], changedPaths = []) {
  return mode === 'full-current' ? [...manifests] : selectChangeManifestsForDiff(manifests, changedPaths)
}

function needsExternalManifest(changedPaths) {
  return changedPaths.map(normalizePath).some((path) => path.startsWith('scripts/ensure-')
    || path.startsWith('scripts/configure-')
    || path.startsWith('scripts/update-')
    || path.includes('/migrations/')
    || path.includes('/triggers/'))
}

export function createReleasePlan({
  baseSha,
  changedPaths = [],
  forceRedeployCurrent = false,
  allFunctions = ALL_CLOUD_FUNCTIONS,
  functionInputs = {},
  headSha,
  manifests = [],
  mode,
} = {}) {
  if (!headSha) throw new Error('release plan requires headSha')
  if (!['main', 'pr', 'full-current'].includes(mode)) throw new Error(`release plan mode must be main, pr, or full-current; got ${mode || '(missing)'}`)
  if (forceRedeployCurrent && mode !== 'full-current') throw new Error('force-redeploy-current requires full-current mode')
  const manifestSummary = validateChangeManifests(manifests)
  if (needsExternalManifest(changedPaths) && !manifests.length) {
    throw new Error('external release changes require a release/changes manifest')
  }
  const fullCurrent = mode === 'full-current'
  const bootstrap = mode === 'main' && !baseSha
  const planningStrategy = fullCurrent ? 'full-current' : bootstrap ? 'bootstrap' : 'incremental'
  const targets = fullCurrent
    ? { adminWeb: true, cloud: allCloud(allFunctions, 'full-current:explicit'), miniprogram: true }
    : classifyReleaseImpact({ changedPaths, allFunctions, functionInputs })
  if (bootstrap) targets.cloud = allCloud(allFunctions, 'bootstrap:no-production-base')
  const hasRuntimeTarget = targets.cloud.functions.length > 0 || targets.miniprogram || targets.adminWeb
  return {
    baseSha: fullCurrent ? null : baseSha || null,
    bootstrap,
    changeIds: manifestSummary.changeIds,
    changedPaths: changedPaths.map(normalizePath),
    forceRedeployCurrent: forceRedeployCurrent === true,
    headSha,
    manifests,
    mode,
    operationKinds: classifyReleaseOperations(manifests),
    planningStrategy,
    releaseRequired: bootstrap || hasRuntimeTarget || manifests.length > 0,
    targets,
  }
}
