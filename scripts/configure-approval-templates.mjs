#!/usr/bin/env node
/**
 * Discover or add WeChat Mini Program subscription message templates.
 *
 * Read-only discovery:
 *   node scripts/configure-approval-templates.mjs discover
 *
 * Add templates by explicit title id + keyword ids:
 *   node scripts/configure-approval-templates.mjs add \
 *     --member-tid=123 --member-kids=1,2,3,4 \
 *     --community-tid=456 --community-kids=1,2,3,4
 *
 * Optional field maps match each selected kid by position:
 *   --member-map=communityName,action,time
 *   --community-map=communityName,action,time,status
 *
 * The script reads CAM keys from ~/.happyhome/cam.env, then reads WX_APPID /
 * WX_APPSECRET from the admin cloud function env unless provided locally.
 */
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { URL } from 'node:url'

const ENV_ID_DEFAULT = 'cloudbase-3gh862acb1505ff3'
const DEFAULT_FIELDS = {
  communityName: 'thing1',
  action: 'thing2',
  time: 'time3',
  status: 'phrase4',
}
const DEFAULT_FIELD_ORDER = ['communityName', 'action', 'time', 'status']

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
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

function getArg(name) {
  const prefix = `--${name}=`
  const hit = process.argv.find((arg) => arg.startsWith(prefix))
  return hit ? hit.slice(prefix.length).trim() : ''
}

function envValue(fileEnv, key, fallback = '') {
  return String(process.env[key] || fileEnv[key] || fallback).trim()
}

function httpsJson(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const rawBody = body === undefined ? undefined : JSON.stringify(body)
    const headers = {}
    if (rawBody !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(rawBody)
    }
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8')
        try {
          resolve(JSON.parse(text))
        } catch {
          reject(new Error(`Non-JSON response from ${u.hostname}: ${text.slice(0, 200)}`))
        }
      })
    })
    req.on('error', reject)
    if (rawBody !== undefined) req.write(rawBody)
    req.end()
  })
}

async function getAdminFunctionEnv(app) {
  const detail = await app.functions.getFunctionDetail('admin')
  const out = {}
  for (const item of detail?.Environment?.Variables || []) {
    out[item.Key] = item.Value
  }
  return out
}

async function getAccessToken(appid, secret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`
  const json = await httpsJson('GET', url)
  if (!json?.access_token) {
    throw new Error(`fetch access_token failed: errcode=${json?.errcode} errmsg=${json?.errmsg || JSON.stringify(json)}`)
  }
  return json.access_token
}

async function wxGet(accessToken, pathAndQuery) {
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  const json = await httpsJson('GET', `https://api.weixin.qq.com${pathAndQuery}${sep}access_token=${encodeURIComponent(accessToken)}`)
  if (json.errcode && json.errcode !== 0) {
    throw new Error(`WeChat API failed ${pathAndQuery}: errcode=${json.errcode} errmsg=${json.errmsg}`)
  }
  return json
}

async function wxPost(accessToken, pathAndQuery, body) {
  const sep = pathAndQuery.includes('?') ? '&' : '?'
  const json = await httpsJson('POST', `https://api.weixin.qq.com${pathAndQuery}${sep}access_token=${encodeURIComponent(accessToken)}`, body)
  if (json.errcode && json.errcode !== 0) {
    throw new Error(`WeChat API failed ${pathAndQuery}: errcode=${json.errcode} errmsg=${json.errmsg}`)
  }
  return json
}

function parseKids(value, label) {
  const kids = String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0)
  if (kids.length < 2 || kids.length > 5) {
    throw new Error(`${label} must contain 2-5 numeric keyword ids, e.g. 1,2,3,4`)
  }
  return kids
}

function parseFieldMap(value, kidCount, label) {
  const map = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const finalMap = map.length > 0 ? map : DEFAULT_FIELD_ORDER.slice(0, kidCount)
  if (finalMap.length !== kidCount) {
    throw new Error(`${label} must contain exactly ${kidCount} field names`)
  }
  const allowed = new Set(DEFAULT_FIELD_ORDER)
  for (const item of finalMap) {
    if (!allowed.has(item)) throw new Error(`${label} contains unsupported field name: ${item}`)
  }
  return finalMap
}

