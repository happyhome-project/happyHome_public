import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ROOT, runLoggedCommand } from './lib/process-utils.mjs'
import { ensureDir, sanitizeName, writeJson } from './lib/reporting.mjs'
import { sendWeComNotification } from './notify-wecom.mjs'
import {
  REQUIRED_NIGHTLY_ENV,
  completeNightlyFailure,
  createNotificationPlan,
  deriveNightlyResult,
  finalizeNightlyRun,
  writeNightlyOutcome,
} from './lib/nightly-notification-policy.mjs'

const startedAt = new Date()
const dateToken = startedAt.toISOString().replace(/[:.]/g, '-')
const artifactRoot = process.env.HH_ARTIFACT_ROOT || join(ROOT, 'artifacts', 'nightly', dateToken)
const logDir = join(artifactRoot, 'logs')
const reportDir = join(artifactRoot, 'reports')
const summaryPath = join(artifactRoot, 'summary.json')
const summaryMarkdownPath = join(artifactRoot, 'summary.md')
const sharedEnv = {
  ...process.env,
  HH_ARTIFACT_ROOT: artifactRoot,
}

const stageStatus = new Map()
const stages = []
function shouldSkip(skipOnFailure = []) {
  return skipOnFailure.some((name) => {
    const status = stageStatus.get(name)
    return status === 'failed' || status === 'skipped'
  })
}

async function runStage({ key, name, command, args = [], cwd = ROOT, env = {}, skipOnFailure = [] }) {
  if (shouldSkip(skipOnFailure)) {
    const stage = {
      key,
      name,
      status: 'skipped',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      command: `${command} ${args.join(' ')}`.trim(),
      logPath: '',
      notes: `Skipped because one of [${skipOnFailure.join(', ')}] failed.`,
    }
    stageStatus.set(key, stage.status)
    stages.push(stage)
    return stage
  }

  const stageStartedAt = new Date()
  const logPath = join(logDir, `${sanitizeName(key)}.log`)
  console.log(`\n=== Stage: ${name} ===`)
  const result = await runLoggedCommand({
    command,
    args,
    cwd,
    env: {
      ...sharedEnv,
      ...env,
    },
    logPath,
  })

  const stage = {
    key,
    name,
    status: result.code === 0 ? 'passed' : 'failed',
    startedAt: stageStartedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    command: `${command} ${args.join(' ')}`.trim(),
    logPath,
  }
  stageStatus.set(key, stage.status)
  stages.push(stage)
  return stage
}

async function collectCleanupIssues(dirPath) {
  const issues = []

  async function walk(currentDir) {
    let entries = []
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue

      try {
        const parsed = JSON.parse(await readFile(fullPath, 'utf8'))
        if (Array.isArray(parsed?.cleanup?.issues)) {
          issues.push(...parsed.cleanup.issues)
        }
      } catch {}
    }
  }

  await walk(dirPath)
  return issues
}

async function persistNightlyOutcome(outcome) {
  await writeNightlyOutcome({
    outcome,
    writeJson: (summary) => writeJson(summaryPath, summary),
    writeMarkdown: (markdown) => writeFile(summaryMarkdownPath, markdown, 'utf8'),
    writeStepSummary: process.env.GITHUB_STEP_SUMMARY
      ? (markdown) => writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8')
      : null,
  })
}

