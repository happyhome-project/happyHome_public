import os from 'node:os'
import path from 'node:path'

import { loadDotEnvFile } from './post-rag-worker-token.mjs'

export function resolveAdminInternalToken(env = process.env, options = {}) {
  const direct = String(env.ADMIN_INTERNAL_CALL_TOKEN || '').trim()
  if (direct) return direct

  const home = options.home || os.homedir()
  const loadFile = options.loadFile || loadDotEnvFile
  const fileEnv = loadFile(path.join(home, '.happyhome', 'admin-internal.env'))
  return String(fileEnv.ADMIN_INTERNAL_CALL_TOKEN || '').trim()
}

export function requireAdminInternalToken(env = process.env, options = {}) {
  const token = resolveAdminInternalToken(env, options)
  if (!token) {
    throw new Error('Missing ADMIN_INTERNAL_CALL_TOKEN in env or ~/.happyhome/admin-internal.env')
  }
  return token
}
