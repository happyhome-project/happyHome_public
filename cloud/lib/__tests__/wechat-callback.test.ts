import { createHash } from 'crypto'
import {
  parseWechatMediaAuditEvent,
  parseWechatVerification,
  verifyWechatSignature,
} from '../wechat-callback'

const token = 'callback-token'
const timestamp = '1710000000'
const nonce = 'nonce-42'
const signature = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex')

describe('verifyWechatSignature', () => {
  test('matches an independently fixed signature vector', () => {
    expect(verifyWechatSignature(
      'known-token',
      '1700000000',
      'fixed-nonce',
      '4c4557fc5328df1f1df71113d7115a97216e6403',
    )).toBe(true)
  })

  test('accepts a valid WeChat SHA-1 signature', () => {
    expect(verifyWechatSignature(token, timestamp, nonce, signature)).toBe(true)
  })

  test('rejects a wrong signature', () => {
    expect(verifyWechatSignature(token, timestamp, nonce, '0'.repeat(40))).toBe(false)
  })

  test('rejects a malformed equal-length non-hex signature', () => {
    expect(verifyWechatSignature(token, timestamp, nonce, 'z'.repeat(40))).toBe(false)
  })

  test.each([
    ['', nonce],
    [timestamp, ''],
  ])('rejects missing timestamp or nonce', (candidateTimestamp, candidateNonce) => {
    expect(verifyWechatSignature(token, candidateTimestamp, candidateNonce, signature)).toBe(false)
  })
})

describe('parseWechatVerification', () => {
  test('returns echostr for a valid GET verification request', () => {
    expect(parseWechatVerification({ signature, timestamp, nonce, echostr: 'verified' }, token)).toBe('verified')
  })

  test('rejects invalid verification requests', () => {
    expect(() => parseWechatVerification({ signature: 'bad', timestamp, nonce, echostr: 'verified' }, token))
      .toThrow('Invalid WeChat signature')
  })

  test.each([
    { query: { signature, nonce, echostr: 'verified' }, field: 'timestamp' },
    { query: { signature, timestamp, echostr: 'verified' }, field: 'nonce' },
    { query: { signature, timestamp, nonce }, field: 'echostr' },
  ])('rejects a verification request missing $field', ({ query }) => {
    expect(() => parseWechatVerification(query, token)).toThrow('Malformed WeChat verification request')
  })
})

describe('parseWechatMediaAuditEvent', () => {
  const base = {
    ToUserName: 'wx-app-id',
    Event: 'wxa_media_check',
    trace_id: 'trace-1',
  }

  test('normalizes a top-level pass result', () => {
    expect(parseWechatMediaAuditEvent({ ...base, result: { suggest: 'pass', label: 100 } }, 'wx-app-id'))
      .toEqual({ traceId: 'trace-1', suggest: 'pass', label: 100 })
  })

  test('treats top-level result as authoritative when detail is also present', () => {
    expect(parseWechatMediaAuditEvent({
      ...base,
      result: { suggest: 'pass', label: 100 },
      detail: [{ suggest: 'risky', label: 20001 }],
    }, 'wx-app-id')).toEqual({ traceId: 'trace-1', suggest: 'pass', label: 100 })
  })

  test('accepts a callback when appid is absent', () => {
    const { ToUserName: _appId, ...withoutAppId } = base
    expect(parseWechatMediaAuditEvent({ ...withoutAppId, result: { suggest: 'pass', label: 100 } }, 'wx-app-id'))
      .toEqual({ traceId: 'trace-1', suggest: 'pass', label: 100 })
  })

  test('normalizes the strongest rejected detail', () => {
    expect(parseWechatMediaAuditEvent({
      ...base,
      detail: [
        { suggest: 'pass', label: 100 },
        { suggest: 'risky', label: 20001 },
      ],
    }, 'wx-app-id')).toEqual({ traceId: 'trace-1', suggest: 'rejected', label: 20001 })
  })

  test('normalizes review and suspect suggestions to review', () => {
    expect(parseWechatMediaAuditEvent({
      ...base,
      detail: [
        { suggest: 'normal', label: 100 },
        { suggest: 'suspect', label: 20002 },
      ],
    }, 'wx-app-id')).toEqual({ traceId: 'trace-1', suggest: 'review', label: 20002 })
  })

  test('rejects an appid mismatch', () => {
    expect(() => parseWechatMediaAuditEvent({ ...base, result: { suggest: 'pass', label: 100 } }, 'other-app'))
      .toThrow('WeChat AppID mismatch')
  })

  test('rejects unsupported events', () => {
    expect(() => parseWechatMediaAuditEvent({ ...base, Event: 'subscribe', result: { suggest: 'pass' } }, 'wx-app-id'))
      .toThrow('Unsupported WeChat callback event')
  })

  test('rejects malformed detail results', () => {
    expect(() => parseWechatMediaAuditEvent({ ...base, detail: [{ label: 100 }] }, 'wx-app-id'))
      .toThrow('Malformed WeChat media audit result')
  })

  test.each([null, 'raw-json', [], 42])('rejects a malformed or non-object payload', (payload) => {
    expect(() => parseWechatMediaAuditEvent(payload, 'wx-app-id')).toThrow('Malformed WeChat callback payload')
  })

  test('rejects a missing trace_id', () => {
    const { trace_id: _traceId, ...withoutTraceId } = base
    expect(() => parseWechatMediaAuditEvent({ ...withoutTraceId, result: { suggest: 'pass' } }, 'wx-app-id'))
      .toThrow('Malformed WeChat media audit trace_id')
  })

  test('rejects a callback missing both result and detail', () => {
    expect(() => parseWechatMediaAuditEvent(base, 'wx-app-id')).toThrow('Malformed WeChat media audit result')
  })

  test('rejects encrypted callback payloads', () => {
    expect(() => parseWechatMediaAuditEvent({ Encrypt: 'ciphertext' }, 'wx-app-id'))
      .toThrow('Encrypted WeChat callbacks are unsupported')
  })
})
