import { createHash } from 'node:crypto'

export const APPROVAL_PREFIX = 'APPROVE TRUSTED WORKFLOW PR '
export const MANIFEST_SCHEMA_VERSION = 1
export const MANIFEST_TTL_MS = 2 * 60 * 60 * 1000
export const VALIDATOR_PATH = '.github/workflows/trusted-workflow-validator.yml'

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

export function buildApprovalPhrase({ prNumber, baseSha, headSha, diffSha256, requestId }) {
  return `${APPROVAL_PREFIX}#${prNumber} BASE ${baseSha} HEAD ${headSha} DIFF ${diffSha256} REQUEST ${requestId}`
}

export function assertAttestation(actual, expected) {
  if (String(actual?.conclusion).toLowerCase() !== 'success') throw new Error('Validator attestation is not successful')
  for (const field of ['schemaVersion', 'prNumber', 'baseSha', 'headSha', 'diffSha256', 'validatorWorkflowSha', 'requestId', 'runId']) {
    if (actual?.[field] !== expected?.[field]) throw new Error(`Validator attestation ${field} mismatch`)
  }
  for (const [name, outcome] of Object.entries(actual?.checks || {})) {
    if (!['passed', 'not-present'].includes(outcome)) throw new Error(`Validator check ${name} did not pass`)
  }
  return actual
}

export function createManifest(input) {
  const createdAt = new Date(input.createdAt || Date.now())
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
    validationOutcomes: input.attestation.checks,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + MANIFEST_TTL_MS).toISOString(),
  }
  manifest.approvalPhrase = buildApprovalPhrase(manifest)
  return manifest
}

export function validateManifest(manifest, current) {
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error('Manifest schema mismatch')
  if (new Date(current.now).getTime() >= new Date(manifest.expiresAt).getTime()) throw new Error('Manifest expired')
  if (current.approval !== manifest.approvalPhrase || current.approval !== buildApprovalPhrase(manifest)) throw new Error('Exact approval phrase mismatch')
  for (const field of ['prNumber', 'baseSha', 'headSha', 'diffSha256', 'validatorWorkflowSha', 'requestId', 'runId']) {
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
  })
  if (JSON.stringify(current.attestation.checks) !== JSON.stringify(manifest.validationOutcomes)) throw new Error('Manifest validation outcomes drift detected')
  return manifest
}

export async function applyAfterValidation({ manifest, current, merge }) {
  validateManifest(manifest, current)
  return merge()
}
