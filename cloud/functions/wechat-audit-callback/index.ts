import { applyWechatMediaAuditResult } from '../../lib/content-audit'
import {
  parseWechatMediaAuditEvent,
  parseWechatVerification,
  verifyWechatSignature,
} from '../../lib/wechat-callback'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' }

function response(statusCode: number, body: string, headers = JSON_HEADERS) {
  return { statusCode, headers, body }
}

function queryOf(event: any): Record<string, unknown> {
  return event?.queryStringParameters && typeof event.queryStringParameters === 'object'
    ? event.queryStringParameters
    : {}
}

function configuredSecrets() {
  return {
    token: String(process.env.WX_MESSAGE_TOKEN || '').trim(),
    appId: String(process.env.WX_APPID || '').trim(),
  }
}

export const main = async (event: any) => {
  if (!event?.httpMethod) return response(404, JSON.stringify({ error: 'Not Found' }))
  const { token, appId } = configuredSecrets()
  if (!token || !appId) return response(503, JSON.stringify({ error: 'Callback unavailable' }))
  const method = String(event.httpMethod).toUpperCase()
  const query = queryOf(event)

  if (method === 'GET') {
    try {
      const echo = parseWechatVerification(query, token)
      return response(200, echo, TEXT_HEADERS)
    } catch {
      return response(403, JSON.stringify({ error: 'Forbidden' }))
    }
  }

  if (method !== 'POST') return response(405, JSON.stringify({ error: 'Method Not Allowed' }))

  const signature = String(query.signature || '')
  const timestamp = String(query.timestamp || '')
  const nonce = String(query.nonce || '')
  if (!verifyWechatSignature(token, timestamp, nonce, signature)) {
    return response(403, JSON.stringify({ error: 'Forbidden' }))
  }

  let payload: unknown
  try {
    payload = JSON.parse(String(event.body || ''))
  } catch {
    return response(400, JSON.stringify({ error: 'Malformed callback' }))
  }

  let normalized
  try {
    normalized = parseWechatMediaAuditEvent(payload, appId)
  } catch {
    return response(400, JSON.stringify({ error: 'Unsupported callback' }))
  }

  try {
    const result = await applyWechatMediaAuditResult(normalized)
    console.log('[wechat-audit-callback]', JSON.stringify({
      event: 'media_audit_result',
      matched: result.matched,
      status: result.status,
    }))
    return response(200, JSON.stringify({
      success: true,
      matched: result.matched,
      status: result.status,
    }))
  } catch {
    console.error('[wechat-audit-callback]', JSON.stringify({ event: 'persistence_failure' }))
    return response(500, JSON.stringify({ error: 'Retry callback' }))
  }
}
