import { createHash } from 'node:crypto'

export const APPROVAL_PREFIX = 'APPROVE TRUSTED WORKFLOW PR '
export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_TTL_MS = 2 * 60 * 60 * 1000
export const VALIDATOR_PATH = '.github/workflows/trusted-workflow-validator.yml'
export const REQUIRED_VALIDATOR_CHECKS = Object.freeze([
  'cloudTest', 'cloudBuild', 'adminTypecheck', 'adminBuild', 'miniprogramTypecheck',
  'miniprogramUnit', 'miniprogramBuild', 'deployOutput', 'governance', 'diffCheck', 'releasePlan', 'docs',
])

const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/i
const TRUST_ROOT_PATHS = new Set([
  VALIDATOR_PATH,
  'scripts/integrate-workflow-pr.mjs',
  'scripts/lib/trusted-workflow-policy.mjs',
  'scripts/lib/integrate-pr-policy.mjs',
  'package.json',
  'AGENTS.md',
])

export function assertWorkflowPaths(paths) {
  const normalized = [...paths].map((path) => String(path).replace(/\\/g, '/')).sort()
  if (!normalized.length) throw new Error('PR must change at least one workflow YAML file')
  for (const path of normalized) {
    if (TRUST_ROOT_PATHS.has(path)) throw new Error(`Candidate modifies integration trust root ${path}; trust roots cannot self-validate`)
    if (!WORKFLOW_PATH.test(path)) throw new Error(`Candidate may change only workflow YAML files; got ${path}`)
  }
  return normalized
}

export function hashWorkflowDiff(binaryDiff) {
  return createHash('sha256').update(binaryDiff).digest('hex')
}

export function discoverWorkflowCandidate({ root, baseSha, headSha, runCommand }) {
  const changedOutput = runCommand('git', ['diff', '--no-renames', '--name-only', baseSha, headSha], { cwd: root, encoding: 'utf8' })
  const changedPaths = assertWorkflowPaths(String(changedOutput || '').trim().split(/\r?\n/).filter(Boolean))
  const binaryDiff = runCommand('git', ['diff', '--binary', '--no-ext-diff', '--no-renames', baseSha, headSha], { cwd: root, encoding: 'buffer' })
  return { changedPaths, diffSha256: hashWorkflowDiff(binaryDiff) }
}

export function buildApprovalPhrase(manifest) {
  const { prNumber, baseSha, headSha, diffSha256, requestId } = manifest
  return `${APPROVAL_PREFIX}#${prNumber} BASE ${baseSha} HEAD ${headSha} DIFF ${diffSha256} REQUEST ${requestId} RUN_CREATED ${manifest.runCreatedAt} VALIDATED ${manifest.validatedAt} CREATED ${manifest.createdAt} EXPIRES ${manifest.expiresAt}`
}

export function assertAttestation(actual, expected) {
  if (String(actual?.conclusion).toLowerCase() !== 'success') throw new Error('Validator attestation is not successful')
  for (const field of ['schemaVersion', 'prNumber', 'baseSha', 'headSha', 'diffSha256', 'validatorWorkflowSha', 'requestId', 'runId', 'validatedAt']) {
    if (actual?.[field] !== expected?.[field]) throw new Error(`Validator attestation ${field} mismatch`)
  }
  const names = Object.keys(actual?.checks || {}).sort()
  if (JSON.stringify(names) !== JSON.stringify([...REQUIRED_VALIDATOR_CHECKS].sort())) throw new Error('Required validator check set is incomplete or unexpected')
  for (const name of REQUIRED_VALIDATOR_CHECKS) {
    const allowed = ['docs', 'releasePlan'].includes(name) ? ['passed', 'not-present'] : ['passed']
    if (!allowed.includes(actual.checks[name])) throw new Error(`Required validator check ${name} did not pass`)
  }
  return actual
}

export function createManifest(input) {
  const createdAt = new Date(input.createdAt || input.attestation?.validatedAt)
  if (!Number.isFinite(createdAt.getTime()) || input.attestation?.validatedAt !== createdAt.toISOString()) throw new Error('Manifest createdAt must derive exactly from attestation validatedAt')
  if (!Number.isFinite(new Date(input.runCreatedAt).getTime())) throw new Error('Trusted validator run timestamp is invalid')
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    prNumber: input.prNumber,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: assertWorkflowPaths(input.changedPaths),
    diffSha256: input.diffSha256,
    validatorWorkflowSha: input.validatorWorkflowSha,
    requestId: input.requestId,
    runId: input.runId,
    runCreatedAt: input.runCreatedAt,
    validatedAt: input.attestation.validatedAt,
    validationOutcomes: input.attestation.checks,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + MANIFEST_TTL_MS).toISOString(),
  }
  manifest.approvalPhrase = buildApprovalPhrase(manifest)
  return manifest
}

