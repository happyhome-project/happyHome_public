const REQUIRED_NODES = [
  'preflight', 'configureRag', 'deployRag', 'deployRemainingCloud',
  'runBasicCloudSmoke', 'publishAdmin', 'publishMiniprogram',
]

export function isReleaseDagV2Enabled(env = process.env) {
  void env
  return true
}

export function releaseDagMode(env = process.env) {
  void env
  return 'v2'
}

export function partitionReleaseCloudFunctions(functions = []) {
  const unique = [...new Set(functions)].sort()
  const ragNames = new Set(['post-rag-worker', 'post-video-rag-worker'])
  return {
    ragBootstrap: unique.filter((name) => ragNames.has(name)),
    remaining: unique.filter((name) => !ragNames.has(name)),
  }
}

export function assertRagBootstrapVerified(required = [], verified = []) {
  const proof = new Set(verified)
  for (const functionName of required) {
    if (!proof.has(functionName)) throw new Error(`${functionName} must be freshly verified before release continues`)
  }
}

function assertDagDependencies(deps) {
  for (const name of REQUIRED_NODES) {
    if (typeof deps?.[name] !== 'function') throw new Error(`release DAG V2 requires ${name}()`)
  }
}

export async function executeReleaseDagV2(deps = {}) {
  assertDagDependencies(deps)
  const preflight = await deps.preflight()
  const ragConfig = await deps.configureRag()
  const ragCloud = await deps.deployRag()
  const remainingCloud = await deps.deployRemainingCloud()
  const cloudEvidence = { ragCloud, remainingCloud }
  const smoke = await deps.runBasicCloudSmoke({ cloudEvidence })
  const admin = await deps.publishAdmin({ cloudEvidence, smoke })
  const miniprogram = await deps.publishMiniprogram({ cloudEvidence, smoke, admin })
  return { preflight, ragConfig, cloudEvidence, smoke, admin, miniprogram }
}
