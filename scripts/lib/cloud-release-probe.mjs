import { randomBytes as nodeRandomBytes } from 'node:crypto'

export function createCloudReleaseProbe({ componentDigest = '', functionName, randomBytes = nodeRandomBytes, runtimeDigest = '', sourceSha = 'unknown' } = {}) {
  if (!functionName) throw new Error('cloud release probe requires functionName')
  const buildId = `cloud-${String(sourceSha).slice(0, 12)}-${functionName}-${randomBytes(6).toString('hex')}`
  return {
    buildId,
    functionName,
    probeToken: randomBytes(32).toString('hex'),
    componentDigest,
    response: { buildId, componentDigest, functionName, runtimeDigest, runtimeVerified: Boolean(runtimeDigest), sourceSha },
    runtimeDigest,
    sourceSha: String(sourceSha),
  }
}

export function createCloudReleaseProbeWrapper() {
  return `const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const info = require('./__release.info.json')
function runtimeIntegrity() {
  try {
    const manifest = require('./.happyhome-runtime-manifest.json')
    const files = manifest.files.map((record) => {
      const content = readFileSync(require('node:path').join(__dirname, record.path))
      return { path: record.path, size: content.length, sha256: createHash('sha256').update(content).digest('hex') }
    })
    const runtimeDigest = createHash('sha256').update(JSON.stringify({ schemaVersion: manifest.schemaVersion, files })).digest('hex')
    return runtimeDigest === info.runtimeDigest && runtimeDigest === manifest.runtimeDigest
  } catch { return false }
}
exports.main = async function main(event, context) {
  if (event && event.__happyhomeReleaseProbe === info.probeToken) return { ...info.response, runtimeVerified: runtimeIntegrity() }
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
  if (value.functionName === expected.functionName && value.sourceSha === expected.sourceSha && value.buildId === expected.buildId &&
    (!expected.componentDigest || value.componentDigest === expected.componentDigest) &&
    (!expected.runtimeDigest || (value.runtimeDigest === expected.runtimeDigest && value.runtimeVerified === true))) return true
  return Object.values(value).some((item) => hasCloudReleaseProbeResponse(item, probe))
}

export function hasCloudReleaseComponentAttestationResponse(value, expected) {
  if (value == null) return false
  if (Array.isArray(value)) return value.some((item) => hasCloudReleaseComponentAttestationResponse(item, expected))
  if (typeof value === 'string') {
    try { return hasCloudReleaseComponentAttestationResponse(JSON.parse(value), expected) } catch { return false }
  }
  if (typeof value !== 'object') return false
  if (value.functionName === expected.functionName && value.componentDigest === expected.componentDigest &&
    value.runtimeDigest === expected.runtimeDigest && value.runtimeVerified === true) return true
  return Object.values(value).some((item) => hasCloudReleaseComponentAttestationResponse(item, expected))
}
