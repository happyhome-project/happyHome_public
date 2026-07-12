export async function executeReleasePostRagBackfill(requiredSuites, deps) {
  if (!requiredSuites.includes('post-rag')) return { status:'skipped' }
  await deps.run()
  const evidence=await deps.readEvidence()
  if (evidence?.coverageRatio!==1 || evidence?.missingCoverageCount!==0 || evidence?.pendingJobCount!==0 || evidence?.failedJobCount!==0) throw new Error('post RAG v2 backfill evidence is incomplete')
  await deps.recordGuard(evidence)
  return {status:'passed',evidence}
}
