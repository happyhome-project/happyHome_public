#!/usr/bin/env node
import CloudBase from '@cloudbase/manager-node'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'

export const DEFAULT_RAG_WORKER_TIMEOUT_SECONDS = 120
export const DEFAULT_RAG_WORKER_MEMORY_MB = 512
export const DEFAULT_POST_RAG_CRON = '0 */5 * * * * *'
export const DEFAULT_POST_VIDEO_RAG_CRON = '0 */10 * * * * *'

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

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function buildRagWorkerFunctionConfigs(options = {}) {
  const timeout = positiveInt(options.timeoutSeconds, DEFAULT_RAG_WORKER_TIMEOUT_SECONDS)
  const memorySize = positiveInt(options.memorySizeMb, DEFAULT_RAG_WORKER_MEMORY_MB)
  const workerToken = String(options.workerToken || '').trim()
  const ragCron = String(options.ragCron || DEFAULT_POST_RAG_CRON).trim()
  const videoCron = String(options.videoCron || DEFAULT_POST_VIDEO_RAG_CRON).trim()
  const base = {
    timeout,
    memorySize,
    envVariables: {
      POST_RAG_WORKER_TOKEN: workerToken,
    },
  }
  return [
    {
      name: 'post-rag-worker',
      ...base,
      triggers: [{ name: 'post-rag-worker-every-5-min', type: 'timer', config: ragCron }],
    },
    {
      name: 'post-video-rag-worker',
      ...base,
      triggers: [{ name: 'post-video-rag-worker-every-10-min', type: 'timer', config: videoCron }],
    },
  ]
}

export async function applyRagWorkerConfig(app, configs) {
  const results = []
  for (const config of configs) {
    const detail = await app.functions.getFunctionDetail(config.name)
    const existing = {}
    for (const item of detail?.Environment?.Variables || []) existing[item.Key] = item.Value
    const envVariables = { ...existing, ...config.envVariables }
    await app.functions.updateFunctionConfig({
      name: config.name,
      timeout: config.timeout,
      memorySize: config.memorySize,
      envVariables,
    })
    if (config.triggers?.length) {
      await app.functions.createFunctionTriggers(config.name, config.triggers)
    }
    results.push({
      name: config.name,
      timeout: config.timeout,
      memorySize: config.memorySize,
      triggerNames: (config.triggers || []).map((trigger) => trigger.name),
    })
  }
  return results
}

export function parseConfigureRagWorkersArgs(argv = process.argv.slice(2), env = process.env) {
  const home = os.homedir()
  const camEnv = loadDotEnvFile(path.join(home, '.happyhome', 'cam.env'))
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    dryRun: argv.includes('--dry-run'),
    envId: getFlagValue(argv, 'env-id', env.TCB_ENV || camEnv.TCB_ENV || 'cloudbase-3gh862acb1505ff3'),
    secretId: env.TENCENTCLOUD_SECRETID || camEnv.TENCENTCLOUD_SECRETID,
    secretKey: env.TENCENTCLOUD_SECRETKEY || camEnv.TENCENTCLOUD_SECRETKEY,
    workerToken: getFlagValue(argv, 'worker-token', resolvePostRagWorkerToken(env)),
    timeoutSeconds: positiveInt(getFlagValue(argv, 'timeout-seconds', env.HH_RAG_WORKER_TIMEOUT_SECONDS || ''), DEFAULT_RAG_WORKER_TIMEOUT_SECONDS),
    memorySizeMb: positiveInt(getFlagValue(argv, 'memory-mb', env.HH_RAG_WORKER_MEMORY_MB || ''), DEFAULT_RAG_WORKER_MEMORY_MB),
    ragCron: getFlagValue(argv, 'rag-cron', env.HH_POST_RAG_WORKER_CRON || DEFAULT_POST_RAG_CRON),
    videoCron: getFlagValue(argv, 'video-cron', env.HH_POST_VIDEO_RAG_WORKER_CRON || DEFAULT_POST_VIDEO_RAG_CRON),
  }
}

function printUsage() {
  console.log(`Usage:
  npm run configure:rag-workers

Options:
  --dry-run                    Print config without applying it.
  --timeout-seconds <n>        Worker timeout. Defaults to ${DEFAULT_RAG_WORKER_TIMEOUT_SECONDS}.
  --memory-mb <n>              Worker memory. Defaults to ${DEFAULT_RAG_WORKER_MEMORY_MB}.
  --rag-cron <cron>            post-rag-worker timer. Defaults to "${DEFAULT_POST_RAG_CRON}".
  --video-cron <cron>          post-video-rag-worker timer. Defaults to "${DEFAULT_POST_VIDEO_RAG_CRON}".
  --worker-token <token>       POST_RAG_WORKER_TOKEN; otherwise read from ~/.happyhome env files.
  --env-id <envId>             CloudBase env id.
`)
}

async function main() {
  const options = parseConfigureRagWorkersArgs()
  if (options.help) {
    printUsage()
    return
  }
  if (!options.secretId || !options.secretKey) {
    throw new Error('Missing TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY in env or ~/.happyhome/cam.env')
  }
  if (!options.workerToken) {
    throw new Error('Missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN in env or ~/.happyhome env files')
  }
  const configs = buildRagWorkerFunctionConfigs(options)
  if (options.dryRun) {
    console.log(JSON.stringify(configs.map((config) => ({
      ...config,
      envVariables: { POST_RAG_WORKER_TOKEN: '[redacted]' },
    })), null, 2))
    return
  }
  const app = CloudBase.init({ secretId: options.secretId, secretKey: options.secretKey, envId: options.envId })
  const results = await applyRagWorkerConfig(app, configs)
  console.log(JSON.stringify({ envId: options.envId, results }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[configure-rag-workers] FAILED: ${error?.stack || error?.message || error}`)
    process.exit(1)
  })
}
