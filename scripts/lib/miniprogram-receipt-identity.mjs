import { createHash } from 'node:crypto'

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function normalizeMiniprogramUploadReceipt({ method, uploadInfoText, receipt } = {}) {
  if (!['devtools-cli', 'miniprogram-ci'].includes(method)) return null
  const parsed = method === 'devtools-cli'
    ? (String(uploadInfoText || '').trim() ? JSON.parse(uploadInfoText) : null)
    : receipt
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return { method, receipt: parsed }
}

export function createMiniprogramReceiptIdentity({ receipt, runId, packageDigest, version, desc } = {}) {
  return createHash('sha256').update(canonicalJson({ receipt, runId, packageDigest, version, desc })).digest('hex')
}
