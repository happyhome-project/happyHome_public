#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import { resolvePostRagWorkerToken } from './lib/post-rag-worker-token.mjs'
import { resolveAdminInternalToken } from './lib/admin-internal-token.mjs'
import { parsePositiveIntOption, runBounded } from './lib/release-concurrency.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

export const DEFAULT_ENV_ID = 'cloudbase-3gh862acb1505ff3'
export const DEFAULT_FUNCTIONS = ['user', 'community', 'member', 'section', 'post', 'post-rag-worker', 'post-video-rag-worker', 'admin', 'http-gateway', 'home-prefetch']
export const REQUIRED_SMOKE_LABELS = [
  'HH_CLOUD_INVOKE_SMOKE_COMMUNITY',
  'HH_CLOUD_INVOKE_SMOKE_MEMBER',
  'HH_CLOUD_INVOKE_SMOKE_POST',
  'HH_CLOUD_INVOKE_SMOKE_POST_RAG_WORKER',
  'HH_CLOUD_INVOKE_SMOKE_POST_VIDEO_RAG_WORKER',
  'HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY',
  'HH_CLOUD_INVOKE_SMOKE_HOME_PREFETCH',
  'HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE',
  'HH_CLOUD_LOG_CAPTURE_POST',
  'HH_CLOUD_FIXTURE_CLEANUP_OK',
]

function pad(value) {
  return String(value).padStart(2, '0')
}

export function makeRunId(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    Math.random().toString(36).slice(2, 8),
  ].join('')
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const getFlag = (name, fallback = '') => {
    const equalsArg = argv.find((arg) => arg.startsWith(`--${name}=`))
    if (equalsArg) return equalsArg.slice(name.length + 3)
    const index = argv.indexOf(`--${name}`)
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) return argv[index + 1]
    return fallback
  }

  const onlyValue = getFlag('only')
  const only = onlyValue
    ? onlyValue.split(',').map((item) => item.trim()).filter(Boolean)
    : [...DEFAULT_FUNCTIONS]
  const envId = getFlag('env-id', env.TCB_ENV || DEFAULT_ENV_ID)
  const logLimit = Number(getFlag('log-limit', env.HH_CLOUD_SMOKE_LOG_LIMIT || '30'))
  const logWaitMs = Number(getFlag('log-wait-ms', env.HH_CLOUD_SMOKE_LOG_WAIT_MS || '3000'))
  const commandTimeoutMs = Number(getFlag('command-timeout-ms', env.HH_CLOUD_SMOKE_COMMAND_TIMEOUT_MS || '60000'))
  const concurrency = parsePositiveIntOption(
    getFlag('concurrency', getFlag('cloud-smoke-concurrency', env.HH_CLOUD_SMOKE_CONCURRENCY || '3')),
    3,
    { min: 1, max: 5 },
  )
  const runId = getFlag('run-id', env.HH_RELEASE_CLOUD_SMOKE_RUN_ID || makeRunId())
  const workerToken = getFlag('worker-token', resolvePostRagWorkerToken(env))
  const adminInternalToken = getFlag('admin-internal-token', resolveAdminInternalToken(env))
  const evidenceDir = getFlag(
    'evidence-dir',
    resolve(ROOT, '.codex-local', 'release-evidence', runId, 'cloud-smoke'),
  )

  return {
    envId,
    only: DEFAULT_FUNCTIONS.filter((fn) => only.includes(fn)),
    logLimit: Number.isFinite(logLimit) && logLimit > 0 ? Math.floor(logLimit) : 30,
    logWaitMs: Number.isFinite(logWaitMs) && logWaitMs >= 0 ? Math.floor(logWaitMs) : 3000,
    commandTimeoutMs: Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0 ? Math.floor(commandTimeoutMs) : 60000,
    concurrency,
    noFixture: argv.includes('--no-fixture'),
    workerToken,
    adminInternalToken,
    evidenceDir,
    runId,
  }
}

