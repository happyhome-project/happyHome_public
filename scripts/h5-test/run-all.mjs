import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoggedCommand } from '../lib/process-utils.mjs'
import { ensureDir, sanitizeName, writeNamedReport } from '../lib/reporting.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(dirname(__dirname))
const reportDir = process.env.HH_REPORT_DIR || join(ROOT, 'artifacts', 'h5-reports')
const logDir = join(reportDir, 'logs')

if (!process.env.CLOUD_API_URL) {
  throw new Error('CLOUD_API_URL is required for scripts/h5-test/run-all.mjs')
}

async function listScenarioFiles() {
  const entries = await readdir(__dirname, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^\d{2}-.*\.mjs$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
}

async function main() {
  await ensureDir(reportDir)
  await ensureDir(logDir)

  const scenarioFiles = await listScenarioFiles()
  const results = []

  for (const fileName of scenarioFiles) {
    const logPath = join(logDir, `${sanitizeName(fileName)}.log`)
    console.log(`\n=== H5 scenario: ${fileName} ===`)
    const result = await runLoggedCommand({
      command: process.execPath,
      args: [join(__dirname, fileName)],
      cwd: ROOT,
      env: { ...process.env, HH_REPORT_DIR: reportDir },
      logPath,
    })

    results.push({
      scenario: fileName,
      code: result.code,
      durationMs: result.durationMs,
      logPath,
    })
  }

  const failedCount = results.filter((item) => item.code !== 0).length
  await writeNamedReport(reportDir, 'summary.json', {
    stage: 'h5-run-all',
    generatedAt: new Date().toISOString(),
    failedCount,
    results,
  })

  if (failedCount > 0) process.exit(1)
}

await main()
