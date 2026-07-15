export function buildWechatAuditFunctionEnvs(functionName, existing = {}, source = {}) {
  const appId = String(source.WX_APPID || '').trim()
  if (functionName === 'post') {
    const appSecret = String(source.WX_APPSECRET || '').trim()
    if (!appId || !appSecret) throw new Error('WX_APPID and WX_APPSECRET are required for post')
    return { ...existing, WX_APPID: appId, WX_APPSECRET: appSecret }
  }
  if (functionName === 'wechat-audit-callback') {
    const messageToken = String(source.WX_MESSAGE_TOKEN || '').trim()
    if (!appId || messageToken.length < 32) throw new Error('WX_APPID and a strong WX_MESSAGE_TOKEN are required for callback')
    return { ...existing, WX_APPID: appId, WX_MESSAGE_TOKEN: messageToken }
  }
  throw new Error(`unsupported WeChat audit function: ${functionName}`)
}

export function redactFunctionEnvRows(values) {
  return Object.entries(values).map(([Key, Value]) => ({
    Key,
    Value: /SECRET|TOKEN|PASSWORD/i.test(Key) ? '[redacted]' : Value,
  }))
}