function quoteCmdArg(value) {
  const str = String(value)
  if (!/[ \t&()^|<>"]/.test(str)) return str
  return `"${str.replace(/"/g, '\\"')}"`
}

export function buildTcbCommand(args) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  return {
    command: npx,
    args: ['--yes', '--package', '@cloudbase/cli', 'tcb', ...args],
  }
}

export function formatCommand(command, args) {
  return [command, ...args].map(quoteCmdArg).join(' ')
}

export function redactSensitive(value, env = process.env) {
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  text = text
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/(--api-key\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:apiKey|apiKeyId|apiKeySecret|secretId|secretKey|workerToken|postRagWorkerToken|token|password)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[REDACTED]')

  for (const key of ['ADMIN_TOKEN', 'ADMIN_INTERNAL_CALL_TOKEN', 'TEST_ADMIN_SESSION_TOKEN', 'TCB_SECRET_ID', 'TCB_SECRET_KEY', 'TCB_API_KEY', 'POST_RAG_WORKER_TOKEN', 'HH_POST_RAG_WORKER_TOKEN']) {
    const secret = env[key]
    if (secret && String(secret).length >= 6) {
      text = text.split(String(secret)).join('[REDACTED]')
    }
  }
  return text
}

function findJsonStart(text) {
  const objectIndex = text.indexOf('{')
  const arrayIndex = text.indexOf('[')
  if (objectIndex < 0) return arrayIndex
  if (arrayIndex < 0) return objectIndex
  return Math.min(objectIndex, arrayIndex)
}

export function parseFirstJson(text) {
  const source = String(text || '').trim()
  let start = findJsonStart(source)
  while (start >= 0) {
    for (let end = source.length; end > start; end--) {
      const candidate = source.slice(start, end).trim()
      try {
        return JSON.parse(candidate)
      } catch {
        // Keep shrinking until we find the JSON payload after CLI banners.
      }
    }
    const nextObject = source.indexOf('{', start + 1)
    const nextArray = source.indexOf('[', start + 1)
    if (nextObject < 0) start = nextArray
    else if (nextArray < 0) start = nextObject
    else start = Math.min(nextObject, nextArray)
  }
  return null
}

export function parseRetMsg(value) {
  const text = String(value || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function extractFunctionResult(parsed) {
  const data = parsed?.data || parsed
  if (!data || typeof data !== 'object') return parsed
  if (typeof data.RetMsg !== 'undefined') return parseRetMsg(data.RetMsg)
  if (typeof data.result !== 'undefined') return data.result
  return parsed
}

export function analyzeCloudInvoke(parsed) {
  const data = parsed?.data
  if (!data || typeof data !== 'object' || !('InvokeResult' in data || 'RetMsg' in data || 'ErrMsg' in data)) {
    return null
  }
  const retMsg = parseRetMsg(data.RetMsg)
  const hasRetMsgError = retMsg && typeof retMsg === 'object' && (
    Number(retMsg.errorCode || 0) !== 0 ||
    Number(retMsg.statusCode || 0) >= 400 ||
    Boolean(retMsg.errorMessage)
  )
  const ok = Number(data.InvokeResult || 0) === 0 && !String(data.ErrMsg || '').trim() && !hasRetMsgError
  return {
    ok,
    requestId: data.FunctionRequestId || data.RequestId || '',
    errMsg: data.ErrMsg || '',
    retMsg,
  }
}

function normalizeStdout(value) {
  return redactSensitive(String(value || ''))
}

export async function defaultRunner(command, args, options = {}) {
  const spawnCommand = process.platform === 'win32' && command.endsWith('.cmd') ? 'cmd.exe' : command
  const spawnArgs = process.platform === 'win32' && command.endsWith('.cmd')
    ? ['/d', '/s', '/c', formatCommand(command, args)]
    : args

  return await new Promise((resolveResult) => {
    let settled = false
    let timer = null
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd || ROOT,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const timeoutMs = Number(options.timeoutMs || 0)
    let stdout = ''
    let stderr = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolveResult(result)
    }
    timer = timeoutMs > 0
      ? setTimeout(() => {
          child.kill('SIGKILL')
          finish({
            status: 1,
            stdout,
            stderr,
            error: `command timed out after ${timeoutMs}ms`,
          })
        }, timeoutMs)
      : null
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      finish({ status: 1, stdout, stderr, error: String(error?.message || error) })
    })
    child.on('exit', (code) => {
      finish({ status: code ?? 1, stdout, stderr })
    })
  })
}

