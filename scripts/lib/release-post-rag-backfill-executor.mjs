export async function executeReleasePostRagBackfill(requiredSuites, deps) {
  if (!requiredSuites.includes('post-rag')) return { status:'skipped' }
  await deps.run()
  const evidence=await deps.readEvidence()
  // Formal names remain stable: retryJobCount maps retry_wait; failedJobCount maps dead_letter.
  if (evidence?.coverageRatio!==1 || evidence?.missingCoverageCount!==0 || evidence?.pendingJobCount!==0 || evidence?.retryJobCount!==0 || evidence?.processingJobCount!==0 || evidence?.failedJobCount!==0 || evidence?.unknownJobStatusCount!==0) throw new Error('post RAG v2 backfill evidence is incomplete')
  await deps.recordGuard(evidence)
  return {status:'passed',evidence}
}
