#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEFAULT_RAG_NETWORK_FUNCTIONS = ['post', 'post-rag-worker']

function loadDotEnvFile(filePath) {
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

function getFlagValue(argv, name, fallback = '') {
  const equalsArg = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (equalsArg) return equalsArg.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return fallback
}

function uniqueNames(names) {
  const out = []
  const seen = new Set()
  for (const rawName of names || []) {
    const name = String(rawName || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function buildRagNetworkFunctionConfigs(options = {}) {
  const vpcId = String(options.vpcId || '').trim()
  const subnetId = String(options.subnetId || '').trim()
  const functions = uniqueNames(options.functions?.length ? options.functions : DEFAULT_RAG_NETWORK_FUNCTIONS)
  if (!vpcId) throw new Error('vpcId is required')
  if (!subnetId) throw new Error('subnetId is required')
  if (functions.length === 0) throw new Error('at least one function name is required')
  return functions.map((name) => ({
    name,
    vpc: { vpcId, subnetId },
  }))
}

function normalizeVpcConfig(value) {
  return {
    vpcId: String(value?.VpcId || value?.vpcId || value?.Vpc?.VpcId || value?.Vpc?.vpcId || value?.vpc?.VpcId || value?.vpc?.vpcId || '').trim(),
    subnetId: String(value?.SubnetId || value?.subnetId || value?.Subnet?.SubnetId || value?.Subnet?.subnetId || value?.subnet?.SubnetId || value?.subnet?.subnetId || '').trim(),
  }
}

export async function applyRagNetworkConfig(app, configs) {
  const results = []
  for (const config of configs) {
    const detail = await app.functions.getFunctionDetail(config.name)
    const previousVpc = normalizeVpcConfig(detail?.VpcConfig)
    const targetVpc = {
      vpcId: config.vpc.vpcId,
      subnetId: config.vpc.subnetId,
    }
    const changed = previousVpc.vpcId !== targetVpc.vpcId || previousVpc.subnetId !== targetVpc.subnetId
    if (changed) {
      await app.functions.updateFunctionConfig({
        name: config.name,
        vpc: targetVpc,
      })
    }
    results.push({
      name: config.name,
      changed,
      previousVpc,
      targetVpc,
    })
  }
  return results
}

export function parseConfigureRagNetworkArgs(argv = process.argv.slice(2), env = process.env) {
  const home = os.homedir()
  const camEnv = loadDotEnvFile(path.join(home, '.happyhome', 'cam.env'))
  const ragEnv = loadDotEnvFile(path.join(home, '.happyhome', 'tencent-rag.env'))
  const only = getFlagValue(argv, 'only', env.HH_RAG_NETWORK_FUNCTIONS || '')
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    dryRun: argv.includes('--dry-run'),
    envId: getFlagValue(argv, 'env-id', env.TCB_ENV || camEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'),
    secretId: env.TENCENTCLOUD_SECRETID || camEnv.TENCENTCLOUD_SECRETID,
    secretKey: env.TENCENTCLOUD_SECRETKEY || camEnv.TENCENTCLOUD_SECRETKEY,
    vpcId: getFlagValue(argv, 'vpc-id', env.TENCENT_RAG_VPC_ID || ragEnv.TENCENT_RAG_VPC_ID || ''),
    subnetId: getFlagValue(argv, 'subnet-id', env.TENCENT_RAG_SUBNET_ID || ragEnv.TENCENT_RAG_SUBNET_ID || ''),
    functions: only
      ? only.split(',').map((item) => item.trim()).filter(Boolean)
      : DEFAULT_RAG_NETWORK_FUNCTIONS,
  }
}

function printUsage() {
  console.log(`Usage:
  npm run configure:rag-network -- --vpc-id <vpcId> --subnet-id <subnetId>

Options:
  --dry-run              Print target config without applying it.
  --vpc-id <vpcId>       Tencent VPC id. Can also come from ~/.happyhome/tencent-rag.env.
  --subnet-id <id>       Tencent subnet id. Can also come from ~/.happyhome/tencent-rag.env.
  --only <a,b>           Functions to configure. Defaults to ${DEFAULT_RAG_NETWORK_FUNCTIONS.join(',')}.
  --env-id <envId>       CloudBase env id.
`)
}

async function main() {
  const options = parseConfigureRagNetworkArgs()
  if (options.help) {
    printUsage()
    return
  }
  if (!options.secretId || !options.secretKey) {
    throw new Error('Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY in env or ~/.happyhome/cam.env')
  }
  const configs = buildRagNetworkFunctionConfigs(options)
  if (options.dryRun) {
    console.log(JSON.stringify({ envId: options.envId, configs }, null, 2))
    return
  }
  const app = CloudBase.init({ secretId: options.secretId, secretKey: options.secretKey, envId: options.envId })
  const results = await applyRagNetworkConfig(app, configs)
  console.log(JSON.stringify({ envId: options.envId, results }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[configure-rag-network] FAILED: ${error?.stack || error?.message || error}`)
    process.exit(1)
  })
}