async function writeJson(filePath, data) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return filePath
}

function statusOk(result) {
  return result.status === 0
}

function includesRequiredText(record, text) {
  if (!text) return true
  const haystack = `${record.stdout}\n${record.stderr}\n${JSON.stringify(record.parsed || {})}`
  return haystack.includes(text)
}

function isTransientCloudBaseFailure(record) {
  const haystack = `${record.error || ''}\n${record.stdout || ''}\n${record.stderr || ''}\n${JSON.stringify(record.parsed || {})}`
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket disconnected|TLS connection|RequestTimeout|context deadline exceeded|command timed out after/i.test(haystack)
}

function logAttemptLimits(logLimit) {
  return [logLimit, Math.min(logLimit, 5), 1]
    .filter((limit) => Number.isFinite(limit) && limit > 0)
    .filter((limit, index, values) => values.indexOf(limit) === index)
}

function escapeClsQueryValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildLogsSearchArgs(fn, opts = {}, limit = 20) {
  const query = [`function_name:"${escapeClsQueryValue(fn)}"`]
  if (opts.contains) query.push(`log:"${escapeClsQueryValue(opts.contains)}"`)
  if (opts.errorOnly) query.push('status_code>200 AND status_code!=202')
  return [
    'logs',
    'search',
    '--query',
    query.join(' AND '),
    '--timeRange',
    opts.timeRange || '30m',
    '--limit',
    String(limit),
    '--sort',
    'desc',
  ]
}

function tcbArgs(actionArgs, envId, json = true) {
  const args = [...actionArgs, '--env-id', envId]
  if (json) args.push('--json')
  return args
}

export class CloudSmokeRun {
  constructor(options, runner = defaultRunner) {
    this.options = options
    this.runner = runner
    this.labels = new Set()
    this.failures = []
    this.warnings = []
    this.evidence = []
    this.cleanup = {
      attempted: false,
      ok: true,
      steps: [],
    }
  }

  addLabel(label) {
    this.labels.add(label)
    console.log(label)
  }

  fail(message, detail = {}) {
    this.failures.push({ message, ...detail })
    console.error(`[cloud-smoke] FAIL ${message}`)
  }

  warn(message, detail = {}) {
    this.warnings.push({ message, ...detail })
    console.warn(`[cloud-smoke] WARN ${message}`)
  }

