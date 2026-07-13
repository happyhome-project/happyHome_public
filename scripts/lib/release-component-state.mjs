function publicCloudIdentity(artifact, artifactRunId) {
  return {
    artifactRunId,
    buildId: artifact.buildId || '',
    componentDigest: artifact.componentDigest || '',
    contentDigest: artifact.contentDigest || '',
    functionName: artifact.functionName || '',
    probeTokenHash: artifact.probeTokenHash || '',
    runtimeDigest: artifact.runtimeDigest || '',
    sourceSha: artifact.sourceSha || '',
  }
}

export function selectCloudProductionBindings({ artifactManifest, currentBoundFunctions = [], deployedFunctions = [], plannedFunctions = [], priorFunctions = {} } = {}) {
  const deployed = new Set([...deployedFunctions, ...currentBoundFunctions])
  const selected = {}
  for (const functionName of plannedFunctions) {
    const current = artifactManifest?.artifacts?.cloud?.[functionName]
    if (!current) throw new Error(`current cloud artifact binding is missing for ${functionName}`)
    if (deployed.has(functionName)) {
      selected[functionName] = publicCloudIdentity(current, artifactManifest.runId)
      continue
    }
    const prior = priorFunctions?.[functionName]
    if (!prior?.artifactRunId) throw new Error(`prior deployed binding is missing for attested ${functionName}`)
    if (!current.componentDigest || current.componentDigest !== prior.componentDigest || current.runtimeDigest !== prior.runtimeDigest) {
      throw new Error(`prior stable digest does not match attested ${functionName}`)
    }
    selected[functionName] = { ...prior }
  }
  return selected
}

export function mergeReleaseComponents(previous = {}, updates = {}) {
  const previousCloud = previous.cloud?.functions || {}
  const updateCloud = updates.cloud?.functions || {}
  return {
    ...previous,
    ...updates,
    adminWeb: updates.adminWeb ?? previous.adminWeb ?? null,
    cloud: {
      ...(previous.cloud || {}),
      ...(updates.cloud || {}),
      functions: { ...previousCloud, ...updateCloud },
    },
    miniprogram: updates.miniprogram ?? previous.miniprogram ?? null,
  }
}

export function selectStableProductionBinding({ component, current, mutated, prior, runId } = {}) {
  if (!current?.componentDigest) throw new Error(`current stable component digest is missing for ${component}`)
  if (!mutated) {
    if (!prior?.artifactRunId) throw new Error(`prior deployed binding is missing for attested ${component}`)
    if (prior.componentDigest !== current.componentDigest) throw new Error(`prior stable digest does not match attested ${component}`)
    return { ...prior }
  }
  const { artifactPath: _artifactPath, probeToken: _probeToken, ...publicIdentity } = current
  return { ...publicIdentity, artifactRunId: runId }
}
