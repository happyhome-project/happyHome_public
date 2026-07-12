export async function executePostRagV2Backfill(deps, { maxAttempts = 20 } = {}) {
  let lastHealth
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rebuild = await deps.rebuild({ allActive: true, processJobs: true, workerStage: 'combined' })
    if (rebuild?.totals?.failedCommunityCount || rebuild?.totals?.failedPostCount
      || rebuild?.workerRounds?.some(row => row.failedCount > 0)) throw new Error('v2 backfill failed')
    lastHealth = await deps.health({ allActive: true, healthV2: true })
    const totals = lastHealth?.totals
    if (!totals || totals.failedCommunityCount || totals.failedStateCount || totals.pendingJobCount || totals.failedJobCount) {
      if (attempt < maxAttempts) { await deps.wait?.(); continue }
      throw new Error('v2 backfill health has failed or pending work')
    }
    if (totals.potentialMissingActiveCount === 0 && totals.coverageRatio === 1) {
      const evidence = { schemaVersion: 1, eligibleActivePostCount: totals.activePostCount,
        coveredPostCount: totals.indexedStateCount, missingCoverageCount: 0, pendingJobCount: 0, failedJobCount: 0,
        coverageRatio: 1, attempts: attempt }
      await deps.recordEvidence?.(evidence)
      return evidence
    }
    if (attempt < maxAttempts) await deps.wait?.()
  }
  throw new Error(`v2 backfill coverage incomplete: missing=${lastHealth?.totals?.potentialMissingActiveCount ?? 'unknown'}`)
}
