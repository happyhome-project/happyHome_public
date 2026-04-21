import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export function sanitizeName(name) {
  return String(name || 'unnamed').replace(/[^a-zA-Z0-9._-]+/g, '-')
}

export async function ensureDir(dirPath) {
  if (!dirPath) return
  await mkdir(dirPath, { recursive: true })
}

export async function writeJson(filePath, data) {
  await ensureDir(dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function resolveReportFile(reportDir, fileName) {
  if (!reportDir) return ''
  return resolve(reportDir, fileName)
}

export async function writeNamedReport(reportDir, fileName, data) {
  const filePath = resolveReportFile(reportDir, fileName)
  if (!filePath) return ''
  await writeJson(filePath, data)
  return filePath
}