export function validateManifest(manifest, current) {
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error('Manifest schema mismatch')
  const createdMs = new Date(manifest.createdAt).getTime()
  const expiresMs = new Date(manifest.expiresAt).getTime()
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs - createdMs !== MANIFEST_TTL_MS) throw new Error('Manifest timestamps must be exactly two hours apart')
  if (manifest.createdAt !== manifest.validatedAt || manifest.runCreatedAt !== current.runCreatedAt || manifest.validatedAt !== current.attestation?.validatedAt) throw new Error('Manifest timestamps do not match trusted run and attestation timestamps')
  if (new Date(manifest.runCreatedAt).getTime() > createdMs) throw new Error('Validator run timestamp is after attestation timestamp')
  if (new Date(current.now).getTime() >= new Date(manifest.expiresAt).getTime()) throw new Error('Manifest expired')
  if (current.approval !== manifest.approvalPhrase || current.approval !== buildApprovalPhrase(manifest)) throw new Error('Exact approval phrase mismatch')
  for (const field of ['prNumber', 'baseSha', 'headSha', 'diffSha256', 'validatorWorkflowSha', 'requestId', 'runId', 'runCreatedAt']) {
    if (current[field] !== manifest[field]) throw new Error(`Manifest ${field} drift detected`)
  }
  if (JSON.stringify(assertWorkflowPaths(current.changedPaths)) !== JSON.stringify(manifest.changedPaths)) throw new Error('Manifest changedPaths drift detected')
  assertAttestation(current.attestation, {
    schemaVersion: manifest.schemaVersion,
    prNumber: manifest.prNumber,
    baseSha: manifest.baseSha,
    headSha: manifest.headSha,
    diffSha256: manifest.diffSha256,
    validatorWorkflowSha: manifest.validatorWorkflowSha,
    requestId: manifest.requestId,
    runId: manifest.runId,
    validatedAt: manifest.validatedAt,
  })
  if (JSON.stringify(current.attestation.checks) !== JSON.stringify(manifest.validationOutcomes)) throw new Error('Manifest validation outcomes drift detected')
  return manifest
}

export async function applyAfterValidation({ manifest, current, merge }) {
  validateManifest(manifest, current)
  return merge()
}

export function findValidatorRun(runs, requestId, validatorWorkflowSha) {
  const run = runs.find((item) => String(item.displayTitle || '').includes(requestId))
  if (!run) throw new Error(`Validator run for request ${requestId} was not found`)
  if (String(run.status).toLowerCase() !== 'completed' || String(run.conclusion).toLowerCase() !== 'success') throw new Error('Validator run was not successful')
  if (run.headSha !== validatorWorkflowSha) throw new Error('Validator run did not use the expected main definition SHA')
  if (!Number.isFinite(new Date(run.createdAt).getTime())) throw new Error('Validator run createdAt is missing')
  return run
}

export async function executeTrustedApply({ manifest, current, refreshBase, readPullRequest, merge, pull }) {
  validateManifest(manifest, current)
  const latestBase = await refreshBase()
  if (latestBase !== manifest.baseSha) throw new Error(`PR base advanced from ${manifest.baseSha} to ${latestBase}`)
  const pr = await readPullRequest()
  if (pr.state !== 'OPEN' || pr.isDraft || pr.baseRefName !== 'main' || pr.baseRefOid !== manifest.baseSha || pr.headRefOid !== manifest.headSha) throw new Error('Server PR identity drift detected')
  if (pr.mergeStateStatus !== 'CLEAN') throw new Error(`Server PR is not up-to-date and clean; got ${pr.mergeStateStatus || '(missing)'}`)
  await merge()
  await pull()
}

export async function withIntegrationLock(acquire, work) {
  const release = await acquire()
  try { return await work() } finally { await release() }
}

export async function obtainVerifiedAttestation({ downloadArtifact, readArtifact, expected }) {
  await downloadArtifact()
  const attestation = await readArtifact()
  return assertAttestation(attestation, expected)
}
