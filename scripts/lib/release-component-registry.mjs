import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const CLOUD_RELEASE_COMPONENTS = Object.freeze([
  'admin', 'community', 'home-prefetch', 'http-gateway', 'member',
  'post', 'post-rag-worker', 'post-video-rag-worker', 'section', 'user',
])

export const RELEASE_COMPONENTS = Object.freeze([
  ...CLOUD_RELEASE_COMPONENTS.map((name) => `cloud:${name}`),
  'admin-web',
  'miniprogram',
])

export const CLOUD_COMPONENT_CONFIG_INPUTS = Object.freeze([
  'cloud/build.mjs',
  'cloud/package.json',
  'cloud/tsconfig.json',
  'scripts/lib/cloud-release-probe.mjs',
  'package.json',
  'project.config.json',
])

export const RELEASE_ACTION_KINDS = Object.freeze({
  'ensure-indexes': 'desired-state',
  'ensure-tencent-rag-index': 'desired-state',
  'configure-rag-network': 'desired-state',
  'configure-rag-workers': 'desired-state',
  'update-rag-env': 'desired-state',
  'backfill-post-rag-v2': 'desired-state',
  'verify-post-rag-timer': 'verification',
  'eval-post-semantic-search': 'verification',
})

export function classifyReleaseActionKind(action) {
  const kind = RELEASE_ACTION_KINDS[action]
  if (!kind) throw new Error(`unknown action: ${action}`)
  return kind
}

export function classifyReleaseOperations(manifests = []) {
  const kinds = { 'desired-state': new Set(), migration: new Set(), verification: new Set() }
  for (const manifest of manifests) {
    for (const action of manifest.actions || []) kinds[classifyReleaseActionKind(action)].add(action)
    for (const migration of manifest.migrations || []) {
      if (migration?.id) kinds.migration.add(migration.id)
    }
  }
  return Object.fromEntries(Object.entries(kinds).map(([kind, values]) => [kind, [...values].sort()]))
}

export function createMigrationInputDigest({ id, module, moduleBytes } = {}) {
  if (!id || !module || moduleBytes == null) throw new Error('migration input digest requires id module and module bytes')
  const sha256 = (value) => createHash('sha256').update(value).digest('hex')
  return sha256(JSON.stringify({ schemaVersion: 1, id, module, moduleSha256: sha256(moduleBytes) }))
}

export function validateMigrationModulePath(value) {
  const module = String(value || '').replace(/\\/g, '/')
  if (!/^release\/migrations\/[a-zA-Z0-9._/-]+\.mjs$/.test(module) || module.split('/').some((part) => part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw new Error(`migration module must be a confined .mjs file under release/migrations: ${value || '(missing)'}`)
  }
  return module
}

function assertNoLinkPathSync(basePath, inputPath, message) {
  const absoluteBase = resolve(basePath)
  const absolutePath = resolve(inputPath)
  let current = absoluteBase
  if (lstatSync(current).isSymbolicLink()) throw new Error(message)
  for (const segment of relative(absoluteBase, absolutePath).split(sep).filter(Boolean)) {
    current = join(current, segment)
    if (lstatSync(current).isSymbolicLink()) throw new Error(message)
  }
}

export function assertConfinedMigrationRealpath(canonicalRoot, canonicalPath, module = '', pathApi = {}) {
  const relativePath = pathApi.relative || relative
  const isAbsolutePath = pathApi.isAbsolute || isAbsolute
  const separator = pathApi.sep || sep
  const confined = relativePath(canonicalRoot, canonicalPath)
  if (!confined || isAbsolutePath(confined) || confined === '..' || confined.startsWith(`..${separator}`)) {
    throw new Error(`migration module escapes release/migrations: ${module}`)
  }
  return confined
}

export function readVerifiedMigrationInputFile({ root, migration } = {}) {
  const module = validateMigrationModulePath(migration?.module)
  const migrationRoot = resolve(root, 'release', 'migrations')
  const modulePath = resolve(root, module)
  assertNoLinkPathSync(migrationRoot, modulePath, `migration module rejects symbolic link junction or reparse path: ${module}`)
  const moduleStat = lstatSync(modulePath)
  if (!moduleStat.isFile() || moduleStat.isSymbolicLink()) throw new Error(`migration module must be an ordinary file: ${module}`)
  assertConfinedMigrationRealpath(realpathSync(migrationRoot), realpathSync(modulePath), module)
  return { module, moduleBytes: readFileSync(modulePath), modulePath }
}

export function verifyMigrationInputFile({ root, migration } = {}) {
  const { module, moduleBytes, modulePath } = readVerifiedMigrationInputFile({ root, migration })
  const actual = createMigrationInputDigest({ id: migration.id, module, moduleBytes })
  if (actual !== migration.inputDigest) throw new Error(`migration ${migration.id} inputDigest does not match actual module bytes`)
  return modulePath
}
