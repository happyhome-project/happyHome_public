export const WECHAT_AUDIT_CALLBACK = 'wechat-audit-callback'
export const WECHAT_AUDIT_CALLBACK_PATH = '/wechat-audit-callback'

export function cloudBaseDeployArgs(functionName, envId) {
  const args = ['fn', 'deploy', functionName, '--force', '--env-id', envId, '--deployMode', 'cos', '--json']
  if (functionName === WECHAT_AUDIT_CALLBACK) {
    args.push('--httpFn', '--path', WECHAT_AUDIT_CALLBACK_PATH)
  }
  return args
}

export function assertWechatAuditHttpAccess(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload
  const entries = Array.isArray(data?.data)
    ? data.data
    : data?.APISet || data?.data?.APISet || data?.Data?.APISet || []
  const match = entries.find((entry) => {
    const name = entry?.Name || entry?.name
    const path = entry?.Path || entry?.path
    return name === WECHAT_AUDIT_CALLBACK && path === WECHAT_AUDIT_CALLBACK_PATH
  })
  if (!match) throw new Error(`HTTP access ${WECHAT_AUDIT_CALLBACK_PATH} is not bound to ${WECHAT_AUDIT_CALLBACK}`)
  return match
}
