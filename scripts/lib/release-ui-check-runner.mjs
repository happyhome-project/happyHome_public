const SECRET_VALUE_PATTERN = /\b(token|openid)\s*[:=]\s*[^\s,;]+/gi

function sanitizeError(error) {
  return String(error?.message || error || 'unknown UI check error')
    .split(/\r?\n/, 1)[0]
    .replace(SECRET_VALUE_PATTERN, '$1=[REDACTED]')
    .slice(0, 500)
}

export async function runReleaseUiChecks(checks = {}) {
  const stages = []
  const failures = []
  const skipped = []

  async function run(stage, check) {
    if (typeof check !== 'function') {
      const item = { stage, status: 'skipped', reason: 'check not configured' }
      stages.push(item)
      skipped.push(item)
      return false
    }
    try {
      await check()
      stages.push({ stage, status: 'passed' })
      return true
    } catch (error) {
      const item = { stage, status: 'failed', error: sanitizeError(error) }
      stages.push(item)
      failures.push(item)
      return false
    }
  }

  function skip(stage, reason) {
    const item = { stage, status: 'skipped', reason }
    stages.push(item)
    skipped.push(item)
  }

  const coldStartPassed = await run('coldStart', checks.coldStart)
  const profilePassed = await run('profile', checks.profile)
  let fixturePassed = false
  if (coldStartPassed && profilePassed) {
    fixturePassed = await run('provisionFixture', checks.provisionFixture)
  } else {
    skip('provisionFixture', coldStartPassed ? 'profile failed' : 'coldStart failed')
  }

  if (coldStartPassed && profilePassed && fixturePassed) {
    await run('homeDetail', checks.homeDetail)
  } else {
    const reason = !coldStartPassed
      ? 'coldStart failed'
      : !profilePassed
        ? 'profile failed'
        : 'provisionFixture failed'
    skip('homeDetail', reason)
  }

  await run('cleanup', checks.cleanup)

  return { ok: failures.length === 0, stages, failures, skipped }
}
