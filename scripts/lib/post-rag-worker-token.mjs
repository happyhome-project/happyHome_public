import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function tokenFromEnv(env) {
  return String(env.POST_RAG_WORKER_TOKEN || env.HH_POST_RAG_WORKER_TOKEN || '').trim()
}

export function resolvePostRagWorkerToken(env = process.env) {
  const direct = tokenFromEnv(env)
  if (direct) return direct

  const home = os.homedir()
  for (const fileName of ['rag-worker.env', 'tencent-lkeap.env', 'cam.env']) {
    const fileEnv = loadDotEnvFile(path.join(home, '.happyhome', fileName))
    const token = tokenFromEnv(fileEnv)
    if (token) return token
  }
  return ''
}

export function requirePostRagWorkerToken(env = process.env) {
  const token = resolvePostRagWorkerToken(env)
  if (!token) {
    throw new Error('Missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN in env or ~/.happyhome/{rag-worker,tencent-lkeap,cam}.env')
  }
  return token
}
