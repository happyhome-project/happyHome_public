export async function executeRequiredSmokeSuite(requiredSmokeSuites, deps) {
  if (!requiredSmokeSuites.includes('post-rag')) {
    await deps.skipLedger?.()
    return { suite: 'post-rag', status: 'skipped' }
  }
  await deps.run()
  const evaluation = await deps.runEvaluation?.()
  await deps.recordLedger(evaluation)
  await deps.recordGuard(evaluation)
  return { suite: 'post-rag', status: 'passed', evaluation }
}
