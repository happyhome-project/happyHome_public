function normalizeEnvironment(value) {
  const entries = Array.isArray(value)
    ? value.map(item => [String(item?.Key || ''), String(item?.Value ?? '')])
    : Object.entries(value || {}).map(([key, item]) => [String(key), String(item ?? '')])
  return Object.fromEntries(entries.filter(([key]) => key).sort(([a], [b]) => a.localeCompare(b)))
}

export async function reconcileRagFunctionEnvironment(app, functionName, desired, options = {}) {
  const detail = await app.functions.getFunctionDetail(functionName)
  const existing = normalizeEnvironment(detail?.Environment?.Variables)
  for (const key of options.deprecatedKeys || []) delete existing[key]
  const target = normalizeEnvironment({ ...existing, ...desired })
  const changed = JSON.stringify(normalizeEnvironment(detail?.Environment?.Variables)) !== JSON.stringify(target)
  if (changed) await app.functions.updateFunctionConfig({ name: functionName, envVariables: target })
  return { name: functionName, changed, keys: Object.keys(target) }
}
