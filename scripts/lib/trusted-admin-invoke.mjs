import CloudBase from '@cloudbase/manager-node'

import { requireAdminInternalToken } from './admin-internal-token.mjs'
import { resolveCloudBaseReleaseCredentials } from './cloudbase-release-store.mjs'

function parseFunctionResult(value) {
  if (value && typeof value === 'object') return value
  const text = String(value || '').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('trusted admin invocation returned invalid JSON')
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

export async function invokeTrustedAdminWithManager(data, options = {}) {
  const action = String(data?.action || 'callFunction')
  const timeoutMs = Number(options.timeoutMs || 90000)
  const internalToken = options.internalToken || requireAdminInternalToken()
  const response = await withTimeout(
    options.manager.functions.invokeFunction('admin', {
      ...data,
      _internalToken: internalToken,
    }),
    timeoutMs,
    `trusted admin ${action}`,
  )
  const functionResult = parseFunctionResult(response?.RetMsg)
  const error = functionResult?.error || functionResult?.message || response?.ErrMsg || ''
  if (Number(response?.InvokeResult || 0) !== 0 || response?.ErrMsg || functionResult?.success === false || functionResult?.error) {
    throw new Error(`[trusted admin] ${action}: ${error || 'invoke failed'}`)
  }
  return functionResult
}

export async function invokeTrustedAdminCloud(data, options = {}) {
  const credentials = resolveCloudBaseReleaseCredentials({ env: options.env || process.env })
  const manager = CloudBase.init({
    secretId: credentials.secretId,
    secretKey: credentials.secretKey,
    envId: credentials.envId,
  })
  return await invokeTrustedAdminWithManager(data, {
    manager,
    internalToken: options.internalToken,
    timeoutMs: options.timeoutMs,
  })
}
