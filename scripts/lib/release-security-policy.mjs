const OPENID_FUNCTIONS = new Set(['user', 'community', 'member', 'section', 'post'])

function envMap(items = []) {
  return Object.fromEntries(items
    .filter((item) => item && item.Key)
    .map((item) => [String(item.Key), String(item.Value || '').trim()]))
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase())
}

function isStrongCapability(value) {
  const token = String(value || '').trim()
  const distinctCharacters = new Set(token.toLowerCase()).size
  return /^[a-f0-9]{48,128}$/i.test(token) && distinctCharacters >= 8
}

export function assertReleaseCapabilitySeparation(configByFunction = {}) {
  const admin = envMap(configByFunction.admin || [])
  const gateway = envMap(configByFunction['http-gateway'] || [])
  if (isEnabled(gateway.GATEWAY_ENABLED) && admin.ADMIN_INTERNAL_CALL_TOKEN === gateway.GATEWAY_TOKEN) {
    throw new Error('admin and http-gateway must not share a capability token')
  }
}

export function assertReleaseFunctionSecurityConfig(functionName, environmentVariables = []) {
  const values = envMap(environmentVariables)
  if (OPENID_FUNCTIONS.has(functionName) && isEnabled(values.ALLOW_TEST_OPENID)) {
    throw new Error(`${functionName} has unsafe ALLOW_TEST_OPENID enabled`)
  }
  if (functionName === 'admin') {
    if (isEnabled(values.ADMIN_LEGACY_TOKEN_FALLBACK)) {
      throw new Error('admin has unsafe ADMIN_LEGACY_TOKEN_FALLBACK enabled')
    }
    if (!isStrongCapability(values.ADMIN_INTERNAL_CALL_TOKEN)) {
      throw new Error('admin is missing a strong ADMIN_INTERNAL_CALL_TOKEN')
    }
    if (isEnabled(values.BOOTSTRAP_ADMIN_ENABLED)) {
      throw new Error('admin has unsafe BOOTSTRAP_ADMIN_ENABLED enabled')
    }
  }
  if (functionName === 'http-gateway' && isEnabled(values.GATEWAY_ENABLED) && !isStrongCapability(values.GATEWAY_TOKEN)) {
    throw new Error('enabled http-gateway is missing a strong GATEWAY_TOKEN')
  }
}
