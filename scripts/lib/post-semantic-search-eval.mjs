const REQUIRED_TOPICS = ['family-thrift', 'gardening-service', 'lost-found', 'parent-route']

export function nearestRankPercentile(values, percentile) {
  if (!values.length) return 0
  const sorted = [...values].map(Number).sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
}

export function validateEvaluationDataset(cases) {
  if (!Array.isArray(cases) || cases.length !== 30) throw new Error('evaluation dataset must contain exactly 30 cases')
  const ids = new Set()
  const aliases = new Set()
  const topics = new Set()
  for (const item of cases) {
    if (!item?.id || ids.has(item.id)) throw new Error('evaluation case ids must be unique')
    ids.add(item.id)
    if (!item.query || !/[\u3400-\u9fff]/u.test(item.query)) throw new Error(`case ${item.id} requires a Chinese query`)
    if (!REQUIRED_TOPICS.includes(item.topic)) throw new Error(`case ${item.id} has unknown topic`)
    topics.add(item.topic)
    if (!Array.isArray(item.relevantFixtureAliases) || !item.relevantFixtureAliases.length) throw new Error(`case ${item.id} requires a relevant fixture alias`)
    if (!Array.isArray(item.forbiddenFixtureAliases)) throw new Error(`case ${item.id} requires forbidden fixture aliases`)
    for (const alias of item.relevantFixtureAliases) {
      if (!/^fixture-[a-z0-9-]+$/.test(alias)) throw new Error(`case ${item.id} contains a production id; use fixture aliases`)
      aliases.add(alias)
    }
    for (const alias of item.forbiddenFixtureAliases) {
      if (!/^fixture-[a-z0-9-]+$/.test(alias)) throw new Error(`case ${item.id} contains a production forbidden id; use fixture aliases`)
      if (item.relevantFixtureAliases.includes(alias)) throw new Error(`case ${item.id} cannot mark a relevant alias forbidden`)
    }
  }
  for (const topic of REQUIRED_TOPICS) if (!topics.has(topic)) throw new Error(`dataset missing required topic ${topic}`)
  return { caseCount: cases.length, fixtureAliasCount: aliases.size, requiredTopics: [...REQUIRED_TOPICS] }
}

export function evaluateSemanticSearch(cases, resultsByCase, options = {}) {
  const durationsMs = options.durationsMs || []
  if (options.enforceProductionRunCount && durationsMs.length !== 100) throw new Error('production semantic evaluation requires exactly 100 latency runs')
  let recallSum = 0
  let precisionSum = 0
  for (const item of cases) {
    const returned = resultsByCase.get(item.id) || []
    const relevant = new Set(item.relevantFixtureAliases)
    recallSum += [...new Set(returned.slice(0, 5))].filter((id) => relevant.has(id)).length / relevant.size
    const top3 = returned.slice(0, 3)
    precisionSum += top3.length ? top3.filter((id) => relevant.has(id)).length / top3.length : 0
  }
  const recallAt5 = cases.length ? recallSum / cases.length : 1
  const top3Precision = cases.length ? precisionSum / cases.length : 1
  const errors = Number(options.errors || 0)
  const runCount = durationsMs.length
  const errorRate = runCount ? errors / runCount : 0
  const p95Ms = nearestRankPercentile(durationsMs, 0.95)
  let forbiddenCount = 0
  for (const item of cases) {
    const forbidden = new Set(item.forbiddenFixtureAliases || [])
    forbiddenCount += [...new Set(resultsByCase.get(item.id) || [])].filter((id) => forbidden.has(id)).length
  }
  return {
    caseCount: cases.length, recallAt5, top3Precision, p95Ms, errorRate, forbiddenCount,
    passed: recallAt5 >= 0.9 && top3Precision >= 0.8 && p95Ms <= 2000 && errorRate <= 0.01 && forbiddenCount === 0,
  }
}