function sameArray(a, b) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function fieldKeyForRule(rule, index) {
  const normalized = String(rule || '').trim()
  if (!normalized) return `thing${index}`
  return `${normalized}${index}`
}

async function deriveTemplateFields(accessToken, tid, kidList, fieldMap) {
  const keywords = await wxGet(accessToken, `/wxaapi/newtmpl/getpubtemplatekeywords?tid=${encodeURIComponent(tid)}`)
  const byKid = new Map((keywords.data || []).map((item) => [Number(item.kid), item]))
  const fields = {}
  kidList.forEach((kid, index) => {
    const keyword = byKid.get(kid)
    if (!keyword) throw new Error(`kid ${kid} not found under tid ${tid}`)
    fields[fieldMap[index]] = fieldKeyForRule(keyword.rule, index + 1)
  })
  return fields
}

function printCandidateTitles(titles) {
  const wanted = titles.filter((item) => /审批|审核|申请|加入|创建|提醒|通知/.test(String(item.title || '')))
  console.log('\n[discover] candidate titles:')
  console.table(wanted.slice(0, 80).map((item) => ({
    tid: item.tid,
    title: item.title,
    type: item.type,
    categoryId: item.categoryId,
  })))
}

async function discover(accessToken) {
  const categories = await wxGet(accessToken, '/wxaapi/newtmpl/getcategory')
  const categoryIds = (categories.data || []).map((item) => String(item.id)).filter(Boolean)
  console.log('[discover] categories:')
  console.table((categories.data || []).map((item) => ({ id: item.id, name: item.name })))

  if (categoryIds.length === 0) {
    console.log('[discover] no category found; cannot query public template titles.')
    return
  }

  const allTitles = []
  for (let i = 0; i < categoryIds.length; i += 5) {
    const ids = categoryIds.slice(i, i + 5).join(',')
    let start = 0
    while (start < 300) {
      const page = await wxGet(accessToken, `/wxaapi/newtmpl/getpubtemplatetitles?ids=${encodeURIComponent(ids)}&start=${start}&limit=30`)
      allTitles.push(...(page.data || []))
      if (!page.data || page.data.length < 30) break
      start += 30
    }
  }

  printCandidateTitles(allTitles)

  const tid = getArg('keywords-tid')
  if (tid) {
    const keywords = await wxGet(accessToken, `/wxaapi/newtmpl/getpubtemplatekeywords?tid=${encodeURIComponent(tid)}`)
    console.log(`\n[discover] keywords for tid=${tid}:`)
    console.table((keywords.data || []).map((item) => ({
      kid: item.kid,
      name: item.name,
      rule: item.rule,
      example: item.example,
    })))
  } else {
    console.log('\n[discover] pass --keywords-tid=<tid> to inspect keyword ids for a candidate title.')
  }
}

async function updateFunctionEnv(app, functionName, targetEnv) {
  const detail = await app.functions.getFunctionDetail(functionName)
  const existing = {}
  for (const item of detail?.Environment?.Variables || []) {
    existing[item.Key] = item.Value
  }
  await app.functions.updateFunctionConfig({ name: functionName, envVariables: { ...existing, ...targetEnv } })
}

