#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

export const DEFAULT_ENV_ID = 'cloudbase-3gh862acb1505ff3'
export const DEFAULT_FUNCTIONS = ['user', 'community', 'member', 'section', 'post', 'admin', 'http-gateway']
export const REQUIRED_SMOKE_LABELS = [
  'HH_CLOUD_INVOKE_SMOKE_COMMUNITY',
  'HH_CLOUD_INVOKE_SMOKE_MEMBER',
  'HH_CLOUD_INVOKE_SMOKE_POST',
  'HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY',
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
  const runId = getFlag('run-id', env.HH_RELEASE_CLOUD_SMOKE_RUN_ID || makeRunId())
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
    noFixture: argv.includes('--no-fixture'),
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
    .replace(/((?:apiKey|apiKeyId|apiKeySecret|secretId|secretKey)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[REDACTED]')

  for (const key of ['ADMIN_TOKEN', 'TEST_ADMIN_SESSION_TOKEN', 'TCB_SECRET_ID', 'TCB_SECRET_KEY', 'TCB_API_KEY']) {
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

function logAttemptLimits(logLimit) {
  return [logLimit, Math.min(logLimit, 5), 1]
    .filter((limit) => Number.isFinite(limit) && limit > 0)
    .filter((limit, index, values) => values.indexOf(limit) === index)
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
    await writeJson(payloadPath, payload)
    const record = await this.runTcb(stage, ['fn', 'invoke', fn, '-d', `@${payloadPath}`], payload)
    const ok = opts.expectedFailure ? true : record.ok
    if (ok && opts.label) this.addLabel(opts.label)
    if (!ok && opts.required !== false) this.fail(`${fn} invoke failed`, { stage, status: record.status })
    return record
  }

  async log(fn, opts = {}) {
    const stage = `log-${fn}${opts.errorOnly ? '-error' : ''}`
    const required = opts.required !== false
    const limits = required ? logAttemptLimits(this.options.logLimit) : [Math.min(this.options.logLimit, 5)]
    const attempts = []
    let selected = null

    for (let index = 0; index < limits.length; index += 1) {
      if (index > 0 && this.options.logWaitMs > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(this.options.logWaitMs, 5000)))
      }
      const attemptStage = limits.length === 1 ? stage : `${stage}-attempt-${index + 1}`
      const args = ['fn', 'log', fn, '--limit', String(limits[index]), '--order', 'desc']
      if (opts.errorOnly) args.push('--error')
      const record = await this.runTcb(attemptStage, args)
      attempts.push(record)
      selected = record
      if (record.ok && includesRequiredText(record, opts.contains)) break
    }

    const ok = Boolean(selected?.ok && includesRequiredText(selected, opts.contains))
    const aggregate = {
      ...(selected || {}),
      stage,
      ok,
      attempts,
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
    if (this.options.only.includes('community')) {
      await this.invoke('community', { action: 'list' }, {
        label: 'HH_CLOUD_INVOKE_SMOKE_COMMUNITY',
      })
    }
    if (this.options.only.includes('member')) {
      await this.invoke('member', { action: 'myCommunities' }, {
        label: 'HH_CLOUD_INVOKE_SMOKE_MEMBER',
      })
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
      await this.invoke('post', payload, {
        label: 'HH_CLOUD_INVOKE_SMOKE_POST',
      })
    }
    if (this.options.only.includes('http-gateway')) {
      await this.invoke('http-gateway', { httpMethod: 'OPTIONS', headers: {}, body: '' }, {
        name: 'options',
        label: 'HH_CLOUD_INVOKE_SMOKE_HTTP_GATEWAY',
      })
    }
    if (this.options.only.includes('user')) {
      await this.invoke('user', { action: 'login', nickName: 'ReleaseSmoke', avatarUrl: '' }, {
        name: 'openid-guard',
        expectedFailure: true,
        required: false,
        label: 'HH_CLOUD_RUNTIME_GUARD_USER',
      })
    }
    if (this.options.only.includes('section')) {
      await this.invoke('section', { action: 'list', communityId: '__release_smoke_missing__' }, {
        name: 'membership-guard',
        expectedFailure: true,
        required: false,
        label: 'HH_CLOUD_RUNTIME_GUARD_SECTION',
      })
    }
  }

  adminPayload(action, params = {}) {
    return {
      action,
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
    }
    if (this.cleanup.ok) this.addLabel('HH_CLOUD_FIXTURE_CLEANUP_OK')
    else this.fail('admin fixture cleanup failed', { communityId })
    await writeJson(resolve(this.options.evidenceDir, 'cleanup.json'), this.cleanup)
  }

  async captureLogs() {
    if (this.options.logWaitMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, this.options.logWaitMs))
    }
    for (const fn of this.options.only) {
      const record = await this.log(fn, {
        required: fn === 'post',
        label: `HH_CLOUD_LOG_CAPTURE_${fn.toUpperCase().replace(/-/g, '_')}`,
        contains: fn === 'post' ? this.options.runId : '',
      })
    }
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
