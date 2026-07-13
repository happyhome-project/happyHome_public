function normalizedOutcome(name, value) {
  const status = ['passed', 'failed', 'indeterminate'].includes(value?.status) ? value.status : 'indeterminate'
  return { name, status, ...(value?.detail ? { detail: String(value.detail).slice(0, 160) } : {}) }
}

export async function runReleasePreflight({ checks = [] } = {}) {
  const byName = new Map()
  const execute = async (check) => {
    let fixture = check.fixture
    let outcome
    try {
      fixture = check.createFixture ? await check.createFixture(fixture) : fixture
      outcome = normalizedOutcome(check.name, await check.run(fixture))
    } catch {
      outcome = { name: check.name, status: 'indeterminate', detail: 'check could not be determined' }
    } finally {
      if (fixture !== undefined && check.cleanupFixture) {
        try {
          await check.cleanupFixture(fixture)
          outcome.cleanup = 'passed'
        } catch {
          outcome = { ...outcome, status: 'failed', cleanup: 'failed', detail: 'temporary fixture cleanup failed' }
        }
      }
    }
    byName.set(check.name, outcome)
  }
  for (const check of checks.filter(item => !item.mutation)) await execute(check)
  const mutationGatePassed = checks.filter(item => item.gateForMutations).every(item => byName.get(item.name)?.status === 'passed')
  for (const check of checks.filter(item => item.mutation)) {
    if (!mutationGatePassed) byName.set(check.name, { name: check.name, status: 'failed', detail: 'production fixture blocked by preflight gate' })
    else await execute(check)
  }
  const results = checks.map(check => byName.get(check.name))
  return { schemaVersion: 1, ok: results.every(item => item.status === 'passed'), checks: results }
}
