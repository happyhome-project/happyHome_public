export const WECHAT_AUDIT_CALLBACK = 'wechat-audit-callback'
export const WECHAT_AUDIT_CALLBACK_PATH = '/wechat-audit-callback'

export function cloudBaseDeployArgs(functionName, envId) {
  return ['fn', 'deploy', functionName, '--force', '--env-id', envId, '--deployMode', 'cos', '--json']
}

export function cloudBaseCreateServiceArgs(envId) {
  return [
    'service', 'create', '--service-path', WECHAT_AUDIT_CALLBACK_PATH,
    '--function', WECHAT_AUDIT_CALLBACK, '--json', '--env-id', envId,
  ]
}

function accessEntries(payload) {
  let data = payload
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload)
    } catch (error) {
      if (/HTTP 访问服务为空|HTTP access services? (?:are )?empty/i.test(payload)) return []
      const lines = payload.split(/\r?\n/)
      for (let index = 1; index < lines.length; index += 1) {
        const progressLines = lines.slice(index).filter((line) => line.trim())
        if (!progressLines.length || !progressLines.every((line) => /^\s*-\s+.+\.\.\.\s*$/u.test(line))) continue
        try {
          data = JSON.parse(lines.slice(0, index).join('\n'))
          break
        } catch {}
      }
      if (data === payload) throw error
    }
  }
  return Array.isArray(data?.data)
    ? data.data
    : data?.APISet || data?.data?.APISet || data?.Data?.APISet || []
}

export function assertWechatAuditHttpAccess(payload) {
  const entries = accessEntries(payload)
  const match = entries.find((entry) => {
    const name = entry?.Name || entry?.name
    const path = entry?.Path || entry?.path
    return name === WECHAT_AUDIT_CALLBACK && path === WECHAT_AUDIT_CALLBACK_PATH
  })
  if (!match) throw new Error(`HTTP access ${WECHAT_AUDIT_CALLBACK_PATH} is not bound to ${WECHAT_AUDIT_CALLBACK}`)
  return match
}

export async function ensureWechatAuditHttpAccess({ readAccess, beforeCreate, createAccess }) {
  const current = await readAccess()
  const entries = accessEntries(current)
  const exact = entries.find((entry) => (entry?.Name || entry?.name) === WECHAT_AUDIT_CALLBACK &&
    (entry?.Path || entry?.path) === WECHAT_AUDIT_CALLBACK_PATH)
  if (exact) return { changed: false }

  const conflicting = entries.find((entry) => (entry?.Path || entry?.path) === WECHAT_AUDIT_CALLBACK_PATH)
  if (conflicting) {
    throw new Error(`HTTP access ${WECHAT_AUDIT_CALLBACK_PATH} is already bound to ${conflicting?.Name || conflicting?.name || 'another function'}`)
  }

  await beforeCreate()
  await createAccess()
  assertWechatAuditHttpAccess(await readAccess())
  return { changed: true }
}
