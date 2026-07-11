function major(version) {
  const match = String(version || '').match(/^(\d+)/)
  return match ? Number(match[1]) : NaN
}

export function assessRuntime({ nodeVersion, npmVersion } = {}) {
  const reasons = []
  if (major(nodeVersion) !== 24) reasons.push('node_major')
  if (major(npmVersion) !== 11) reasons.push('npm_major')
  return { ready: reasons.length === 0, reasons }
}
