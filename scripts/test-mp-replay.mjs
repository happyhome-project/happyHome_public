/**
 * 小程序真实测试（DevTools CLI auto-replay）
 *
 * 适用于新版微信开发者工具在 miniprogram-automator 协议不兼容时的回退方案。
 *
 * 可选环境变量：
 *   WECHAT_DEVTOOLS_CLI_PATH
 *   WECHAT_DEVTOOLS_PROJECT_PATH
 *   WECHAT_DEVTOOLS_PORT
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const DEVTOOLS_PORT = Number(process.env.WECHAT_DEVTOOLS_PORT || 56287)
const DEFAULT_PROJECT_PATH = resolve(ROOT, 'miniprogram', 'dist', 'build', 'mp-weixin')
const DEFAULT_CLI_PATH = process.platform === 'win32'
  ? 'X:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat'
  : ''

function quoteForPowerShell(arg) {
  const str = String(arg)
  return `'${str.replace(/'/g, "''")}'`
}

function runCli(cliPath, args, options = {}) {
  const baseOptions = { encoding: 'utf8', ...options }
  if (process.platform === 'win32') {
    const psCommand = `& ${quoteForPowerShell(cliPath)} ${args.map(quoteForPowerShell).join(' ')}`
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCommand], baseOptions)
  }
  return spawnSync(cliPath, args, baseOptions)
}

function resolveCliPath() {
  const cliPath = String(process.env.WECHAT_DEVTOOLS_CLI_PATH || DEFAULT_CLI_PATH).trim()
  if (!cliPath || !existsSync(cliPath)) return ''
  return cliPath
}

function resolveProjectPath() {
  const projectPath = String(process.env.WECHAT_DEVTOOLS_PROJECT_PATH || DEFAULT_PROJECT_PATH).trim()
  if (!projectPath || !existsSync(projectPath)) return ''
  return projectPath
}

function main() {
  const cliPath = resolveCliPath()
  const projectPath = resolveProjectPath()

  if (!Number.isFinite(DEVTOOLS_PORT) || DEVTOOLS_PORT <= 0) {
    console.error('❌ Invalid WECHAT_DEVTOOLS_PORT. It must be a positive number.')
    process.exit(1)
  }
  if (!cliPath) {
    console.error('❌ WECHAT_DEVTOOLS_CLI_PATH is invalid or not found.')
    process.exit(1)
  }
  if (!projectPath) {
    console.error('❌ WECHAT_DEVTOOLS_PROJECT_PATH is invalid or not found.')
    process.exit(1)
  }

  console.log('🎬 Running DevTools auto-replay...')
  console.log(`   cliPath: ${cliPath}`)
  console.log(`   projectPath: ${projectPath}`)
  console.log(`   port: ${DEVTOOLS_PORT}`)

  const args = [
    'auto-replay',
    '--project', projectPath,
    '--port', String(DEVTOOLS_PORT),
    '--replay-all',
    '--trust-project',
  ]

  const result = runCli(cliPath, args, { timeout: 300000 })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')

  if (result.status !== 0) {
    console.error(`❌ auto-replay exited with status ${result.status}`)
    process.exit(result.status || 1)
  }
  if (!output.includes('auto-replay finish')) {
    console.error('❌ auto-replay did not report finish marker.')
    process.exit(1)
  }

  console.log('✅ DevTools auto-replay completed.')
}

main()