async function add(accessToken, app) {
  const memberTid = getArg('member-tid')
  const communityTid = getArg('community-tid')
  const memberKids = parseKids(getArg('member-kids'), '--member-kids')
  const communityKids = parseKids(getArg('community-kids'), '--community-kids')
  const memberMap = parseFieldMap(getArg('member-map'), memberKids.length, '--member-map')
  const communityMap = parseFieldMap(getArg('community-map'), communityKids.length, '--community-map')
  if (!memberTid || !communityTid) throw new Error('--member-tid and --community-tid are required')

  const [memberFields, communityFields] = await Promise.all([
    deriveTemplateFields(accessToken, memberTid, memberKids, memberMap),
    deriveTemplateFields(accessToken, communityTid, communityKids, communityMap),
  ])

  const useSingleTemplate =
    String(memberTid) === String(communityTid) &&
    sameArray(memberKids, communityKids) &&
    sameArray(memberMap, communityMap)

  const member = await wxPost(accessToken, '/wxaapi/newtmpl/addtemplate', {
    tid: memberTid,
    kidList: memberKids,
    sceneDesc: useSingleTemplate ? '审批待办提醒' : '成员审批提醒',
  })
  const community = useSingleTemplate
    ? member
    : await wxPost(accessToken, '/wxaapi/newtmpl/addtemplate', {
      tid: communityTid,
      kidList: communityKids,
      sceneDesc: '社区审批提醒',
    })

  const memberTemplateId = member.priTmplId
  const communityTemplateId = community.priTmplId
  if (!memberTemplateId || !communityTemplateId) {
    throw new Error(`addtemplate returned no priTmplId: ${JSON.stringify({ member, community })}`)
  }

  await updateFunctionEnv(app, 'member', {
    APPROVAL_MEMBER_JOIN_TEMPLATE_ID: memberTemplateId,
    APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS: JSON.stringify(memberFields),
  })
  await updateFunctionEnv(app, 'community', {
    APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID: communityTemplateId,
    APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS: JSON.stringify(communityFields),
  })

  console.log('[add] templates added and cloud function env updated.')
  console.table([
    { key: 'APPROVAL_MEMBER_JOIN_TEMPLATE_ID', value: memberTemplateId },
    { key: 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID', value: communityTemplateId },
    { key: 'APPROVAL_MEMBER_JOIN_TEMPLATE_FIELDS', value: JSON.stringify(memberFields) },
    { key: 'APPROVAL_COMMUNITY_CREATE_TEMPLATE_FIELDS', value: JSON.stringify(communityFields) },
    { key: 'VITE_APPROVAL_MEMBER_JOIN_TEMPLATE_ID', value: memberTemplateId },
    { key: 'VITE_APPROVAL_COMMUNITY_CREATE_TEMPLATE_ID', value: communityTemplateId },
  ])
}

const command = process.argv[2] || 'discover'
if (!['discover', 'add'].includes(command)) {
  console.error('Usage: node scripts/configure-approval-templates.mjs discover [--keywords-tid=123]')
  console.error('   or: node scripts/configure-approval-templates.mjs add --member-tid=123 --member-kids=1,2,3 --member-map=communityName,action,time --community-tid=456 --community-kids=1,2,3,4 --community-map=communityName,action,time,status')
  process.exit(1)
}

const fileEnv = loadDotEnvFile(path.join(os.homedir(), '.happyhome', 'cam.env'))
const ENV_ID = envValue(fileEnv, 'TCB_ENV', ENV_ID_DEFAULT)
const SECRET_ID = envValue(fileEnv, 'TENCENTCLOUD_SECRETID')
const SECRET_KEY = envValue(fileEnv, 'TENCENTCLOUD_SECRETKEY')
if (!SECRET_ID || !SECRET_KEY) throw new Error('Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY')

const app = CloudBase.init({ secretId: SECRET_ID, secretKey: SECRET_KEY, envId: ENV_ID })
const adminEnv = await getAdminFunctionEnv(app)
const WX_APPID = envValue({ ...fileEnv, ...adminEnv }, 'WX_APPID')
const WX_APPSECRET = envValue({ ...fileEnv, ...adminEnv }, 'WX_APPSECRET')
if (!WX_APPID || !WX_APPSECRET) throw new Error('Missing WX_APPID / WX_APPSECRET in local env or admin function env')

const accessToken = await getAccessToken(WX_APPID, WX_APPSECRET)
if (command === 'discover') await discover(accessToken)
if (command === 'add') await add(accessToken, app)
