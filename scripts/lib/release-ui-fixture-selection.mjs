const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitForReleaseFixtureSelection({
  communityId,
  bootstrap,
  attempts = 6,
  delayMs = 2000,
  sleep = defaultSleep,
}) {
  const expected = String(communityId || '')
  if (!expected) throw new Error('release fixture communityId is required')
  if (typeof bootstrap !== 'function') throw new Error('release fixture bootstrap function is required')

  let lastSnapshot = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastSnapshot = await bootstrap()
    if (String(lastSnapshot?.currentCommunityId || '') === expected) {
      return { snapshot: lastSnapshot, attempt }
    }
    if (attempt < attempts) await sleep(delayMs)
  }

  const actual = String(lastSnapshot?.currentCommunityId || '') || '<empty>'
  const fixtureListed = Array.isArray(lastSnapshot?.communities) &&
    lastSnapshot.communities.some((community) => String(community?._id || '') === expected)
  throw new Error(
    `post.bootstrap did not select release fixture community ${expected} after ${attempts} attempts; ` +
    `actual=${actual}; fixtureListed=${fixtureListed}`,
  )
}

export async function applyAndWaitForReleaseFixtureSelection({ apply, ...selectionOptions }) {
  if (typeof apply !== 'function') throw new Error('release fixture apply function is required')
  const applyResult = await apply()
  if (applyResult?.status && applyResult.status !== 'active') {
    throw new Error(`release fixture membership is not active: status=${String(applyResult.status)}`)
  }
  return waitForReleaseFixtureSelection(selectionOptions)
}
