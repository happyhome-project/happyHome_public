#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureReleaseControlPlane, verifyReleaseControlPlane } from './lib/release-control-plane.mjs'

function readEnv(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(readFileSync(path, 'utf8').split(/\r?\n/).map((line) => {
    const index = line.indexOf('=')
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : []
  }).filter(([key]) => key))
}

const fileEnv = readEnv(join(homedir(), '.happyhome', 'cam.env'))
const secretId = process.env.TENCENTCLOUD_SECRETID || fileEnv.TENCENTCLOUD_SECRETID
const secretKey = process.env.TENCENTCLOUD_SECRETKEY || fileEnv.TENCENTCLOUD_SECRETKEY
const envId = process.env.TCB_ENV || fileEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'
if (!secretId || !secretKey) throw new Error('Missing CloudBase manager credentials for release control plane')

const db = CloudBase.init({ secretId, secretKey, envId }).database
const verifyOnly = process.argv.slice(2).includes('--verify-only')
const operation = verifyOnly ? verifyReleaseControlPlane : ensureReleaseControlPlane
await operation(db, { log: console.log })
