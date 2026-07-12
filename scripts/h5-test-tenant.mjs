#!/usr/bin/env node
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import CloudBase from '@cloudbase/manager-node'
import { resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import { COMMUNITY_ID, FIXTURE_KEY, applyTenant, buildManifest, createPrepareRecord, doctorTenant, planTenant, serializePrepareRecord } from './lib/h5-test-tenant.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PREPARE_PATH = join(ROOT, '.codex-local', 'h5-test-tenant', 'prepare.json')
const REQUIRED_CONFIG = ['HH_CLOUDBASE_ENV_ID', 'HH_CLOUDBASE_ACCESS_KEY', 'HH_H5_WEB_USERNAME', 'HH_H5_WEB_PASSWORD', 'HH_WECHAT_TEST_OPENID']

function parseEnvFile(path) {
  if (!existsSync(path)) throw new Error(`missing machine config: ${path}`)
  const values = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    let value = line.slice(separator + 1).trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    values[line.slice(0, separator).trim()] = value
  }
  return values
}

export function loadTenantConfig({ env = process.env, home = homedir() } = {}) {
  const values = { ...parseEnvFile(join(home, '.happyhome', 'h5-web.env')), ...env }
  const missing = REQUIRED_CONFIG.filter((key) => !String(values[key] || '').trim())
  if (missing.length) throw new Error(`missing H5 test tenant config: ${missing.join(', ')}`)
  return {
    envId: values.HH_CLOUDBASE_ENV_ID.trim(),
    accessKey: values.HH_CLOUDBASE_ACCESS_KEY.trim(),
    username: values.HH_H5_WEB_USERNAME.trim(),
    password: values.HH_H5_WEB_PASSWORD,
    wechatOpenid: values.HH_WECHAT_TEST_OPENID.trim(),
  }
}

function isMissing(error) {
  return /document(?:\.get)?:fail[\s\S]*(?:does not exist|not found)|document not found|db or table not exist/i.test(String(error?.message || error))
}

export async function createCloudBaseTenantStore({ config, root = ROOT, env = process.env, home = homedir() }) {
  const credentials = resolveCloudBaseReleaseCredentials({ env: { ...env, TCB_ENV: config.envId }, home })
  if (credentials.envId !== config.envId) throw new Error('CAM credential environment does not match HH_CLOUDBASE_ENV_ID')
  const manager = new CloudBase({ envId: config.envId, secretId: credentials.secretId, secretKey: credentials.secretKey })
  const workspaceRequire = createRequire(resolve(root, 'cloud', 'package.json'))
  const sdk = workspaceRequire('@cloudbase/node-sdk')
  const db = sdk.init({ env: config.envId, secretId: credentials.secretId, secretKey: credentials.secretKey }).database()

  async function getDocument(collection, id) {
    try {
      const response = await db.collection(collection).doc(id).get()
      const row = Array.isArray(response?.data) ? response.data[0] : response?.data
      return row || null
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async function findAccount(username) {
    let offset = 0
    while (true) {
      const page = await manager.user.getEndUserList({ limit: 100, offset })
      const found = (page.Users || []).find((user) => user.UserName === username)
      if (found) return { uuid: found.UUId, username: found.UserName, disabled: found.IsDisabled }
      offset += (page.Users || []).length
      if (offset >= Number(page.Total || 0) || !(page.Users || []).length) return null
    }
  }

  return {
    async inspect({ username, wechatOpenid }) {
      const account = await findAccount(username)
      const manifest = buildManifest({ webUserId: account ? `web:${account.uuid}` : null, wechatOpenid })
      const entries = [
        ...manifest.users.map((doc) => ['users', doc._id]),
        ...manifest.memberships.map((doc) => ['community_members', doc._id]),
        ...manifest.communities.map((doc) => ['communities', doc._id]),
        ...manifest.sections.map((doc) => ['sections', doc._id]),
        ...manifest.posts.map((doc) => ['posts', doc._id]),
      ]
      if (!account) entries.push(['community_members', 'hh-web-h5-v1-member-web'])
      const documents = {}
      for (const [collection, id] of entries) {
        const document = await getDocument(collection, id)
        if (document) documents[`${collection}/${id}`] = document
      }
      const sectionResponse = await db.collection('sections').where({ communityId: COMMUNITY_ID }).limit(1000).get()
      for (const section of sectionResponse?.data || []) documents[`sections/${section._id}`] = section
      for (const section of sectionResponse?.data || []) {
        const postResponse = await db.collection('posts').where({ sectionId: section._id }).limit(1000).get()
        for (const post of postResponse?.data || []) documents[`posts/${post._id}`] = post
      }
      let memberships = []
      if (account) {
        const response = await db.collection('community_members').where({ userId: `web:${account.uuid}` }).limit(1000).get()
        memberships = response?.data || []
      }
      return { account, documents, memberships }
    },
    async createEndUser({ username, password }) {
      const response = await manager.user.createEndUser({ username, password })
      return { uuid: response.User.UUId, username: response.User.UserName }
    },
    async setDocument(collection, id, document) {
      const data = structuredClone(document)
      delete data._id
      await db.collection(collection).doc(id).set(data)
    },
  }
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, home = homedir(), root = ROOT, stdout = console.log } = {}) {
  const command = argv[0]
  if (!['prepare', 'doctor', 'apply'].includes(command)) throw new Error('usage: npm run h5:test-tenant -- <prepare|apply|doctor>')
  const config = loadTenantConfig({ env, home })
  const store = await createCloudBaseTenantStore({ config, root, env, home })
  switch (command) {
    case 'prepare': {
      const prepare = createPrepareRecord(await planTenant({ store, config }))
      const path = join(root, '.codex-local', 'h5-test-tenant', 'prepare.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, serializePrepareRecord(prepare), { encoding: 'utf8', mode: 0o600 })
      stdout(JSON.stringify({ ok: true, command, envId: config.envId, fixtureKey: FIXTURE_KEY, diff: prepare.diff, preparePath: path }))
      return prepare
    }
    case 'doctor': {
      const result = await doctorTenant({ store, config })
      stdout(JSON.stringify(result))
      return result
    }
    case 'apply': {
      if (env.HAPPYHOME_FIXTURE_PREFIX !== FIXTURE_KEY) throw new Error(`apply requires HAPPYHOME_FIXTURE_PREFIX=${FIXTURE_KEY}`)
      const path = root === ROOT ? PREPARE_PATH : join(root, '.codex-local', 'h5-test-tenant', 'prepare.json')
      if (!existsSync(path)) throw new Error(`apply requires prepare.json: run prepare first (${path})`)
      const prepare = JSON.parse(readFileSync(path, 'utf8'))
      const result = await applyTenant({ store, config, prepare, env })
      stdout(JSON.stringify(result))
      return result
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(`[h5-test-tenant] ${error.message}`)
    process.exitCode = 1
  })
}
