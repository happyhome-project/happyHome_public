import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { loadDotEnvFile } from './post-rag-worker-token.mjs'

const require = createRequire(import.meta.url)
const { signPostRagSmokeIdentity } = require('../../cloud/shared/post-rag-smoke-identity.cjs')

const SECRET_KEY = 'POST_RAG_SMOKE_IDENTITY_SECRET'
const SECRET_FILE_NAME = 'post-rag-smoke.env'

function fromEnv(values) {
  return String(values[SECRET_KEY] || values.HH_POST_RAG_SMOKE_IDENTITY_SECRET || '').trim()
}

export function resolvePostRagSmokeIdentitySecret(env = process.env, options = {}) {
  const direct = fromEnv(env)
  if (direct) return direct
  const home = options.home || homedir()
  const loadFile = options.loadFile || loadDotEnvFile
  return fromEnv(loadFile(join(home, '.happyhome', SECRET_FILE_NAME)))
}

export function ensurePostRagSmokeIdentitySecret(env = process.env, options = {}) {
  const existing = resolvePostRagSmokeIdentitySecret(env, options)
  if (existing) return existing

  const home = options.home || homedir()
  const filePath = join(home, '.happyhome', SECRET_FILE_NAME)
  const secret = randomBytes(32).toString('base64url')
  mkdirSync(join(home, '.happyhome'), { recursive: true })
  writeFileSync(filePath, `${SECRET_KEY}=${secret}\n`, { encoding: 'utf8', mode: 0o600 })
  return secret
}

export function requirePostRagSmokeIdentitySecret(env = process.env, options = {}) {
  const secret = resolvePostRagSmokeIdentitySecret(env, options)
  if (!secret) {
    throw new Error(`Missing ${SECRET_KEY} in env or ~/.happyhome/${SECRET_FILE_NAME}`)
  }
  return secret
}

export function createSignedPostRagSmokeIdentity(claims, secret) {
  return signPostRagSmokeIdentity(claims, secret)
}
