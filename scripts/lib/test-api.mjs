import http from 'node:http'
import https from 'node:https'

export const BASE = String(
  process.env.CLOUD_API_URL || 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com'
).replace(/\/+$/, '')

export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

export function makeRunId() {
  return Date.now().toString(36)
}

export function getErrorMessage(error) {
  return String(
    error?.response?.data?.error ||
    error?.data?.error ||
    error?.message ||
    error ||
    'unknown error'
  )
}

export function isNotFoundError(error) {
  return /not found|does not exist/i.test(getErrorMessage(error))
}

export function isAlreadyDisabledError(error) {
  return /only active community can be disabled/i.test(getErrorMessage(error))
}

export function isAlreadyDeletedError(error) {
  return /not found/i.test(getErrorMessage(error))
}

function request(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body)
    const req = transport.request(
      {
        method: 'POST',
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          let parsed = {}
          try {
            parsed = raw ? JSON.parse(raw) : {}
          } catch {
            parsed = { raw }
          }
          resolve({ statusCode: res.statusCode || 0, data: parsed })
        })
      }
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

export async function callAs(openid, fnName, action, params = {}) {
  const res = await request(
    `${BASE}/http-gateway`,
    { _fn: fnName, action, ...params },
    { authorization: `Bearer ${ADMIN_TOKEN}`, 'x-test-openid': openid },
  )

  if (res.statusCode !== 200) {
    const err = new Error(`[${fnName}/${action}] ${res.statusCode}: ${res.data?.error || JSON.stringify(res.data)}`)
    err.statusCode = res.statusCode
    err.data = res.data
    throw err
  }

  return res.data
}

export async function callAdmin(action, params = {}) {
  const res = await request(
    `${BASE}/admin`,
    { action, ...params },
    { authorization: `Bearer ${ADMIN_TOKEN}` },
  )

  if (res.statusCode !== 200) {
    const err = new Error(`[admin/${action}] ${res.statusCode}: ${res.data?.error || JSON.stringify(res.data)}`)
    err.statusCode = res.statusCode
    err.data = res.data
    throw err
  }

  return res.data
}

export async function callAdminRaw(token, action, params = {}) {
  return request(
    `${BASE}/admin`,
    { action, ...params },
    { authorization: `Bearer ${token}` },
  )
}

export function createCleanupRegistry() {
  const communityIds = new Set()
  const issues = []

  return {
    trackCommunity(communityId) {
      const normalized = String(communityId || '').trim()
      if (normalized) communityIds.add(normalized)
      return normalized
    },
    getTrackedCommunities() {
      return [...communityIds]
    },
    getIssues() {
      return [...issues]
    },
    async cleanupAll(logger = console) {
      for (const communityId of communityIds) {
        try {
          await cleanupCommunity(communityId, logger)
        } catch (error) {
          issues.push({ communityId, message: getErrorMessage(error) })
        }
      }

      return {
        ok: issues.length === 0,
        communities: [...communityIds],
        issues: [...issues],
      }
    },
  }
}

export async function cleanupCommunity(communityId, logger = console) {
  const normalized = String(communityId || '').trim()
  if (!normalized) return { communityId: normalized, skipped: true }

  try {
    await callAdmin('community.disable', { communityId: normalized })
    logger.log(`[cleanup] disabled community ${normalized}`)
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.log(`[cleanup] community already gone: ${normalized}`)
      return { communityId: normalized, skipped: true }
    }
    if (!isAlreadyDisabledError(error)) {
      throw error
    }
    logger.log(`[cleanup] community already disabled: ${normalized}`)
  }

  try {
    await callAdmin('community.hardDelete', { communityId: normalized })
    logger.log(`[cleanup] hard-deleted community ${normalized}`)
  } catch (error) {
    if (isAlreadyDeletedError(error)) {
      logger.log(`[cleanup] community already hard-deleted: ${normalized}`)
      return { communityId: normalized, skipped: true }
    }
    throw error
  }

  return { communityId: normalized, cleaned: true }
}
