#!/usr/bin/env node
/**
 * Sync approval notification template config to CloudBase functions.
 *
 * Required env:
 *   APPROVAL_MEMBER_JOIN_TEMPLATE_ID
 *   APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID
 *
 * Optional env:
 *   APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS
 *   APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS
 *
 * CAM credentials are loaded from ~/.happyhome/cam.env or process env.
 */
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_FIELDS = JSON.stringify({
  communityName: 'thing1',
  action: 'thing2',
  time: 'time3',
  status: 'phrase4',
})

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const out = {}
  for (const rawLine of content.split(/\r?\n/)) {
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

function envValue(fileEnv, key, fallback = '') {
  return String(process.env[key] || fileEnv[key] || fallback).trim()
}

function normalizeFields(raw, name) {
  const value = String(raw || DEFAULT_FIELDS).trim()
  try {
    const parsed = JSON.parse(value)
    for (const key of ['communityName', 'action', 'time']) {
      if (!parsed[key]) throw new Error(`missing ${key}`)
    }
    return JSON.stringify(parsed)
  } catch (error) {
    throw new Error(`${name} must be valid JSON with communityName/action/time fields; status is optional: ${error?.message || error}`)
  }
}

async function updateFunctionEnv(app, functionName, targetEnv) {
  const detail = await app.functions.getFunctionDetail(functionName)
  const existing = {}
  for (const item of detail?.Environment?.Variables || []) {
    existing[item.Key] = item.Value
  }
  const merged = { ...existing, ...targetEnv }
  await app.functions.updateFunctionConfig({ name: functionName, envVariables: merged })
  console.log(`[approval-env] ${functionName} updated:`)
  console.table(Object.entries(targetEnv).map(([Key, Value]) => ({ Key, Value })))
}

const fileEnv = loadDotEnvFile(path.join(os.homedir(), '.happyhome', 'cam.env'))
const ENV_ID = envValue(fileEnv, 'TCB_ENV', 'cloudbase-3gh862acb1505ff3')
const SECRET_ID = envValue(fileEnv, 'TENCENTCLOUD_SECRETID')
const SECRET_KEY = envValue(fileEnv, 'TENCENTCLOUD_SECRETKEY')

const memberTemplateId = envValue(fileEnv, 'APPROVAL_MEMBER_JOIN_TEMPLATE_ID')
const communityTemplateId = envValue(fileEnv, 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID')
const memberFields = normalizeFields(envValue(fileEnv, 'APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS', DEFAULT_FIELDS), 'APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS')
const communityFields = normalizeFields(envValue(fileEnv, 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS', DEFAULT_FIELDS), 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS')

if (!SECRET_ID || !SECRET_KEY) {
  console.error('[approval-env] Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')
  process.exit(1)
}
if (!memberTemplateId || !communityTemplateId) {
  console.error('[approval-env] Missing APPROVAL_MEMBER_JOIN_TEMPLATE_ID / APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID')
  process.exit(1)
}

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })

await updateFunctionEnv(app, 'member', {
  APPROVAL_MEMBER_JOIN_TEMPLATE_ID: memberTemplateId,
  APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS: memberFields,
})

await updateFunctionEnv(app, 'community', {
  APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID: communityTemplateId,
  APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS: communityFields,
})

console.log('\n✓ Approval notification env synced. Deploy/restart the changed cloud functions before live testing.')
