import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function readCompiledStringField(source, field) {
  const pattern = new RegExp(`(?:^|[,{])\\s*${field}\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`)
  const match = pattern.exec(String(source || ''))
  if (!match) throw new Error(`mini-program compiled build-info is missing ${field}`)
  return JSON.parse(match[1])
}

export function parseMiniprogramPackageIdentity(source) {
  const version = readCompiledStringField(source, 'version')
  const desc = readCompiledStringField(source, 'desc')
  const buildId = readCompiledStringField(source, 'buildId')
  if (buildId !== `mp-${version}`) {
    throw new Error(`mini-program compiled build-info buildId mismatch: expected mp-${version}, got ${buildId}`)
  }
  return { version, desc, buildId }
}

export async function readMiniprogramPackageIdentity(projectPath) {
  const buildInfoPath = resolve(projectPath, 'generated', 'build-info.js')
  return parseMiniprogramPackageIdentity(await readFile(buildInfoPath, 'utf8'))
}
