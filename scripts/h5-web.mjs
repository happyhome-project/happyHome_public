#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseEnvFile } from './h5-test-tenant.mjs'

const execFileAsync = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function inspectGit(root) {
  const run = async (...args) => (await execFileAsync('git', args, { cwd: root })).stdout.trim()
  return { cwd: root, branch: await run('branch', '--show-current'), head: await run('rev-parse', 'HEAD') }
}

async function waitUntilReady(url, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`H5 dev server exited before ready (${child.exitCode})`)
    try { const response = await fetch(url); if (response.ok) return } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  throw new Error(`H5 dev server did not become ready: ${url}`)
}

async function killOwnTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/pid', String(pid), '/t', '/f']).catch((error) => {
      if (!/not found|no running instance/i.test(`${error.stdout || ''} ${error.stderr || ''}`)) throw error
    })
  } else process.kill(pid, 'SIGTERM')
}

export function createH5WebLauncher({ root = ROOT, home = homedir(), findPort = availablePort, spawnChild = spawn, waitUntilReady: wait = waitUntilReady, killTree = killOwnTree, inspectGit: git = () => inspectGit(root), log = console.log } = {}) {
  return { async start() {
    const configPath = join(home, '.happyhome', 'h5-web.env')
    const values = parseEnvFile(configPath)
    const missing = ['HH_CLOUDBASE_ENV_ID', 'HH_CLOUDBASE_ACCESS_KEY'].filter((key) => !String(values[key] || '').trim())
    if (missing.length) throw new Error(`missing H5 Web public config: ${missing.join(', ')}`)
    const [port, gitInfo] = await Promise.all([findPort(), git()])
    const url = `http://127.0.0.1:${port}`
    const child = spawnChild('npm.cmd', ['--workspace', 'miniprogram', 'run', 'dev:h5', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, VITE_CLOUDBASE_ENV_ID: values.HH_CLOUDBASE_ENV_ID.trim(), VITE_CLOUDBASE_ACCESS_KEY: values.HH_CLOUDBASE_ACCESS_KEY.trim() },
    })
    let stopped = false
    const stop = async () => { if (!stopped) { stopped = true; await killTree(child.pid) } }
    try { await wait(url, child) } catch (error) { await stop(); throw error }
    log(JSON.stringify({ url, cwd: gitInfo.cwd, branch: gitInfo.branch, head: gitInfo.head }))
    return { child, port, url, git: gitInfo, stop }
  } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const running = await createH5WebLauncher().start()
  const shutdown = async () => { await running.stop(); process.exit() }
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown)
}
