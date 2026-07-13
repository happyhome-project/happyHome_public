import { releaseFailureCauses } from './release-failure-safety.mjs'

export async function persistFormalReleaseFailure({ error, guard, guardAcquired, ledger }) {
  const failureCauses = releaseFailureCauses(error, { branch: 'release', phase: 'parallel' })
  const persistenceErrors = []
  if (guard && guardAcquired && !guard.finished) {
    try {
      await guard.fail(error, { failureCauses, localReleaseRunId: ledger.runId })
    } catch {
      persistenceErrors.push({ target: 'production-guard', code: 'PERSIST_FAILED' })
    }
  }
  try {
    await ledger.appendEvent('release_failure_causes', { failureCauses })
  } catch {
    persistenceErrors.push({ target: 'local-ledger-event', code: 'PERSIST_FAILED' })
  }
  if (!error?.releaseRemotelyCompleted) {
    try {
      await ledger.complete('failed')
    } catch {
      persistenceErrors.push({ target: 'local-ledger-completion', code: 'PERSIST_FAILED' })
    }
  }
  return { failureCauses, persistenceErrors }
}
