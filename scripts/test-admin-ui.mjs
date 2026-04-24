import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { runLoggedCommand, ROOT, waitForHttp } from './lib/process-utils.mjs'
import { ensureDir, writeNamedReport } from './lib/reporting.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const adminWebDir = join(ROOT, 'admin-web')
const host = process.env.ADMIN_WEB_HOST || '127.0.0.1'
const port = String(process.env.ADMIN_WEB_PORT || '4173')
const baseURL = process.env.ADMIN_WEB_BASE_URL || `http://${host}:${port}`
const reportDir = process.env.HH_REPORT_DIR || join(ROOT, 'artifacts', 'admin-ui')
const previewLogPath = join(reportDir, 'admin-preview.log')
const playwrightLogPath = join(reportDir, 'playwright.log')

if (!process.env.CLOUD_API_URL || !process.env.VITE_CLOUD_API_URL) {
  throw new Error('CLOUD_API_URL and VITE_CLOUD_API_URL are required for scripts/test-admin-ui.mjs')
}

function stopProcessTree(child) {
  return new Promise((resolvePromise) => {
    if (!child?.pid) {
      resolvePromise()
      return
    }

    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
      killer.on('close', () => resolvePromise())
      killer.on('error', () => resolvePromise())
      return
    }

    try {
      child.kill('SIGTERM')
    } catch {}
    resolvePromise()
  })
}

async function main() {
  await ensureDir(reportDir)

  const browserInstall = await runLoggedCommand({
    command: 'npx.cmd',
    args: ['playwright', 'install', 'chromium'],
    cwd: ROOT,
    env: process.env,
    logPath: join(reportDir, 'playwright-install.log'),
  })
  if (browserInstall.code !== 0) {
    process.exit(browserInstall.code)
  }

  const buildResult = await runLoggedCommand({
    command: 'npm.cmd',
    args: ['run', 'build'],
    cwd: adminWebDir,
    env: process.env,
    logPath: join(reportDir, 'admin-build.log'),
  })
  if (buildResult.code !== 0) {
    process.exit(buildResult.code)
  }

  const previewServerCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm.cmd'
  const previewServerArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm.cmd', 'run', 'preview', '--', '--host', host, '--port', port]
    : ['run', 'preview', '--', '--host', host, '--port', port]

  const previewServer = spawn(
    previewServerCommand,
    previewServerArgs,
    {
      cwd: adminWebDir,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const previewLog = createWriteStream(previewLogPath, { flags: 'w' })
  previewServer.stdout.on('data', (chunk) => {
    previewLog.write(chunk)
    process.stdout.write(chunk)
  })
  previewServer.stderr.on('data', (chunk) => {
    previewLog.write(chunk)
    process.stderr.write(chunk)
  })

  let playwrightResult = null

  try {
    await waitForHttp(baseURL, { timeoutMs: 30000, intervalMs: 500 })
    playwrightResult = await runLoggedCommand({
      command: 'npx.cmd',
      args: ['playwright', 'test'],
      cwd: ROOT,
      env: {
        ...process.env,
        ADMIN_WEB_BASE_URL: baseURL,
        PLAYWRIGHT_HTML_REPORT: process.env.PLAYWRIGHT_HTML_REPORT || join(ROOT, 'artifacts', 'playwright-report'),
        PLAYWRIGHT_OUTPUT_DIR: process.env.PLAYWRIGHT_OUTPUT_DIR || join(ROOT, 'artifacts', 'playwright-artifacts'),
      },
      logPath: playwrightLogPath,
    })
  } finally {
    previewLog.end()
    await stopProcessTree(previewServer)
  }

  const exitCode = playwrightResult?.code ?? 1
  await writeNamedReport(reportDir, 'admin-ui-summary.json', {
    stage: 'admin-ui-playwright',
    baseURL,
    exitCode,
    finishedAt: new Date().toISOString(),
    playwrightLogPath,
    previewLogPath,
  })

  process.exit(exitCode)
}

main().catch(async (error) => {
  console.error(error?.stack || error?.message || error)
  await writeNamedReport(reportDir, 'admin-ui-summary.json', {
    stage: 'admin-ui-playwright',
    baseURL,
    exitCode: 1,
    finishedAt: new Date().toISOString(),
    error: error?.stack || error?.message || String(error),
  })
  process.exit(1)
})
