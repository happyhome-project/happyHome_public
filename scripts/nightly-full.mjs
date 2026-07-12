import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ROOT, runLoggedCommand } from './lib/process-utils.mjs'
import { ensureDir, sanitizeName, writeJson } from './lib/reporting.mjs'

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
const requiredEnvVars = [
  'CLOUD_API_URL',
  'GATEWAY_TOKEN',
  'TEST_COMMUNITY_ID',
  'VITE_CLOUD_API_URL',
  'VITE_ADMIN_USERNAME',
  'VITE_ADMIN_PASSWORD',
  'WECOM_WEBHOOK_URL',
]

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

function renderMarkdown(summary) {
  const lines = [
    '# HappyHome Nightly Summary',
    '',
    `- Status: ${summary.status}`,
    `- Branch: ${summary.branch}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Artifact root: ${summary.artifactRoot}`,
    '',
    '## Stages',
  ]

  for (const stage of summary.stages) {
    lines.push(`- ${stage.name}: ${stage.status} (${stage.durationMs} ms)`)
  }

  if (summary.cleanupIssues.length > 0) {
    lines.push('', '## Cleanup Issues')
    for (const issue of summary.cleanupIssues) {
      lines.push(`- ${issue.communityId}: ${issue.message}`)
    }
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  await ensureDir(logDir)
  await ensureDir(reportDir)

  const missingEnv = requiredEnvVars.filter((name) => !process.env[name])
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
    await writeJson(summaryPath, {
      status: 'failed',
      branch: process.env.GITHUB_REF_NAME || process.env.BRANCH_NAME || 'codex/cicd',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      artifactRoot,
      cleanupIssues: [],
      stages,
    })
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
  const hasFailures = stages.some((stage) => stage.status === 'failed' || stage.status === 'recovered_flaky')
  const summary = {
    status: hasFailures || cleanupIssues.length > 0 ? 'failed' : 'passed',
    branch: process.env.GITHUB_REF_NAME || process.env.BRANCH_NAME || 'codex/cicd',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    artifactRoot,
    cleanupIssues,
    stages,
  }

  await writeJson(summaryPath, summary)
  const markdown = renderMarkdown(summary)
  await writeFile(summaryMarkdownPath, markdown, 'utf8')

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8')
  }

  const notifyStage = await runStage({
    key: 'notify-wecom',
    name: 'WeCom notification',
    command: process.execPath,
    args: ['scripts/notify-wecom.mjs', summaryPath],
    env: {
      HH_SUMMARY_PATH: summaryPath,
      HH_REQUIRE_WECOM: process.env.GITHUB_ACTIONS ? '1' : '0',
    },
  })

  if (notifyStage.status !== 'passed') {
    summary.status = 'failed'
  }

  await writeJson(summaryPath, summary)
  const finalMarkdown = renderMarkdown(summary)
  await writeFile(summaryMarkdownPath, finalMarkdown, 'utf8')
  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, finalMarkdown, 'utf8')
  }
  if (summary.status !== 'passed') {
    process.exit(1)
  }
}

main().catch(async (error) => {
  console.error(error?.stack || error?.message || error)
  await ensureDir(artifactRoot)
  await writeJson(summaryPath, {
    status: 'failed',
    branch: process.env.GITHUB_REF_NAME || 'codex/cicd',
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    artifactRoot,
    cleanupIssues: [],
    stages,
    error: error?.stack || error?.message || String(error),
  })
  process.exit(1)
})
