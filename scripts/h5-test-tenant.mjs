#!/usr/bin/env node
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import CloudBase from '@cloudbase/manager-node'
import { resolveCloudBaseReleaseCredentials } from './lib/cloudbase-release-store.mjs'
import { COMMUNITY_ID, FIXTURE_KEY, applyTenant, buildManifest, canonicalFingerprint, createPrepareRecord, doctorTenant, planTenant, serializePrepareRecord } from './lib/h5-test-tenant.mjs'
import { withValidationLease } from './lib/validation-lease.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

export async function createCloudBaseTenantStore({ config, root = ROOT, env = process.env, home = homedir(), manager: injectedManager, db: injectedDb, queryPageSize = 100 }) {
  let manager = injectedManager
  let db = injectedDb
  if (!manager || !db) {
    const credentials = resolveCloudBaseReleaseCredentials({ env: { ...env, TCB_ENV: config.envId }, home })
    if (credentials.envId !== config.envId) throw new Error('CAM credential environment does not match HH_CLOUDBASE_ENV_ID')
    manager ||= new CloudBase({ envId: config.envId, secretId: credentials.secretId, secretKey: credentials.secretKey })
    const workspaceRequire = createRequire(resolve(root, 'cloud', 'package.json'))
    const sdk = workspaceRequire('@cloudbase/node-sdk')
    db ||= sdk.init({ env: config.envId, secretId: credentials.secretId, secretKey: credentials.secretKey }).database()
  }

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

  async function queryAll(collection, where) {
    const rows = []
    for (let offset = 0; ; offset += queryPageSize) {
      const response = await db.collection(collection).where(where).skip(offset).limit(queryPageSize).get()
      const page = response?.data || []
      rows.push(...page)
      if (page.length < queryPageSize) return rows
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
      const allSections = await queryAll('sections', { communityId: COMMUNITY_ID })
      for (const section of allSections) documents[`sections/${section._id}`] = section
      const postById = new Map((await queryAll('posts', { communityId: COMMUNITY_ID })).map((post) => [post._id, post]))
      for (const section of manifest.sections) {
        for (const post of await queryAll('posts', { sectionId: section._id })) postById.set(post._id, post)
      }
      for (const post of postById.values()) documents[`posts/${post._id}`] = post
      const membershipById = new Map((await queryAll('community_members', { communityId: COMMUNITY_ID })).map((member) => [member._id, member]))
      if (account) {
        for (const member of await queryAll('community_members', { userId: `web:${account.uuid}` })) membershipById.set(member._id, member)
      }
      const memberships = [...membershipById.values()]
      return { account, documents, memberships }
    },
    async createEndUser({ username, password }) {
      const response = await manager.user.createEndUser({ username, password })
      return { uuid: response.User.UUId, username: response.User.UserName }
    },
    async setDocument(collection, id, document, { expectedCurrentHash } = {}) {
      if (typeof expectedCurrentHash !== 'string') throw new Error('setDocument requires expectedCurrentHash')
      const data = structuredClone(document)
      delete data._id
      await db.runTransaction(async (transaction) => {
        const reference = transaction.collection(collection).doc(id)
        let current = null
        try {
          const response = await reference.get()
          current = Array.isArray(response?.data) ? response.data[0] : response?.data
        } catch (error) {
          if (!isMissing(error)) throw error
        }
        if (current && current.fixtureKey !== FIXTURE_KEY) throw new Error(`fixture ownership changed before write: ${collection}/${id}`)
        if (canonicalFingerprint(current) !== expectedCurrentHash) throw new Error(`current document changed before write: ${collection}/${id}`)
        await reference.set(data)
      })
    },
  }
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, home = homedir(), root = ROOT, stdout = console.log, storeFactory = createCloudBaseTenantStore, leaseWrapper = withValidationLease, operations = {} } = {}) {
  const command = argv[0]
  if (!['prepare', 'doctor', 'apply'].includes(command)) throw new Error('usage: npm run h5:test-tenant -- <prepare|apply|doctor>')
  const config = loadTenantConfig({ env, home })
  switch (command) {
    case 'prepare': {
      const store = await storeFactory({ config, root, env, home })
      const prepare = operations.prepare
        ? await operations.prepare({ store, config })
        : createPrepareRecord(await planTenant({ store, config }))
      const path = join(root, '.codex-local', 'h5-test-tenant', 'prepare.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, serializePrepareRecord(prepare), { encoding: 'utf8', mode: 0o600 })
      stdout(JSON.stringify({ ok: true, command, envId: config.envId, fixtureKey: FIXTURE_KEY, diff: prepare.diff, preparePath: path }))
      return prepare
    }
    case 'doctor': {
      const store = await storeFactory({ config, root, env, home })
      const result = operations.doctor ? await operations.doctor({ store, config }) : await doctorTenant({ store, config })
      stdout(JSON.stringify(result))
      return result
    }
    case 'apply': {
      if (env.HAPPYHOME_FIXTURE_PREFIX !== FIXTURE_KEY) throw new Error(`apply requires HAPPYHOME_FIXTURE_PREFIX=${FIXTURE_KEY}`)
      const argument = argv.slice(1).find((value) => value.startsWith('--manifest='))
      if (!argument?.slice('--manifest='.length)) throw new Error('apply requires --manifest=<prepare.json>')
      const path = resolve(argument.slice('--manifest='.length))
      if (!existsSync(path)) throw new Error(`apply requires prepare.json: run prepare first (${path})`)
      const prepare = JSON.parse(readFileSync(path, 'utf8'))
      const result = await leaseWrapper({ command: 'h5-test-tenant:apply' }, async () => {
        const store = await storeFactory({ config, root, env, home })
        return operations.apply
          ? await operations.apply({ store, config, prepare, env })
          : await applyTenant({ store, config, prepare, env })
      })
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
