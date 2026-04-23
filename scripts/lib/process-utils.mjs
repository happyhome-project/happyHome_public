import { createWriteStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { ensureDir } from './reporting.mjs'

export const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)))

export function nowIso() {
  return new Date().toISOString()
}

export async function fileExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export async function waitForHttp(url, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {}
    await delay(intervalMs)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export async function runLoggedCommand({
  command,
  args = [],
  cwd = ROOT,
  env = process.env,
  logPath = '',
  printPrefix = '',
}) {
  if (logPath) await ensureDir(dirname(logPath))

  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    })

    const startedAt = Date.now()
    const stream = logPath ? createWriteStream(logPath, { flags: 'w' }) : null

    const writeChunk = (chunk, target) => {
      const text = chunk.toString()
      if (stream) stream.write(text)
      target.write(printPrefix ? `${printPrefix}${text}` : text)
    }

    child.stdout.on('data', (chunk) => writeChunk(chunk, process.stdout))
    child.stderr.on('data', (chunk) => writeChunk(chunk, process.stderr))

    child.on('close', (code, signal) => {
      if (stream) stream.end()
      resolvePromise({
        code: code ?? 1,
        signal: signal || '',
        durationMs: Date.now() - startedAt,
      })
    })

    child.on('error', (error) => {
      if (stream) {
        stream.write(`${error.stack || error.message}\n`)
        stream.end()
      }
      resolvePromise({
        code: 1,
        signal: '',
        durationMs: Date.now() - startedAt,
        error,
      })
    })
  })
}
