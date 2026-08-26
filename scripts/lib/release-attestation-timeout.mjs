import { parsePositiveIntOption } from './release-concurrency.mjs'

export const DEFAULT_CLOUD_ATTESTATION_TIMEOUT_MS = 120_000
export const MAX_CLOUD_ATTESTATION_TIMEOUT_MS = 120_000

export function resolveCloudAttestationTimeoutMs(value) {
  return parsePositiveIntOption(value, DEFAULT_CLOUD_ATTESTATION_TIMEOUT_MS, {
    max: MAX_CLOUD_ATTESTATION_TIMEOUT_MS,
  })
}
