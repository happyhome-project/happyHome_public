import { createHash, timingSafeEqual } from 'crypto'

export interface WechatVerificationQuery {
  signature?: unknown
  timestamp?: unknown
  nonce?: unknown
  echostr?: unknown
}

export interface WechatMediaAuditResult {
  traceId: string
  suggest: 'pass' | 'review' | 'rejected'
  label: string | number | undefined
}

type AuditSuggestion = WechatMediaAuditResult['suggest']
type ParsedAuditResult = Pick<WechatMediaAuditResult, 'suggest' | 'label'>

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function verifyWechatSignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string,
): boolean {
  if (![token, timestamp, nonce, signature].every(nonemptyString)) return false

  const expected = createHash('sha1')
    .update([token, timestamp, nonce].sort().join(''))
    .digest()
  const provided = Buffer.from(signature, 'hex')

  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export function parseWechatVerification(query: WechatVerificationQuery, token: string): string {
  if (!query || typeof query !== 'object') throw new Error('Malformed WeChat verification request')

  const { signature, timestamp, nonce, echostr } = query
  if (!nonemptyString(signature) || !nonemptyString(timestamp) || !nonemptyString(nonce) || !nonemptyString(echostr)) {
    throw new Error('Malformed WeChat verification request')
  }
  if (!verifyWechatSignature(token, timestamp, nonce, signature)) {
    throw new Error('Invalid WeChat signature')
  }
  return echostr
}

function normalizeSuggestion(value: unknown): AuditSuggestion | undefined {
  if (!nonemptyString(value)) return undefined
  switch (value.trim().toLowerCase()) {
    case 'pass':
    case 'normal':
      return 'pass'
    case 'review':
    case 'suspect':
      return 'review'
    case 'rejected':
    case 'risky':
      return 'rejected'
    default:
      return undefined
  }
}

function suggestionRank(suggest: AuditSuggestion): number {
  return suggest === 'rejected' ? 3 : suggest === 'review' ? 2 : 1
}

function parseResult(value: unknown): ParsedAuditResult | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = value as Record<string, unknown>
  const suggest = normalizeSuggestion(result.suggest)
  if (!suggest) return undefined
  const label = result.label
  if (label !== undefined && typeof label !== 'string' && typeof label !== 'number') return undefined
  return { suggest, label }
}

export function parseWechatMediaAuditEvent(payload: unknown, expectedAppId: string): WechatMediaAuditResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Malformed WeChat callback payload')
  }
  const event = payload as Record<string, unknown>
  if (event.Encrypt !== undefined || event.encrypt !== undefined) {
    throw new Error('Encrypted WeChat callbacks are unsupported')
  }

  const eventName = event.Event ?? event.event
  if (eventName !== 'wxa_media_check') throw new Error('Unsupported WeChat callback event')

  const appId = event.appid ?? event.AppId ?? event.ToUserName
  if (appId !== undefined && appId !== expectedAppId) throw new Error('WeChat AppID mismatch')
  if (!nonemptyString(event.trace_id)) throw new Error('Malformed WeChat media audit trace_id')

  let normalized = parseResult(event.result)
  if (!normalized && Array.isArray(event.detail) && event.detail.length > 0) {
    const details = event.detail.map(parseResult)
    if (details.some(detail => !detail)) throw new Error('Malformed WeChat media audit result')
    normalized = (details as ParsedAuditResult[])
      .reduce((strongest, candidate) => (
        suggestionRank(candidate.suggest) > suggestionRank(strongest.suggest) ? candidate : strongest
      ))
  }
  if (!normalized) throw new Error('Malformed WeChat media audit result')

  return { traceId: event.trace_id, ...normalized }
}
