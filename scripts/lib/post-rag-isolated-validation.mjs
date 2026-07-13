import { createHash, timingSafeEqual } from 'node:crypto'

const RUN_ID = /^[A-Za-z0-9_-]{1,40}$/
const FUNCTION_NAME = /^post-rag-validate-[a-f0-9]{8}$/
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/

function requireSafeId(label, value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${label} is invalid`)
  return value
}

export function createValidationIdentity(head, runId) {
  if (typeof head !== 'string' || !/^[a-f0-9]{7,64}$/i.test(head)) throw new Error('head is invalid')
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('runId is invalid')
  const digest = createHash('sha256').update(`${head}:${runId}`).digest('hex').slice(0, 8)
  return Object.freeze({ functionName: `post-rag-validate-${digest}`, runId })
}

export function createProbeFixtureIds(runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('runId is invalid')
  const suffix = createHash('sha256').update(runId).digest('hex').slice(0, 24)
  return { sectionId: `rag_timer_section_${suffix}`, postId: `rag_timer_post_${suffix}` }
}

export function assertValidationIdentity(identity) {
  if (!identity || !FUNCTION_NAME.test(String(identity.functionName || '')) || !RUN_ID.test(String(identity.runId || ''))) {
    throw new Error('validation identity is invalid')
  }
  return true
}

export function assertProbeOwnedId(actual, expected) {
  const actualId = requireSafeId('actual id', actual)
  const expectedId = requireSafeId('expected id', expected)
  if (!expectedId.startsWith('rag_timer_') || actualId !== expectedId) {
    throw new Error('validation binding mismatch')
  }
  return true
}

export function selectExactCandidates(boundIds, availableIds) {
  if (!Array.isArray(boundIds) || boundIds.length !== 1) throw new Error('exactly one bound candidate is required')
  const boundId = requireSafeId('bound candidate', boundIds[0])
  if (!Array.isArray(availableIds)) throw new Error('available candidates are invalid')
  const seen = new Set()
  for (const candidate of availableIds) {
    const id = requireSafeId('available candidate', candidate)
    if (id === boundId) seen.add(id)
  }
  return [...seen]
}

export function constantTimeTokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  const actualDigest = createHash('sha256').update(actual).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(actualDigest, expectedDigest) && actual.length === expected.length
}

export function assertIndependentValidationTokens(validationToken, timerToken) {
  if (typeof validationToken !== 'string' || validationToken.length < 16
    || typeof timerToken !== 'string' || timerToken.length < 16) throw new Error('validation tokens are invalid')
  if (constantTimeTokenMatches(validationToken, timerToken)) throw new Error('validation and timer tokens must be independent')
  return true
}

export function sanitizeValidationEvidence(value) {
  const baseline = Number(value?.baseline?.nonProbeCount ?? value?.residue?.nonProbeCount)
  const finalCount = Number(value?.residue?.nonProbeCount)
  return {
    schemaVersion: 1,
    status: 'passed',
    functionName: String(value?.identity?.functionName || ''),
    runId: String(value?.identity?.runId || ''),
    postId: String(value?.probe?.postId || ''),
    communityId: String(value?.probe?.communityId || ''),
    createJobId: String(value?.indexed?.jobId || ''),
    createOutcome: String(value?.indexed?.outcome || ''),
    semanticExactHit: value?.semanticHit?.exactHit === true,
    sourceFieldsVerified: value?.semanticHit?.sourceFieldsVerified === true,
    deleteJobId: String(value?.removed?.jobId || ''),
    deleteOutcome: String(value?.removed?.outcome || ''),
    semanticExactAbsent: value?.semanticAbsent?.exactAbsent === true,
    cleanupStatus: String(value?.cleaned?.status || ''),
    operationalResidueCount: Number(value?.residue?.operationalResidueCount || 0),
    cleanedAuditCount: Number(value?.residue?.cleanedAuditCount || 0),
    nonProbeBaselineCount: Number.isFinite(baseline) ? baseline : 0,
    nonProbeFinalCount: Number.isFinite(finalCount) ? finalCount : 0,
  }
}

function requireDependency(deps, name) {
  if (typeof deps?.[name] !== 'function') throw new Error(`${name} dependency is required`)
  return deps[name]
}

async function cleanupStep(operation, errors) {
  try { await operation() } catch (error) {
    const fingerprint = createHash('sha256')
      .update(String(error && typeof error === 'object' ? error.message || '' : error || '')).digest('hex').slice(0, 16)
    errors.push(new Error(`cleanup failed fingerprint=${fingerprint}`))
  }
}

export async function runIsolatedValidation(options, deps) {
  const identity = createValidationIdentity(options?.head, options?.runId)
  const communityId = requireSafeId('communityId', options?.communityId)
  let deployAttempted = false
  let baselineVerifiedAbsent = false
  let triggerCreated = false
  let createAttempted = false
  let probe
  let primaryError
  let evidence
  try {
    const baseline = await requireDependency(deps, 'baseline')(identity)
    if (baseline?.functionAbsent !== true) throw new Error('temporary function already exists')
    baselineVerifiedAbsent = true
    const artifact = await requireDependency(deps, 'build')(identity)
    deployAttempted = true
    await requireDependency(deps, 'deploy')({ ...identity, artifact })
    await requireDependency(deps, 'copyRuntimeConfig')(identity)
    await requireDependency(deps, 'createTrigger')(identity)
    triggerCreated = true
    createAttempted = true
    probe = await requireDependency(deps, 'invoke')(identity, { action: 'create', runId: identity.runId, communityId })
    const expected = createProbeFixtureIds(identity.runId)
    assertProbeOwnedId(probe?.postId, expected.postId)
    assertProbeOwnedId(probe?.sectionId, expected.sectionId)
    if (probe?.communityId !== communityId) throw new Error('validation community binding mismatch')
    const indexed = await requireDependency(deps, 'waitIndexed')(identity, probe)
    const semanticHit = await requireDependency(deps, 'assertSemanticHit')(probe, indexed)
    await requireDependency(deps, 'invoke')(identity, { action: 'cleanup', ...probe })
    const removed = await requireDependency(deps, 'waitRemoved')(identity, probe)
    const semanticAbsent = await requireDependency(deps, 'assertSemanticAbsent')(probe, removed)
    const cleaned = await requireDependency(deps, 'waitCleaned')(identity, probe)
    const residue = await requireDependency(deps, 'assertNoResidue')(probe, cleaned, baseline)
    evidence = sanitizeValidationEvidence({ identity, baseline, probe, indexed, semanticHit, removed, semanticAbsent, cleaned, residue })
    if (!evidence.semanticExactHit || !evidence.sourceFieldsVerified || !evidence.semanticExactAbsent
      || evidence.cleanupStatus !== 'cleaned' || evidence.operationalResidueCount !== 0
      || evidence.cleanedAuditCount !== 1) {
      throw new Error('isolated RAG validation evidence is incomplete')
    }
  } catch (error) {
    primaryError = error
  } finally {
    const cleanupErrors = []
    if (createAttempted) await cleanupStep(() => requireDependency(deps, 'recoverProbe')(identity, {
      runId: identity.runId, communityId, probe,
    }), cleanupErrors)
    if (triggerCreated) await cleanupStep(() => requireDependency(deps, 'deleteTrigger')(identity), cleanupErrors)
    if (deployAttempted) await cleanupStep(() => requireDependency(deps, 'deleteFunction')(identity), cleanupErrors)
    await cleanupStep(() => requireDependency(deps, 'removeArtifact')(identity), cleanupErrors)
    await cleanupStep(() => requireDependency(deps, 'clearSecrets')(identity), cleanupErrors)
    if (baselineVerifiedAbsent) await cleanupStep(() => requireDependency(deps, 'assertControlPlaneAbsent')(identity), cleanupErrors)
    if (cleanupErrors.length > 0) primaryError = new AggregateError(
      primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
      'isolated RAG validation cleanup failed',
    )
  }
  if (primaryError) throw primaryError
  return requireDependency(deps, 'writeEvidence')(evidence)
}
