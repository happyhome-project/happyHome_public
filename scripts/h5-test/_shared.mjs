// Shared helpers for individual H5 test scenario scripts.
// Each scenario imports from here; no state is shared between runs.

import http from 'node:http'
import https from 'node:https'

export const BASE = (process.env.CLOUD_API_URL || 'https://cloudbase-3gh862acb1505ff3-1307183045.ap-shanghai.app.tcloudbase.com').replace(/\/+$/, '')
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'happyhome-admin-2024'

function request(url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const transport = u.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body)
    const req = transport.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers,
      },
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        let parsed = {}
        try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { raw } }
        resolve({ statusCode: res.statusCode || 0, data: parsed })
      })
    })
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
    const msg = res.data?.error || JSON.stringify(res.data)
    const err = new Error(`[${fnName}/${action}] ${res.statusCode}: ${msg}`)
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
    throw new Error(`[admin ${action}] ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }
  return res.data
}

export function makeRunId() {
  return Date.now().toString(36)
}

// Simple assert helper that tracks pass/fail per scenario and exits with correct code.
export function createAsserter(scenarioName) {
  let passed = 0, failed = 0
  const assert = (cond, msg) => {
    if (cond) { passed++; console.log(`  ✓ ${msg}`) }
    else { failed++; console.error(`  ✗ ${msg}`) }
  }
  const expectReject = async (fn, label) => {
    try {
      await fn()
      failed++
      console.error(`  ✗ ${label}: expected rejection but succeeded`)
    } catch (err) {
      passed++
      console.log(`  ✓ ${label} (${String(err.message).slice(0, 80)})`)
    }
  }
  const finish = () => {
    console.log(`\n[${scenarioName}] ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  }
  return { assert, expectReject, finish }
}

// Helper to set up a fresh community + section + widget for scenarios that need one.
// Returns { ownerOpenid, communityId, sectionId, widgetId }.
export async function seedApprovedCommunity(runId) {
  const owner = `seed-owner-${runId}`
  await callAs(owner, 'user', 'login', { nickName: `Seeder-${runId}`, avatarUrl: '' })
  const { communityId } = await callAs(owner, 'community', 'create', {
    name: `Scenario社区-${runId}`,
    description: 'seeded by scenario script',
    coverImage: '',
    location: { province: 'P', city: 'C', district: 'D', address: 'A' },
    joinType: 'open',
  })
  await callAdmin('community.approve', { communityId })
  const { sectionId } = await callAdmin('section.create', {
    communityId, name: '默认板块', icon: '📋', order: 0,
  })
  const { widgets } = await callAdmin('section.updateWidgets', {
    sectionId,
    widgets: [{ type: 'text', label: '内容', required: true, showInList: true, widgetId: '' }],
  })
  return { ownerOpenid: owner, communityId, sectionId, widgetId: widgets[0].widgetId }
}
