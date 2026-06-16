import { randomBytes } from 'crypto'
import * as db from './db'
import type { User } from '../shared/types'

const TOKEN_PREFIX = 'hhpf_'
const TOKEN_BYTES = 24
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000

function nowMs() {
  return Date.now()
}

function isUsableToken(user: Partial<User> | null | undefined, now = nowMs()) {
  const token = String(user?.backgroundFetchToken || '')
  const expiresAt = Date.parse(String(user?.backgroundFetchTokenExpiresAt || ''))
  return token.startsWith(TOKEN_PREFIX) &&
    Number.isFinite(expiresAt) &&
    expiresAt - now > TOKEN_REFRESH_WINDOW_MS
}

function isValidToken(user: Partial<User> | null | undefined, now = nowMs()) {
  const token = String(user?.backgroundFetchToken || '')
  const expiresAt = Date.parse(String(user?.backgroundFetchTokenExpiresAt || ''))
  return token.startsWith(TOKEN_PREFIX) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
}

function createToken() {
  return `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`
}

export function buildBackgroundFetchTokenPatch() {
  const token = createToken()
  const expiresAt = new Date(nowMs() + TOKEN_TTL_MS).toISOString()
  return {
    backgroundFetchToken: token,
    backgroundFetchTokenExpiresAt: expiresAt,
  }
}

export async function ensureBackgroundFetchToken(
  openid: string,
  existingUser?: Partial<User> | null,
) {
  if (!openid) throw new Error('Missing OPENID')
  if (isUsableToken(existingUser)) {
    return {
      backgroundFetchToken: String(existingUser?.backgroundFetchToken || ''),
      backgroundFetchTokenExpiresAt: String(existingUser?.backgroundFetchTokenExpiresAt || ''),
      patch: {},
    }
  }

  const patch = buildBackgroundFetchTokenPatch()
  if (existingUser) {
    await db.updateById('users', openid, patch)
  }
  return { ...patch, patch }
}

export async function resolveOpenIdByBackgroundFetchToken(token: string): Promise<string> {
  const normalized = String(token || '').trim()
  if (!normalized.startsWith(TOKEN_PREFIX)) return ''
  const users = await db.query('users', {
    backgroundFetchToken: normalized,
  }, {
    limit: 1,
  }) as User[]
  const user = users[0]
  if (!user || !isValidToken(user)) return ''
  return user._id
}
