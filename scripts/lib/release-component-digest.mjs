import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const DIGEST_SCHEMA_VERSION = 1

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalPath(value) {
  return String(value).replace(/\\/g, '/')
}

export function createReleaseBuildConfigurationDigest(configuration = {}) {
  const canonical = Object.fromEntries(Object.entries(configuration).sort(([left], [right]) => left.localeCompare(right)))
  return sha256(JSON.stringify(canonical))
}

function inside(root, path) {
  const rel = relative(root, path)
  if (!rel || rel === '.') return '.'
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error('release component digest input must stay inside the repository root')
  }
  return canonicalPath(rel)
}

async function fileRecord(root, input, kind) {
  const path = resolve(root, input)
  const local = inside(root, path)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`release component digest ${kind} input must be an ordinary file: ${local}`)
  const resolvedRoot = await realpath(root)
  const resolvedPath = await realpath(path)
  inside(resolvedRoot, resolvedPath)
  const content = await readFile(resolvedPath)
  return { kind, path: local, size: content.length, sha256: sha256(content) }
}

export async function createReleaseComponentDigest({ root, component, sourcePaths = [], configPaths = [], lockfilePath, builderVersion } = {}) {
  if (!root || !component || !lockfilePath || !builderVersion) throw new Error('release component digest requires root component lockfile and builder version')
  if (!sourcePaths.length) throw new Error(`release component digest requires source inputs for ${component}`)
  const records = await Promise.all([
    ...sourcePaths.map((path) => fileRecord(resolve(root), path, 'source')),
    ...configPaths.map((path) => fileRecord(resolve(root), path, 'config')),
    fileRecord(resolve(root), lockfilePath, 'lockfile'),
  ])
  records.sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`))
  return sha256(JSON.stringify({ schemaVersion: DIGEST_SCHEMA_VERSION, component, builderVersion, records }))
}

async function runtimeRecords(root, directory = root, prefix = '', excluded = new Set()) {
  const records = []
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    const local = prefix ? `${prefix}/${entry.name}` : entry.name
    if (excluded.has(local)) continue
    if (entry.isSymbolicLink()) throw new Error(`runtime manifest rejects symbolic link or reparse entry: ${local}`)
    if (entry.isDirectory()) records.push(...await runtimeRecords(root, path, local, excluded))
    else if (entry.isFile()) {
      const content = await readFile(path)
      records.push({ path: canonicalPath(local), size: content.length, sha256: sha256(content) })
    } else throw new Error(`runtime manifest rejects unsupported entry: ${local}`)
  }
  return records
}

export async function collectComponentSourcePaths(inputRoot, { excludeDirectories = [], excludeFiles = [] } = {}) {
  const root = resolve(inputRoot)
  const excluded = new Set(excludeDirectories)
  const excludedFiles = new Set(excludeFiles.map(canonicalPath))
  const files = []
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`component source collection rejects symbolic link or reparse entry: ${inside(root, path)}`)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) {
        if (!excludedFiles.has(canonicalPath(inside(root, path)))) files.push(path)
      }
      else throw new Error(`component source collection rejects unsupported entry: ${inside(root, path)}`)
    }
  }
  await walk(root)
  return files
}

export async function createRuntimeFileManifest(artifactRoot, { exclude = [] } = {}) {
  const root = resolve(artifactRoot)
  await realpath(root)
  const files = await runtimeRecords(root, root, '', new Set(exclude.map(canonicalPath)))
  const body = { schemaVersion: DIGEST_SCHEMA_VERSION, files }
  return { ...body, runtimeDigest: sha256(JSON.stringify(body)) }
}

export async function verifyRuntimeFileManifest(artifactRoot, manifest) {
  try {
    const actual = await createRuntimeFileManifest(artifactRoot, { exclude: ['__release.info.json', '.happyhome-runtime-manifest.json'] })
    return manifest?.schemaVersion === DIGEST_SCHEMA_VERSION && actual.runtimeDigest === manifest.runtimeDigest &&
      JSON.stringify(actual.files) === JSON.stringify(manifest.files)
  } catch {
    return false
  }
}
