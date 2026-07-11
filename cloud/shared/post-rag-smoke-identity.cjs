'use strict'

const { createHmac, timingSafeEqual } = require('node:crypto')

const POST_RAG_SMOKE_IDENTITY_VERSION = 1
const MAX_POST_RAG_SMOKE_IDENTITY_TTL_MS = 5 * 60 * 1000
const MAX_POST_RAG_SMOKE_IDENTITY_CLOCK_SKEW_MS = 60 * 1000
const MIN_POST_RAG_SMOKE_SECRET_BYTES = 32

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return normalized && normalized.length <= maxLength ? normalized : ''
}

function normalizeClaims(value) {
  const version = Number(value?.version)
  const expiresAt = Number(value?.expiresAt)
  const claims = {
    version,
    action: normalizeText(value?.action, 64),
    communityId: normalizeText(value?.communityId, 256),
    runId: normalizeText(value?.runId, 256),
    userId: normalizeText(value?.userId, 512),
    expiresAt,
  }
  if (
    claims.version !== POST_RAG_SMOKE_IDENTITY_VERSION
    || !claims.action
    || !claims.communityId
    || !claims.runId
    || !claims.userId
    || !Number.isSafeInteger(claims.expiresAt)
  ) {
    return null
  }
  return claims
}

function serializePostRagSmokeIdentityClaims(claims) {
  return JSON.stringify({
    version: claims.version,
    action: claims.action,
    communityId: claims.communityId,
    runId: claims.runId,
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  })
}

function signPostRagSmokeIdentity(claims, secret) {
  const normalized = normalizeClaims(claims)
  const key = typeof secret === 'string' ? secret : ''
  if (!normalized) throw new Error('Invalid post RAG smoke identity claims')
  if (Buffer.byteLength(key, 'utf8') < MIN_POST_RAG_SMOKE_SECRET_BYTES) {
    throw new Error('POST_RAG_SMOKE_IDENTITY_SECRET must be at least 32 bytes')
  }
  return {
    ...normalized,
    signature: createHmac('sha256', key)
      .update(serializePostRagSmokeIdentityClaims(normalized), 'utf8')
      .digest('hex'),
  }
}

function verifyPostRagSmokeIdentity(value, { secret, action, communityId, now = Date.now() } = {}) {
  const claims = normalizeClaims(value)
  const key = typeof secret === 'string' ? secret : ''
  const signature = typeof value?.signature === 'string' ? value.signature : ''
  const expectedAction = normalizeText(action, 64)
  const expectedCommunityId = normalizeText(communityId, 256)

  if (
    !claims
    || !expectedAction
    || !expectedCommunityId
    || claims.action !== expectedAction
    || claims.communityId !== expectedCommunityId
    || claims.expiresAt <= now
    || claims.expiresAt > now + MAX_POST_RAG_SMOKE_IDENTITY_TTL_MS + MAX_POST_RAG_SMOKE_IDENTITY_CLOCK_SKEW_MS
    || !/^[a-f0-9]{64}$/i.test(signature)
    || Buffer.byteLength(key, 'utf8') < MIN_POST_RAG_SMOKE_SECRET_BYTES
  ) {
    return null
  }

  const expected = createHmac('sha256', key)
    .update(serializePostRagSmokeIdentityClaims(claims), 'utf8')
    .digest()
  const received = Buffer.from(signature, 'hex')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  return claims
}

module.exports = {
  POST_RAG_SMOKE_IDENTITY_VERSION,
  MAX_POST_RAG_SMOKE_IDENTITY_TTL_MS,
  MAX_POST_RAG_SMOKE_IDENTITY_CLOCK_SKEW_MS,
  signPostRagSmokeIdentity,
  verifyPostRagSmokeIdentity,
}