async function main() {
  await ensureDir(logDir)
  await ensureDir(reportDir)

  const missingEnv = REQUIRED_NIGHTLY_ENV.filter((name) => !process.env[name])
  if (missingEnv.length > 0) {
    const preflight = {
      key: 'preflight-env',
      name: 'preflight env validation',
      status: 'failed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      command: 'validate required environment variables',
      logPath: '',
      notes: `Missing required env vars: ${missingEnv.join(', ')}`,
    }
    stageStatus.set(preflight.key, preflight.status)
    stages.push(preflight)
    throw new Error(preflight.notes)
  }

  await runStage({ key: 'install', name: 'npm ci', command: 'npm.cmd', args: ['ci'] })
  await runStage({ key: 'cloud-local', name: 'cloud local tests', command: 'npm.cmd', args: ['test', '--workspace', 'cloud'], skipOnFailure: ['install'] })
  await runStage({ key: 'miniprogram-typecheck', name: 'miniprogram type-check', command: 'npm.cmd', args: ['run', 'type-check', '--workspace', 'miniprogram'], skipOnFailure: ['install'] })
  await runStage({ key: 'miniprogram-unit', name: 'miniprogram unit tests', command: 'npm.cmd', args: ['run', 'test:unit', '--workspace', 'miniprogram'], skipOnFailure: ['install'] })
  await runStage({ key: 'admin-typecheck', name: 'admin-web type-check', command: 'npm.cmd', args: ['run', 'type-check', '--workspace', 'admin-web'], skipOnFailure: ['install'] })
  await runStage({ key: 'admin-build', name: 'admin-web build', command: 'npm.cmd', args: ['run', 'build', '--workspace', 'admin-web'], skipOnFailure: ['install'] })
  await runStage({ key: 'cloud-real', name: 'cloud real-environment tests', command: 'npm.cmd', args: ['run', 'test:cloud', '--workspace', 'cloud'], skipOnFailure: ['install'] })
  await runStage({
    key: 'h5-e2e',
    name: 'H5 scenario suite',
    command: process.execPath,
    args: ['scripts/h5-test/run-all.mjs'],
    env: { HH_REPORT_DIR: join(reportDir, 'h5') },
    skipOnFailure: ['install'],
  })
  await runStage({
    key: 'admin-api',
    name: 'admin API smoke',
    command: process.execPath,
    args: ['scripts/test-admin-api.mjs'],
    env: { HH_REPORT_DIR: join(reportDir, 'admin-api') },
    skipOnFailure: ['install'],
  })
  await runStage({
    key: 'admin-ui',
    name: 'admin UI Playwright',
    command: 'npm.cmd',
    args: ['run', 'test:admin:ui'],
    env: {
      HH_REPORT_DIR: join(reportDir, 'admin-ui'),
      PLAYWRIGHT_HTML_REPORT: join(artifactRoot, 'playwright-report'),
      PLAYWRIGHT_OUTPUT_DIR: join(artifactRoot, 'playwright-artifacts'),
    },
    skipOnFailure: ['install', 'admin-build'],
  })
  await runStage({ key: 'mp-build', name: 'miniprogram build', command: 'npm.cmd', args: ['run', 'build:mp-weixin', '--workspace', 'miniprogram'], skipOnFailure: ['install'] })
  await runStage({ key: 'mp-devtools', name: 'miniprogram DevTools automation capability', command: 'npm.cmd', args: ['run', 'test:mp:devtools'], skipOnFailure: ['install', 'mp-build'] })

  const cleanupIssues = await collectCleanupIssues(reportDir)
  const { status, testStatus } = deriveNightlyResult({ stages, cleanupIssues })
  const summary = {
    status,
    testStatus,
    branch: process.env.GITHUB_REF_NAME || process.env.BRANCH_NAME || 'codex/cicd',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    artifactRoot,
    cleanupIssues,
    stages,
  }

  await writeJson(summaryPath, summary)
  const notificationPlan = createNotificationPlan({ webhook: process.env.WECOM_WEBHOOK_URL })
  let notifyStage = notificationPlan.stage
  if (!notificationPlan.shouldRun) {
    stageStatus.set(notifyStage.key, notifyStage.status)
    stages.push(notifyStage)
    console.warn(notificationPlan.warning)
  } else {
    notifyStage = await runStage({
      key: 'notify-wecom',
      name: 'WeCom notification',
      command: process.execPath,
      args: ['scripts/notify-wecom.mjs', summaryPath],
      env: { HH_SUMMARY_PATH: summaryPath },
    })
  }
  const outcome = finalizeNightlyRun({ summary, notificationStage: notifyStage })
  if (outcome.warning) console.warn(outcome.warning)
  await persistNightlyOutcome(outcome)
  if (outcome.exitCode !== 0) process.exit(outcome.exitCode)
}

main().catch(async (error) => {
  console.error(error?.stack || error?.message || error)
  await ensureDir(artifactRoot)
  await completeNightlyFailure({
    error,
    stages,
    cleanupIssues: [],
    webhook: process.env.WECOM_WEBHOOK_URL,
    summary: {
      status: 'failed',
      testStatus: 'failed',
      branch: process.env.GITHUB_REF_NAME || 'codex/cicd',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      artifactRoot,
      cleanupIssues: [],
      stages,
    },
    sendNotification: (failureSummary) => sendWeComNotification({
      webhook: process.env.WECOM_WEBHOOK_URL,
      summary: failureSummary,
    }),
    writeOutcome: persistNightlyOutcome,
    warn: (warning) => console.warn(warning),
  })
  process.exit(1)
})