  async runTcb(stage, args, payload = null) {
    const built = buildTcbCommand(tcbArgs(args, this.options.envId))
    const commandLine = formatCommand(built.command, built.args)
    console.log(`[cloud-smoke] ${stage}: ${commandLine}`)
    if (typeof this.options.beforeCommand === 'function') await this.options.beforeCommand({ stage, command: built.command, args: built.args })
    const result = await this.runner(built.command, built.args, {
      cwd: ROOT,
      env: process.env,
      timeoutMs: this.options.commandTimeoutMs,
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const parsed = parseFirstJson(output)
    const cloudInvoke = analyzeCloudInvoke(parsed)
    const record = {
      stage,
      command: redactSensitive(commandLine),
      payload: payload ? JSON.parse(redactSensitive(JSON.stringify(payload))) : null,
      status: result.status,
      ok: statusOk(result) && (cloudInvoke ? cloudInvoke.ok : true),
      stdout: normalizeStdout(result.stdout),
      stderr: normalizeStdout(result.stderr),
      error: result.error || '',
      parsed,
      cloudInvoke,
      functionResult: extractFunctionResult(parsed),
      finishedAt: new Date().toISOString(),
    }
    this.evidence.push(record)
    await writeJson(resolve(this.options.evidenceDir, `${stage}.json`), record)
    return record
  }

  async invoke(fn, payload, opts = {}) {
    const stage = `invoke-${fn}-${opts.name || payload.action || 'event'}`
    const payloadPath = resolve(this.options.evidenceDir, `${stage}-payload.json`)
    await writeJson(payloadPath, JSON.parse(redactSensitive(JSON.stringify(payload))))
    const tempDir = await mkdtemp(join(tmpdir(), 'happyhome-cloud-smoke-payload-'))
    const invokePayloadPath = join(tempDir, 'payload.json')
    let record = null
    try {
      await writeJson(invokePayloadPath, payload)
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const attemptStage = attempt === 1 ? stage : `${stage}-attempt-${attempt}`
        record = await this.runTcb(attemptStage, ['fn', 'invoke', fn, '-d', `@${invokePayloadPath}`], payload)
        if (record.ok || opts.expectedFailure || !isTransientCloudBaseFailure(record)) break
        this.warn(`${fn} invoke transient failure; retrying`, { stage: attemptStage, attempt })
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(1000 * attempt, 3000)))
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
    const ok = opts.expectedFailure ? true : record.ok
    if (ok && opts.label) this.addLabel(opts.label)
    if (!ok && opts.required !== false) this.fail(`${fn} invoke failed`, { stage, status: record.status })
    return record
  }

  async log(fn, opts = {}) {
    const stage = `log-${fn}${opts.errorOnly ? '-error' : ''}`
    const required = opts.required !== false
    const limits = required ? logAttemptLimits(this.options.logLimit) : [Math.min(this.options.logLimit, 5)]
    const searchAttempts = []
    const legacyAttempts = []
    let selected = null
    let method = 'logs-search'

    for (let index = 0; index < limits.length; index += 1) {
      if (index > 0 && this.options.logWaitMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(this.options.logWaitMs, 5000)))
      }
      const attemptStage = limits.length === 1 ? `${stage}-search` : `${stage}-search-attempt-${index + 1}`
      const args = buildLogsSearchArgs(fn, opts, limits[index])
      const record = await this.runTcb(attemptStage, args)
      searchAttempts.push(record)
      selected = record
      if (record.ok && includesRequiredText(record, opts.contains)) break
    }

    let ok = Boolean(selected?.ok && includesRequiredText(selected, opts.contains))

