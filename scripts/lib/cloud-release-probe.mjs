import { randomBytes as nodeRandomBytes } from 'node:crypto'

export function createCloudReleaseProbe({ functionName, randomBytes = nodeRandomBytes, sourceSha = 'unknown' } = {}) {
  if (!functionName) throw new Error('cloud release probe requires functionName')
  const buildId = `cloud-${String(sourceSha).slice(0, 12)}-${functionName}-${randomBytes(6).toString('hex')}`
  return {
    buildId,
    functionName,
    probeToken: randomBytes(32).toString('hex'),
    response: { buildId, functionName, sourceSha },
    sourceSha: String(sourceSha),
  }
}

export function createCloudReleaseProbeWrapper() {
  return `const info = require('./__release.info.json')
exports.main = async function main(event, context) {
  if (event && event.__happyhomeReleaseProbe === info.probeToken) return info.response
  const handler = require('./handler.js')
  return await handler.main(event, context)
}
`
}

export function hasCloudReleaseProbeResponse(value, probe) {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((item) => hasCloudReleaseProbeResponse(item, probe))
  if (typeof value === 'string') {
    try { return hasCloudReleaseProbeResponse(JSON.parse(value), probe) } catch { return false }
  }
  if (typeof value !== 'object') return false
  const expected = probe?.response || probe
  if (value.functionName === expected.functionName && value.sourceSha === expected.sourceSha && value.buildId === expected.buildId) return true
  return Object.values(value).some((item) => hasCloudReleaseProbeResponse(item, probe))
}