    if (!ok) {
      for (let index = 0; index < limits.length; index += 1) {
        if (index > 0 && this.options.logWaitMs > 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(this.options.logWaitMs, 5000)))
        }
        const attemptStage = limits.length === 1 ? `${stage}-legacy` : `${stage}-legacy-attempt-${index + 1}`
        const args = ['fn', 'log', fn, '--limit', String(limits[index]), '--order', 'desc']
        if (opts.errorOnly) args.push('--error')
        const record = await this.runTcb(attemptStage, args)
        legacyAttempts.push(record)
        selected = record
        method = 'fn-log'
        if (record.ok && includesRequiredText(record, opts.contains)) break
      }
      ok = Boolean(selected?.ok && includesRequiredText(selected, opts.contains))
    }

    const inlineLogFallback = !ok && opts.contains
      ? this.evidence.find((record) => record.stage.startsWith(`invoke-${fn}-`) && includesRequiredText(record, opts.contains))
      : null
    if (inlineLogFallback) ok = true
    const aggregate = {
      ...(selected || {}),
      stage,
      ok,
      method: inlineLogFallback ? 'inline-invoke-output' : method,
      attempts: [...searchAttempts, ...legacyAttempts],
      searchAttempts,
      legacyAttempts,
      ...(inlineLogFallback ? { inlineLogFallbackStage: inlineLogFallback.stage } : {}),
      finishedAt: new Date().toISOString(),
    }
    await writeJson(resolve(this.options.evidenceDir, `${stage}.json`), aggregate)

    if (ok && opts.label) this.addLabel(opts.label)
    if (!ok && required) {
      if (!selected?.ok) this.fail(`${fn} log capture failed`, { stage, status: selected?.status ?? 1 })
      else if (opts.contains) this.fail('post.clientLog runId was not found in recent logs', { runId: opts.contains })
      else this.fail(`${fn} log capture failed`, { stage, status: selected.status })
    }
    if (!ok && !required) this.warn(`${fn} log capture failed`, { stage, status: selected?.status ?? 1 })
    return aggregate
  }

  async smokeBasicFunctions() {
    const tasks = []
    if (this.options.only.includes('community')) {
      tasks.push(() => this.invoke('community', { action: 'list' }, {
        label: 'HH_CLOUD_INVOKE_SMOKE_COMMUNITY',
      }))
    }
    if (this.options.only.includes('member')) {
      tasks.push(() => this.invoke('member', { action: 'myCommunities' }, {
        label: 'HH_CLOUD_INVOKE_SMOKE_MEMBER',
      }))
    }
    if (this.options.only.includes('post')) {
      const payload = {
        action: 'clientLog',
        event: 'release.cloudSmoke',
        route: 'release/cloud-smoke',
        clientTime: new Date().toISOString(),
        build: { runId: this.options.runId },
        details: { runId: this.options.runId },
      }
      tasks.push(() => this.invoke('post', payload, {
        label: 'HH_CLOUD_INVOKE_SMOKE_POST',
      }))
    }
    if (this.options.only.includes('post-rag-worker')) {
      if (!this.options.workerToken) {
        tasks.push(async () => this.fail('post-rag-worker smoke missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN'))
      } else {
        tasks.push(() => this.invoke('post-rag-worker', {
          limit: 1,
          postId: '__release_smoke_missing__',
          workerToken: this.options.workerToken,
        }, {
          name: 'token-guard',
          label: 'HH_CLOUD_INVOKE_SMOKE_POST_RAG_WORKER',
        }))
      }
    }
    if (this.options.only.includes('post-video-rag-worker')) {
      if (!this.options.workerToken) {
        tasks.push(async () => this.fail('post-video-rag-worker smoke missing POST_RAG_WORKER_TOKEN / HH_POST_RAG_WORKER_TOKEN'))
      } else {
        tasks.push(() => this.invoke('post-video-rag-worker', {
          limit: 1,
          postId: '__release_smoke_missing__',
          workerToken: this.options.workerToken,
        }, {
          name: 'token-guard',
          label: 'HH_CLOUD_INVOKE_SMOKE_POST_VIDEO_RAG_WORKER',
        }))
      }
    }
    if (this.options.only.includes('http-gateway')) {
      tasks.push(() => this.invoke('http-gateway', { httpMethod: 'OPTIONS', headers: {}, body: '' }, {
        name: 'options',
        label: 'HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY',
      }))
    }
    if (this.options.only.includes('home-prefetch')) {
      tasks.push(() => this.invoke('home-prefetch', {
        httpMethod: 'GET',
        queryStringParameters: { token: '__release_smoke_missing__' },
      }, {
        name: 'missing-token-fallback',
        label: 'HH_CLOUD_INVOKE_SMOKE_HOME_PREFETCH',
      }))
    }
    if (this.options.only.includes('user')) {
      tasks.push(() => this.invoke('user', { action: 'login', nickName: 'ReleaseSmoke', avatarUrl: '' }, {
        name: 'openid-guard',
        expectedFailure: true,
        required: false,
        label: 'HH_CLOUD_RUNTIME_GUARD_USER',
      }))
    }
    if (this.options.only.includes('section')) {
      tasks.push(() => this.invoke('section', { action: 'list', communityId: '__release_smoke_missing__' }, {
        name: 'membership-guard',
        expectedFailure: true,
        required: false,
        label: 'HH_CLOUD_RUNTIME_GUARD_SECTION',
      }))
    }
    await runBounded(tasks, this.options.concurrency)
  }

  adminPayload(action, params = {}) {
    if (!this.options.adminInternalToken) {
      throw new Error('admin smoke requires ADMIN_INTERNAL_CALL_TOKEN')
    }
    return {
      action,
      _internalToken: this.options.adminInternalToken,
      _actAs: {
        accountId: `release-smoke-${this.options.runId}`,
        role: 'superAdmin',
        userId: `release-smoke-owner-${this.options.runId}`,
        username: 'release-smoke',
      },
      ...params,
    }
  }

  async adminInvoke(action, params = {}, opts = {}) {
    return await this.invoke('admin', this.adminPayload(action, params), {
      name: action.replace(/[^a-zA-Z0-9._-]+/g, '-'),
      ...opts,
    })
  }

  async smokeAdminFixture() {
    if (this.options.noFixture || !this.options.only.includes('admin')) return
    this.cleanup.attempted = true
    const name = `HH_RELEASE_SMOKE_${this.options.runId}`
    let communityId = ''
    try {
      const create = await this.adminInvoke('community.createAdmin', {
        name,
        description: 'temporary release smoke fixture',
        coverImage: '',
        location: { province: 'P', city: 'C', district: 'D', address: 'release-smoke' },
        joinType: 'open',
      }, { label: 'HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE_CREATE' })
      communityId = create.functionResult?.communityId || ''
      if (!communityId) throw new Error('community.createAdmin did not return communityId')
      this.cleanup.communityId = communityId

      const section = await this.adminInvoke('section.create', {
        communityId,
        name: `Release Smoke ${this.options.runId}`,
        icon: 'test',
        order: 0,
        type: 'realtime',
      }, { label: 'HH_CLOUD_INVOKE_SMOKE_ADMIN_SECTION' })
      const sectionId = section.functionResult?.sectionId || ''
      if (!sectionId) throw new Error('section.create did not return sectionId')

      const widgetsRes = await this.adminInvoke('section.updateWidgets', {
        sectionId,
        widgets: [{ type: 'short_text', label: 'Title', fieldKey: 'title', required: true, showInList: true, widgetId: '' }],
      }, { label: 'HH_CLOUD_INVOKE_SMOKE_ADMIN_WIDGETS' })
      const widgets = widgetsRes.functionResult?.widgets || []
      const widgetId = widgets[0]?.widgetId
      if (!widgetId) throw new Error('section.updateWidgets did not return widgetId')

      const post = await this.adminInvoke('post.createAdmin', {
        communityId,
        sectionId,
        content: { [widgetId]: `release smoke ${this.options.runId}` },
      }, { label: 'HH_CLOUD_INVOKE_SMOKE_ADMIN_POST' })
      const postId = post.functionResult?.postId || ''
      if (!postId) throw new Error('post.createAdmin did not return postId')

      const list = await this.adminInvoke('post.listAdmin', { communityId }, {
        label: 'HH_CLOUD_INVOKE_SMOKE_ADMIN_LIST',
      })
      const posts = list.functionResult?.posts || []
      if (!posts.some((item) => item._id === postId || item.id === postId)) {
        throw new Error('post.listAdmin did not include smoke post')
      }
      this.addLabel('HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE')
    } catch (error) {
      this.cleanup.ok = false
      this.fail(`admin fixture smoke failed: ${error?.message || error}`)
    } finally {
      await this.cleanupFixture(communityId)
    }
  }

  async cleanupFixture(communityId) {
    if (!communityId) {
      this.cleanup.ok = false
      this.cleanup.steps.push({ action: 'skip', ok: false, reason: 'no communityId returned' })
      await writeJson(resolve(this.options.evidenceDir, 'cleanup.json'), this.cleanup)
      return
    }

    for (const action of ['community.disable', 'community.hardDelete']) {
      const record = await this.adminInvoke(action, { communityId }, {
        required: false,
        label: `HH_CLOUD_CLEANUP_${action === 'community.disable' ? 'DISABLE' : 'HARD_DELETE'}`,
      })
      const ok = record.ok
      this.cleanup.steps.push({ action, ok, status: record.status, communityId })
      if (!ok) this.cleanup.ok = false
      if (action === 'community.hardDelete' && ok) this.cleanup.ok = true
    }
    if (this.cleanup.ok) this.addLabel('HH_CLOUD_FIXTURE_CLEANUP_OK')
    else this.fail('admin fixture cleanup failed', { communityId })
    await writeJson(resolve(this.options.evidenceDir, 'cleanup.json'), this.cleanup)
  }

  async captureLogs() {
    if (this.options.logWaitMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, this.options.logWaitMs))
    }
    if (this.options.only.includes('post')) {
      await this.log('post', {
        required: true,
        label: 'HH_CLOUD_LOG_CAPTURE_POST',
        contains: this.options.runId,
      })
    }
    const optionalLogTasks = this.options.only
      .filter((fn) => fn !== 'post')
      .map((fn) => () => this.log(fn, {
        required: false,
        label: `HH_CLOUD_LOG_CAPTURE_${fn.toUpperCase().replace(/-/g, '_')}`,
        contains: '',
      }))
    await runBounded(optionalLogTasks, this.options.concurrency)
  }

  async writeSummary() {
    const requiredLabels = REQUIRED_SMOKE_LABELS.filter((label) => {
      if (label === 'HH_CLOUD_INVOKE_SMOKE_ADMIN_FIXTURE' || label === 'HH_CLOUD_FIXTURE_CLEANUP_OK') {
        return this.options.only.includes('admin') && !this.options.noFixture
      }
      if (label === 'HH_CLOUD_LOG_CAPTURE_POST') return this.options.only.includes('post')
      const fn = label.toLowerCase().replace('hh_cloud_invoke_smoke_', '').replace(/_/g, '-')
      return this.options.only.includes(fn)
    })
    const missingLabels = requiredLabels.filter((label) => !this.labels.has(label))
    for (const label of missingLabels) this.fail(`required label missing: ${label}`)

    const summary = {
      status: this.failures.length === 0 ? 'passed' : 'failed',
      runId: this.options.runId,
      envId: this.options.envId,
      functions: this.options.only,
      evidenceDir: this.options.evidenceDir,
      concurrency: this.options.concurrency,
      labels: [...this.labels].sort(),
      requiredLabels,
      missingLabels,
      failures: this.failures,
      warnings: this.warnings,
      cleanup: this.cleanup,
      finishedAt: new Date().toISOString(),
    }
    await writeJson(resolve(this.options.evidenceDir, 'summary.json'), summary)
    return summary
  }

  async run() {
    await mkdir(this.options.evidenceDir, { recursive: true })
    console.log(`[cloud-smoke] evidenceDir=${this.options.evidenceDir}`)
    console.log(`[cloud-smoke] envId=${this.options.envId} runId=${this.options.runId}`)
    await this.smokeBasicFunctions()
    await this.smokeAdminFixture()
    await this.captureLogs()
    return await this.writeSummary()
  }
}

export async function runCloudReleaseSmoke(options = parseArgs(), runner = defaultRunner) {
  const run = new CloudSmokeRun(options, runner)
  return await run.run()
}

async function main() {
  const summary = await runCloudReleaseSmoke(parseArgs())
  console.log(`[cloud-smoke] summary=${resolve(summary.evidenceDir, 'summary.json')}`)
  if (summary.status !== 'passed') process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[cloud-smoke] FAILED: ${error?.stack || error?.message || error}`)
    process.exit(1)
  })
}
